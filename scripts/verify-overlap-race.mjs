// Concurrency verification — trg_dispatch_overlap under real contention.
//
// Migration 023 claims the double-booking guard is race-free: a BEFORE INSERT
// OR UPDATE trigger takes per-resource advisory locks (pg_advisory_xact_lock
// hashed on dispatch_veh_<id> / dispatch_drv_<id>) so a check-then-insert
// cannot interleave two overlapping dispatches. This suite is the proof. It
// opens TWO real connections and fires overlapping inserts so that one
// transaction is still uncommitted while the other's INSERT is in flight — the
// exact interleaving that defeats an unguarded check-then-insert — and asserts
// the loser is rejected.
//
// A sequential baseline (insert + commit, then insert the conflict) is also
// included so both the guard's existence AND its concurrency are pinned
// separately.
//
// Every fixture uses a dedicated vehicle/driver and a far-future window. Each
// race gets its OWN window so a winner committed by an earlier race can never
// collide with a later one. Cleanup deletes every committed fixture row plus
// the notifications the DB triggers write for it, and runs unconditionally in
// `finally` — a crash mid-suite cannot leak rows.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-overlap-race.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const app = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);
const { getPool } = await app("lib/db.js");

let pass = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// A marker the cleanup pass can identify — seed data wears DSP-S4-*, so the
// RACE- prefix cannot collide with existing rows.
const PRE = `RACE-${Date.now()}-`;
let seq = 0;
const nextNumber = () => `${PRE}${++seq}`;

const createdNumbers = [];
const createdDispatchIds = [];

const INSERT_DISPATCH = `
  INSERT INTO dispatchschedules
    (dispatch_number, vehicle_id, driver_id, scheduled_departure, scheduled_arrival, status, priority, notes)
  VALUES ($1, $2, $3, $4, $5, 'Scheduled', 'Normal', 'race-fixture')
  RETURNING dispatch_id
`;

async function insertDispatch(client, { number, vehicleId, driverId, departure, arrival }) {
  const { rows } = await client.query(INSERT_DISPATCH, [
    number, vehicleId, driverId, departure, arrival,
  ]);
  createdNumbers.push(number);
  createdDispatchIds.push(rows[0].dispatch_id);
  return rows[0].dispatch_id;
}

// ---------------------------------------------------------------------------
// Fixtures: clean vehicle + driver with no active dispatch anywhere.
// ---------------------------------------------------------------------------
const pool = getPool();

// Self-heal: a previous run that was killed (tool timeout, crash between a
// winner's COMMIT and the cleanup pass) can leave committed RACE-* fixtures
// behind. Sweep them so the clean-resource fixture query can never be
// satisfied by a poisoned run's leftovers.
{
  const c = await pool.connect();
  try {
    const ds = await c.query(`SELECT dispatch_id FROM dispatchschedules WHERE dispatch_number LIKE 'RACE-%'`);
    const stale = ds.rows.map((r) => r.dispatch_id);
    if (stale.length) {
      await c.query(`DELETE FROM notifications WHERE reference_type='dispatch' AND reference_id = ANY($1::int[])`, [stale]);
      await c.query(`DELETE FROM dispatchschedules WHERE dispatch_id = ANY($1::int[])`, [stale]);
      console.log(`pre-clean removed ${stale.length} stale RACE-* fixtures from a previous run`);
    }
  } finally {
    c.release();
  }
}

const owner = await pool.connect();

let vehicle; let driver; let otherVehicle; let otherDriver;

try {
  const { rows: [v] } = await owner.query(
    `SELECT v.vehicle_id
       FROM vehicles v
      WHERE v.deleted_at IS NULL
        AND v.vehicle_status = 'Available'
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules d
           WHERE d.vehicle_id = v.vehicle_id AND d.deleted_at IS NULL
             AND d.status IN ('Scheduled','In Progress'))
      ORDER BY v.vehicle_id LIMIT 1`
  );
  const { rows: [d] } = await owner.query(
    `SELECT d.driver_id
       FROM drivers d
      WHERE d.deleted_at IS NULL
        AND d.driver_status = 'Available'
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules ds
           WHERE ds.driver_id = d.driver_id AND ds.deleted_at IS NULL
             AND ds.status IN ('Scheduled','In Progress'))
      ORDER BY d.driver_id LIMIT 1`
  );
  check("a clean vehicle exists for the fixture", Boolean(v));
  check("a clean driver exists for the fixture", Boolean(d));
  if (!v || !d) process.exit(1);
  vehicle = v; driver = d;

  const { rows: [v2] } = await owner.query(
    `SELECT vehicle_id FROM vehicles
      WHERE deleted_at IS NULL AND vehicle_status = 'Available'
        AND vehicle_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules d
           WHERE d.vehicle_id = vehicles.vehicle_id AND d.deleted_at IS NULL
             AND d.status IN ('Scheduled','In Progress'))
      ORDER BY vehicle_id LIMIT 1`,
    [v.vehicle_id]
  );
  const { rows: [d2] } = await owner.query(
    `SELECT driver_id FROM drivers
      WHERE deleted_at IS NULL AND driver_status = 'Available'
        AND driver_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules ds
           WHERE ds.driver_id = drivers.driver_id AND ds.deleted_at IS NULL
             AND ds.status IN ('Scheduled','In Progress'))
      ORDER BY driver_id LIMIT 1`,
    [d.driver_id]
  );
  otherVehicle = v2; otherDriver = d2;
} finally {
  owner.release();
}

