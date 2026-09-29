import { query, withTransaction } from '@/lib/db';
import { AuthError } from '@/lib/api/utils';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@/lib/consent/policies';
import { LIVE_TRIP_STATUSES } from '@/lib/constants';
import { toCalendarDay } from '@/lib/dates';
import { qualifiedGps } from '@/lib/dispatch/location-relevance';
import { resolveVehiclePairing, vehicleOperationallyAvailable } from '@/lib/ai/pair-scoring';
import { loadDriverScheduleContext } from '@/services/driver-schedule.service';
import { driverBlockReason } from '@/lib/scheduling/driver-schedule';
import { validatePostShift } from '@/lib/inspections/checklists';

export async function standbyState(driverId, db = { query }, excludeTripId = null) {
  const { rows } = await db.query(`SELECT d.*,
    (SELECT max(a.time_in) FROM driverattendance a WHERE a.driver_id=d.driver_id AND a.time_out IS NULL) AS duty_started_at,
    EXISTS (SELECT 1 FROM driverattendance a WHERE a.driver_id=d.driver_id
      AND a.date=(NOW() AT TIME ZONE 'Asia/Manila')::date AND a.time_in <= NOW() AND a.time_out IS NULL
      AND a.status IN ('Present','Late','Half-Day')) AS checked_in,
    EXISTS (SELECT 1 FROM driver_consents c WHERE c.driver_id=d.driver_id AND c.policy_version=$2) AS consented,
    EXISTS (SELECT 1 FROM trips t WHERE t.driver_id=d.driver_id AND t.deleted_at IS NULL AND t.trip_status=ANY($3::text[]) AND ($4::int IS NULL OR t.trip_id<>$4))
      OR EXISTS (SELECT 1 FROM driverincidents i WHERE (i.driver_id=d.driver_id OR i.responder_driver_id=d.driver_id)
        AND i.deleted_at IS NULL AND i.status='Open') AS busy,
    EXISTS (SELECT 1 FROM mobile_refresh_tokens m JOIN employees e ON e.employee_id=m.employee_id
      WHERE m.employee_id=d.employee_id AND m.family_id=d.standby_session_family
      AND m.revoked_at IS NULL AND m.expires_at>NOW() AND e.deleted_at IS NULL AND e.status='Active') AS session_live,
    EXISTS (SELECT 1 FROM vehicleinspection i WHERE i.driver_id=d.driver_id
      AND i.inspection_type='Pre-Shift'
      AND i.inspection_date=(NOW() AT TIME ZONE 'Asia/Manila')::date) AS preshift_baseline
    FROM drivers d WHERE d.driver_id=$1 AND d.deleted_at IS NULL`, [driverId, CURRENT_PRIVACY_POLICY_VERSION, LIVE_TRIP_STATUSES, excludeTripId]);
  return rows[0] ?? null;
}

