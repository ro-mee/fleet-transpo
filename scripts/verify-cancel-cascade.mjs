// DB-backed verification harness for the cancellation cascade (task 17 / plan).
//
// Tasks 13-14 closed the cancel-cascade holes: cancelling a Booking request
// cancels its open dispatches and trips, and cancelling a dispatch directly
// cancels its trip and (for a request-driven dispatch) the request. This harness
// proves both directions against the live database through the REAL route
// handlers:
//
//   (a) PUT /api/integration/transport-requests/[id]/cancel on a request that
//       has an open dispatch + trip -> dispatch Cancelled AND trip Cancelled
//       AND request Cancelled.
//   (b) PUT /api/dispatch/[id]/status {status:"Cancelled"} -> trip Cancelled AND
//       (request-driven dispatch) request Cancelled.
//
// Seeding note: the request -> dispatch -> trip chain is seeded DIRECTLY via
// query (request at `Assigned`, an In Progress dispatch linked by request_id, a
// Trip Started trip). The ACT under test is the real cancel / dispatch-status
// route; its cascade logic (status.service / reservation-lifecycle.service) runs
// as shipped.
//
// Every row this run creates is soft-deleted at the end; reservation_events and
// integration_log rows scoped to our request ids are removed directly.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-cancel-cascade.mjs
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
const requestCancel = await app("app/api/integration/transport-requests/[id]/cancel/route.js");
const dispatchStatus = await app("app/api/dispatch/[id]/status/route.js");

const ADMIN = { user: { employeeId: 8, role: "admin", email: "admin@harness" } };

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

const putParams = (id) => ({ params: Promise.resolve({ id: String(id) }) });

// ---------------------------------------------------------------------------
// Seeding: a throwaway vehicle + driver (+ their employee) + request->dispatch
// ->trip chain. Tracked for cleanup.
// ---------------------------------------------------------------------------
const marker = Date.now();
const createdVehicleIds = [];
const createdEmployeeIds = [];
const createdDriverIds = [];
const createdRequestIds = [];
const createdDispatchIds = [];
const createdTripIds = [];

async function seedChain() {
  const { rows: veh } = await query(
    `INSERT INTO vehicles (plate_number, vehicle_name, mileage, registration_expiry, vehicle_status)
     VALUES ($1, $2, 1000, '2099-01-01', 'Available') RETURNING vehicle_id`,
    [`HARN-CC-${marker}-${createdVehicleIds.length}`, "CancelCascade throwaway"]
  );
  createdVehicleIds.push(veh[0].vehicle_id);

  const { rows: emp } = await query(
    `INSERT INTO employees (first_name, last_name, email)
     VALUES ('Harness', $1, $2) RETURNING employee_id`,
    [`CC${createdEmployeeIds.length}`, `harness-cc-${marker}-${createdEmployeeIds.length}@example.com`]
  );
  createdEmployeeIds.push(emp[0].employee_id);

  const { rows: drv } = await query(
    `INSERT INTO drivers (employee_id, license_expiry, driver_status)
     VALUES ($1, '2099-01-01', 'Available') RETURNING driver_id`,
    [emp[0].employee_id]
  );
  createdDriverIds.push(drv[0].driver_id);

  const { rows: req } = await query(
    `INSERT INTO transportation_requests
       (external_booking_id, source_system, pickup_location, pickup_datetime,
        passenger_count, priority, fleet_status, vehicle_id, driver_id)
     VALUES ($1, 'PMS', 'Origin', NOW(), 1, 'Medium', 'Assigned', $2, $3)
     RETURNING request_id`,
    [`HARN-CC-${marker}-${createdRequestIds.length}`, veh[0].vehicle_id, drv[0].driver_id]
  );
  createdRequestIds.push(req[0].request_id);

  const { rows: disp } = await query(
    `INSERT INTO dispatchschedules
       (request_id, vehicle_id, driver_id, dispatch_number, scheduled_departure, status)
     VALUES ($1, $2, $3, $4, NOW(), 'In Progress')
     RETURNING dispatch_id`,
    [req[0].request_id, veh[0].vehicle_id, drv[0].driver_id, `HARN-DSP-${marker}-${createdDispatchIds.length}`]
  );
  createdDispatchIds.push(disp[0].dispatch_id);

  const { rows: trip } = await query(
    `INSERT INTO trips (vehicle_id, driver_id, dispatch_id, trip_status, start_odometer, start_time)
     VALUES ($1, $2, $3, 'Trip Started', 1000, NOW())
     RETURNING trip_id`,
    [veh[0].vehicle_id, drv[0].driver_id, disp[0].dispatch_id]
  );
  createdTripIds.push(trip[0].trip_id);

  return {
    requestId: req[0].request_id,
    dispatchId: disp[0].dispatch_id,
    tripId: trip[0].trip_id,
  };
}

let startMaxLogId = null;

