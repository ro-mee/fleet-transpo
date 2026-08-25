// Live route check for request -> allocation -> receipt fulfillment.
// Test rows are hard-deleted and any temporarily activated trip is restored.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();
const app = (path) => import(pathToFileURL(resolve(process.cwd(), "src", path)).href);
const { query, getPool } = await app("lib/db.js");
const allocationsRoute = await app("app/api/fuel/allocations/route.js");
const requestsRoute = await app("app/api/fuel/requests/route.js");
const mobileFuelRoute = await app("app/api/mobile/fuel/route.js");
const mobileFuelByIdRoute = await app("app/api/mobile/fuel/[id]/route.js");

const createdFuelIds = [];
const createdRequestIds = [];
let trip;
let originalTripStatus;
let originalVehicle;
let originalAllocation;
let testAllocationId;
let allocationMonth;
let passed = 0;
const failed = [];
const check = (label, condition, detail = "") => condition ? passed++ : failed.push(`${label}${detail ? ` — ${detail}` : ""}`);
const request = (method, url, body) => new Request(url, {
  method,
  headers: { "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const call = async (handler, req, context) => {
  const response = await handler(req, context);
  return { status: response.status, body: await response.json() };
};

try {
  const { rows: columns } = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'fuelrequests'`
  );
  const { rows: constraints } = await query(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'public.fuelrequests'::regclass`
  );
  check("fuelrequests columns exist", columns.length === 20, `got ${columns.length}`);
  check("fuelrequests constraints exist", constraints.length >= 5, `got ${constraints.length}`);

  const { rows: trips } = await query(
    `SELECT t.trip_id, t.trip_status, t.driver_id, t.vehicle_id, d.employee_id
       FROM trips t
       JOIN drivers d ON d.driver_id = t.driver_id
      WHERE t.deleted_at IS NULL AND t.vehicle_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM fuelrequests r
           WHERE r.vehicle_id = t.vehicle_id AND r.status IN ('Pending', 'Approved')
        )
      ORDER BY CASE WHEN t.trip_status = ANY($1::text[]) THEN 0 ELSE 1 END, t.trip_id
      LIMIT 1`,
    [["Assigned", "Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress"]]
  );
  trip = trips[0];
  if (!trip) throw new Error("No driver trip is available for the fuel request check");
  originalTripStatus = trip.trip_status;
  if (!["Assigned", "Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress"].includes(originalTripStatus)) {
    await query(`UPDATE trips SET trip_status = 'Assigned' WHERE trip_id = $1`, [trip.trip_id]);
  }

  const stamp = Date.now();
  allocationMonth = new Date().toISOString().slice(0, 7) + "-01";
  const { rows: vehicleRows } = await query(
    `SELECT fuel_level, tank_capacity_l, fuel_efficiency_kmpl FROM vehicles WHERE vehicle_id = $1`,
    [trip.vehicle_id]
  );
  originalVehicle = vehicleRows[0];
  const { rows: allocationRows } = await query(
    `SELECT * FROM fuelallocations WHERE vehicle_id = $1 AND allocation_month = $2`,
    [trip.vehicle_id, allocationMonth]
  );
  originalAllocation = allocationRows[0] || null;

  globalThis.__HARNESS_SESSION__ = { user: { employeeId: trip.employee_id, role: "fleet_manager" } };
  const configured = await call(allocationsRoute.PUT, request("PUT", "http://localhost/api/fuel/allocations", {
    vehicle_id: trip.vehicle_id,
    allocated_liters: 100000,
    tank_capacity_l: 60,
    fuel_efficiency_kmpl: 8,
  }));
  testAllocationId = configured.body?.allocation_id;
  check("monthly vehicle plan saves", configured.status === 200, JSON.stringify(configured.body));
  const plans = await call(allocationsRoute.GET, request("GET", "http://localhost/api/fuel/allocations"));
  check(
    "monthly vehicle plan lists its profile and balance",
    plans.status === 200 && plans.body?.rows?.some((row) =>
      Number(row.vehicle_id) === Number(trip.vehicle_id)
      && Number(row.tank_capacity_l) === 60
      && Number(row.fuel_efficiency_kmpl) === 8
      && Number(row.remaining_liters) > 0
    ),
    JSON.stringify(plans.body)
  );

  globalThis.__HARNESS_SESSION__ = { user: { employeeId: trip.employee_id, role: "driver" } };
  const created = await call(requestsRoute.POST, request("POST", "http://localhost/api/fuel/requests", {
    trip_id: trip.trip_id,
    current_fuel_level_percent: 5,
    purpose: "Live workflow verification",
    client_submission_id: `${stamp}-fuel-request`,
  }));
  if (created.body?.fuel_request_id) createdRequestIds.push(created.body.fuel_request_id);
  check("driver request returns 201", created.status === 201, JSON.stringify(created.body));
  check("driver request starts pending", created.body?.status === "Pending", created.body?.status);
  check("request stores a recommendation snapshot", Number(created.body?.recommended_liters) > 0 && !!created.body?.calculation_snapshot);

  const listed = await call(requestsRoute.GET, request("GET", "http://localhost/api/fuel/requests"));
  check("driver sees own request", listed.body?.rows?.some((row) => row.fuel_request_id === created.body?.fuel_request_id));

  globalThis.__HARNESS_SESSION__ = { user: { employeeId: trip.employee_id, role: "fleet_manager" } };
  const approved = await call(requestsRoute.PUT, request("PUT", "http://localhost/api/fuel/requests", {
    fuel_request_id: created.body.fuel_request_id,
    status: "Approved",
    approved_liters: 35,
    review_notes: "Approved by live verification",
  }));
  check("fleet approval returns 200", approved.status === 200, JSON.stringify(approved.body));
  check("approval stores allocation", approved.body?.status === "Approved" && Number(approved.body?.approved_liters) === 35);

  globalThis.__HARNESS_SESSION__ = { user: { employeeId: trip.employee_id, role: "driver" } };
  const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const fuelBody = {
    trip_id: trip.trip_id,
    fuel_request_id: created.body.fuel_request_id,
    liters: 34,
    amount: 2100,
    fuel_date: new Date().toISOString().slice(0, 10),
    station_name: "Verification Fuel Stop",
    receipt_url: `${storage.origin}/storage/v1/object/sign/fuel-receipts/${trip.driver_id}/verify.jpg?token=verify`,
    client_submission_id: `${stamp}-fuel-record`,
  };
  const previousMonth = new Date();
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1, 1);
  const wrongMonth = await call(mobileFuelRoute.POST, request("POST", "http://localhost/api/mobile/fuel", {
    ...fuelBody,
    fuel_date: previousMonth.toISOString().slice(0, 10),
    client_submission_id: `${stamp}-wrong-month`,
  }));
  check("receipt cannot consume a different allocation month", wrongMonth.status === 409 && /allocation month/i.test(wrongMonth.body?.error), JSON.stringify(wrongMonth.body));
  const fulfilled = await call(mobileFuelRoute.POST, request("POST", "http://localhost/api/mobile/fuel", fuelBody));
  if (fulfilled.body?.fuel_record_id) createdFuelIds.push(fulfilled.body.fuel_record_id);
  check("approved receipt returns 201", fulfilled.status === 201, JSON.stringify(fulfilled.body));
  check("receipt links its request", Number(fulfilled.body?.fuel_request_id) === Number(created.body?.fuel_request_id));
  const { rows: final } = await query(
    `SELECT status, fulfilled_at FROM fuelrequests WHERE fuel_request_id = $1`,
    [created.body.fuel_request_id]
  );
  check("receipt fulfills allocation", final[0]?.status === "Fulfilled" && !!final[0]?.fulfilled_at, JSON.stringify(final[0]));

  await query(`UPDATE fuelrecords SET status = 'Rejected' WHERE fuel_record_id = $1`, [fulfilled.body.fuel_record_id]);
  const oversized = await call(
    mobileFuelByIdRoute.PUT,
    request("PUT", `http://localhost/api/mobile/fuel/${fulfilled.body.fuel_record_id}`, {
      ...fuelBody,
      liters: 36,
    }),
    { params: Promise.resolve({ id: String(fulfilled.body.fuel_record_id) }) }
  );
  check("rejected receipt cannot exceed allocation", oversized.status === 400 && /allocation/i.test(oversized.body?.error), JSON.stringify(oversized.body));
} catch (error) {
  failed.push(error.stack || error.message);
} finally {
  if (createdFuelIds.length) await query(`DELETE FROM fuelrecords WHERE fuel_record_id = ANY($1::int[])`, [createdFuelIds]);
  if (createdRequestIds.length) {
    await query(`DELETE FROM audit_logs WHERE resource = 'fuelrequests' AND resource_id = ANY($1::int[])`, [createdRequestIds]);
    await query(`DELETE FROM fuelrequests WHERE fuel_request_id = ANY($1::int[])`, [createdRequestIds]);
  }
  if (trip && originalAllocation) {
    await query(
      `UPDATE fuelallocations SET allocated_liters = $3, created_by = $4, updated_by = $5,
              created_at = $6, updated_at = $7
        WHERE vehicle_id = $1 AND allocation_month = $2`,
      [trip.vehicle_id, allocationMonth, originalAllocation.allocated_liters, originalAllocation.created_by, originalAllocation.updated_by, originalAllocation.created_at, originalAllocation.updated_at]
    );
  } else if (trip) {
    await query(`DELETE FROM fuelallocations WHERE vehicle_id = $1 AND allocation_month = $2`, [trip.vehicle_id, allocationMonth]);
  }
  if (testAllocationId) await query(`DELETE FROM audit_logs WHERE resource = 'fuelallocations' AND resource_id = $1`, [testAllocationId]);
  if (trip && originalVehicle) {
    await query(
      `UPDATE vehicles SET fuel_level = $2, tank_capacity_l = $3, fuel_efficiency_kmpl = $4 WHERE vehicle_id = $1`,
      [trip.vehicle_id, originalVehicle.fuel_level, originalVehicle.tank_capacity_l, originalVehicle.fuel_efficiency_kmpl]
    );
  }
  if (trip && originalTripStatus && trip.trip_status !== "Assigned") {
    await query(`UPDATE trips SET trip_status = $2 WHERE trip_id = $1`, [trip.trip_id, originalTripStatus]);
  }
  await getPool().end();
}

console.log(`fuel requests: ${passed} passed, ${failed.length} failed`);
for (const failure of failed) console.log(`  FAIL ${failure}`);
if (failed.length) process.exitCode = 1;