export async function setDuty(driverId, active) {
  if (active) {
    const now = new Date();
    const block = driverBlockReason({ driverId,pickup:now,returnAt:now,ctx:await loadDriverScheduleContext([driverId]) });
    if (block?.blocked) throw new AuthError(block.reason,409,'DUTY_UNAVAILABLE');
  }
  return withTransaction(async (tx) => {
    await tx.query('SELECT driver_id FROM drivers WHERE driver_id=$1 FOR UPDATE', [driverId]);
    if (active) {
      const state = await standbyState(driverId, tx);
      if (!state?.consented) throw new AuthError('Accept the current privacy policy before starting duty.', 403);
      // Gate order is deliberate: the roster/leave check runs before the
      // transaction (see above) and consent before this, so a driver on rest day
      // or approved leave is told DUTY_UNAVAILABLE rather than being asked for an
      // inspection for a shift they are not working. Existence, not a pass/fail
      // verdict: a FAILED baseline records what the driver found, and refusing
      // duty on it would strand them with no recourse at the start of the day.
      // The failed items are surfaced to the office instead.
      if (!state?.preshift_baseline) {
        throw new AuthError('Complete the pre-shift vehicle check before starting duty.', 409, 'PRESHIFT_REQUIRED');
      }
      // One attendance row per local day is the existing attendance contract.
      // `end_duty_outcome=NULL` on the reopen, and it is not tidiness (Task 4's fix
      // round 5). The column describes how a CLOSED duty ended, so an open duty has no
      // outcome — and leaving the stale marker behind costs two things at once:
      // migration 126's sweep requires `end_duty_outcome IS NULL`, so a reopened row
      // could never be auto-closed and the driver stayed shown on duty forever with
      // nothing to rescue them; and `endDutyWithReport`'s no-vehicle fixed point reads
      // that marker, so a driver who reopened a 'NoVehicle' day and later filed a real
      // report had it silently dropped. A 'Reported' (or 'AutoClosed') day the driver
      // reopens carries the same stale marker and the same first consequence.
      //
      // The `WHERE` already distinguishes "reopen a closed row" from "do nothing to a
      // live one", so clearing the marker cannot touch a duty that was never closed.
      await tx.query(`INSERT INTO driverattendance (driver_id,date,time_in,status,check_in_method)
        VALUES ($1,(NOW() AT TIME ZONE 'Asia/Manila')::date,NOW(),'Present','manual')
        ON CONFLICT (driver_id,date) DO UPDATE SET time_in=NOW(), time_out=NULL, status='Present',
          end_duty_outcome=NULL
        WHERE driverattendance.time_out IS NOT NULL OR driverattendance.time_in IS NULL`, [driverId]);
      await tx.query("UPDATE drivers SET driver_status='Available' WHERE driver_id=$1 AND driver_status='Off Duty'", [driverId]);
      await tx.query('UPDATE drivers SET standby_tracking_enabled=true WHERE driver_id=$1', [driverId]);
    } else {
      await tx.query('UPDATE driverattendance SET time_out=NOW() WHERE driver_id=$1 AND time_in IS NOT NULL AND time_out IS NULL', [driverId]);
      await tx.query('UPDATE drivers SET standby_tracking_enabled=false, standby_session_family=NULL WHERE driver_id=$1', [driverId]);
    }
    return { checkedIn: active };
  });
}

/**
 * End duty, recording the End Duty report in the same transaction.
 *
 * One transaction on purpose. "A report is required to end duty" only means
 * something if the two writes cannot land separately — otherwise a failure
 * between them either ends a duty with no report, or files a report against a
 * driver still shown as on duty.
 *
 * @param {object} input
 * @param {number} input.driverId
 * @param {number|null} input.vehicleId  null when the driver has no vehicle to report on
 * @param {{ nothing_unusual?: boolean, findings?: string }} input.report
 * @param {string} input.clientSubmissionId
 * @param {string} [input.dutyDate]  'YYYY-MM-DD'. The day the duty belongs to.
 *   Omitted, it resolves to the newest still-open row so a shift that crosses
 *   midnight closes the row it actually opened. Passed explicitly by the late
 *   report path, where the row is a past day's and may already be auto-closed.
 * @returns {Promise<{ checkedIn: boolean, inspectionId: number|null, reported: boolean, recorded: boolean, late: boolean }>}
 */
