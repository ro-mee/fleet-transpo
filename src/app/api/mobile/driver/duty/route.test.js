import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({
  requireDriver: vi.fn(),
  parseBody: vi.fn(),
  err: (message, status) => Response.json({ error: message }, { status }),
  handleError: (e) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}));
vi.mock("@/services/driver-schedule.service", () => ({ loadDriverScheduleContext: vi.fn() }));
vi.mock("@/services/standby.service", () => ({
  setDuty: vi.fn(),
  standbyState: vi.fn(),
  effectiveStandbyVehicle: vi.fn(),
  endDutyWithReport: vi.fn(),
}));
vi.mock("@/lib/inspections/maintenance", () => ({ raiseEndDutyWorkOrder: vi.fn() }));

import { query } from "@/lib/db";
import { requireDriver, parseBody } from "@/lib/api/utils";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";
import { setDuty, standbyState, effectiveStandbyVehicle, endDutyWithReport } from "@/services/standby.service";
import { raiseEndDutyWorkOrder } from "@/lib/inspections/maintenance";
import { localDayOfWeek } from "@/lib/scheduling/driver-schedule";
import { toCalendarDay } from "@/lib/dates";
import { GET, POST } from "./route";

// driverDayEligibility is deliberately NOT mocked. It is pure, and it is the
// module that actually decides the rest-day and on-leave cases this file cares
// about — mocking it would test that the route can read a boolean, not that a
// driver on leave is left alone.
const DRIVER = 7;
const CID = "endduty123456789"; // 16 chars, matches /^[0-9a-z-]{16,64}$/i
// The date-aware vehicle resolver, identified by the table and alias it reads:
// `... FROM vehicleinspection i` — the substring the brief mandates for exactly
// this reason. Deliberately NOT keyed on `inspection_date=$2::date` or on the
// COALESCE that makes it date-aware: once the COALESCE is in place the former no
// longer appears and the mock silently stops matching, and keying on the latter
// would fail the pre-existing vehicle-resolution tests for a reason that has
// nothing to do with what they assert. The `unreported` lookup reads
// `FROM vehicleinspection vi` (LATERAL alias) and so does not collide with this.
const RESOLVER_SQL = "FROM vehicleinspection i";
// Resolved from the clock rather than hardcoded, so these do not silently stop
// testing the rest-day path when the suite runs on a different weekday.
const TODAY = localDayOfWeek(new Date());
const TODAY_DAY = toCalendarDay(new Date());

/** A schedule context that permits today, with optional leave or a rest day. */
const context = ({ restDay = false, leave = [] } = {}) => ({
  schedules: new Map([[DRIVER, new Map([[TODAY, {
    day_of_week: TODAY, shift_start: "06:00:00", shift_end: "22:00:00", is_rest_day: restDay,
  }]])]]),
  leave: new Map([[DRIVER, leave]]),
});

const get = () => GET(new Request("http://localhost/api/mobile/driver/duty"));
const post = () => POST(new Request("http://localhost/api/mobile/driver/duty", { method: "POST" }));
const body = async (res) => res.json();

beforeEach(() => {
  vi.clearAllMocks();
  requireDriver.mockResolvedValue({ user: { driverId: DRIVER, employeeId: 4 } });
  standbyState.mockResolvedValue({ checked_in: true, busy: false, preshift_baseline: false });
  loadDriverScheduleContext.mockResolvedValue(context());
  setDuty.mockResolvedValue({ checkedIn: true });
  effectiveStandbyVehicle.mockResolvedValue(2);
  endDutyWithReport.mockResolvedValue({ checkedIn: false, inspectionId: 88, reported: false, recorded: true });
  raiseEndDutyWorkOrder.mockResolvedValue({ created: true });
  // SQL-aware rather than a blanket row: GET now issues a second query
  // (`unreportedDuty`, which answers whether a past day still owes a report), and
  // a blanket mock hands it the resolver's row — inventing a duty to report on in
  // every test that did not override the mock, including the one asserting that
  // nothing is owed.
  query.mockImplementation(async (sql) =>
    sql.includes(RESOLVER_SQL) ? { rows: [{ vehicle_id: 3 }] } : { rows: [] }
  );
});

