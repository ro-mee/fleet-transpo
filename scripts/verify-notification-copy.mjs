// Live route check for the driver notification microcopy module
// (src/lib/notifications/copy.js).
//
// Drives the real driver incident route + staff acknowledge + staff resolve
// against the live database and asserts the notification rows the REPORTER
// receives match the copy module exactly — title and message, byte for byte.
// Also verifies the two SQL-trigger copy exceptions (migration 110) are live
// in pg_proc.
//
// Every row this run creates is hard-deleted at the end (notifications,
// incident_comments, audit_logs, the driverincidents row itself).
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-notification-copy.mjs
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const app = (path) => import(pathToFileURL(resolve(process.cwd(), "src", path)).href);
const { query, getPool } = await app("lib/db.js");
const driverIncidentsRoute = await app("app/api/driver/incidents/route.js");
const acknowledgeRoute = await app("app/api/incidents/[id]/acknowledge/route.js");
const incidentRoute = await app("app/api/incidents/[id]/route.js");
const { incidentTypeLabel } = await app("lib/incidents/resolution.js");
const copy = await app("lib/notifications/copy.js");

let passed = 0;
const failed = [];
const check = (label, condition, detail = "") =>
  condition ? passed++ : failed.push(`${label}${detail ? ` — ${detail}` : ""}`);

const request = (method, url, body) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const setSession = (session) => {
  globalThis.__HARNESS_SESSION__ = session;
};

// A real driver+employee pair to play the reporter. "Passenger delay" /
// Minor deliberately avoids the grounding + auto-maintenance paths so the
// smoke stays about copy, not work orders.
const { rows: drivers } = await query(
  `SELECT d.driver_id, e.employee_id
     FROM drivers d
     JOIN employees e ON e.employee_id = d.employee_id
    WHERE d.deleted_at IS NULL AND e.deleted_at IS NULL
    LIMIT 1`
);
const driver = drivers[0];
if (!driver) {
  console.error("No active driver+employee pair found to run the smoke.");
  process.exit(1);
}

const incidentIds = [];

try {
  // ── 1. Report an incident as the driver ──────────────────────────────────
  setSession({ user: { employeeId: driver.employee_id, role: "driver" } });
  const clientSubmissionId = `vnc-smoke-${Date.now()}`;
  const postRes = await driverIncidentsRoute.POST(
    request("POST", "http://harness/api/driver/incidents", {
      incident_type: "Passenger delay",
      description: "verify-notification-copy smoke test row — will be deleted",
      location: "Test Location",
      severity: "Minor",
      client_submission_id: clientSubmissionId,
    })
  );
  const incident = await postRes.json();
  check("driver POST /api/driver/incidents returns 201", postRes.status === 201, `status ${postRes.status}`);
  const incidentData = incident?.data ?? incident;
  if (!incidentData?.incident_id) {
    throw new Error(`incident create failed: ${JSON.stringify(incident).slice(0, 300)}`);
  }
  const incidentId = incidentData.incident_id;
  incidentIds.push(incidentId);

  const expected = copy.incidentUnderReview({
    incidentTypeLabel: incidentTypeLabel(incidentData.incident_type),
  });
  const { rows: underReviewRows } = await query(
    `SELECT title, message FROM notifications
      WHERE employee_id = $1 AND reference_type = 'incident' AND reference_id = $2`,
    [driver.employee_id, incidentId]
  );
  check(
    "under-review notification title matches copy module",
    underReviewRows[0]?.title === expected.title,
    `got "${underReviewRows[0]?.title}", expected "${expected.title}"`
  );
  check(
    "under-review notification message matches copy module",
    underReviewRows[0]?.message === expected.message,
    `got "${underReviewRows[0]?.message}", expected "${expected.message}"`
  );

  // ── 2. Staff acknowledges ────────────────────────────────────────────────
  setSession({ user: { employeeId: 8, role: "admin", email: "admin@harness" } });
  const ackRes = await acknowledgeRoute.POST(
    request("POST", `http://harness/api/incidents/${incidentId}/acknowledge`, {
      note: "Tow truck arranged for the delayed guests.",
    }),
    { params: Promise.resolve({ id: String(incidentId) }) }
  );
  check("staff acknowledge succeeds", ackRes.status === 200, `status ${ackRes.status}`);

  const ackExpected = copy.incidentAcknowledged({
    note: "Tow truck arranged for the delayed guests.",
  });
  const { rows: ackRows } = await query(
    `SELECT title, message FROM notifications
      WHERE employee_id = $1 AND reference_type = 'incident' AND reference_id = $2
        AND title = $3`,
    [driver.employee_id, incidentId, ackExpected.title]
  );
  check(
    "acknowledged notification matches copy module",
    ackRows[0]?.message === ackExpected.message,
    `got "${ackRows[0]?.message}", expected "${ackExpected.message}"`
  );

  // ── 3. Staff resolves ────────────────────────────────────────────────────
  const actions = "Replacement vehicle dispatched; guests re-accommodated.";
  const resolveRes = await incidentRoute.PATCH(
    request("PATCH", `http://harness/api/incidents/${incidentId}`, {
      status: "Resolved",
      actions_taken: actions,
    }),
    { params: Promise.resolve({ id: String(incidentId) }) }
  );
  check("staff resolve succeeds", resolveRes.status === 200, `status ${resolveRes.status}`);

  const resolveExpected = copy.incidentResolvedByStaff({ actions });
  const { rows: resolveRows } = await query(
    `SELECT title, message FROM notifications
      WHERE employee_id = $1 AND reference_type = 'incident' AND reference_id = $2
        AND title = $3`,
    [driver.employee_id, incidentId, resolveExpected.title]
  );
  check(
    "resolved notification matches copy module",
    resolveRows[0]?.message === resolveExpected.message,
    `got "${resolveRows[0]?.message}", expected "${resolveExpected.message}"`
  );

  // ── 4. The two SQL-trigger copy exceptions (migration 110) are live ──────
  const { rows: fnRows } = await query(
    `SELECT proname, prosrc FROM pg_proc
      WHERE proname IN ('notify_dispatch_created', 'enqueue_dispatch_push', 'notify_leave_reviewed')`
  );
  const fnBy = Object.fromEntries(fnRows.map((r) => [r.proname, r.prosrc]));
  check(
    "notify_dispatch_created carries the new dispatch copy",
    (fnBy.notify_dispatch_created || "").includes("You have a new dispatch")
  );
  check(
    "enqueue_dispatch_push carries the new dispatch copy",
    (fnBy.enqueue_dispatch_push || "").includes("You have a new dispatch")
  );
  check(
    "notify_leave_reviewed carries the new leave copy",
    (fnBy.notify_leave_reviewed || "").includes("Check the app for the approved dates.")
  );
} finally {
  // ── Cleanup: hard-delete everything this run created ─────────────────────
  for (const id of incidentIds) {
    await query(`DELETE FROM notifications WHERE reference_type = 'incident' AND reference_id = $1`, [id]);
    await query(`DELETE FROM incident_comments WHERE incident_id = $1`, [id]);
    await query(`DELETE FROM audit_logs WHERE resource = 'driverincidents' AND resource_id = $1`, [id]);
    await query(`DELETE FROM driverincidents WHERE incident_id = $1`, [id]);
  }
  await getPool().end();
}

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) {
  console.log("\nFAILURES:");
  failed.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log("Driver notification copy verified against live routes + DB.");
