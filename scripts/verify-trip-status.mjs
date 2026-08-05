// DB-backed verification harness for the trip-status sync (task 17 / plan steps).
//
// Tasks 8-13 closed the trip-status sync holes: completing or cancelling a trip
// through PUT /api/trips/[id]/status now reconciles the dispatch, the vehicle,
// the driver and the underlying Booking request, and writes the timeline. This
// harness proves that end-to-end against the live database through the REAL
// route handler:
//
//   (a) PUT {status:"Completed", end_odometer} -> dispatch Completed, vehicle
//       and driver re-synced, request Completed, a `trip_completed` event on
//       the timeline.
//   (b) PUT {status:"Cancelled"} on a fresh trip -> dispatch Cancelled,
//       resources released, request Cancelled.
//   (c) `management` gets 403 on the route (role dropped in task 11).
//   (d) a driver calling start/complete on another driver's trip gets 404.
//
// Seeding note: the request -> dispatch -> trip chain is seeded DIRECTLY via
// query (transportation_request at `Assigned`, an In Progress dispatch linked
// by request_id, and a Trip Started trip), because driving every hop through
// the integration webhook + approve/dispatch routes is out of scope. The ACT
// under test — PUT /api/trips/[id]/status — is the real handler, and its
// downstream sync (status.service / trip-lifecycle.service) runs as shipped.
//
// Every row this run creates is soft-deleted at the end; reservation_events
// (append-only) and integration_log rows for our own requests are removed by
// request id, exactly as verify-fuel.mjs scopes its own audit rows.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-trip-status.mjs
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
// Route under test: PUT /api/trips/[id]/status (+ start for the ownership 404).
// ---------------------------------------------------------------------------
const tripStatus = await app("app/api/trips/[id]/status/route.js");
const tripStart = await app("app/api/trips/[id]/start/route.js");

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
const tripUrl = (id) => `http://localhost:3000/api/harness/trips/${id}`;