async function cleanup() {
  if (createdRequestIds.length) {
    const { rowCount } = await query(
      `DELETE FROM reservation_events WHERE request_id = ANY($1::int[])`,
      [createdRequestIds]
    );
    if (rowCount) console.log(`cleanup: removed ${rowCount} harness reservation_event(s)`);
    const { rowCount: logDel } = await query(
      `DELETE FROM integration_log WHERE reference_id = ANY($1::int[]) AND reference_type = 'transportation_request'`,
      [createdRequestIds]
    );
    if (logDel) console.log(`cleanup: removed ${logDel} harness integration_log row(s)`);
  }
  const softDeletes = [
    ["trips", createdTripIds, "trip_id"],
    ["dispatchschedules", createdDispatchIds, "dispatch_id"],
    ["transportation_requests", createdRequestIds, "request_id"],
    ["drivers", createdDriverIds, "driver_id"],
    ["employees", createdEmployeeIds, "employee_id"],
    ["vehicles", createdVehicleIds, "vehicle_id"],
  ];
  for (const [table, ids, col] of softDeletes) {
    if (!ids.length) continue;
    const { rowCount } = await query(
      `UPDATE ${table} SET deleted_at = NOW() WHERE ${col} = ANY($1::int[])`,
      [ids]
    );
    if (rowCount) console.log(`cleanup: soft-deleted ${rowCount} ${table} row(s)`);
  }
  if (startMaxLogId !== null) {
    const { rowCount } = await query(
      `DELETE FROM audit_logs WHERE log_id > $1 AND resource = ANY($2::text[])`,
      [startMaxLogId, ["trips", "dispatchschedules", "transportation_requests", "vehicles"]]
    );
    if (rowCount) console.log(`cleanup: removed ${rowCount} harness audit_logs row(s)`);
  }
}

console.log("\n=== Cancel cascade: request -> dispatch/trip, and dispatch -> trip/request ===\n");

try {
  const { rows: logRows } = await query(`SELECT COALESCE(MAX(log_id), 0) AS max FROM audit_logs`);
  startMaxLogId = Number(logRows[0]?.max ?? 0);

  // -------------------------------------------------------------------------
  // (a) Cancel a request that has an open dispatch + trip.
  // -------------------------------------------------------------------------
  const chainA = await seedChain();
  console.log(`1. Seeded request #${chainA.requestId} -> dispatch #${chainA.dispatchId} -> trip #${chainA.tripId}`);

  setSession();
  const reqRes = await expectStatus(
    requestCancel.PUT,
    makeRequest("PUT", `http://localhost:3000/api/harness/transport-requests/${chainA.requestId}/cancel`, { reason: "harness cancel" }),
    putParams(chainA.requestId)
  );
  check("request cancel returns 200", reqRes.status === 200, `got ${reqRes.status}`);

  const { rows: a } = await query(
    `SELECT r.fleet_status AS request_status, d.status AS dispatch_status, t.trip_status
       FROM transportation_requests r
       JOIN dispatchschedules d ON d.request_id = r.request_id
       JOIN trips t ON t.dispatch_id = d.dispatch_id
      WHERE r.request_id = $1`,
    [chainA.requestId]
  );
  check("request is Cancelled", a[0]?.request_status === "Cancelled", JSON.stringify(a[0]?.request_status));
  check("open dispatch cascaded to Cancelled", a[0]?.dispatch_status === "Cancelled", JSON.stringify(a[0]?.dispatch_status));
  check("open trip cascaded to Cancelled", a[0]?.trip_status === "Cancelled", JSON.stringify(a[0]?.trip_status));

  // -------------------------------------------------------------------------
  // (b) Cancel a dispatch directly.
  // -------------------------------------------------------------------------
  const chainB = await seedChain();
  console.log(`2. Seeded request #${chainB.requestId} -> dispatch #${chainB.dispatchId} -> trip #${chainB.tripId}`);

  setSession();
  const dispRes = await expectStatus(
    dispatchStatus.PUT,
    makeRequest("PUT", `http://localhost:3000/api/harness/dispatch/${chainB.dispatchId}/status`, { status: "Cancelled" }),
    putParams(chainB.dispatchId)
  );
  check("dispatch status PUT returns 200", dispRes.status === 200, `got ${dispRes.status}`);

  const { rows: b } = await query(
    `SELECT d.status AS dispatch_status, t.trip_status, r.fleet_status AS request_status
       FROM dispatchschedules d
       JOIN trips t ON t.dispatch_id = d.dispatch_id
       LEFT JOIN transportation_requests r ON r.request_id = d.request_id
      WHERE d.dispatch_id = $1`,
    [chainB.dispatchId]
  );
  check("dispatch is Cancelled", b[0]?.dispatch_status === "Cancelled", JSON.stringify(b[0]?.dispatch_status));
  check("trip cascaded to Cancelled", b[0]?.trip_status === "Cancelled", JSON.stringify(b[0]?.trip_status));
  check("request-driven dispatch cascades request to Cancelled", b[0]?.request_status === "Cancelled", JSON.stringify(b[0]?.request_status));

  // The dispatch route guards its own transition machine — a terminal dispatch
  // cannot be cancelled again.
  const again = await expectStatus(
    dispatchStatus.PUT,
    makeRequest("PUT", `http://localhost:3000/api/harness/dispatch/${chainB.dispatchId}/status`, { status: "Cancelled" }),
    putParams(chainB.dispatchId)
  );
  check("re-cancelling a Cancelled dispatch is refused", again.status === 409, `got ${again.status}`);
} catch (e) {
  failures.push(`unexpected harness error: ${e.stack || e.message}`);
} finally {
  await cleanup();
}

console.log(`\ncancel-cascade: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await getPool().end();
if (failures.length) process.exitCode = 1;
