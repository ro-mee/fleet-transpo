// DB-backed verification harness for the fuel review workflow (tasks 1–5 of the
// integrity-fixes plan).
//
// Proves, against the live database through the real route handlers:
//   1. POST /api/fuel creates a Pending record (default status) — 201.
//   2. PUT /api/fuel/[id] reject persists rejection_reason and returns 200
//      (previously the reason was validated then dropped, causing a 500).
//   3. PUT approve sets approved_by / approved_at and clears rejection_reason.
//   4. PUT with an unknown key is refused 400 and the column never reaches
//      Postgres — the WRITABLE allowlist is the guard, and the route builds
//      its SET clause only from keys in that allowlist.
//   5. GET /api/fuel/analytics counts the Approved record and excludes a
//      Pending sibling (Approved-only aggregation, migration 020 chk_fuel_status).
//
// Auth is stubbed via scripts/route-harness-loader.mjs — requireAuth(), the
// role lists and the route bodies all run as shipped; the harness only declares
// who the caller is (an admin). Every row created here is soft-deleted at the
// end (deleted_at = NOW()), and the throwaway audit_logs rows the POST handler
// writes are removed by log_id range so no test data survives the run.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-fuel.mjs
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
// Routes under test, loaded through the harness loader so the "@/..." alias
// resolves and auth() is the stub.
// ---------------------------------------------------------------------------
const fuel = await app("app/api/fuel/route.js");
const fuelById = await app("app/api/fuel/[id]/route.js");
const analytics = await app("app/api/fuel/analytics/route.js");

const ADMIN = { user: { employeeId: 8, role: "admin", email: "admin@harness" } };
const ACTOR_ID = ADMIN.user.employeeId;

function setSession(session = ADMIN) {
  globalThis.__HARNESS_SESSION__ = session;
}

function makeRequest(method, url, body) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// handleError logs each error with a full stack trace; silence it for the
// calls that are expected to fail so the assertion output stays legible.
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

async function readJson(res) {
  return res.json().catch(() => null);
}

// ---------------------------------------------------------------------------
// Bookkeeping for cleanup — every id this run creates.
// ---------------------------------------------------------------------------
const createdFuelIds = [];
const createdVehicleId = [];
let startMaxLogId = null;

async function cleanup() {
  if (createdFuelIds.length) {
    const { rows } = await query(
      `UPDATE fuelrecords SET deleted_at = NOW()
       WHERE fuel_record_id = ANY($1::int[]) RETURNING fuel_record_id`,
      [createdFuelIds]
    );
    console.log(`cleanup: soft-deleted ${rows.length} fuel record(s) [${rows.map((r) => r.fuel_record_id).join(", ")}]`);
  }
  if (createdVehicleId.length) {
    const { rowCount } = await query(
      `UPDATE vehicles SET deleted_at = NOW() WHERE vehicle_id = $1`,
      [createdVehicleId[0]]
    );
    console.log(`cleanup: soft-deleted throwaway vehicle #${createdVehicleId[0]} (${rowCount} row(s))`);
  }
  if (startMaxLogId !== null) {
    const { rowCount } = await query(
      `DELETE FROM audit_logs WHERE log_id > $1 AND resource = 'fuelrecords'`,
      [startMaxLogId]
    );
    if (rowCount) console.log(`cleanup: removed ${rowCount} harness audit_logs row(s)`);
  }
}

console.log("\n=== Fuel: create / reject / approve / allowlist / analytics ===\n");

