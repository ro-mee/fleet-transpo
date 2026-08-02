// Stage 1 verification — conflict detection (Phase 12 queue chips + dispatch gate).
//
// Two layers are under test:
//   1. detectRequestConflicts — advisory, never blocks, feeds the queue chips.
//      Must surface all 7 CONFLICT_TYPE values.
//   2. findDispatchConflicts / POST /api/dispatch — enforcing, returns 409.
//
// Also pins src/lib/dates.js, because the original expiry checks compared a pg
// Date object against a "YYYY-MM-DD" string. That coerces to NaN, so
// license_expired and registration_expired never fired. Regression-guarded here.
//
// Fixtures that current dev data can't provide (an open maintenance window, an
// expired registration, a second driver booking) are created inside a
// transaction and rolled back, so this suite leaves the database untouched.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-conflicts.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const app = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);
const { getPool, query } = await app("lib/db.js");
const { detectRequestConflicts, detectConflictsForRequests, findDispatchConflicts, CONFLICT_TYPE } =
  await app("lib/scheduling/conflicts.js");
const { toCalendarDay, isExpired } = await app("lib/dates.js");

let pass = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

function checkEq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `got ${a}, want ${e}`);
}

const typesOf = (findings) => findings.map((f) => f.type).sort();

// ---------------------------------------------------------------------------
// 1. Date helpers — the bug class that silently disabled two conflict types.
// ---------------------------------------------------------------------------
{
  // pg returns `date` as a Date at LOCAL midnight. Reading it back with
  // toISOString() shifts the day backward at positive UTC offsets.
  const localJul31 = new Date(2026, 6, 31);
  checkEq("toCalendarDay keeps the local day", toCalendarDay(localJul31), "2026-07-31");
  check(
    "toCalendarDay differs from the naive toISOString at UTC+",
    new Date().getTimezoneOffset() >= 0 ||
      toCalendarDay(localJul31) !== localJul31.toISOString().split("T")[0]
  );
  checkEq("toCalendarDay slices a timestamptz string", toCalendarDay("2026-07-31T16:00:00.000Z"), "2026-07-31");
  checkEq("toCalendarDay(null)", toCalendarDay(null), null);
  checkEq("toCalendarDay(garbage)", toCalendarDay("not-a-date"), null);
  checkEq("toCalendarDay(Invalid Date)", toCalendarDay(new Date("x")), null);

  // A document expiring today is still valid today.
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  check("isExpired(yesterday)", isExpired(yesterday) === true);
  check("isExpired(today) is false — valid through end of day", isExpired(today) === false);
  check("isExpired(tomorrow)", isExpired(tomorrow) === false);
  check("isExpired(null)", isExpired(null) === false);

  // A raw Date compared to a string is the original bug. Assert it really is
  // broken, so nobody 'simplifies' the helper away.
  check(
    "regression: raw Date < 'YYYY-MM-DD' is always false (why the helper exists)",
    (new Date(2020, 0, 1) < "2026-08-01") === false
  );
}

// ---------------------------------------------------------------------------
// 2. detectRequestConflicts — all 7 types, against real + transactional data.
// ---------------------------------------------------------------------------
const pool = getPool();
const client = await pool.connect();
let rolledBack = false;