export async function endDutyWithReport({ driverId, vehicleId, report, clientSubmissionId, dutyDate = null }) {
  const check = validatePostShift(report ?? {});
  if (!check.ok) throw new AuthError(check.error, 400, 'REPORT_INVALID');

  return withTransaction(async (tx) => {
    await tx.query('SELECT driver_id FROM drivers WHERE driver_id=$1 FOR UPDATE', [driverId]);

    // The day this report belongs to. Derived from the open row rather than from
    // "today" so a shift that started before midnight closes the row it opened,
    // and passed in by the late-report path whose row is a past day's.
    //
    // `toCalendarDay` and not `String(v).slice(0, 10)`: `driverattendance.date` is
    // a Postgres `date`, and `pg`'s default parser (OID 1082) hands back a JS Date
    // pinned to LOCAL midnight. `String()` on one renders as "Mon Sep 21 2026
    // 00:00:00 GMT+0800", so a bare `String(v).slice(0,10)` yields "Mon Sep 21" and
    // the `$1::date` below throws `invalid input syntax for type date` — every End
    // Duty call 500s. `src/lib/dates.js:25` exists for exactly this, documents both
    // traps as having already bitten this codebase, and reads Date objects by their
    // local components (never `toISOString()`, which re-reads local midnight in UTC
    // and shifts a Manila date back a day). This repo's convention is that all date
    // normalization goes through it; do not hand-roll a second copy.
    const { rows: openRows } = await tx.query(
      `SELECT date FROM driverattendance
        WHERE driver_id=$1 AND time_in IS NOT NULL AND time_out IS NULL
        ORDER BY date DESC LIMIT 1`,
      [driverId]
    );
    const resolvedDate =
      dutyDate ?? (openRows[0]?.date ? toCalendarDay(openRows[0].date) : null)
      ?? (await tx.query("SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date AS d")).rows[0].d;
    const day = toCalendarDay(resolvedDate);
    // Lateness is measured against the SAME 04:00 boundary the sweep uses, not
    // against midnight. Under Decision 1 a duty day is not abandoned until 04:00
    // the next morning, so "the resolved day is not today" is the wrong question:
    // it marks a crossing-midnight shift reported at 00:30 as late, and a report
    // filed at 03:59 as late, when Decision 1 calls both on time. The remark this
    // writes is permanent, so a mislabelled row cannot be told from a real one
    // afterwards. Subtracting the grace first asks the question that matters:
    // had the deadline for that day passed when this report arrived?
    const late = (await tx.query(
      "SELECT ($1::date < ((NOW() AT TIME ZONE 'Asia/Manila') - INTERVAL '4 hours')::date) AS yes",
      [day]
    )).rows[0].yes === true;

    // The day's own recorded outcome, read BEFORE any vehicle is considered — and that
    // ordering is the fix, not tidiness (Task 4's fix round 4). `vehicleId` arrives here
    // ALREADY RESOLVED by the route, whose `resolveReportVehicle` falls back to the
    // date-blind `effectiveStandbyVehicle`, i.e. "the pairing you have now". So on a
    // replay of a day this close already handled, a pairing that has since become
    // resolvable makes `vehicleId` non-null and the request would take the REPORTED
    // branch below: a Post-Shift row filed against a vehicle never driven that day, and
    // `end_duty_outcome` flipped from 'NoVehicle' to 'Reported'. Task 4's route admits
    // such a replay on purpose (`closedWithoutReport`), so the recorded outcome has to
    // win before the branch is chosen.
    //
    // Nothing is then written on the replay: the day is already closed this way, and the
    // first attempt already disabled standby tracking. Write-once therefore lives HERE,
    // which is why round 3's `$3` / `firstNoVehicleClose` is gone — with this early
    // return the close below can only be reached when no day this way is already closed,
    // so a guard that could never be false read as the enforcement while being
    // unreachable. `appendLateRemark`'s `$3` is a different case and stays: it is
    // arbitrated by the database (the INSERT's `ON CONFLICT … DO NOTHING RETURNING`),
    // where only one racer can win, not by a read-then-write.
    //
    // One read, two arms, because the two questions have the same answer (Task 4's fix
    // round 5 — a day-anchored read alone let the midnight retry escape it):
    //   - `end_duty_submission_id=$2` — did THIS SUBMISSION already close a day? Day-blind,
    //     which is the whole point: a retry can resolve a different day than the attempt it
    //     is retrying (see the recovery note below), and only the id spans both. A shift
    //     closed at 00:05 on the 24th closes the 23rd; the retry at 00:10 resolves the
    //     24th, finds no marker on THAT day, and would otherwise take the reported branch —
    //     a fresh Post-Shift row dated the 24th against a vehicle never driven that day,
    //     a work order that can ground the wrong vehicle, and a 200 that stops the client
    //     retrying.
    //   - the resolved day, closed — a request for a day already closed this way arriving
    //     under a DIFFERENT id (a client that minted a fresh id after losing the first
    //     response). `time_out IS NOT NULL` states the intent (this day is CLOSED) and
    //     keeps the branch off a row `setDuty` has reopened: a row reopened before this
    //     round's fix still carries the stale marker, and reading it as "closed this way"
    //     would strand the driver on a duty they had restarted.
    const { rows: priorRows } = await tx.query(
      `SELECT end_duty_outcome FROM driverattendance
        WHERE driver_id=$1
          AND (end_duty_submission_id=$2
               OR (date=$3::date AND time_in IS NOT NULL AND time_out IS NOT NULL))`,
      [driverId, clientSubmissionId, day]
    );
    // Fires on ANY row the read returned, not only the first (Task 4's fix round 6): the
    // two arms can match two different rows and the statement has no ORDER BY, so
    // `priorRows[0]` left the answer to a plan the application does not control.
    if (priorRows.some(r => r?.end_duty_outcome === 'NoVehicle')) {
      return { checkedIn: false, inspectionId: null, reported: false, recorded: false, late };
    }

    // No pairing means there is nothing to inspect, and vehicleinspection.vehicle_id
    // is NOT NULL — so no report can be filed. Ending duty still has to work:
    // a driver with no eligible pairing is exactly the one who most needs to get
    // out of the app. The gap is recorded on the attendance row rather than
    // faked into an inspection against a vehicle they never had.
    //
    // The remark is written at most once and `time_out` keeps its first value. The
    // remark's `CASE` tests the PRE-UPDATE outcome, because every `SET` expression in an
    // UPDATE reads the old row — so a second id (a client that minted a fresh one after
    // losing the first response) arrives on a row already marked 'NoVehicle' and leaves
    // the remark untouched, where the unconditional form appended a second line.
    //
    // `COALESCE(end_duty_submission_id,$3)` is load-bearing, not tidiness (Task 4's fix
    // round 5): the id read by the fixed point above is how a midnight retry is
    // recognised, so letting a second id overwrite the first would trade that away to
    // record a close that had already happened — the first id would no longer match, and
    // a later replay of it would take the reported branch. Verified live in
    // `scripts/verify-unreported-duty.mjs`: two ids, one day, the first id kept.
    // (The copies in `scripts/verify-duty-autoclose.mjs` are of the REPORTED close, not
    // this one, so this statement's text can change without desyncing anything there.)
    if (!vehicleId) {
      await tx.query(`UPDATE driverattendance
          SET time_out=COALESCE(time_out,NOW()), end_duty_outcome='NoVehicle',
              end_duty_submission_id=COALESCE(end_duty_submission_id,$3),
              remarks=CASE WHEN end_duty_outcome='NoVehicle' THEN remarks
                           ELSE COALESCE(remarks||' | ','')||'Ended duty with no vehicle pairing; no End Duty report recorded' END
        WHERE driver_id=$1 AND date=$2::date AND time_in IS NOT NULL`, [driverId, day, clientSubmissionId]);
      await tx.query('UPDATE drivers SET standby_tracking_enabled=false, standby_session_family=NULL WHERE driver_id=$1', [driverId]);
      return { checkedIn: false, inspectionId: null, reported: false, recorded: false, late };
    }

    // severity is NULL for a reported defect rather than a guessed level: the
    // driver answered one question, so no severity was assessed and inventing
    // one would put a judgement in the record that nobody made. "None" is the
    // driver's own assertion that they found nothing.
    const { rows } = await tx.query(
      `INSERT INTO vehicleinspection
         (vehicle_id, driver_id, inspection_type, inspection_date, checklist, findings, severity, status, client_submission_id)
       VALUES ($1,$2,'Post-Shift',$7::date,NULL,$3,$4,$5,$6)
       ON CONFLICT (driver_id, client_submission_id) WHERE client_submission_id IS NOT NULL DO NOTHING
       RETURNING inspection_id`,
      [vehicleId, driverId, check.findings, check.reported ? null : 'None', check.reported ? 'Reported' : 'Passed', clientSubmissionId, day]
    );
    let inspectionId = rows[0]?.inspection_id ?? null;
    // The recovered row's own day, when this is a replay. It is the day the filing
    // belongs to and the day the first attempt closed — see below.
    let recordedDay = null;
    if (!inspectionId) {
      // The unique index already holds this submission id. That is a retry ONLY if the
      // row it holds is a Post-Shift report: the index's predicate is
      // `(driver_id, client_submission_id) WHERE client_submission_id IS NOT NULL` —
      // type-blind and date-blind — so a client that reused one id across two endpoints
      // lands here as well. Recovering a Pre-Shift row would close this day as 'Reported'
      // with no Post-Shift record for it and hand the caller an inspection id whose
      // findings belong to another kind of record — so a `findings` payload would raise
      // a work order against a row that has none, and the defect report would vanish
      // with no trace.
      //
      // The look-up is keyed on the id ALONE, with no date predicate (Task 4's fix round
      // 4), and it cannot be day-scoped. On the ordinary path the client names no day, so
      // the server resolves one per request: a retry after midnight resolves a different
      // day than the attempt it is retrying — a shift closed at 00:05 on the 24th carries
      // a row dated the 23rd while the retry resolves the 24th. A date predicate there
      // refused a report that WAS recorded (round 3's regression), so the recovered row's
      // own `inspection_date` is what the day is taken from instead.
      const { rows: existing } = await tx.query(
        `SELECT inspection_id, inspection_date FROM vehicleinspection
          WHERE driver_id=$1 AND client_submission_id=$2
            AND inspection_type='Post-Shift'`,
        [driverId, clientSubmissionId]
      );
      inspectionId = existing[0]?.inspection_id ?? null;
      recordedDay = existing[0] ? toCalendarDay(existing[0].inspection_date) : null;
    }
    // A day the CLIENT named that contradicts the recorded one — and only that. It takes a
    // recovered row to contradict anything, so `recordedDay !== null` is part of the test
    // rather than implied by it: on an ordinary first filing `inspectionId` comes from the
    // INSERT and there is nothing to disagree with.
    const contradicted =
      recordedDay !== null && dutyDate !== null && toCalendarDay(dutyDate) !== recordedDay;
    if (!inspectionId || contradicted) {
      // Ruling (Task 4's fix round 4): an id that is not this filing is refused, and
      // refused WITHOUT WRITING. Two shapes land here, and one reason covers both because
      // the caller's action is identical either way:
      //   - the id is held by a row that is not a Post-Shift report at all (nothing was
      //     recovered), so it is spent on another kind of record;
      //   - the id is held by a Post-Shift report for a day the CLIENT named and the
      //     record contradicts. Only a client-named day can ever contradict the record:
      //     when the client names no day the server resolves one from the very row it is
      //     about to re-use, so it cannot disagree with itself inside one request — and
      //     refusing there is what round 3 got wrong, turning a midnight-crossing retry
      //     into a 409 for a report that WAS recorded.
      // Nothing has been written at this point (the INSERT was a DO NOTHING conflict and
      // the look-up only read), so the day named in the request is left exactly as it
      // was: still owed, still open, still advertised by `unreportedDuty`. Task 4's route
      // turns `reason` into a 409. It must stay distinguishable from the no-vehicle
      // return above, which also returns `recorded: false` and must keep answering 200.
      // `reported: false` rather than `check.reported`: nothing was recorded, so the
      // request's own claim about a defect is not something this return can assert.
      return { checkedIn: false, inspectionId: null, reported: false, recorded: false,
               reason: 'submission_id_already_used', late };
    }
    // The day this transaction closes. Normally the one resolved above — but a RECOVERED
    // replay carries its own `inspection_date`, and that day is authoritative: it is the
    // day the report belongs to and the day the first attempt closed. Closing the
    // server-resolved day instead would close a day that has no report against it.
    const reportDay = recordedDay ?? day;

    // COALESCE keeps a sweep's time_out if the row was already auto-closed; the
    // outcome flips to 'Reported' because that is now the row's final state. The
    // remark carries both facts — overwriting it would erase the evidence that
    // the duty was ever abandoned, which is the record the design note asked for.
    //
    // A RETRY must not append it twice. `rows[0]` is absent exactly when the INSERT
    // hit the unique index and the recovery branch above took over — the signal that
    // this transaction did NOT create the Post-Shift record, i.e. the report was
    // already filed. The remark records when the report was FIRST received, so a
    // driver retrying on a lost response would otherwise accumulate one line per
    // retry, each stamped with a later time, until the row read as a history of its
    // own retries. Task 4's guard now ACCEPTS a retry, so this path is reachable.
    //
    // The decision is made here rather than inside the CASE, deliberately. `late`
    // reaches the service FROM SQL and so cannot be pinned by a unit test (Task 3's
    // Step 5 block (c) exists for exactly that reason); this one is JS, so the tests
    // can see it. Leaving the statement's text unchanged also keeps the copy of it in
    // `scripts/verify-duty-autoclose.mjs` faithful to the service.
    //
    // `reportDay`, not `day`: on a replay the row recovered above is the report this
    // request is a retry OF, so the day the first attempt closed is the day this one
    // re-asserts. They differ exactly when the retry resolved a different day.
    const appendLateRemark = late && Boolean(rows[0]?.inspection_id);
    await tx.query(`UPDATE driverattendance
        SET time_out=COALESCE(time_out,NOW()), end_duty_outcome='Reported',
            remarks=CASE WHEN $3::boolean
              THEN COALESCE(remarks||' | ','')||'Late End Duty report received '||to_char(NOW() AT TIME ZONE 'Asia/Manila','YYYY-MM-DD HH24:MI')
              ELSE remarks END
      WHERE driver_id=$1 AND date=$2::date AND time_in IS NOT NULL`, [driverId, reportDay, appendLateRemark]);
    await tx.query('UPDATE drivers SET standby_tracking_enabled=false, standby_session_family=NULL WHERE driver_id=$1', [driverId]);
    return { checkedIn: false, inspectionId, reported: check.reported, recorded: true, late };
  });
}

