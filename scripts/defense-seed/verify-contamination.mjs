import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { BUSINESS_TABLES, readDefenseBaseline } from "./baseline.mjs";
import { readLedger } from "./ledger.mjs";

loadEnvLocal();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await db.connect();
const failures = [];
const near = (actual, expected) => Math.abs(Number(actual) - Number(expected)) < 0.02;
const equal = (name, actual, expected) => {
  if (!near(actual, expected)) failures.push(`${name}: got ${actual}, expected ${expected}`);
};
globalThis.__HARNESS_SESSION__ = { user: { employeeId: 8, role: "super_admin", email: "harness@local" } };
const call = async (path) => {
  const file = resolve(process.cwd(), "src", `app/api/reports/${path}/route.js`);
  const { GET } = await import(pathToFileURL(file).href);
  const response = await GET(new Request("http://localhost/api/verification?from=2026-09-03&to=2026-10-02"));
  const body = await response.json();
  if (response.status !== 200) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
};
try {
  await client.query("BEGIN READ ONLY");
  const ledger = await readLedger(client);
  if (!ledger || ledger.state === "media_cleanup") throw new Error("Applied defense ledger required");
  const baseline = await readDefenseBaseline(client);
  for (const table of BUSINESS_TABLES) {
    const expected = ledger.ids?.[table]?.length ?? 0;
    equal(`${table} outside defense ownership`, baseline.counts[table] - expected, 0);
  }
  const { rows: tripRows } = await client.query(`SELECT COUNT(*)::int AS trips,
      COALESCE(SUM(distance),0)::numeric AS distance,
      COUNT(*) FILTER (WHERE trip_status='Completed')::int AS completed
      FROM trips WHERE deleted_at IS NULL AND start_time >= '2026-09-03'::date
      AND start_time < '2026-10-03'::date`);
  const { rows: fuelRows } = await client.query(`SELECT COUNT(*)::int AS records,
      COALESCE(SUM(liters),0)::numeric AS liters,COALESCE(SUM(amount),0)::numeric AS cost
      FROM fuelrecords WHERE deleted_at IS NULL AND fuel_date >= '2026-09-03'::date
      AND fuel_date < '2026-10-03'::date`);
  const { rows: maintenanceRows } = await client.query(`SELECT COUNT(*)::int AS records,
      COALESCE(SUM(cost),0)::numeric AS cost FROM vehiclemaintenance
      WHERE deleted_at IS NULL AND maintenance_date >= '2026-09-03'::date
      AND maintenance_date < '2026-10-03'::date`);
  const { rows: otherRows } = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM vehicles WHERE deleted_at IS NULL) AS vehicles,
      (SELECT COUNT(*)::int FROM drivers WHERE deleted_at IS NULL) AS drivers,
      (SELECT COUNT(*)::int FROM driverincidents WHERE deleted_at IS NULL) AS incidents,
      (SELECT COUNT(*)::int FROM expense_records) AS expenses,
      (SELECT COUNT(*)::int FROM transportation_requests) AS requests,
      (SELECT COUNT(*)::int FROM trips WHERE trip_status='Assigned' AND deleted_at IS NULL) AS open_trips,
      (SELECT COUNT(*)::int FROM storage.objects WHERE name LIKE 'defense-2026-10/%') AS defense_media`);
  const trips = tripRows[0], fuel = fuelRows[0], maintenance = maintenanceRows[0], other = otherRows[0];
  const { rows: guestRows } = await client.query(`SELECT r.guest_name,r.special_requests,
      r.booking_reference,r.reservation_number,
      to_char(r.pickup_datetime AT TIME ZONE 'Asia/Manila','HH24:MI') AS pickup_time,
      c.category_name FROM transportation_requests r
      JOIN vehiclecategories c ON c.category_id=r.requested_category_id`);
  for (const [index, guest] of guestRows.entries()) {
    if (!guest.guest_name || /demo|test|fixture|seed/i.test([
      guest.guest_name, guest.special_requests, guest.booking_reference, guest.reservation_number].join(" ")))
      failures.push(`Guest-facing request ${index + 1} has fixture wording`);
    if (!/Guest mobile: \+63 9\d{2} \d{3} \d{4}/.test(guest.special_requests ?? ""))
      failures.push(`Guest-facing request ${index + 1} lacks PH mobile format`);
    if (guest.pickup_time < "06:00" || guest.pickup_time >= "22:00")
      failures.push(`Guest-facing request ${index + 1} outside working hours`);
    if (!["VIP Guest Transport", "Guest Transport"].includes(guest.category_name))
      failures.push(`Guest-facing request ${index + 1} has wrong category`);
  }
  const { rows: scheduleRows } = await client.query(`SELECT COUNT(*)::int AS bad FROM driver_work_schedules
    WHERE NOT is_rest_day AND (shift_start <> '06:00'::time OR shift_end <> '22:00'::time)`);
  equal("working schedule violations", scheduleRows[0].bad, 0);
  const { rows: arrivalRows } = await client.query(`SELECT COUNT(*)::int AS bad FROM dispatchschedules
    WHERE to_char(scheduled_arrival AT TIME ZONE 'Asia/Manila','HH24:MI') > '22:00'`);
  equal("dispatch arrivals after 22:00", arrivalRows[0].bad, 0);
  const { rows: mediaReferenceRows } = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM vehicles WHERE deleted_at IS NULL
        AND image_url LIKE '%/defense-2026-10/vehicles/V__.png') AS transparent_vehicle_refs,
      (SELECT COUNT(*)::int FROM vehicles WHERE deleted_at IS NULL
        AND image_url IS NOT NULL AND image_url NOT LIKE '%/defense-2026-10/%') AS old_vehicle_refs,
      (SELECT COUNT(*)::int FROM fuelrecords WHERE deleted_at IS NULL
        AND receipt_url IS NOT NULL AND receipt_url NOT LIKE '%defense-2026-10/%') AS old_fuel_refs,
      (SELECT COUNT(*)::int FROM driverattendance WHERE face_capture_url IS NOT NULL
        AND face_capture_url NOT LIKE '%defense-2026-10/%') AS old_face_refs`);
  equal("transparent vehicle image references", mediaReferenceRows[0].transparent_vehicle_refs, 10);
  equal("old media referenced by active vehicles", mediaReferenceRows[0].old_vehicle_refs, 0);
  equal("old media referenced by fuel", mediaReferenceRows[0].old_fuel_refs, 0);
  equal("old media referenced by attendance", mediaReferenceRows[0].old_face_refs, 0);
  const { rows: derivedRows } = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM ai_insights) AS ai_insights,
      (SELECT COUNT(*)::int FROM ai_recommendations) AS ai_recommendations,
      (SELECT COUNT(*)::int FROM recommendation_snapshots) AS recommendation_snapshots,
      (SELECT COUNT(*)::int FROM ai_report_narratives n
        WHERE n.generated_at < $1::timestamptz OR
          (n.report='analytics' AND n.narrative ILIKE '%zero activity across all metrics%'
           AND EXISTS (SELECT 1 FROM trips t WHERE t.deleted_at IS NULL
             AND t.trip_status='Completed' AND t.start_time >= n.range_from::date
             AND t.start_time < (n.range_to::date + 1)))) AS stale_narratives,
      (SELECT COUNT(*)::int FROM company_cards) AS company_cards`, [ledger.plantedAt]);
  for (const name of ["ai_insights", "ai_recommendations", "recommendation_snapshots", "stale_narratives"])
    equal(name, derivedRows[0][name], 0);
  equal("company cards outside seed", derivedRows[0].company_cards, ledger.ids.company_cards?.length ?? 0);
  for (const [name, actual, expected] of [
    ["historical completed trips", trips.completed, 30], ["open trips", other.open_trips, 7],
    ["drivers", other.drivers, 10], ["vehicles", other.vehicles, 10],
    ["requests", other.requests, 45], ["incidents", other.incidents, 3],
    ["expenses", other.expenses, 6], ["defense media", other.defense_media, 86],
  ]) equal(name, actual, expected);
  const report = {
    financial: await call("financial"), fleet: await call("fleet-utilization"),
    maintenance: await call("maintenance"), fuel: await call("fuel-consumption"),
    fleetCost: await call("fleet-cost"), drivers: await call("driver-performance"),
  };
  equal("financial fuel cost", report.financial.fuelCost, fuel.cost);
  equal("financial maintenance cost", report.financial.maintCost, maintenance.cost);
  equal("financial distance", report.financial.totalDistance, trips.distance);
  equal("fleet trips", report.fleet.totalTrips, trips.trips);
  equal("fleet size", report.fleet.fleetSize, other.vehicles);
  equal("fleet distance", report.fleet.totalDistance, trips.distance);
  equal("maintenance report rows", report.maintenance.totalRecords, maintenance.records);
  equal("maintenance report cost", report.maintenance.totalCost, maintenance.cost);
  equal("fuel report liters", report.fuel.totalLiters, fuel.liters);
  equal("fuel report cost", report.fuel.totalCost, fuel.cost);
  equal("fleet cost fuel", report.fleetCost.totals.fuel_cost, fuel.cost);
  equal("fleet cost maintenance", report.fleetCost.totals.maintenance_cost, maintenance.cost);
  equal("driver report completed trips", report.drivers.totalCompletedTrips, trips.completed);
  const { rows: oldMedia } = await client.query(`SELECT bucket_id,COUNT(*)::int AS n FROM storage.objects
    WHERE name NOT LIKE 'defense-2026-10/%' GROUP BY bucket_id ORDER BY bucket_id`);
  console.log(JSON.stringify({ state: failures.length ? "failed" : "passed", planHash: ledger.planHash,
    businessOutsideSeed: Object.fromEntries(BUSINESS_TABLES.map((table) =>
      [table, baseline.counts[table] - (ledger.ids?.[table]?.length ?? 0)])),
    independentSql: { trips, fuel, maintenance, other, guestRequestsChecked: guestRows.length,
      mediaReferences: mediaReferenceRows[0], derived: derivedRows[0] },
    reports: { financial: { fuelCost: report.financial.fuelCost, maintCost: report.financial.maintCost,
      totalDistance: report.financial.totalDistance },
      fleet: { totalTrips: report.fleet.totalTrips, fleetSize: report.fleet.fleetSize },
      driverCompletedTrips: report.drivers.totalCompletedTrips,
      fuel: { liters: report.fuel.totalLiters, cost: report.fuel.totalCost } },
    preservedUnrelatedStorage: oldMedia, failures }, null, 2));
  await client.query("ROLLBACK");
  if (failures.length) process.exitCode = 1;
} catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
finally {
  client.release();
  await db.end();
  const { getPool } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/db.js")).href);
  await getPool().end();
}