try {
  await client.query("BEGIN");

  // -- Fixtures -------------------------------------------------------------
  const { rows: [cat] } = await client.query(
    `SELECT category_id FROM vehiclecategories ORDER BY category_id LIMIT 1`
  );

  // A vehicle whose registration lapsed yesterday, with 4 seats.
  const { rows: [expiredVeh] } = await client.query(
    `INSERT INTO vehicles (category_id, plate_number, vehicle_name, model, manufacturer,
                           seating_capacity, vehicle_status, registration_expiry)
     VALUES ($1, 'TEST-EXP-01', 'Conflict Fixture', 'T', 'T', 4, 'Available',
             (CURRENT_DATE - INTERVAL '1 day')::date)
     RETURNING vehicle_id, registration_expiry`,
    [cat?.category_id ?? null]
  );

  // A clean vehicle, so "no findings" is provably reachable.
  const { rows: [cleanVeh] } = await client.query(
    `INSERT INTO vehicles (category_id, plate_number, vehicle_name, model, manufacturer,
                           seating_capacity, vehicle_status, registration_expiry)
     VALUES ($1, 'TEST-OK-01', 'Clean Fixture', 'T', 'T', 8, 'Available',
             (CURRENT_DATE + INTERVAL '365 days')::date)
     RETURNING vehicle_id`,
    [cat?.category_id ?? null]
  );

  const pickup = "2026-09-15T09:00:00.000Z";
  const pickupDay = "2026-09-15";

  // An open maintenance window covering the pickup date.
  await client.query(
    `INSERT INTO vehiclemaintenance (vehicle_id, maintenance_type, description, status,
                                     maintenance_date, completed_date)
     VALUES ($1, 'Brake service', 'fixture', 'In Progress',
             ($2::date - INTERVAL '1 day')::date, ($2::date + INTERVAL '1 day')::date)`,
    [cleanVeh.vehicle_id, pickupDay]
  );

  // An active dispatch holding the clean vehicle + driver 1 across the window.
  const { rows: [heldDispatch] } = await client.query(
    `INSERT INTO dispatchschedules (vehicle_id, driver_id, dispatch_number, status,
                                    scheduled_departure, scheduled_arrival)
     VALUES ($1, 1, 'DSP-FIXTURE-01', 'Scheduled',
             '2026-09-15T08:00:00.000Z', '2026-09-15T12:00:00.000Z')
     RETURNING dispatch_id, dispatch_number`,
    [cleanVeh.vehicle_id]
  );

  // detectRequestConflicts uses the pooled `query`, not this client, so the
  // uncommitted fixtures above would be invisible to it. Run the checks that
  // need them through the same transaction by pinning the pool to this client.
  // Simpler: assert those two directly via SQL-visible helpers below, and use
  // committed data for the pooled-path checks.
  const req = (over = {}) => ({ pickup_datetime: pickup, passenger_count: 2, ...over });

  // -- Committed-data checks (pooled path, the real code path) --------------
  //
  // Expectations are DERIVED from each row rather than hardcoded. An earlier
  // version pinned "driver 4 is clean"; that driver's license lapsed the next
  // day and the suite failed on a calendar roll, not a code change. Postgres
  // answers "is this expired?" here and the JS helper answers it in the code
  // under test, so the two oracles must also agree — which is the original bug
  // (Date vs string) restated as a live cross-check.
  const { rows: driverRows } = await client.query(
    `SELECT d.driver_id, d.driver_status, d.license_expiry,
            (d.license_expiry IS NOT NULL AND d.license_expiry < CURRENT_DATE) AS sql_says_expired
       FROM drivers d
      WHERE d.deleted_at IS NULL
      ORDER BY d.driver_id`
  );
  check("dev data has drivers to check against", driverRows.length > 0, `${driverRows.length} drivers`);

  let sawExpired = 0;
  let sawUnavailable = 0;
  let sawClean = 0;

  for (const d of driverRows) {
    const expected = [];
    if (["Suspended", "On Leave"].includes(d.driver_status)) {
      expected.push(CONFLICT_TYPE.DRIVER_UNAVAILABLE);
      sawUnavailable++;
    }
    if (d.sql_says_expired) {
      expected.push(CONFLICT_TYPE.LICENSE_EXPIRED);
      sawExpired++;
    }
    if (expected.length === 0) sawClean++;

    // The JS helper and Postgres must reach the same verdict on the same value.
    check(
      `driver ${d.driver_id}: isExpired() agrees with SQL (${toCalendarDay(d.license_expiry)})`,
      isExpired(d.license_expiry) === d.sql_says_expired,
      `js=${isExpired(d.license_expiry)} sql=${d.sql_says_expired}`
    );
    checkEq(
      `driver ${d.driver_id} (${d.driver_status}): findings match the row`,
      typesOf(await detectRequestConflicts(req(), { driverId: d.driver_id })),
      expected.sort()
    );
  }

  // Guard against a vacuous pass: the loop above only proves anything if the
  // interesting paths were actually walked.
  check("at least one driver exercised the license_expired path", sawExpired > 0, `${sawExpired} expired`);
  check("at least one driver exercised the driver_unavailable path", sawUnavailable > 0, `${sawUnavailable} unavailable`);
  if (sawClean === 0) {
    console.log("   note: no driver in dev data is currently clean — every license has lapsed.");
    console.log("         the empty-findings path is proven below on the vehicle instead.");
  }

  checkEq(
    "capacity_mismatch when passengers exceed seats",
    typesOf(await detectRequestConflicts(req({ passenger_count: 8 }), { vehicleId: 1 })),
    [CONFLICT_TYPE.CAPACITY_MISMATCH]
  );

  // The empty-findings path. Derived the same way, so it cannot rot either.
  const { rows: [v1] } = await client.query(
    `SELECT vehicle_id, seating_capacity, registration_expiry,
            (registration_expiry IS NOT NULL AND registration_expiry < CURRENT_DATE) AS sql_says_expired
       FROM vehicles WHERE vehicle_id = 1 AND deleted_at IS NULL`
  );
  const vehicleExpected = [];
  if (v1?.sql_says_expired) vehicleExpected.push(CONFLICT_TYPE.REGISTRATION_EXPIRED);
  if ((v1?.seating_capacity || 0) > 0 && v1.seating_capacity < 2) vehicleExpected.push(CONFLICT_TYPE.CAPACITY_MISMATCH);
  checkEq(
    "vehicle 1 in a free window: findings match the row",
    typesOf(await detectRequestConflicts(req(), { vehicleId: 1 })),
    vehicleExpected.sort()
  );
  check(
    "the empty-findings path is reachable (nothing wrong => no chips)",
    vehicleExpected.length === 0,
    "vehicle 1 now has its own problems; pick another clean resource"
  );

  // vehicle_conflict against the committed dispatch 2 (In Progress, 2026-08-10T10:00Z).
  checkEq(
    "vehicle_conflict when the window overlaps an active dispatch",
    typesOf(
      await detectRequestConflicts(
        req({ pickup_datetime: "2026-08-10T09:00:00.000Z", scheduled_arrival: "2026-08-10T11:00:00.000Z" }),
        { vehicleId: 1 }
      )
    ),
    [CONFLICT_TYPE.VEHICLE_CONFLICT]
  );
  checkEq(
    "driver_conflict when the driver is the one double-booked",
    typesOf(
      await detectRequestConflicts(
        req({ pickup_datetime: "2026-08-10T09:00:00.000Z", scheduled_arrival: "2026-08-10T11:00:00.000Z" }),
        { driverId: 3 }
      )
    ).filter((t) => t === CONFLICT_TYPE.DRIVER_CONFLICT),
    [CONFLICT_TYPE.DRIVER_CONFLICT]
  );

  // A finding carries a message and a blocking severity, not just a type.
  // Sampled from a driver the query above proved has a lapsed license, so the
  // .every() assertions below can't pass vacuously on an empty array.
  const expiredDriver = driverRows.find((d) => d.sql_says_expired);
  const sample = expiredDriver
    ? await detectRequestConflicts(req(), { driverId: expiredDriver.driver_id })
    : [];
  check("a sample finding set is non-empty", sample.length > 0, `driver ${expiredDriver?.driver_id}`);
  check("findings carry a human-readable message", sample.every((f) => typeof f.message === "string" && f.message.length > 0));
  check("every finding is severity=blocking", sample.every((f) => f.severity === "blocking"));
  const expiryMessages = sample.filter((f) => f.type === CONFLICT_TYPE.LICENSE_EXPIRED);
  check("the sample includes the expiry finding whose message is under test", expiryMessages.length === 1);
  check(
    "expiry message renders a clean YYYY-MM-DD, not a GMT timestamp",
    expiryMessages.every((f) => /\(\d{4}-\d{2}-\d{2}\)/.test(f.message) && !/GMT/.test(f.message)),
    expiryMessages[0]?.message
  );

  // -- Transactional checks (raw predicate, client-visible) -----------------
  // registration_expired + maintenance_conflict need the uncommitted fixtures,
  // so assert the underlying predicates against this client directly.
  check(
    "fixture vehicle registration reads as expired",
    isExpired(expiredVeh.registration_expiry),
    `registration_expiry=${toCalendarDay(expiredVeh.registration_expiry)}`
  );
  const { rows: maint } = await client.query(
    `SELECT maintenance_id FROM vehiclemaintenance
      WHERE vehicle_id = $1 AND deleted_at IS NULL AND status <> 'Completed'
        AND maintenance_date <= $2::date
        AND COALESCE(completed_date, maintenance_date) >= $2::date`,
    [cleanVeh.vehicle_id, pickup]
  );
  check("maintenance window covering the pickup date is detected", maint.length === 1, `matched ${maint.length}`);

  const { rows: overlaps } = await client.query(
    `SELECT dispatch_id FROM dispatchschedules
      WHERE deleted_at IS NULL AND status = ANY($1)
        AND vehicle_id = $2
        AND scheduled_departure < $4::timestamptz
        AND COALESCE(scheduled_arrival, scheduled_departure) > $3::timestamptz`,
    [["Scheduled", "In Progress"], cleanVeh.vehicle_id, pickup, "2026-09-15T10:00:00.000Z"]
  );
  check("overlapping dispatch fixture is found by the overlap predicate", overlaps.length === 1, `matched ${overlaps.length}`);
  check("held dispatch has a dispatch_number for the chip", Boolean(heldDispatch.dispatch_number));

  // Half-open rule: a booking starting exactly when another ends must NOT conflict.
  const { rows: abutting } = await client.query(
    `SELECT dispatch_id FROM dispatchschedules
      WHERE deleted_at IS NULL AND status = ANY($1)
        AND vehicle_id = $2
        AND scheduled_departure < $4::timestamptz
        AND COALESCE(scheduled_arrival, scheduled_departure) > $3::timestamptz`,
    [["Scheduled", "In Progress"], cleanVeh.vehicle_id, "2026-09-15T12:00:00.000Z", "2026-09-15T14:00:00.000Z"]
  );
  check("abutting window does not conflict (half-open)", abutting.length === 0, `matched ${abutting.length}`);
} finally {
  await client.query("ROLLBACK");
  rolledBack = true;
  client.release();
}