// ---------------------------------------------------------------------------
// Seeding: a throwaway vehicle + driver (+ their employee) + a full
// request->dispatch->trip chain. All rows are tracked for soft-delete cleanup.
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
     VALUES ($1, $2, 1000, '2099-01-01', 'Available')
     RETURNING vehicle_id`,
    [`HARN-VS-${marker}-${createdVehicleIds.length}`, "TripStatus throwaway"]
  );
  createdVehicleIds.push(veh[0].vehicle_id);

  const { rows: emp } = await query(
    `INSERT INTO employees (first_name, last_name, email)
     VALUES ('Harness', $1, $2) RETURNING employee_id`,
    [`VS${createdEmployeeIds.length}`, `harness-vs-${marker}-${createdEmployeeIds.length}@example.com`]
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
    [`HARN-VS-${marker}-${createdRequestIds.length}`, veh[0].vehicle_id, drv[0].driver_id]
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
    vehicleId: veh[0].vehicle_id,
    driverId: drv[0].driver_id,
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

console.log("\n=== Trip status: complete / cancel / roles / ownership ===\n");

try {
  const { rows: logRows } = await query(`SELECT COALESCE(MAX(log_id), 0) AS max FROM audit_logs`);
  startMaxLogId = Number(logRows[0]?.max ?? 0);

  const chainA = await seedChain();
  console.log(`1. Seeded request #${chainA.requestId} -> dispatch #${chainA.dispatchId} -> trip #${chainA.tripId} (completion chain)`);

  // -------------------------------------------------------------------------
  // (a) Complete the trip via the real status route.
  // -------------------------------------------------------------------------
  console.log("2. PUT status Completed");
  setSession();
  const complete = await expectStatus(
    tripStatus.PUT,
    makeRequest("PUT", tripUrl(chainA.tripId), { status: "Completed", end_odometer: 1010 }),
    putParams(chainA.tripId)
  );
  check("complete returns 200", complete.status === 200, `got ${complete.status}`);
  check("trip status is Completed", complete.body?.trip_status === "Completed", JSON.stringify(complete.body?.trip_status));

  const { rows: afterComplete } = await query(
    `SELECT t.trip_status, t.end_odometer,
            d.status AS dispatch_status,
            r.fleet_status AS request_status,
            v.vehicle_status, dr.driver_status
       FROM trips t
       JOIN dispatchschedules d ON d.dispatch_id = t.dispatch_id
       JOIN transportation_requests r ON r.request_id = d.request_id
       JOIN vehicles v ON v.vehicle_id = t.vehicle_id
       JOIN drivers dr ON dr.driver_id = t.driver_id
      WHERE t.trip_id = $1`,
    [chainA.tripId]
  );
  const ac = afterComplete[0];
  check("dispatch synced to Completed", ac?.dispatch_status === "Completed", JSON.stringify(ac?.dispatch_status));
  check("request synced to Completed", ac?.request_status === "Completed", JSON.stringify(ac?.request_status));
  check("vehicle re-synced to Available", ac?.vehicle_status === "Available", JSON.stringify(ac?.vehicle_status));
  check("driver re-synced to Available", ac?.driver_status === "Available", JSON.stringify(ac?.driver_status));

  const { rows: evtRows } = await query(
    `SELECT event_type FROM reservation_events WHERE request_id = $1 AND event_type = 'trip_completed'`,
    [chainA.requestId]
  );
  check("timeline has a trip_completed event", evtRows.length === 1, JSON.stringify(evtRows));

  // -------------------------------------------------------------------------
  // (b) Cancel a fresh trip via the status route.
  // -------------------------------------------------------------------------
  const chainB = await seedChain();
  console.log(`3. Seeded request #${chainB.requestId} -> dispatch #${chainB.dispatchId} -> trip #${chainB.tripId} (cancel chain)`);

  console.log("4. PUT status Cancelled");
  setSession();
  const cancel = await expectStatus(
    tripStatus.PUT,
    makeRequest("PUT", tripUrl(chainB.tripId), { status: "Cancelled", reason: "harness" }),
    putParams(chainB.tripId)
  );
  check("cancel returns 200", cancel.status === 200, `got ${cancel.status}`);
  check("trip status is Cancelled", cancel.body?.trip_status === "Cancelled", JSON.stringify(cancel.body?.trip_status));

  const { rows: afterCancel } = await query(
    `SELECT t.trip_status, d.status AS dispatch_status, r.fleet_status AS request_status,
            v.vehicle_status, dr.driver_status
       FROM trips t
       JOIN dispatchschedules d ON d.dispatch_id = t.dispatch_id
       JOIN transportation_requests r ON r.request_id = d.request_id
       JOIN vehicles v ON v.vehicle_id = t.vehicle_id
       JOIN drivers dr ON dr.driver_id = t.driver_id
      WHERE t.trip_id = $1`,
    [chainB.tripId]
  );
  const cc = afterCancel[0];
  check("dispatch synced to Cancelled", cc?.dispatch_status === "Cancelled", JSON.stringify(cc?.dispatch_status));
  check("request synced to Cancelled", cc?.request_status === "Cancelled", JSON.stringify(cc?.request_status));
  check("vehicle resources released (Available)", cc?.vehicle_status === "Available", JSON.stringify(cc?.vehicle_status));
  check("driver resources released (Available)", cc?.driver_status === "Available", JSON.stringify(cc?.driver_status));

  // -------------------------------------------------------------------------
  // (c) management is refused 403 on the status route.
  // -------------------------------------------------------------------------
  console.log("5. management gets 403");
  setSession({ user: { employeeId: 8, role: "management", email: "mgmt@harness" } });
  const mgmt = await expectStatus(
    tripStatus.PUT,
    makeRequest("PUT", tripUrl(chainA.tripId), { status: "Completed", end_odometer: 1100 }),
    putParams(chainA.tripId)
  );
  check("management returns 403 on status", mgmt.status === 403, `got ${mgmt.status}`);

  // -------------------------------------------------------------------------
  // (d) a driver probing another driver's trip gets 404 (start route).
  // -------------------------------------------------------------------------
  console.log("6. driver on another driver's trip gets 404");
  setSession({ user: { employeeId: 9, role: "driver", email: "driver@harness", driverId: 999999 } });
  const otherDriver = await expectStatus(
    tripStart.PUT,
    makeRequest("PUT", tripUrl(chainA.tripId), { odometer: 1000 }),
    putParams(chainA.tripId)
  );
  check("start on another driver's trip returns 404", otherDriver.status === 404, `got ${otherDriver.status}`);

  // Also exercise the same guard on the complete route.
  const otherDriverComplete = await expectStatus(
    (await app("app/api/trips/[id]/complete/route.js")).PUT,
    makeRequest("PUT", tripUrl(chainA.tripId), { end_odometer: 1010 }),
    putParams(chainA.tripId)
  );
  check("complete on another driver's trip returns 404", otherDriverComplete.status === 404, `got ${otherDriverComplete.status}`);
} catch (e) {
  failures.push(`unexpected harness error: ${e.stack || e.message}`);
} finally {
  await cleanup();
}

console.log(`\ntrip-status: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await getPool().end();
if (failures.length) process.exitCode = 1;
