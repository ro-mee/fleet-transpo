// DB-backed verification harness for the quick wins (task 17 / plan steps 14-16).
//
//   (a) Notification scoping (task 15): GET /api/notifications for a caller
//       returns only their own rows; an ops role (admin) can read a specific
//       employee via ?employee_id; a non-ops role asking for another employee's
//       rows is refused 403. Note: the route authenticates with requireAuth()
//       (the DEFAULT_ROLES list, which excludes `driver`), so a driver cannot
//       reach this endpoint at all; the non-ops actor here is `management`,
//       which exercises the same caller-scoping branch.
//   (b) Report date range (task 16): GET /api/reports/driver-performance?from&to
//       returns the same response shape as before (totalDrivers / avgScore /
//       topDrivers) — shape-only, since it cannot be meaningfully exercised
//       without seeded completed trips.
//
// A third check used to live here: that POST /api/reservations returned 410
// (task 14's legacy lockdown). Phase 3 deleted that route surface outright along
// with the `vehiclereservations` table it served, so there is no longer an
// endpoint to assert against.
//
// Both go through the REAL route handlers against the live database.
// Two throwaway employees are seeded (with one notification each) and soft-
// deleted at the end; the notifications themselves are hard-deleted (the table
// has no deleted_at) — scoped to the ids this run created.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-quickwins.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const app = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);
const { getPool } = await app("lib/db.js");
const { query } = await app("lib/db.js");

let pass = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) pass++;
  else failures.push(detail ? `${label} — ${detail}` : label);
}

// ---------------------------------------------------------------------------
// Routes under test.
// ---------------------------------------------------------------------------
const notifications = await app("app/api/notifications/route.js");
const driverPerformance = await app("app/api/reports/driver-performance/route.js");

function setSession(session) {
  globalThis.__HARNESS_SESSION__ = session;
}

function makeRequest(method, url, body) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectStatus(handler, req, params) {
  const restore = console.error;
  console.error = () => {};
  try {
    const res = await handler(req, params);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    console.error = restore;
  }
}

// ---------------------------------------------------------------------------
// Seeding: two throwaway employees + one notification each. Tracked for cleanup.
// ---------------------------------------------------------------------------
const marker = Date.now();
const createdEmployeeIds = [];
const createdNotificationIds = [];

async function seedEmployee(suffix) {
  const { rows } = await query(
    `INSERT INTO employees (first_name, last_name, email)
     VALUES ('Harness', $1, $2) RETURNING employee_id`,
    [suffix, `harness-qw-${marker}-${suffix}@example.com`]
  );
  createdEmployeeIds.push(rows[0].employee_id);
  return rows[0].employee_id;
}

async function seedNotification(employeeId, title) {
  const { rows } = await query(
    `INSERT INTO notifications (employee_id, title, message, type)
     VALUES ($1, $2, $3, 'Info') RETURNING notification_id`,
    [employeeId, title, `harness ${title}`]
  );
  createdNotificationIds.push(rows[0].notification_id);
  return rows[0].notification_id;
}

async function cleanup() {
  if (createdNotificationIds.length) {
    const { rowCount } = await query(
      `DELETE FROM notifications WHERE notification_id = ANY($1::int[])`,
      [createdNotificationIds]
    );
    if (rowCount) console.log(`cleanup: deleted ${rowCount} harness notification(s)`);
  }
  if (createdEmployeeIds.length) {
    const { rowCount } = await query(
      `UPDATE employees SET deleted_at = NOW() WHERE employee_id = ANY($1::int[])`,
      [createdEmployeeIds]
    );
    if (rowCount) console.log(`cleanup: soft-deleted ${rowCount} harness employee(s)`);
  }
}

console.log("\n=== Quick wins: notification scoping / report shape ===\n");

try {
  const empA = await seedEmployee("A");
  const empB = await seedEmployee("B");
  const noteA = await seedNotification(empA, "HARN-T17-A");
  const noteB = await seedNotification(empB, "HARN-T17-B");
  console.log(`1. Seeded employees #${empA} / #${empB} with notifications #${noteA} / #${noteB}`);

  // -------------------------------------------------------------------------
  // (a) Notification scoping.
  // -------------------------------------------------------------------------
  console.log("2. GET notifications returns only the caller's rows");
  setSession({ user: { employeeId: empA, role: "management", email: "mgmt@harness" } });
  const own = await expectStatus(notifications.GET, makeRequest("GET", "http://localhost:3000/api/harness/notifications"));
  const ownTitles = (Array.isArray(own.body) ? own.body : []).map((n) => n.title);
  check("non-ops caller GET returns 200", own.status === 200, `got ${own.status}`);
  check("caller sees their own notification", ownTitles.includes("HARN-T17-A"), JSON.stringify(ownTitles));
  check("caller does NOT see the other employee's notification", !ownTitles.includes("HARN-T17-B"), JSON.stringify(ownTitles));

  console.log("3. GET notifications as admin with ?employee_id");
  setSession({ user: { employeeId: 8, role: "admin", email: "admin@harness" } });
  const scoped = await expectStatus(
    notifications.GET,
    makeRequest("GET", `http://localhost:3000/api/harness/notifications?employee_id=${empB}`)
  );
  const scopedTitles = (scoped.body || []).map((n) => n.title);
  check("admin ?employee_id returns 200", scoped.status === 200, `got ${scoped.status}`);
  check("admin sees the requested employee's notification", scopedTitles.includes("HARN-T17-B"), JSON.stringify(scopedTitles));

  console.log("4. GET notifications scoped to another employee is refused for non-ops");
  setSession({ user: { employeeId: empA, role: "management", email: "mgmt@harness" } });
  const driverScoped = await expectStatus(
    notifications.GET,
    makeRequest("GET", `http://localhost:3000/api/harness/notifications?employee_id=${empB}`)
  );
  check("driver scoped read returns 403", driverScoped.status === 403, `got ${driverScoped.status}`);

  // -------------------------------------------------------------------------
  // (b) Report date-range regression: shape must be preserved.
  // -------------------------------------------------------------------------
  console.log("5. GET driver-performance honors from/to (shape regression)");
  setSession({ user: { employeeId: 8, role: "admin", email: "admin@harness" } });
  const report = await expectStatus(
    driverPerformance.GET,
    makeRequest("GET", "http://localhost:3000/api/harness/reports/driver-performance?from=2020-01-01&to=2030-01-01")
  );
  check("report returns 200", report.status === 200, `got ${report.status}`);
  check("report exposes totalDrivers", Object.prototype.hasOwnProperty.call(report.body || {}, "totalDrivers"), JSON.stringify(report.body));
  check("report exposes avgScore", Object.prototype.hasOwnProperty.call(report.body || {}, "avgScore"), JSON.stringify(report.body));
  check("report exposes topDrivers", Array.isArray(report.body?.topDrivers), JSON.stringify(report.body?.topDrivers));
} catch (e) {
  failures.push(`unexpected harness error: ${e.stack || e.message}`);
} finally {
  await cleanup();
}

console.log(`\nquickwins: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await getPool().end();
if (failures.length) process.exitCode = 1;
