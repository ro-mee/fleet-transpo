import { query } from '@/lib/db';
import { requireDriver, parseBody, err, handleError } from '@/lib/api/utils';
import { setDuty, standbyState, effectiveStandbyVehicle, endDutyWithReport } from '@/services/standby.service';
import { loadDriverScheduleContext } from '@/services/driver-schedule.service';
import { driverDayEligibility } from '@/lib/scheduling/day-eligibility';
import { raiseEndDutyWorkOrder } from '@/lib/inspections/maintenance';
import { CLIENT_SUBMISSION_ID_RE } from '@/lib/inspections/checklists';
import { toCalendarDay } from '@/lib/dates';
import { writeAudit } from '@/lib/audit';

const reply = data => Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });

/**
 * The vehicle an End Duty report is about: the one the driver last inspected on
 * `onDate`. Pre-Trip rows are per-trip, so the newest one is the vehicle they
 * have just finished with. Falls back to the standby pairing for a driver who
 * never inspected anything (a pure-standby day).
 *
 * `onDate` is the duty's own day, NOT today. A late report has to name the
 * vehicle the driver actually drove: resolving against today would file a
 * Post-Shift maintenance record against the wrong vehicle, which is worse than
 * the missing report it was meant to fix.
 *
 * Either can be absent, and that is not an error — see endDutyWithReport, which
 * ends duty and records the gap rather than filing a report against a vehicle
 * the driver never had.
 */
async function resolveReportVehicle(driverId, onDate = null) {
  const { rows } = await query(
    `SELECT i.vehicle_id, v.plate_number
       FROM vehicleinspection i
       JOIN vehicles v ON v.vehicle_id = i.vehicle_id
      WHERE i.driver_id=$1
        AND i.inspection_date=COALESCE($2::date,(NOW() AT TIME ZONE 'Asia/Manila')::date)
        AND i.inspection_type IN ('Pre-Shift','Pre-Trip')
      ORDER BY i.inspection_id DESC LIMIT 1`,
    [driverId, onDate]
  );
  if (rows[0]) return rows[0];
  const fallback = await effectiveStandbyVehicle(driverId);
  return fallback ? { vehicle_id: fallback, plate_number: null } : null;
}

/**
 * The most recent past duty day that still owes an End Duty report, if any.
 *
 * Two shapes count, and both are needed: a row the sweep has already closed
 * ('AutoClosed' — now the common case, because the sweep runs at 04:00 and
 * drivers report later in the morning), and a row still open because the sweep
 * has not reached it yet. 'NoVehicle' is deliberately absent: there was nothing
 * to report against, so prompting for one would be asking for the impossible.
 *
 * The two guards below are load-bearing against real live data, not defensive:
 * there are 47 open `driverattendance` rows with a past date, all of them
 * `time_in IS NULL` and status 'On Leave' or 'Absent'. Without them the app
 * would ask those drivers to report duties they never worked.
 */