describe("GET /api/mobile/driver/duty", () => {
  it("asks for the pre-shift baseline when the day is worked and none exists", async () => {
    const payload = await body(await get());
    expect(payload).toMatchObject({ checkedIn: true, preshiftRequired: true });
    expect(payload.today).toMatchObject({ blocked: false, reason: null });
  });

  it("stops asking once the day's baseline exists", async () => {
    standbyState.mockResolvedValue({ checked_in: true, busy: false, preshift_baseline: true });
    expect(await body(await get())).toMatchObject({ preshiftRequired: false });
  });

  it("does not ask on a rest day, and says why", async () => {
    loadDriverScheduleContext.mockResolvedValue(context({ restDay: true }));
    const payload = await body(await get());
    expect(payload.preshiftRequired).toBe(false);
    expect(payload.today.blocked).toBe(true);
    expect(payload.today.reason).toMatch(/rest day/i);
  });

  it("does not ask while on approved leave", async () => {
    loadDriverScheduleContext.mockResolvedValue(
      context({ leave: [{ status: "Approved", start_date: TODAY_DAY, end_date: TODAY_DAY }] })
    );
    const payload = await body(await get());
    expect(payload.preshiftRequired).toBe(false);
    expect(payload.today.blocked).toBe(true);
    expect(payload.today.reason).toMatch(/approved leave/i);
  });

  it("does not ask a driver with no schedule on file", async () => {
    loadDriverScheduleContext.mockResolvedValue({ schedules: new Map(), leave: new Map() });
    const payload = await body(await get());
    expect(payload.preshiftRequired).toBe(false);
    expect(payload.today.blocked).toBe(true);
  });

  it("carries the shift span the end-duty nudge counts down to", async () => {
    expect((await body(await get())).today.duty).toEqual({ start: "06:00:00", end: "22:00:00" });
  });
});

describe("POST /api/mobile/driver/duty", () => {
  it("starts duty through setDuty, which owns the gate order", async () => {
    parseBody.mockResolvedValue({ active: true });
    const res = await post();
    expect(await body(res)).toEqual({ checkedIn: true });
    expect(setDuty).toHaveBeenCalledWith(DRIVER, true);
  });

  it("rejects a missing or non-boolean active", async () => {
    parseBody.mockResolvedValue({});
    expect((await post()).status).toBe(400);
    parseBody.mockResolvedValue({ active: "true" });
    expect((await post()).status).toBe(400);
    expect(setDuty).not.toHaveBeenCalled();
  });

  it("refuses to end duty without a submission id, before writing anything", async () => {
    parseBody.mockResolvedValue({ active: false, report: { nothing_unusual: true } });
    expect((await post()).status).toBe(400);
    parseBody.mockResolvedValue({ active: false, report: { nothing_unusual: true }, client_submission_id: "short" });
    expect((await post()).status).toBe(400);
    expect(endDutyWithReport).not.toHaveBeenCalled();
  });

  it("ends duty with the report and the time_out in one service call", async () => {
    parseBody.mockResolvedValue({ active: false, report: { nothing_unusual: true }, client_submission_id: CID });
    const res = await post();
    expect(await body(res)).toMatchObject({ checkedIn: false, recorded: true });
    // Exact, not objectContaining: `vehicleId` is the unwrapped number, and
    // `dutyDate` is present-and-null on the ordinary same-day path. Asserting
    // both keeps this a check of the whole call shape rather than of one field.
    expect(endDutyWithReport).toHaveBeenCalledWith({
      driverId: DRIVER, vehicleId: 3, report: { nothing_unusual: true },
      clientSubmissionId: CID, dutyDate: null,
    });
  });

  it("reports against the vehicle the driver last inspected today", async () => {
    parseBody.mockResolvedValue({ active: false, report: { findings: "sira ang preno" }, client_submission_id: CID });
    await post();
    expect(endDutyWithReport.mock.calls[0][0].vehicleId).toBe(3);
    // The paired vehicle is not consulted when there is a real one to report on.
    expect(effectiveStandbyVehicle).not.toHaveBeenCalled();
  });

  it("falls back to the standby pairing when nothing was inspected", async () => {
    query.mockResolvedValue({ rows: [] });
    parseBody.mockResolvedValue({ active: false, report: { nothing_unusual: true }, client_submission_id: CID });
    await post();
    expect(effectiveStandbyVehicle).toHaveBeenCalledWith(DRIVER);
    expect(endDutyWithReport.mock.calls[0][0].vehicleId).toBe(2);
  });

  it("raises the work order only when something was reported", async () => {
    parseBody.mockResolvedValue({ active: false, report: { nothing_unusual: true }, client_submission_id: CID });
    await post();
    expect(raiseEndDutyWorkOrder).not.toHaveBeenCalled();

    endDutyWithReport.mockResolvedValue({ checkedIn: false, inspectionId: 88, reported: true, recorded: true });
    await post();
    expect(raiseEndDutyWorkOrder).toHaveBeenCalledWith({
      inspectionId: 88,
      session: { user: { driverId: DRIVER, employeeId: 4 } },
      route: "/api/mobile/driver/duty",
    });
  });

  it("still ends duty when the driver had no vehicle to report on", async () => {
    query.mockResolvedValue({ rows: [] });
    effectiveStandbyVehicle.mockResolvedValue(null);
    endDutyWithReport.mockResolvedValue({ checkedIn: false, inspectionId: null, reported: false, recorded: false });
    parseBody.mockResolvedValue({ active: false, report: { nothing_unusual: true }, client_submission_id: CID });
    const res = await post();
    expect(await body(res)).toMatchObject({ checkedIn: false, recorded: false });
    expect(raiseEndDutyWorkOrder).not.toHaveBeenCalled();
  });
});