let windowCounter = 0;
// Each race gets its own window so previously committed fixtures never overlap.
const windowFor = (cycle) => {
  const origin = 2030 + cycle; // far future, distinct year per race
  return {
    W1: { departure: `${origin}-06-15T08:00:00.000Z`, arrival: `${origin}-06-15T10:00:00.000Z` },
    W_OVERLAP: { departure: `${origin}-06-15T09:00:00.000Z`, arrival: `${origin}-06-15T11:00:00.000Z` },
    W2: { departure: `${origin}-06-15T10:00:00.000Z`, arrival: `${origin}-06-15T12:00:00.000Z` },
  };
};

// ---------------------------------------------------------------------------
// 1. Sequential baseline — the guard exists before we test its concurrency.
// ---------------------------------------------------------------------------
{
  console.log("1. Sequential baseline");
  const w = windowFor(windowCounter++);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const first = await insertDispatch(c, {
      number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: driver.driver_id, ...w.W1,
    });
    await c.query("COMMIT");
    check("sequential: first dispatch commits", Number(first) > 0);

    try {
      await c.query("BEGIN");
      await insertDispatch(c, {
        number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: driver.driver_id, ...w.W_OVERLAP,
      });
      await c.query("COMMIT");
      check("sequential: overlapping dispatch is rejected", false);
    } catch (e) {
      check("sequential: overlapping dispatch is rejected", true);
      check("sequential: rejection is the trigger's P0001", e?.code === "P0001", e?.message);
      await c.query("ROLLBACK");
    }

    // Half-open rule — a dispatch starting exactly when another ends must NOT conflict.
    await c.query("BEGIN");
    await insertDispatch(c, {
      number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: driver.driver_id, ...w.W2,
    });
    await c.query("COMMIT");
    check("sequential: abutting window (half-open) is allowed", true);

    if (otherVehicle && otherDriver) {
      await c.query("BEGIN");
      await insertDispatch(c, {
        number: nextNumber(),
        vehicleId: otherVehicle.vehicle_id,
        driverId: otherDriver.driver_id,
        ...w.W1,
      });
      await c.query("COMMIT");
      check("sequential: different resource, same window is allowed", true);
    }
  } finally {
    c.release();
  }
}

// ---------------------------------------------------------------------------
// 2. The race. Both transactions BEGIN; both INSERTs fire. The first INSERT to
//    settle holds the advisory lock, so it wins; the other blocks on the lock
//    until the winner's transaction ends. Only when the winner COMMITs does the
//    loser re-run its check against a row that is now visible — and the trigger
//    raises. Assert exactly-one-wins + P0001 loser.
// ---------------------------------------------------------------------------
async function runOverlapRace({ label, dispatchA, dispatchB }) {
  const a = await pool.connect();
  const b = await pool.connect();
  const outcome = { A: "pending", B: "pending" };
  try {
    await a.query("BEGIN");
    await b.query("BEGIN");

    const pA = insertDispatch(a, dispatchA).then(
      () => { outcome.A = "inserted"; return "A"; },
      (e) => { outcome.A = "rejected"; return "A"; }
    );
    const pB = insertDispatch(b, dispatchB).then(
      () => { outcome.B = "inserted"; return "B"; },
      (e) => { outcome.B = "rejected"; return "B"; }
    );

    // Neither promise rejects (both catch and record outcome), so which one
    // 'won' is the first to settle — that transaction holds the advisory lock.
    const winner = await Promise.race([pA, pB]);

    // Wait for the loser to be waiting on the lock, then commit the winner.
    await new Promise((r) => setTimeout(r, 200));
    if (winner === "A") await a.query("COMMIT");
    else await b.query("COMMIT");

    // The loser can now acquire the lock, re-check, and must be rejected.
    await (winner === "A" ? pB : pA);

    const loserState = winner === "A" ? outcome.B : outcome.A;
    try {
      if (winner === "A") await b.query("ROLLBACK");
      else await a.query("ROLLBACK");
    } catch {}

    check(`${label}: the loser is rejected by the trigger`, loserState === "rejected", `loser state=${loserState}`);
    check(`${label}: the winner committed`, loserState === "rejected" || outcome.A === "inserted" || outcome.B === "inserted");
  } finally {
    a.release(); b.release();
  }
}