async function unreportedDuty(driverId) {
  const { rows } = await query(
    `SELECT a.date, i.vehicle_id, v.plate_number
       FROM driverattendance a
       LEFT JOIN LATERAL (
         SELECT vi.vehicle_id FROM vehicleinspection vi
          WHERE vi.driver_id=a.driver_id AND vi.inspection_type IN ('Pre-Shift','Pre-Trip')
            AND vi.inspection_date=a.date
          ORDER BY vi.inspection_id DESC LIMIT 1
       ) i ON TRUE
       LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
      WHERE a.driver_id=$1
        AND a.date < (NOW() AT TIME ZONE 'Asia/Manila')::date
        AND a.date >= (NOW() AT TIME ZONE 'Asia/Manila')::date - 7
        AND a.time_in IS NOT NULL
        AND a.status IN ('Present','Late','Half-Day')
        AND (a.end_duty_outcome='AutoClosed'
             OR (a.end_duty_outcome IS NULL AND a.time_out IS NULL))
      ORDER BY a.date DESC LIMIT 1`,
    [driverId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    // `toCalendarDay` and NOT `String(row.date).slice(0, 10)`. `a.date` is a
    // Postgres `date`, and `pg`'s default parser (OID 1082) hands it back as a JS
    // Date pinned to LOCAL midnight — `String()` on one renders as "Wed Sep 23
    // 2026 00:00:00 GMT+0800", so slicing yields "Wed Sep 23". That value leaves
    // here as `unreported.date`, reaches the driver as the day to report on, and
    // comes back as `report_date`, where POST's own `/^\d{4}-\d{2}-\d{2}$/`
    // validation rejects it — the late report 400s. src/lib/dates.js documents
    // this exact trap, plus the `toISOString()` one, as having bitten this
    // codebase before; this is the canonical helper, not a second copy.
    date: toCalendarDay(row.date),
    vehicleId: row.vehicle_id ?? null,
    plateNumber: row.plate_number ?? null,
  };
}

/**
 * Whether this exact submission already filed a report for this day.
 *
 * The complement of `unreportedDuty`: a day stops being owed the moment its report
 * lands, because the service flips `end_duty_outcome` to 'Reported'. So on a retry
 * the owed-day guard is asking the wrong question — the day is no longer owed
 * PRECISELY because this submission already paid it.
 *
 * The Post-Shift row the service writes carries `client_submission_id`, which makes
 * it the durable proof that this submission landed. Day-scoped and submission-scoped
 * deliberately — and this is the ONE place the day-scoping is right, because this
 * predicate only ever runs when the CLIENT named a day (`report_date`) and is
 * therefore answering "did this submission file the day the caller asked about". A
 * submission id reused for a different day matches nothing here, so a fresh claim
 * still 400s.
 *
 * The service's recovery is deliberately NOT day-scoped (round 4). It cannot be: on
 * the ordinary path the client names no day, so the service resolves one per request,
 * and a retry after midnight resolves a different day than the attempt it is
 * retrying. There the recovered row's own `inspection_date` is authoritative. Do not
 * "make these agree" — they answer different questions, and the asymmetry is the fix.
 *
 * The `ps` alias is distinct from the resolver's `i` and `unreportedDuty`'s `vi`, and
 * `inspection_type='Post-Shift'` appears nowhere else in this file — so a test mock
 * can key on either without catching another statement. Verify that with a grep
 * before relying on it, and move the mock keys if a later change adds a second
 * Post-Shift statement.
 */
async function reportAlreadyFiled(driverId, clientSubmissionId, reportDate) {
  const { rows } = await query(
    `SELECT ps.inspection_id
       FROM vehicleinspection ps
      WHERE ps.driver_id=$1
        AND ps.client_submission_id=$2
        AND ps.inspection_type='Post-Shift'
        AND ps.inspection_date=$3::date
      LIMIT 1`,
    [driverId, clientSubmissionId, reportDate]
  );
  return Boolean(rows[0]);
}

/**
 * Whether this submission already closed a day without a report.
 *
 * The no-vehicle branch closes the day with `end_duty_outcome='NoVehicle'` and writes
 * no Post-Shift row — there is no vehicle to inspect, and `vehicleinspection.vehicle_id`
 * is NOT NULL, so it cannot. That leaves `reportAlreadyFiled` with nothing to find and
 * `unreportedDuty` excluding the day, so a replayed submission for it would be refused
 * even though the first attempt answered 200. The human partner ruled that a replay must
 * reach the service and return the recorded result, so the day is admitted here.
 *
 * Admitted BY SUBMISSION ID (Task 4's fix round 5), and day-independent for the same
 * reason the service's id arm is: the guard's job is to let a retry reach an answer the
 * first attempt already gave, and a retry can resolve a different day than the attempt
 * it is retrying. Round 3 admitted it by day because that branch had nowhere to record
 * an id; migration 129 gave `driverattendance` an `end_duty_submission_id` column, so
 * the question is now the exact one — "did THIS submission close a day this way" — and
 * it stays consistent with `reportAlreadyFiled`, which likewise demands the same id:
 * one id per attempt, reused across its retries.
 *
 * That is safe because the service returns the recorded outcome BEFORE consulting a
 * vehicle (round 4): a request for a day already closed 'NoVehicle' short-circuits to
 * `{ recorded: false, reported: false }` and writes nothing, so admitting a replayed —
 * or even a spurious — request for such a day cannot change it. The id-keyed read there
 * is what makes this admission hold across a midnight crossing too, where a day-keyed
 * read alone would hand the request a day the marker is not on.
 *
 * Round 3 justified this with "the branch is a fixed point", which was true of the branch
 * and false of the request: `vehicleId` arrives already resolved, and the route's
 * `resolveReportVehicle` falls back to the date-blind `effectiveStandbyVehicle`, so the
 * moment the driver's pairing became resolvable a replay took the REPORTED branch instead
 * — filing a Post-Shift row against a vehicle never driven that day and flipping the
 * outcome to 'Reported'. If that early return is ever removed, this predicate must go
 * back to being day-scoped and merely advisory, or be deleted; it is not safe on the
 * strength of the no-vehicle statement alone.
 *
 * The `da` alias is distinct from the resolver's `i`, `unreportedDuty`'s `vi` and
 * `reportAlreadyFiled`'s `ps`, and `end_duty_outcome='NoVehicle'` appears nowhere else in
 * this file — so a mock can key on either. Verify that with a grep before relying on it.
 */
async function closedWithoutReport(driverId, clientSubmissionId) {
  const { rows } = await query(
    `SELECT da.end_duty_outcome
       FROM driverattendance da
      WHERE da.driver_id=$1
        AND da.end_duty_submission_id=$2
        AND da.time_in IS NOT NULL
        AND da.end_duty_outcome='NoVehicle'
      LIMIT 1`,
    [driverId, clientSubmissionId]
  );
  return Boolean(rows[0]);
}

export async function GET(req) {
  try {
    const { user } = await requireDriver(req);
    const [state, ctx, unreported] = await Promise.all([
      standbyState(user.driverId),
      loadDriverScheduleContext([user.driverId]),
      unreportedDuty(user.driverId),
    ]);
    const today = driverDayEligibility({ driverId: user.driverId, date: new Date(), ctx });
    const blocked = today.blocked === true;
    return reply({
      checkedIn: state?.checked_in === true,
      busy: state?.busy === true,
      // False when the day is blocked, and that matters: a driver on rest day or
      // approved leave must not be told to complete an inspection for a shift
      // they are not working, nor sent to a screen that would refuse them.
      preshiftRequired: !blocked && state?.preshift_baseline !== true,
      // A past day that still owes a report, with the vehicle it was driven on.
      // Null when nothing is owed — the common case, and the prompt's off switch.
      unreported,
      today: { blocked, reason: today.reason ?? null, duty: today.duty ?? null },
    });
  } catch (error) { return handleError(error); }
}

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);
    if (typeof body?.active !== 'boolean') return err('active must be a boolean', 400);

    // Starting duty still goes through setDuty, which owns the whole gate order:
    // roster/leave, then privacy consent, then the day's pre-shift baseline.
    if (body.active) {
      const started = await setDuty(session.user.driverId, true);
      if (started.changed) {
        await writeAudit(req, session, {
          action: "duty_started",
          resource: "drivers",
          resourceId: session.user.driverId,
          newValues: { started: true, source: "mobile_duty" },
        });
      }
      return reply(started);
    }

    // Ending duty requires the End Duty report — the report and the time_out are
    // one transaction, so a driver cannot clock out having reported nothing.
    const clientSubmissionId = body?.client_submission_id;
    if (typeof clientSubmissionId !== 'string' || !CLIENT_SUBMISSION_ID_RE.test(clientSubmissionId)) {
      return err('client_submission_id is required', 400);
    }
    // A late report names its own day. Strictly validated rather than passed
    // through: it decides which attendance row is closed AND which vehicle the
    // report is filed against, so an unparseable value must not reach the
    // service where it would silently mean "today".
    //
    // The regex is not the check, and on its own it is a 500 waiting for a client
    // typo: `2026-02-30` and `2026-13-45` both match it and both make Postgres
    // raise `date/time field value out of range` at the first `$::date` — in the
    // guard's own queries, before the service is reached. A calendar day has to be
    // checked as a calendar day: build the date from the components and require the
    // round trip, which is exactly what a day that does not exist fails.
    const reportDate = body?.report_date ?? null;
    if (reportDate !== null) {
      const raw = String(reportDate);
      const [y, m, d] = raw.split('-').map(Number);
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(Date.UTC(y, m - 1, d)) : null;
      const real = parsed !== null
        && parsed.getUTCFullYear() === y
        && parsed.getUTCMonth() === m - 1
        && parsed.getUTCDate() === d;
      if (!real) return err('report_date must be a real YYYY-MM-DD date', 400);
    }
    // Format is not enough, and this guard is the difference between a bad date
    // being rejected and it being silently misfiled. A well-formed date the driver
    // does not owe reaches resolveReportVehicle, which finds no inspection for that
    // day and falls through to the current standby pairing — filing a Post-Shift
    // inspection against a vehicle that was never driven on that date, while the day
    // the driver actually owes stays open. (The service then closes nothing, because
    // its close statement is date-scoped, so the caller gets `recorded: false` and
    // an inspection that should not exist.)
    //
    // So the write path accepts exactly the days the read path advertises: it is
    // gated on `unreportedDuty`, the same query that built `unreported`. If a driver
    // owes more than one day, they file them one at a time as each is offered.
    //
    // One exception, and it is not a hole: a RETRY of a report that already landed.
    // The day stops being owed the moment this submission pays it — the service flips
    // the outcome to 'Reported' — so on a replayed request the guard above names a
    // different day, or none at all, and a 400 there would report failure for a report
    // that WAS recorded, to a driver whose connection already lost the first response.
    // `reportAlreadyFiled` separates that from a driver naming a day they never owed:
    // it demands the SAME submission id on a Post-Shift row for the SAME day, so a
    // retry passes and a fresh claim still 400s.
    //
    // There is a second exception, for the same reason: a submission replayed after the
    // NO-VEHICLE path closed its day. That branch writes no Post-Shift row, so
    // `reportAlreadyFiled` has nothing to find and `unreportedDuty` excludes the day; the
    // first attempt answered 200 with `recorded: false`, so refusing the replay would
    // report failure for a shift the server had already closed. `closedWithoutReport`
    // admits it — and only because the service returns the recorded no-vehicle outcome
    // before it consults a vehicle (round 4), so the admitted request cannot take the
    // reported branch and cannot change the day. The guard's job is to let the retry
    // through to an answer the first attempt already gave; it is not itself the thing that
    // makes the answer safe. It is keyed on the submission id and not the day (round 5),
    // because a retry can resolve a different day than the attempt it is retrying — which
    // is the same reason the service's own id arm is day-blind.
    //
    // Reuse of a submission id across two DIFFERENT days is a third case. When the id was
    // spent on a REPORT, the service refuses it in its recovery branch and this route turns
    // that into a 409; when it was spent on a no-vehicle close, the id arm above answers it
    // from the record instead — the recorded outcome, with nothing written. That answer is
    // matched on the submission id ACROSS days, not on the day the filing named, so the row
    // it comes from may be one the client never named. What holds after round 6 is narrower
    // than the claim this comment used to make: the service's fixed point fires on ANY row
    // the read returns rather than on whichever came back first, so row order — which
    // nothing here controls — no longer decides whether the no-vehicle answer is given.
    //
    // The `&&` short-circuits, so the ordinary path — the day IS owed — costs no extra
    // query.
    if (reportDate !== null) {
      const owed = await unreportedDuty(session.user.driverId);
      if (reportDate !== owed?.date
          && !(await reportAlreadyFiled(session.user.driverId, clientSubmissionId, reportDate))
          && !(await closedWithoutReport(session.user.driverId, clientSubmissionId))) {
        return err('report_date does not name an unreported duty day', 400);
      }
    }
    const vehicle = await resolveReportVehicle(session.user.driverId, reportDate);
    const result = await endDutyWithReport({
      driverId: session.user.driverId,
      vehicleId: vehicle?.vehicle_id ?? null,
      report: body?.report,
      clientSubmissionId,
      dutyDate: reportDate,
    });
    // The submission id is already spent on something that is not this filing: another
    // day the caller named, or a non-Post-Shift row carrying the id. Nothing was written
    // and the day this request names is left exactly as it was — still owed, still
    // advertised. A 409 rather than the guard's 400, so a client debugging from a log
    // line can tell "you do not owe this day" from "your id is already used". Tested on
    // `reason`, NOT on `recorded`: the no-vehicle branch also returns `recorded: false`
    // and must keep answering 200.
    if (result.reason === 'submission_id_already_used') {
      return err('client_submission_id was already used', 409);
    }

    if (result.changed) {
      await writeAudit(req, session, {
        action: "duty_ended",
        resource: "drivers",
        resourceId: session.user.driverId,
        newValues: { status: "Off Duty", outcome: result.reported ? "reported" : result.recorded ? "report_recorded" : "no_vehicle", source: "mobile_duty" },
      });
    }

    // Best-effort, after the commit. A maintenance failure must not strand the
    // driver at the end of their shift, and because the work order IS the
    // grounding this is logged rather than swallowed — see raiseEndDutyWorkOrder.
    if (result.recorded && result.reported && result.inspectionId) {
      await raiseEndDutyWorkOrder({
        inspectionId: result.inspectionId,
        session,
        route: '/api/mobile/driver/duty',
      });
    }
    return reply(result);
  } catch (error) { return handleError(error); }
}