describe("unreported past duties", () => {
  it("names a day left owing a report, and the vehicle it was driven on", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes('end_duty_outcome')) {
        return { rows: [{ date: "2026-09-23", vehicle_id: 5, plate_number: "ABC-1234" }] };
      }
      return { rows: [] };
    });
    const payload = await body(await get());
    expect(payload.unreported).toEqual({ date: "2026-09-23", vehicleId: 5, plateNumber: "ABC-1234" });
  });

  it("reports nothing when every past duty was resolved", async () => {
    expect((await body(await get())).unreported).toBeNull();
  });

  // The day arrives from Postgres as a `Date`, not a string — `pg` parses a `date`
  // column (OID 1082) into one. Every other test here mocks a string, so they all
  // pass under either implementation and cannot tell them apart. This test mocks
  // what production actually returns, and must be shown FAILING before the
  // `toCalendarDay` change — with the old code it reads "Wed Sep 23".
  it("normalises the day Postgres actually returns, not just a mocked string", async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes('end_duty_outcome')) {
        return { rows: [{ date: new Date(2026, 8, 23), vehicle_id: 5, plate_number: "ABC-1234" }] };
      }
      return { rows: [] };
    });
    const payload = await body(await get());
    expect(payload.unreported.date).toBe("2026-09-23");
  });

  it("files a late report against the day it names, and its vehicle", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { findings: "sira ang preno" },
      client_submission_id: CID, report_date: "2026-09-23",
    });
    query.mockImplementation(async (sql) => {
      // POST is gated on the owed-day query, so this mock must answer it or the
      // guard 400s before anything is resolved. Keyed on `end_duty_outcome`, which
      // appears only in `unreportedDuty`.
      if (sql.includes('end_duty_outcome')) {
        return { rows: [{ date: "2026-09-23", vehicle_id: 5, plate_number: "ABC-1234" }] };
      }
      // Keyed on a substring the resolver's SQL keeps before AND after this task's
      // change. Do not key it on `inspection_date=$2::date`: once the COALESCE is in
      // place that text no longer appears, the mock silently stops matching, and the
      // assertion below then compares 5 against undefined.
      if (sql.includes('FROM vehicleinspection i')) return { rows: [{ vehicle_id: 5 }] };
      return { rows: [] };
    });
    await post();
    expect(endDutyWithReport).toHaveBeenCalledWith(expect.objectContaining({
      dutyDate: "2026-09-23", vehicleId: 5,
    }));
  });

  // A retry, not a new claim. The day stops being owed the moment this submission
  // pays it — the service flips the outcome to 'Reported' — so on a replayed request
  // the owed-day guard names a different day, or none at all. Answering 400 there
  // would report failure for a report that WAS recorded, to a driver whose connection
  // already lost the first response. Both the submission id and the day must match
  // what the Post-Shift row already carries.
  it("accepts a retry of a report this same submission already filed", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "2026-09-23",
    });
    query.mockImplementation(async (sql) => {
      if (sql.includes('end_duty_outcome')) return { rows: [] }; // nothing owed any more
      if (sql.includes("inspection_type='Post-Shift'")) return { rows: [{ inspection_id: 88 }] };
      return { rows: [{ vehicle_id: 5 }] };
    });
    expect((await post()).status).toBe(200);
    expect(endDutyWithReport).toHaveBeenCalledWith(expect.objectContaining({
      dutyDate: "2026-09-23",
    }));
  });

  // The service refuses a submission id already spent on something that is not this
  // filing: a different day the CLIENT named, or a row of another kind carrying the id.
  // Nothing was written and the day named here is left exactly as it was, so the answer is
  // 409 — not the guard's 400 ("you do not owe this day") and not a 500. Tested on `reason`
  // and not on `recorded`: the no-vehicle branch also returns `recorded: false` and must
  // keep answering 200 (asserted below).
  it("answers 409 when the submission id is already spent", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "2026-09-23",
    });
    // The day IS owed here, so the guard passes and the request reaches the service —
    // otherwise this would assert the guard's 400 instead of the refusal's 409.
    query.mockImplementation(async (sql) =>
      sql.includes('end_duty_outcome')
        ? { rows: [{ date: "2026-09-23", vehicle_id: 5, plate_number: "ABC-1234" }] }
        : { rows: [{ vehicle_id: 5 }] }
    );
    endDutyWithReport.mockResolvedValue({
      checkedIn: false, inspectionId: null, reported: false, recorded: false,
      reason: "submission_id_already_used", late: true,
    });
    const res = await post();
    expect(res.status).toBe(409);
    expect((await body(res)).error).toMatch(/already used/);
    // Nothing else runs on a refusal: no work order is raised off an id that belongs
    // to something other than this filing.
    expect(raiseEndDutyWorkOrder).not.toHaveBeenCalled();
  });

  // The no-vehicle branch closes the day with no Post-Shift row, so neither the owed-day
  // query nor `reportAlreadyFiled` can see it — and the first attempt answered 200 with
  // `recorded: false`. Refusing the replay would report failure for a shift the server
  // had already closed, so `closedWithoutReport` admits it. Since round 5 that predicate
  // is keyed on the SUBMISSION ID, and the mock models the recorded close as data
  // accordingly: it answers only when this submission's id is among the parameters. A
  // day-keyed predicate passes the day here, the row is not found, and the request falls
  // through to the guard's 400 — which is what makes this a check of the id rather than
  // of the statement's text.
  it("accepts a replay of a day the no-vehicle path already closed", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "2026-09-23",
    });
    endDutyWithReport.mockResolvedValue({
      checkedIn: false, inspectionId: null, reported: false, recorded: false, late: true,
    });
    query.mockImplementation(async (sql, values) => {
      if (sql.includes("end_duty_outcome='NoVehicle'")) {
        return { rows: values.includes(CID) ? [{ end_duty_outcome: "NoVehicle" }] : [] };
      }
      if (sql.includes('end_duty_outcome')) return { rows: [] };   // nothing owed any more
      if (sql.includes("inspection_type='Post-Shift'")) return { rows: [] }; // and no report either
      return { rows: [{ vehicle_id: 5 }] };
    });
    expect((await post()).status).toBe(200);
    expect(endDutyWithReport).toHaveBeenCalled();
  });

  // The route half of the pairing whose service half is in `standby.test.js`, and a defect
  // neither half can see alone. Round 3 admitted this day on the grounds that the branch is
  // a fixed point — true of the branch, false of the REQUEST: `resolveReportVehicle` falls
  // back to the date-blind `effectiveStandbyVehicle`, i.e. "the pairing you have now", so a
  // pairing that has become resolvable since the close hands the service a REAL vehicleId
  // on the replay (asserted below), and the request then takes the reported branch. The
  // service's early return is what makes the admission safe; this pins that the route still
  // answers 200 and hands that vehicle over, which is the situation it has to survive.
  it("answers 200 to a no-vehicle replay even when a vehicle now resolves", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "2026-09-23",
    });
    endDutyWithReport.mockResolvedValue({
      checkedIn: false, inspectionId: null, reported: false, recorded: false, late: true,
    });
    query.mockImplementation(async (sql, values) => {
      // The same id-keyed model as the test above: this day's close is this submission's.
      if (sql.includes("end_duty_outcome='NoVehicle'")) {
        return { rows: values.includes(CID) ? [{ end_duty_outcome: "NoVehicle" }] : [] };
      }
      if (sql.includes('end_duty_outcome')) return { rows: [] };   // nothing owed any more
      if (sql.includes("inspection_type='Post-Shift'")) return { rows: [] }; // and no report either
      return { rows: [] };   // nor was anything inspected on that day…
    });
    const res = await post();
    expect(res.status).toBe(200);
    // …so the vehicle comes from the date-blind standby pairing, which is exactly the
    // route-side mechanism that made round 3's justification false.
    expect(effectiveStandbyVehicle).toHaveBeenCalledWith(DRIVER);
    expect(endDutyWithReport).toHaveBeenCalledWith(expect.objectContaining({
      vehicleId: 2, dutyDate: "2026-09-23",
    }));
    // A day with no report must not raise a work order off a vehicle it never had.
    expect(raiseEndDutyWorkOrder).not.toHaveBeenCalled();
  });

  it("refuses a report_date that is not a plain calendar day", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "yesterday",
    });
    expect((await post()).status).toBe(400);
    expect(endDutyWithReport).not.toHaveBeenCalled();
  });

  // The regex is not the check. `2026-02-30` and `2026-13-45` both match it and both
  // reach `$::date` — in the guard's own queries, before the service — where Postgres
  // raises `date/time field value out of range`. A client typo must not be a 500 on a
  // path that writes nothing, so the day is checked as a calendar day: build it from its
  // components and require the round trip, which a day that does not exist fails.
  it("refuses a report_date that is shaped like a day but is not one", async () => {
    const statusFor = async (report_date) => {
      parseBody.mockResolvedValue({
        active: false, report: { nothing_unusual: true },
        client_submission_id: CID, report_date,
      });
      return (await post()).status;
    };
    expect(await statusFor("2026-02-30")).toBe(400);
    expect(await statusFor("2026-13-45")).toBe(400);
    expect(endDutyWithReport).not.toHaveBeenCalled();
    // …and nothing was asked of the database either, which is the whole point rather than
    // tidiness: the check runs BEFORE the first query, so the bad day never reaches
    // `$::date` in the guard's own look-ups. This suite mocks `query`, so without this
    // assertion a later guard's 400 would hide the defect — in production those queries
    // raise `date/time field value out of range`, which is the 500 this prevents.
    expect(query).not.toHaveBeenCalled();
    // A real day still goes through, so this cannot pass by rejecting everything.
    query.mockImplementation(async (sql) =>
      sql.includes('end_duty_outcome')
        ? { rows: [{ date: "2026-09-23", vehicle_id: 5, plate_number: "ABC-1234" }] }
        : { rows: [{ vehicle_id: 5 }] }
    );
    expect(await statusFor("2026-09-23")).toBe(200);
    expect(endDutyWithReport).toHaveBeenCalled();
  });

  // The mocks in this file key on SQL text and ignore arguments entirely, so nothing
  // goes red if an argument is swapped, dropped or reordered — and a swap 500s in
  // production on `$3::date`. The guard's three predicates take three different shapes,
  // so each is pinned separately.
  it("passes the driver, the submission id and the day to each guard predicate", async () => {
    const DAY = "2026-09-23";
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: DAY,
    });
    // Nothing owed and nothing filed, so the `&&` consults all three predicates and the
    // request 400s — which is what makes every call site observable here.
    query.mockImplementation(async () => ({ rows: [] }));
    expect((await post()).status).toBe(400);

    const owed = query.mock.calls.find(([sql]) =>
      sql.includes('end_duty_outcome') && !sql.includes("end_duty_outcome='NoVehicle'"));
    expect(owed[1]).toEqual([DRIVER]);
    const filed = query.mock.calls.find(([sql]) => sql.includes("inspection_type='Post-Shift'"));
    expect(filed[1]).toEqual([DRIVER, CID, DAY]);
    // The third predicate takes the SUBMISSION ID and not the day (round 5), which is the
    // only observable of the two: the mocks key on statement text, so a day-keyed call
    // would answer identically here and in every behavioural test in this file. The
    // argument pin is what separates them — and the day arm of the service's own fixed
    // point is what used to make this redundant.
    const closed = query.mock.calls.find(([sql]) => sql.includes("end_duty_outcome='NoVehicle'"));
    expect(closed[1]).toEqual([DRIVER, CID]);
  });

  // The `&&` short-circuit: the ordinary path — the day IS owed — costs no extra query,
  // which the round's requirements call binding and nothing else pins.
  it("issues no extra query when the day is owed", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "2026-09-23",
    });
    query.mockImplementation(async (sql) => {
      if (sql.includes('end_duty_outcome')) {
        return { rows: [{ date: "2026-09-23", vehicle_id: 5, plate_number: "ABC-1234" }] };
      }
      return { rows: [{ vehicle_id: 5 }] };
    });
    await post();
    expect(endDutyWithReport).toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes('Post-Shift'))).toBe(false);
    // The SECOND predicate's short-circuit is what the assertion above pins — and only
    // that one. Hoisting `closedWithoutReport` out of the `&&`, so it runs on every
    // request instead of only on a request the first two predicates refused, would stay
    // green under it. The third predicate is pinned on its own text, which appears in no
    // other statement in the route.
    expect(query.mock.calls.some(([sql]) => sql.includes("end_duty_outcome='NoVehicle'"))).toBe(false);
  });

  it("refuses a day the driver does not owe, rather than filing it anyway", async () => {
    parseBody.mockResolvedValue({
      active: false, report: { nothing_unusual: true },
      client_submission_id: CID, report_date: "2020-01-01",
    });
    // The mock must let the resolver succeed, or this test would pass merely
    // because no vehicle was found. It has to fail *because of the guard*: with
    // the guard removed, the flow below reaches `endDutyWithReport` and files a
    // Post-Shift inspection against today's standby vehicle.
    //
    // It must also answer the RETRY query with nothing, and that is load-bearing
    // rather than tidiness. A blanket `{ rows: [{ vehicle_id: 5 }] }` for everything
    // else now lands on `reportAlreadyFiled` as a truthy row, the carve-out accepts,
    // and this test breaks for the opposite reason — a 2020 date counted as "already
    // filed". Keying on the retry statement's own text keeps the two apart.
    //
    // The THIRD predicate needs the same treatment, and it is the one that would make
    // this step vacuous otherwise: a blanket fallthrough row lands on
    // `closedWithoutReport` too, and a predicate that ignored its arguments (or simply
    // answered true once any NoVehicle row existed) would then admit a 2020 day through
    // the new door while nothing went red here.
    query.mockImplementation(async (sql) => {
      if (sql.includes("end_duty_outcome='NoVehicle'")) return { rows: [] };
      if (sql.includes('end_duty_outcome')) return { rows: [] };
      if (sql.includes("inspection_type='Post-Shift'")) return { rows: [] };
      return { rows: [{ vehicle_id: 5 }] };
    });
    expect((await post()).status).toBe(400);
    expect(endDutyWithReport).not.toHaveBeenCalled();
  });
});
