// One-off cleanup for the employee rows the verification harnesses leaked.
//
// scripts/verify-*.mjs run against the LIVE DATABASE_URL and create employee +
// driver rows they never remove. Before mandatory email OTP an abandoned fixture
// was junk; now it is an account nobody can sign into and nobody can remove
// through the UI — every one of them sits on the reserved `@example.com` domain,
// so isDeliverableEmailAddress() (src/lib/auth/otp-policy.js:62-86) refuses the
// login, and `deleted_at IS NULL` keeps them in every user list.
//
// The leak itself is closed in verify-p1-e2e.mjs and verify-p2-analytics.mjs
// (both now soft-delete what they create). This script clears the backlog, and
// is still worth keeping: four of the rows below match no current script at all
// (`testdriver1@example.com`, `testdriver2@example.com`, `test-driver-<n>@...`)
// — they are debris from superseded harness versions that no longer exist to be
// fixed.
//
// Shape follows scripts/soft-delete-otp-collision.mjs: the repo's established
// form for live-data surgery — loadEnvLocal → @/lib/db → guard every assumption
// and refuse loudly → withTransaction → writeAudit after commit → report.
//
// ---------------------------------------------------------------------------
// ACCEPTED LIMITATION — three tables have no `deleted_at` column and cannot be
// swept: `driver_vehicle_assignments` (schema.sql:250), `fuelallocations`
// (:503) and `fuelrequests` (:554). Their rows are left in place. Their parent
// drivers and vehicles are soft-deleted, so they stop surfacing anywhere the app
// reads through `deleted_at IS NULL`; only a DBA looking at the raw tables would
// still see them.
//
// Soft-delete, not DELETE: `drivers.employee_id` carries no ON DELETE CASCADE
// (schema.sql:1158), nor do `notifications` (:1195) or `audit_logs` (:1127), so a
// hard delete would need an ordered unwinding across ~8 tables to clear FK
// references that soft delete leaves perfectly valid.
// ---------------------------------------------------------------------------
//
// Run (dry run — prints the rows, writes nothing):
//   node --import ./scripts/alias-loader.mjs scripts/cleanup-harness-fixtures.mjs
//
// Apply (--expect is REQUIRED with --apply):
//   node --import ./scripts/alias-loader.mjs scripts/cleanup-harness-fixtures.mjs \
//     --apply --expect 19

import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const { withTransaction, query } = await import("@/lib/db");
const { writeAudit } = await import("@/lib/audit");

// Address patterns the harnesses produce. Matched case-insensitively against
// the WHOLE address, and only ever as one of several guards — see `assertSafe`.
// The trailing `-` variants carry the `EXTRACT(EPOCH FROM NOW())` suffix the two
// live scripts stamp on; the bare ones are the superseded versions.
const PATTERNS = [
  "testdriver1-%@example.com",
  "testdriver2-%@example.com",
  "testdriver1@example.com",
  "testdriver2@example.com",
  "test-driver-%@example.com",
  "analytics_driver_%@example.com",
];

const REASON = "harness_fixture_cleanup";

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");

const expectIdx = argv.indexOf("--expect");
const expected = expectIdx === -1 ? null : Number(argv[expectIdx + 1]);

for (const arg of argv) {
  if (arg !== "--apply" && arg !== "--expect" && !/^\d+$/.test(arg)) {
    console.error(`x unknown argument "${arg}"`);
    process.exitCode = 1;
  }
}
if (expectIdx !== -1 && !Number.isInteger(expected)) {
  console.error("x --expect needs an integer, e.g. --expect 19");
  process.exitCode = 1;
}
if (process.exitCode) process.exit();

// ---- resolve what would be swept -------------------------------------------
const { rows: employees } = await query(
  `SELECT e.employee_id, e.email, e.status, e.created_at, e.role_id,
          e.password_hash IS NOT NULL AS has_password,
          coalesce(r.role_name, '(no role)') AS role_name,
          trim(concat_ws(' ', e.first_name, e.last_name)) AS name
     FROM employees e
     LEFT JOIN roles r ON r.role_id = e.role_id
    WHERE e.deleted_at IS NULL
      AND lower(e.email) LIKE ANY ($1::text[])
    ORDER BY e.employee_id`,
  [PATTERNS]
);