export async function effectiveStandbyVehicle(driverId, now = new Date()) {
  const [{ rows: pairs }, { rows: substitutes }, { rows: drivers }, { rows: vehicles }] = await Promise.all([
    query('SELECT driver_id,vehicle_id FROM driver_vehicle_assignments WHERE assigned_until IS NULL'),
    query('SELECT vehicle_id,substitute_driver_id,effective_from,effective_until FROM substitute_vehicle_schedules'),
    query('SELECT driver_id,driver_status,license_number,license_type,license_class,license_expiry,license_verified_at,license_verified_by,license_verification_method FROM drivers WHERE deleted_at IS NULL'),
    query('SELECT vehicle_id,vehicle_status,required_license_class FROM vehicles WHERE deleted_at IS NULL'),
  ]);
  const scheduleContext = await loadDriverScheduleContext(drivers.map(d => d.driver_id));
  const driverById = new Map(drivers.map(d => [Number(d.driver_id), d]));
  const matches = vehicles.filter(vehicle => vehicleOperationallyAvailable(vehicle)).filter(vehicle => {
    const pair = resolveVehiclePairing({ vehicleId: vehicle.vehicle_id, pickupDate: now, returnAt: now,
      activePairs: pairs, activeSubstitutes: substitutes, driverById, scheduleContext, now,
      requiredLicenseClass: vehicle.required_license_class });
    return pair.ok && Number(pair.driver?.driver_id) === Number(driverId);
  });
  return matches.length === 1 ? matches[0].vehicle_id : null;
}