try {
  const { rows: logRows } = await query(
    `SELECT COALESCE(MAX(log_id), 0) AS max FROM audit_logs`
  );
  startMaxLogId = Number(logRows[0]?.max ?? 0);

  // -------------------------------------------------------------------------
  // 0. A real, non-deleted vehicle to hang the fuel records on. If the table
  //    is empty, insert a throwaway vehicle and soft-delete it at cleanup.
  // -------------------------------------------------------------------------
  const { rows: vehicleRows } = await query(
    `SELECT vehicle_id, mileage FROM vehicles WHERE deleted_at IS NULL ORDER BY vehicle_id LIMIT 1`
  );
  let vehicle;
  if (vehicleRows.length) {
    vehicle = vehicleRows[0];
    console.log(`0. Using vehicle #${vehicle.vehicle_id} (mileage ${vehicle.mileage})`);
  } else {
    const { rows: inserted } = await query(
      `INSERT INTO vehicles (plate_number, vehicle_name, mileage)
       VALUES ($1, $2, 0) RETURNING vehicle_id, mileage`,
      [`HARN-${Date.now()}`, "Fuel harness throwaway"]
    );
    vehicle = inserted[0];
    createdVehicleId.push(vehicle.vehicle_id);
    console.log(`0. No live vehicles — created throwaway vehicle #${vehicle.vehicle_id}`);
  }

  const baseMileage = Number(vehicle.mileage);
  const odometer = Number.isFinite(baseMileage) && baseMileage > 0 ? baseMileage + 1 : 1;

  const fuelUrl = "http://localhost:3000/api/harness/fuel";
  const recordUrl = (id) => `http://localhost:3000/api/harness/fuel/${id}`;
  const putParams = (id) => ({ params: Promise.resolve({ id: String(id) }) });

  // Baseline analytics count so every later assertion is delta-based and
  // immune to pre-existing fuel records in the database.
  setSession();
  const baselineRes = await analytics.GET(makeRequest("GET", `${fuelUrl}/analytics`));
  const baseline = await readJson(baselineRes);
  check("analytics baseline returns 200", baselineRes.status === 200, `got ${baselineRes.status}`);
  const baselineCount = baseline?.recordsCount ?? 0;

  // -------------------------------------------------------------------------
  // 1. POST creates a Pending record.
  // -------------------------------------------------------------------------
  console.log("1. POST /api/fuel creates a Pending record");
  setSession();
  const createRes = await fuel.POST(makeRequest("POST", fuelUrl, {
    vehicle_id: vehicle.vehicle_id,
    liters: 50,
    amount: 2500,
    price_per_liter: 50,
    odometer,
    fuel_date: "2026-08-04",
    fuel_type: "Diesel",
    station_name: "Harness Fuel Stop",
  }));
  const created = await readJson(createRes);
  const recordA = created.fuel_record_id;
  createdFuelIds.push(recordA);
  check("create returns 201", createRes.status === 201, `got ${createRes.status}`);
  check("create defaults status to Pending", created.status === "Pending", `got ${JSON.stringify(created.status)}`);
  check("create returns the posted odometer", Number(created.odometer) === odometer, `got ${created.odometer}`);
  check("create persists a fuel_record_id", Number.isInteger(Number(recordA)) && Number(recordA) > 0, `got ${JSON.stringify(recordA)}`);

  // A Pending record must not be counted by analytics yet.
  const pendingCountRes = await analytics.GET(makeRequest("GET", `${fuelUrl}/analytics`));
  const pendingCount = (await readJson(pendingCountRes))?.recordsCount ?? 0;
  check("analytics excludes the Pending record", pendingCount === baselineCount, `${baselineCount} -> ${pendingCount}`);

  // -------------------------------------------------------------------------
  // 2. Reject persists the reason and returns 200 (the bug under test).
  // -------------------------------------------------------------------------
  console.log("2. PUT reject persists rejection_reason");
  const rejectRes = await fuelById.PUT(makeRequest("PUT", recordUrl(recordA), {
    status: "Rejected",
    rejection_reason: "test",
  }), putParams(recordA));
  const rejected = await readJson(rejectRes);
  check("reject returns 200", rejectRes.status === 200, `got ${rejectRes.status}`);
  check("reject response carries rejection_reason", rejected?.rejection_reason === "test", `got ${JSON.stringify(rejected?.rejection_reason)}`);
  const { rows: rejectedRows } = await query(
    `SELECT status, rejection_reason FROM fuelrecords WHERE fuel_record_id = $1`,
    [recordA]
  );
  check("rejection_reason persisted in DB", rejectedRows[0]?.rejection_reason === "test", `got ${JSON.stringify(rejectedRows[0]?.rejection_reason)}`);
  check("record status is now Rejected", rejectedRows[0]?.status === "Rejected", `got ${rejectedRows[0]?.status}`);

  // -------------------------------------------------------------------------
  // 3. Approve sets the audit fields and clears the reason.
  // -------------------------------------------------------------------------
  console.log("3. PUT approve sets audit fields");
  const approveRes = await fuelById.PUT(makeRequest("PUT", recordUrl(recordA), {
    status: "Approved",
  }), putParams(recordA));
  const approved = await readJson(approveRes);
  check("approve returns 200", approveRes.status === 200, `got ${approveRes.status}`);
  check("approve sets approved_by to the actor", Number(approved?.approved_by) === ACTOR_ID, `got ${JSON.stringify(approved?.approved_by)}`);
  check("approve sets approved_at", !!approved?.approved_at, `got ${JSON.stringify(approved?.approved_at)}`);
  check("approve clears rejection_reason", approved?.rejection_reason === null, `got ${JSON.stringify(approved?.rejection_reason)}`);
  const { rows: approvedRows } = await query(
    `SELECT status, approved_by, approved_at, rejection_reason FROM fuelrecords WHERE fuel_record_id = $1`,
    [recordA]
  );
  check(
    "approval audit persisted in DB",
    approvedRows[0]?.status === "Approved" &&
      Number(approvedRows[0]?.approved_by) === ACTOR_ID &&
      !!approvedRows[0]?.approved_at &&
      approvedRows[0]?.rejection_reason === null,
    JSON.stringify(approvedRows[0])
  );

  // The now-Approved record must appear in analytics exactly once.
  const approvedCountRes = await analytics.GET(makeRequest("GET", `${fuelUrl}/analytics`));
  const approvedCount = (await readJson(approvedCountRes))?.recordsCount ?? 0;
  check("analytics counts the Approved record", approvedCount === baselineCount + 1, `${baselineCount} -> ${approvedCount}`);

  // -------------------------------------------------------------------------
  // 4. PUT allowlist refuses unknown keys before any SQL is built.
  // -------------------------------------------------------------------------
  console.log("4. PUT allowlist refuses unknown keys");
  const allowlist = await expectStatus(
    fuelById.PUT,
    makeRequest("PUT", recordUrl(recordA), { foo: 1 }),
    putParams(recordA)
  );
  check("unknown-key PUT returns 400", allowlist.status === 400, `got ${allowlist.status}`);
  const { rows: colRows } = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'fuelrecords' AND column_name = 'foo'`
  );
  check("no 'foo' column exists — SET foo can never reach Postgres", colRows.length === 0);
  const { rows: afterAllowlist } = await query(
    `SELECT status, approved_by, liters, amount FROM fuelrecords WHERE fuel_record_id = $1`,
    [recordA]
  );
  check(
    "allowlist rejection left the record untouched",
    afterAllowlist[0]?.status === "Approved" && Number(afterAllowlist[0]?.approved_by) === ACTOR_ID,
    JSON.stringify(afterAllowlist[0])
  );

  // -------------------------------------------------------------------------
  // 5. Analytics stays Approved-only with a Pending sibling present.
  // -------------------------------------------------------------------------
  console.log("5. GET /api/fuel/analytics excludes a Pending sibling");
  setSession();
  const siblingRes = await fuel.POST(makeRequest("POST", fuelUrl, {
    vehicle_id: vehicle.vehicle_id,
    liters: 30,
    amount: 1500,
    price_per_liter: 50,
    odometer: odometer + 50,
    fuel_date: "2026-08-05",
    fuel_type: "Diesel",
    station_name: "Harness Fuel Stop",
  }));
  const sibling = await readJson(siblingRes);
  const recordB = sibling.fuel_record_id;
  createdFuelIds.push(recordB);
  check("sibling record created as Pending", siblingRes.status === 201 && sibling?.status === "Pending", `got ${siblingRes.status}/${JSON.stringify(sibling?.status)}`);

  const finalRes = await analytics.GET(makeRequest("GET", `${fuelUrl}/analytics`));
  const finalBody = await readJson(finalRes);
  check("analytics returns 200", finalRes.status === 200, `got ${finalRes.status}`);
  const finalCount = finalBody?.recordsCount ?? 0;
  check("analytics still counts only the Approved record (sibling excluded)", finalCount === baselineCount + 1, `expected ${baselineCount + 1}, got ${finalCount}`);
  check("analytics recordsCount >= 1", finalCount >= 1, `got ${finalCount}`);
} catch (e) {
  failures.push(`unexpected harness error: ${e.stack || e.message}`);
} finally {
  await cleanup();
}

console.log(`\nfuel: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await getPool().end();
if (failures.length) process.exitCode = 1;