if (!employees.length) {
  console.log("Nothing to do — no active employee row matches the fixture patterns.");
  process.exit();
}

const employeeIds = employees.map((e) => Number(e.employee_id));

const { rows: drivers } = await query(
  `SELECT driver_id, employee_id, license_number
     FROM drivers
    WHERE employee_id = ANY($1::int[]) AND deleted_at IS NULL
    ORDER BY driver_id`,
  [employeeIds]
);
const driverIds = drivers.map((d) => Number(d.driver_id));

// Vehicles are reached through the fixture drivers' own rows only — the
// harnesses name plates with a timestamp suffix rather than a stable prefix, so
// there is no plate pattern to match on and reference is the only sound link.
const { rows: vehicles } = driverIds.length
  ? await query(
      `SELECT v.vehicle_id, v.plate_number, v.vehicle_name,
              (SELECT count(*) FROM trips t
                WHERE t.vehicle_id = v.vehicle_id AND t.deleted_at IS NULL) AS trips_total,
              (SELECT count(*) FROM trips t
                WHERE t.vehicle_id = v.vehicle_id AND t.deleted_at IS NULL
                  AND t.driver_id = ANY($1::int[])) AS trips_ours,
              (SELECT count(*) FROM fuelrecords f
                WHERE f.vehicle_id = v.vehicle_id AND f.deleted_at IS NULL) AS fuel_total,
              (SELECT count(*) FROM fuelrecords f
                WHERE f.vehicle_id = v.vehicle_id AND f.deleted_at IS NULL
                  AND f.driver_id = ANY($1::int[])) AS fuel_ours
         FROM vehicles v
        WHERE v.deleted_at IS NULL
          AND (v.vehicle_id IN (SELECT vehicle_id FROM trips
                                 WHERE driver_id = ANY($1::int[]) AND deleted_at IS NULL)
            OR v.vehicle_id IN (SELECT vehicle_id FROM fuelrecords
                                 WHERE driver_id = ANY($1::int[]) AND deleted_at IS NULL))
        ORDER BY v.vehicle_id`,
      [driverIds]
    )
  : [];
const vehicleIds = vehicles.map((v) => Number(v.vehicle_id));

const { rows: counts } = driverIds.length
  ? await query(
      `SELECT
         (SELECT count(*) FROM trips
           WHERE driver_id = ANY($1::int[]) AND deleted_at IS NULL) AS trips,
         (SELECT count(*) FROM fuelrecords
           WHERE driver_id = ANY($1::int[]) AND deleted_at IS NULL) AS fuelrecords,
         (SELECT count(*) FROM fuelrequests
           WHERE driver_id = ANY($1::int[])) AS fuelrequests_undeletable,
         (SELECT count(*) FROM driver_vehicle_assignments
           WHERE driver_id = ANY($1::int[])) AS assignments_undeletable`,
      [driverIds]
    )
  : [{ trips: 0, fuelrecords: 0, fuelrequests_undeletable: 0, assignments_undeletable: 0 }];
const c = counts[0];

// ---- guards ----------------------------------------------------------------
// Each refuses the WHOLE run rather than skipping the offending row: a partial
// sweep of a set that surprised us is exactly the outcome these exist to stop.
const problems = [];

// role_id is the load-bearing guard. Every leaked fixture has no role — the
// harnesses INSERT `(first_name, last_name, email)` and nothing else
// (`employees.role_id` is nullable, schema.sql:437) — while every account a human
// provisioned has one. An address pattern alone must never decide that a real
// account is disposable.
for (const e of employees) {
  if (e.role_id !== null) {
    problems.push(`employee ${e.employee_id} (${e.email}) has role "${e.role_name}" — not a fixture`);
  }
  if (e.has_password) {
    problems.push(`employee ${e.employee_id} (${e.email}) has a password_hash — someone set a credential on it`);
  }
}
// A vehicle is only ours to retire if EVERY row pointing at it is ours. The
// harnesses create their own vehicles, but they are the only rows here that are
// shared rather than owned (plates are unique, trips and fuel are not), so this
// is where a cheap mistake would do real damage.
for (const v of vehicles) {
  const total = Number(v.trips_total) + Number(v.fuel_total);
  const ours = Number(v.trips_ours) + Number(v.fuel_ours);
  if (total !== ours) {
    problems.push(
      `vehicle ${v.vehicle_id} (${v.plate_number}) also carries ${total - ours} row(s) ` +
        `of non-fixture data — refusing to retire it`
    );
  }
}
// Pinned count. `--apply` demands it so the operator must state up front how many
// accounts they expect; a pattern that quietly starts matching real accounts, or
// a harness row created between the dry run and the apply, fails closed here
// instead of being swept.
if (expected !== null && employees.length !== expected) {
  problems.push(`expected ${expected} fixture account(s), resolved ${employees.length}`);
}
if (apply && expected === null) {
  problems.push("--apply requires --expect <n> (the number this dry run printed)");
}