export async function publishStandby(user, body) {
  const fix = { latitude: body?.latitude, longitude: body?.longitude, accuracy: body?.accuracy, observed_at: body?.recorded_at };
  if (!qualifiedGps(fix).eligible) throw new AuthError('A fresh location with accuracy within 100 m is required.', 400, 'GPS_NOT_QUALIFIED');
  if (!user.familyId) throw new AuthError('A current mobile session is required.', 403);
  const vehicleId = await effectiveStandbyVehicle(user.driverId);
  if (!vehicleId) throw new AuthError('No eligible vehicle pairing for standby.', 409, 'STANDBY_NOT_READY');
  return withTransaction(async (tx) => {
    await tx.query('SELECT driver_id FROM drivers WHERE driver_id=$1 FOR UPDATE', [user.driverId]);
    const state = await standbyState(user.driverId, tx);
    const { rows: sessions } = await tx.query(`SELECT 1 FROM mobile_refresh_tokens WHERE employee_id=$1
      AND family_id=$2 AND revoked_at IS NULL AND expires_at>NOW() LIMIT 1`, [user.employeeId, user.familyId]);
    if (!state?.checked_in || !state.consented || state.busy || !state.standby_tracking_enabled || !sessions.length)
      throw new AuthError('Checked-in standby duty is required.', 409, 'STANDBY_NOT_READY');
    if (!state.duty_started_at || new Date(fix.observed_at) < new Date(state.duty_started_at))
      throw new AuthError('Location predates the current duty session.', 409, 'GPS_OUT_OF_ORDER');
    const { rows } = await tx.query(`UPDATE drivers SET standby_latitude=$2,standby_longitude=$3,
      location_observed_at=$4,location_received_at=NOW(),location_accuracy_m=$5,location_source='standby',location_vehicle_id=$6,
      standby_session_family=$7
      WHERE driver_id=$1 AND (location_observed_at IS NULL OR location_observed_at<$4::timestamptz)
      RETURNING location_observed_at`, [user.driverId,fix.latitude,fix.longitude,fix.observed_at,fix.accuracy,vehicleId,user.familyId]);
    return { updated: rows.length > 0, observedAt: rows[0]?.location_observed_at ?? state.location_observed_at };
  });
}