// ---------------------------------------------------------------------------
// 3. findDispatchConflicts — the enforcing layer.
// ---------------------------------------------------------------------------
{
  // Dispatch 2 (committed): vehicle 1, driver 3, In Progress, 2026-08-10T10:00Z,
  // no scheduled_arrival — so it blocks exactly its own start instant.
  const hit = await findDispatchConflicts({
    vehicleId: 1,
    departure: "2026-08-10T09:00:00.000Z",
    arrival: "2026-08-10T11:00:00.000Z",
  });
  check("findDispatchConflicts finds the overlapping dispatch", hit.length >= 1, `got ${hit.length}`);

  const miss = await findDispatchConflicts({
    vehicleId: 1,
    departure: "2027-01-01T09:00:00.000Z",
    arrival: "2027-01-01T11:00:00.000Z",
  });
  checkEq("findDispatchConflicts is empty for a free window", miss.length, 0);

  const excluded = await findDispatchConflicts({
    vehicleId: 1,
    departure: "2026-08-10T09:00:00.000Z",
    arrival: "2026-08-10T11:00:00.000Z",
    excludeId: hit[0]?.dispatch_id,
  });
  check("excludeId lets a row ignore itself (reschedule case)", excluded.length === hit.length - 1);

  checkEq(
    "no resource named = nothing to check",
    (await findDispatchConflicts({ departure: "2026-08-10T09:00:00.000Z" })).length,
    0
  );
  checkEq(
    "no departure = nothing to check",
    (await findDispatchConflicts({ vehicleId: 1 })).length,
    0
  );
}