if (problems.length) {
  console.error("Refusing to act — the assumption(s) behind this sweep did not hold:\n");
  for (const p of problems) console.error(`  x ${p}`);
  console.error("\nNothing was written.");
  process.exitCode = 1;
  process.exit();
}

// ---- report ----------------------------------------------------------------
console.log(
  `\nFixture accounts matched: ${employees.length}\n` +
    `  drivers ${drivers.length}, vehicles ${vehicles.length}, ` +
    `trips ${c.trips}, fuel records ${c.fuelrecords}\n`
);
console.log(
  "  id     role         email                              name"
);
for (const e of employees) {
  console.log(
    `  ${String(e.employee_id).padStart(5)}  ${e.role_name.padEnd(11)}  ` +
      `${String(e.email).padEnd(33)}  ${e.name}`
  );
}
console.log(
  `\n  Not sweepable (no deleted_at column): ${c.fuelrequests_undeletable} fuel request(s), ` +
    `${c.assignments_undeletable} driver/vehicle assignment(s) — see the header.`
);

if (!apply) {
  console.log(
    "\nDRY RUN — nothing written.\n" +
      `Re-run with:  --apply --expect ${employees.length}`
  );
  process.exit();
}

// ---- apply -----------------------------------------------------------------
const now = new Date().toISOString();

const swept = await withTransaction(async (tx) => {
  const order = [
    ["fuelrecords", "fuel_record_id", `driver_id = ANY($1::int[])`, driverIds],
    ["trips", "trip_id", `driver_id = ANY($1::int[])`, driverIds],
    ["vehicles", "vehicle_id", `vehicle_id = ANY($1::int[])`, vehicleIds],
    ["drivers", "driver_id", `driver_id = ANY($1::int[])`, driverIds],
    ["employees", "employee_id", `employee_id = ANY($1::int[])`, employeeIds],
  ];

  const result = {};
  for (const [table, idCol, where, ids] of order) {
    if (!ids.length) {
      result[table] = { ids: [], rows: 0 };
      continue;
    }
    // `deleted_at IS NULL` in the predicate doubles as the idempotency guard: a
    // re-run matches nothing and reports 0 rather than restamping the timestamp.
    const { rows } = await tx.query(
      `UPDATE ${table} SET deleted_at = NOW()
        WHERE ${where} AND deleted_at IS NULL
        RETURNING ${idCol}`,
      [ids]
    );
    result[table] = { ids: rows.map((r) => Number(r[idCol])), rows: rows.length };
  }
  return result;
});

// After commit, so a rollback cannot leave an audit trail claiming work that
// did not happen. No request context — actor is null and the ids name the
// subjects, matching the shape src/lib/auth.js uses for credential events.
for (const [table, { ids, rows }] of Object.entries(swept)) {
  if (!rows) continue;
  await writeAudit(null, null, {
    action: "update",
    resource: table,
    oldValues: { ids, count: rows, deleted_at: null },
    newValues: { deleted_at: now, reason: REASON },
  });
}

console.log("\nApplied:");
for (const [table, { rows }] of Object.entries(swept)) {
  console.log(`  soft-deleted ${String(rows).padStart(3)} ${table} row(s)`);
}

const { rows: after } = await query(
  `SELECT count(*)::int AS n FROM employees
    WHERE deleted_at IS NULL AND lower(email) LIKE ANY ($1::text[])`,
  [PATTERNS]
);
console.log(
  `\n${after[0].n} fixture account(s) still active.` +
    (after[0].n === 0 ? "" : " Expected 0 — investigate before re-running.")
);