// Operations visibility is separate from request-specific recommendation policy.
export async function standbyLocations() {
  const { rows } = await query(`SELECT d.driver_id, e.first_name, e.last_name, v.plate_number
    FROM drivers d JOIN employees e ON e.employee_id=d.employee_id
    JOIN vehicles v ON v.vehicle_id=d.location_vehicle_id AND v.deleted_at IS NULL
    WHERE d.deleted_at IS NULL AND d.standby_tracking_enabled=true`);
  const positions = [];
  // ponytail: small fleet, reuse authoritative per-driver checks; batch their
  // schedule/pairing reads if measured polling cost grows with fleet size.
  for (const driver of rows) {
    const state = await standbyState(driver.driver_id);
    if (!state?.checked_in || !state.consented || state.busy || !state.session_live || !state.standby_tracking_enabled) continue;
    const fix = { latitude:state.standby_latitude, longitude:state.standby_longitude,
      accuracy:state.location_accuracy_m, observed_at:state.location_observed_at };
    if (!qualifiedGps(fix).eligible || !state.duty_started_at || new Date(fix.observed_at) < new Date(state.duty_started_at)) continue;
    const vehicleId = await effectiveStandbyVehicle(driver.driver_id);
    if (!vehicleId || Number(vehicleId) !== Number(state.location_vehicle_id)) continue;
    const gps = qualifiedGps(fix);
    if (!gps.eligible) continue;
    positions.push({ tracking_id:`standby-${driver.driver_id}`, driver_id:driver.driver_id,
      vehicle_id:vehicleId, vehicle_status:'Standby', driver_name:`${driver.first_name || ''} ${driver.last_name || ''}`.trim(),
      plate_number:driver.plate_number, latitude:Number(fix.latitude), longitude:Number(fix.longitude),
      accuracy:Number(fix.accuracy), recorded_at:fix.observed_at, expires_at:gps.expiresAt });
  }
  return positions;
}