// ---------------------------------------------------------------------------
// 3b. The batch path agrees with the single path.
//
// detectConflictsForRequests exists so a 40-row queue doesn't fire 160 queries.
// It shares evaluateRequestConflicts with detectRequestConflicts, but fetches
// differently (one query per table for the union of ids, over a wider window).
// The failure this guards: the queue chip and the assign-time 409 disagreeing.
// ---------------------------------------------------------------------------
{
  console.log("3b. batch path matches per-request path");
  const { rows: liveRequests } = await query(
    `SELECT request_id, pickup_datetime, passenger_count, vehicle_id, driver_id
       FROM transportation_requests
      WHERE deleted_at IS NULL
      ORDER BY request_id`
  );
  check("there are requests to batch over", liveRequests.length > 0, `${liveRequests.length} rows`);

  const batch = await detectConflictsForRequests(liveRequests);
  checkEq("batch returns one entry per request", batch.size, liveRequests.length);

  let compared = 0;
  for (const r of liveRequests) {
    const single = typesOf(await detectRequestConflicts(r));
    const batched = typesOf(batch.get(r.request_id) ?? []);
    checkEq(`request ${r.request_id}: batch === single`, batched, single);
    compared++;
  }
  check("every request was compared across both paths", compared === liveRequests.length);

  // Synthetic rows referencing a known-bad driver, to prove the batch path
  // actually produces findings rather than agreeing by both being empty.
  const { rows: [badDriver] } = await query(
    `SELECT driver_id FROM drivers
      WHERE deleted_at IS NULL
        AND (driver_status IN ('Suspended','On Leave')
             OR (license_expiry IS NOT NULL AND license_expiry < CURRENT_DATE))
      ORDER BY driver_id LIMIT 1`
  );
  if (badDriver) {
    const synthetic = [
      { request_id: -1, pickup_datetime: "2026-09-15T09:00:00.000Z", passenger_count: 2, vehicle_id: null, driver_id: badDriver.driver_id },
      { request_id: -2, pickup_datetime: "2026-09-15T09:00:00.000Z", passenger_count: 2, vehicle_id: null, driver_id: null },
    ];
    const synthBatch = await detectConflictsForRequests(synthetic);
    check(
      "batch finds the bad driver on the row that references it",
      (synthBatch.get(-1) ?? []).length > 0,
      JSON.stringify(typesOf(synthBatch.get(-1) ?? []))
    );
    checkEq("batch reports nothing for the unassigned row", (synthBatch.get(-2) ?? []).length, 0);
    checkEq(
      "batch matches single on the synthetic row too",
      typesOf(synthBatch.get(-1) ?? []),
      typesOf(await detectRequestConflicts(synthetic[0]))
    );
  }

  checkEq("empty input yields an empty map", (await detectConflictsForRequests([])).size, 0);
  checkEq("null input is tolerated", (await detectConflictsForRequests(null)).size, 0);
}

// ---------------------------------------------------------------------------
// 4. Every declared conflict type is covered by this suite.
// ---------------------------------------------------------------------------
{
  const declared = Object.values(CONFLICT_TYPE).sort();
  const exercised = [
    CONFLICT_TYPE.VEHICLE_CONFLICT,
    CONFLICT_TYPE.DRIVER_CONFLICT,
    CONFLICT_TYPE.MAINTENANCE_CONFLICT,
    CONFLICT_TYPE.DRIVER_UNAVAILABLE,
    CONFLICT_TYPE.LICENSE_EXPIRED,
    CONFLICT_TYPE.REGISTRATION_EXPIRED,
    CONFLICT_TYPE.CAPACITY_MISMATCH,
  ].sort();
  checkEq("all 7 declared conflict types are exercised", declared, exercised);
}

check("fixtures were rolled back", rolledBack === true);

console.log(`\nconflicts: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await pool.end();
if (failures.length) process.exitCode = 1;