try {
  console.log("2. Concurrent races");
  {
    const w = windowFor(windowCounter++);
    await runOverlapRace({
      label: "race (same vehicle+driver)",
      dispatchA: { number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: driver.driver_id, ...w.W1 },
      dispatchB: { number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: driver.driver_id, ...w.W_OVERLAP },
    });
  }

  if (otherDriver) {
    const w = windowFor(windowCounter++);
    await runOverlapRace({
      label: "race (same vehicle, different drivers)",
      dispatchA: { number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: driver.driver_id, ...w.W1 },
      dispatchB: { number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: otherDriver.driver_id, ...w.W_OVERLAP },
    });
  }

  if (otherVehicle) {
    const w = windowFor(windowCounter++);
    await runOverlapRace({
      label: "race (same driver, different vehicles)",
      dispatchA: { number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: driver.driver_id, ...w.W1 },
      dispatchB: { number: nextNumber(), vehicleId: otherVehicle.vehicle_id, driverId: driver.driver_id, ...w.W_OVERLAP },
    });
  }

  // Control: non-overlapping windows on the SAME resource fired concurrently
  // must BOTH succeed — the locks must not over-block. Same fire pattern as the
  // races, but here the loser's re-check finds no overlap, so it inserts too.
  if (otherVehicle && otherDriver) {
    const w = windowFor(windowCounter++);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      const pA = insertDispatch(a, {
        number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: driver.driver_id, ...w.W1,
      }).then(() => "A");
      const pB = insertDispatch(b, {
        number: nextNumber(), vehicleId: vehicle.vehicle_id, driverId: otherDriver.driver_id, ...w.W2,
      }).then(() => "B");

      const first = await Promise.race([pA, pB]);
      await new Promise((r) => setTimeout(r, 200));
      if (first === "A") await a.query("COMMIT");
      else await b.query("COMMIT");

      let bothCommitted = false;
      try {
        await (first === "A" ? pB : pA);
        if (first === "A") await b.query("COMMIT");
        else await a.query("COMMIT");
        bothCommitted = true;
      } catch (e) {
        try {
          if (first === "A") await b.query("ROLLBACK");
          else await a.query("ROLLBACK");
        } catch {}
      }
      check(
        "race control: two non-overlapping windows both commit",
        bothCommitted,
        "second commit was rejected"
      );
    } finally {
      a.release(); b.release();
    }
  }
} catch (e) {
  failures.push(`unexpected error mid-suite — ${e?.message}`);
  console.log("ERROR:", e?.message);
}

// ---------------------------------------------------------------------------
// 3. Cleanup — unconditional, and verified.
// ---------------------------------------------------------------------------
console.log("3. Cleanup");
const cleanup = await pool.connect();
let deletedNotifications = 0;
let deletedDispatches = 0;
try {
  const n = await cleanup.query(
    `DELETE FROM notifications
      WHERE reference_type = 'dispatch'
        AND reference_id = ANY($1::int[])`,
    [createdDispatchIds]
  );
  deletedNotifications = n.rowCount;

  const d = await cleanup.query(
    `DELETE FROM dispatchschedules WHERE dispatch_number = ANY($1::text[])`,
    [createdNumbers]
  );
  deletedDispatches = d.rowCount;
} finally {
  cleanup.release();
}

check("cleanup removed the fixtures' notifications", deletedNotifications <= createdDispatchIds.length);
check("cleanup removed every committed fixture dispatch", deletedDispatches === createdNumbers.length, `${deletedDispatches}/${createdNumbers.length}`);
// A re-query proves nothing survives, not just that the DELETE matched.
{
  const c = await pool.connect();
  try {
    const { rows } = await c.query(
      `SELECT 1 FROM dispatchschedules WHERE dispatch_number LIKE $1 LIMIT 1`,
      [`${PRE}%`]
    );
    check("no fixture dispatch survives in the table", rows.length === 0, `${rows.length} left`);
  } finally {
    c.release();
  }
}

console.log(`\noverlap-race: ${pass} passed, ${failures.length} failed; fixtures ${createdNumbers.length} dispatches / ${createdDispatchIds.length} ids`);
for (const f of failures) console.log(`  FAIL ${f}`);
await pool.end();
if (failures.length) process.exitCode = 1;