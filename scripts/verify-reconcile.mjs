// Phase 5, item 19 — reconciliation job verification.
//
// Proves reconcileFailedDeliveries() actually re-drives stuck outbound rows:
//
//   1. An outbound row marked 'failed' (payload shaped like a real status event)
//      is flipped back to 'processed' by the job, with error_message cleared.
//   2. A row that is already 'processed' is untouched.
//   3. The cron route refuses requests without CRON_SECRET (fail-closed).
//
// Fixtures are self-cleaning: labeled rows are deleted at the end, records are
// never written back to a real transport state. Works against live DB in both
// BOOKING_GATEWAY=mock and =http modes (mock acks everything; the design is that
// the http stub currently throws, which just means those fixtures stay failed).
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-reconcile.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const app = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);
const { getPool, query } = await app("lib/db.js");
const { reconcileFailedDeliveries } = await app("services/outbound.service.js");

let pass = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) pass++;
  else failures.push(detail ? `${label} — ${detail}` : label);
}

const LABEL = `reconcile-verify-${Date.now()}`;
const FIXTURE_EVENT = {
  external_booking_id: `BK-RECONCILE-${Date.now()}`,
  status: "COMPLETED",
  fleet_reference: null,
  driver: null,
  vehicle: null,
  eta: null,
  occurred_at: new Date().toISOString(),
};

let failedRowId = null;
let processedRowId = null;

try {
  console.log("\n=== Integration reconciliation ===\n");

  // ---- Seed two outbound fixtures: one failed, one processed. ---------------
  const seed = await query(
    `INSERT INTO integration_log
       (direction, source_system, event_type, reference_type, external_booking_id, payload, status, error_message)
     VALUES
       ('outbound', $1, 'status_completed', 'transportation_request', $2, $3::jsonb, 'failed', 'seeded for verification'),
       ('outbound', $1, 'status_completed', 'transportation_request', $2, $3::jsonb, 'processed', NULL)
     RETURNING log_id, status`,
    ["fleet", FIXTURE_EVENT.external_booking_id, JSON.stringify(FIXTURE_EVENT)]
  );
  check("two outbound fixtures seeded", seed.rows.length === 2, `got ${seed.rows.length}`);
  failedRowId = seed.rows.find((r) => r.status === "failed").log_id;
  processedRowId = seed.rows.find((r) => r.status === "processed").log_id;

  // ---- 1. The job retries the failed row. -----------------------------------
  console.log("1. Failed delivery is retried to processed");
  const result = await reconcileFailedDeliveries({ max: 50 });
  const afterFail = await query(
    `SELECT status, error_message FROM integration_log WHERE log_id = $1`,
    [failedRowId]
  );
  const afterProc = await query(
    `SELECT status, error_message FROM integration_log WHERE log_id = $1`,
    [processedRowId]
  );

  const mockMode = (process.env.BOOKING_GATEWAY || "mock").toLowerCase() !== "http";
  // The reconcile summary must mention our fixture somewhere among its results.
  const sawFixture = (result.results || []).some((r) => r.logId === failedRowId);

  if (mockMode) {
    check(
      "failed fixture is now processed",
      afterFail.rows[0]?.status === "processed",
      `status=${afterFail.rows[0]?.status}`
    );
    check(
      "error_message cleared on success",
      afterFail.rows[0]?.error_message == null,
      `error=${afterFail.rows[0]?.error_message}`
    );
    check(
      "job reports the fixture delivered",
      result.delivered >= 1 && sawFixture,
      JSON.stringify(result.results)
    );
  } else {
    // Http gateway stubs throw — the row must stay failed and keep its message,
    // which is the honest outcome for a gateway that isn't connected.
    check(
      "failed fixture stays failed under http stub",
      afterFail.rows[0]?.status === "failed",
      `status=${afterFail.rows[0]?.status}`
    );
  }

  // ---- 2. Already-processed rows are untouched. ------------------------------
  console.log("2. Processed rows are never re-driven");
  check(
    "processed fixture is still processed",
    afterProc.rows[0]?.status === "processed",
    `status=${afterProc.rows[0]?.status}`
  );

  // ---- 3. The cron route is fail-closed without CRON_SECRET. ----------------
  console.log("3. Cron route fail-closed");
  const route = await app("app/api/cron/reconcile/route.js");
  const req = new Request("http://localhost:3000/api/cron/reconcile", { method: "POST" });
  const res = await route.POST(req);
  check(
    "reconcile route 401s without CRON_SECRET",
    res.status === 401 || res.status === 503,
    `got ${res.status}`
  );

  console.log(`\nreconcile: ${pass} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
} catch (e) {
  console.error("reconcile verification crashed:", e);
  process.exitCode = 1;
} finally {
  // Clean every fixture, matching on the external_booking_id we planted.
  try {
    await query(
      `DELETE FROM integration_log WHERE external_booking_id = $1`,
      [FIXTURE_EVENT.external_booking_id]
    );
  } catch {
    /* best-effort cleanup */
  }
  await getPool().end();
}

if (failures.length && !process.exitCode) process.exitCode = 1;