// Report verification — every /api/reports figure against an independent total.
//
// The routes aggregate in JavaScript over rows pg hands back. This suite calls
// each real handler in-process (auth stubbed, everything else as shipped) and
// compares each number against the same figure computed a second, deliberately
// different way: one scalar SQL aggregate per column, no multi-table joins.
//
// The two paths have to be independently derived or the check is worthless. So:
//
//   - the routes SUM in JS over row arrays; the expectations SUM in SQL,
//   - the routes join several tables at once; the expectations query one table
//     at a time, which is what catches join fan-out,
//   - a third anchor comes from scripts/seed-demo.mjs, whose totals were added
//     up in memory before any row reached the database. `npm run seed:plan`
//     prints them; the SEED_ANCHOR block below repeats them so a mismatch
//     between "what we meant to insert" and "what is in the table" is visible
//     without re-reading the seed.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-reports.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const app = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);
const { query, getPool } = await app("lib/db.js");
const ExcelJS = (await import("exceljs")).default;
const JSZip = (await import("jszip")).default;

// The seed window. Every report is exercised over exactly this range, so a
// figure that disagrees can be traced to a specific set of generated rows.
const FROM = "2026-05-13";
const TO = "2026-08-10";

// Printed by `npm run seed:plan`, computed in memory before insertion.
// These cover the SEEDED rows only — the live database also holds pre-existing
// rows (2 trips, 7 maintenance, 1 incident), so a report total over the window
// is legitimately >= the anchor. The anchor's job is to catch a table that is
// missing seeded rows entirely, which a route-vs-SQL check cannot see.
const SEED_ANCHOR = {
  trips: 200,
  distance: 1039.76,
  fuelAmount: 95343.32,
  fuelLiters: 1464.6,
  maintCost: 66415.2,
  onTime: 152,
};

let pass = 0;
const failures = [];
const notes = [];

const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;

function check(label, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(detail ? `${label} — ${detail}` : label);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(label, actual, expected, tol) {
  check(label, near(actual, expected, tol), `route ${actual} vs independent ${expected}`);
}

// ---------------------------------------------------------------------------
// Route invocation. Same seam scripts/verify-rbac.mjs uses: auth() is stubbed,
// requireAuth and the handler body run as shipped, against the live database.
// ---------------------------------------------------------------------------
globalThis.__HARNESS_SESSION__ = { user: { employeeId: 8, role: "system_admin", email: "harness@local" } };

async function callReport(rel, params = `from=${FROM}&to=${TO}`) {
  const mod = await app(rel);
  const req = new Request(`http://localhost:3000/api/harness?${params}`, { method: "GET" });
  const restore = console.error;
  console.error = () => {};
  let res;
  try {
    res = await mod.GET(req);
  } finally {
    console.error = restore;
  }
  const body = await res.json();
  if (res.status !== 200) throw new Error(`${rel} returned ${res.status}: ${JSON.stringify(body)}`);
  // ok() in src/lib/api/utils.js is Response.json(data) — no envelope to strip.
  return body;
}

async function callWorkbook(rel, params = `from=${FROM}&to=${TO}`) {
  const mod = await app(rel);
  const req = new Request(`http://localhost:3000/api/harness?${params}`, { method: "GET" });
  const restore = console.error;
  console.error = () => {};
  let res;
  try {
    res = await mod.GET(req);
  } finally {
    console.error = restore;
  }
  if (res.status !== 200) throw new Error(`${rel} returned ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = await JSZip.loadAsync(buffer);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  book.__package = {
    chartCount: zip.file(/^xl\/charts\/chart\d+\.xml$/).length,
    drawingCount: zip.file(/^xl\/drawings\/drawing\d+\.xml$/).length,
    mediaCount: zip.file(/^xl\/media\//).length,
  };
  return book;
}

const cellResult = (cell) => (cell && typeof cell.value === "object" ? cell.value.result : cell?.value);

// ---------------------------------------------------------------------------
// Independent expectations — one table per query, one column per aggregate.
// ---------------------------------------------------------------------------
const one = async (sql, params) => (await query(sql, params)).rows[0];

// Two windows, deliberately.
//
// `tripAgg` repeats the routes' own predicate (`start_time <= $2`) so the
// route-vs-SQL comparison is apples-to-apples and isolates the JS aggregation.
// `tripFull` uses a real closed-open day range, which is what "the window"
// actually means. The gap between them IS the date-boundary bug: `to` is a bare
// date, so it compares as midnight and the last day's trips fall outside.
const tripAgg = await one(
  `SELECT COUNT(*)::int AS n,
          COALESCE(SUM(distance), 0) AS distance,
          COALESCE(SUM(total_cost), 0) AS total_cost,
          COUNT(*) FILTER (WHERE on_time_completion)::int AS on_time
     FROM trips WHERE deleted_at IS NULL AND start_time >= $1 AND start_time <= $2`,
  [FROM, TO]
);
const tripFull = await one(
  `SELECT COUNT(*)::int AS n,
          COALESCE(SUM(distance), 0) AS distance,
          COALESCE(SUM(total_cost), 0) AS total_cost,
          COUNT(*) FILTER (WHERE on_time_completion)::int AS on_time
     FROM trips WHERE deleted_at IS NULL AND start_time >= $1::date AND start_time < ($2::date + 1)`,
  [FROM, TO]
);
const fuelAgg = await one(
  `SELECT COUNT(*)::int AS n,
          COALESCE(SUM(amount), 0) AS amount,
          COALESCE(SUM(liters), 0) AS liters
     FROM fuelrecords WHERE deleted_at IS NULL AND fuel_date >= $1 AND fuel_date <= $2`,
  [FROM, TO]
);
const fuelReportAgg = await one(
  `SELECT COUNT(*)::int AS n,
          COALESCE(SUM(amount), 0) AS amount,
          COALESCE(SUM(liters), 0) AS liters
     FROM fuelrecords
    WHERE deleted_at IS NULL AND status IN ('Approved', 'Completed')
      AND fuel_date >= $1::date AND fuel_date < ($2::date + 1)`,
  [FROM, TO]
);
const fuelTripAgg = await one(
  `SELECT COUNT(*)::int AS n, COALESCE(SUM(distance), 0) AS distance
     FROM trips
    WHERE deleted_at IS NULL AND trip_status = 'Completed'
      AND end_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
      AND end_time < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')`,
  [FROM, TO]
);
const fuelApproved = await one(
  `SELECT COUNT(*)::int AS n,
          COALESCE(SUM(amount), 0) AS amount,
          COALESCE(SUM(liters), 0) AS liters
     FROM fuelrecords WHERE deleted_at IS NULL AND status = 'Approved'`
);
const maintAgg = await one(
  `SELECT COUNT(*)::int AS n, COALESCE(SUM(cost), 0) AS cost
     FROM vehiclemaintenance WHERE deleted_at IS NULL AND maintenance_date >= $1 AND maintenance_date <= $2`,
  [FROM, TO]
);

console.log(`\n=== Reports over ${FROM} .. ${TO} ===`);
console.log(`\nIndependent SQL aggregates:`);
console.log(`  trips (route predicate) n=${tripAgg.n} distance=${tripAgg.distance} total_cost=${tripAgg.total_cost} on_time=${tripAgg.on_time}`);
console.log(`  trips (full day range)  n=${tripFull.n} distance=${tripFull.distance} total_cost=${tripFull.total_cost} on_time=${tripFull.on_time}`);
console.log(`  fuelrecords            n=${fuelAgg.n} amount=${fuelAgg.amount} liters=${fuelAgg.liters}`);
console.log(`  fuelrecords (approved) n=${fuelApproved.n} amount=${fuelApproved.amount} liters=${fuelApproved.liters}`);
console.log(`  vehiclemaintenance     n=${maintAgg.n} cost=${maintAgg.cost}`);

// ---------------------------------------------------------------------------
// 0. Seed anchor — did the seeded rows actually land?
//
// Measured against tripFull: the anchor's question is "is the data there", and
// answering it with the routes' truncating predicate would blame the seed for a
// bug in the reports.
// ---------------------------------------------------------------------------
console.log(`\n0. Seed anchor (in-memory totals vs the table)`);
check(`trips: >= ${SEED_ANCHOR.trips} rows in window`, tripFull.n >= SEED_ANCHOR.trips, `got ${tripFull.n}`);
check(`trips.distance >= seeded ${SEED_ANCHOR.distance}`, Number(tripFull.distance) >= SEED_ANCHOR.distance - 0.02, `got ${tripFull.distance}`);
check(`fuelrecords.amount >= seeded ${SEED_ANCHOR.fuelAmount}`, Number(fuelAgg.amount) >= SEED_ANCHOR.fuelAmount - 0.02, `got ${fuelAgg.amount}`);
check(`fuelrecords.liters >= seeded ${SEED_ANCHOR.fuelLiters}`, Number(fuelAgg.liters) >= SEED_ANCHOR.fuelLiters - 0.02, `got ${fuelAgg.liters}`);
check(`maintenance.cost >= seeded ${SEED_ANCHOR.maintCost}`, Number(maintAgg.cost) >= SEED_ANCHOR.maintCost - 0.02, `got ${maintAgg.cost}`);
check(`on-time >= seeded ${SEED_ANCHOR.onTime}`, tripFull.on_time >= SEED_ANCHOR.onTime, `got ${tripFull.on_time}`);
// tripAgg deliberately mirrors the OLD `<= to` predicate; tripFull is the real
// closed-open range. The routes now use the closed-open form, so every route-vs-SQL
// comparison below is against tripFull — and the gap between the two SQL windows is
// the date-boundary bug, kept as a regression probe. If a route regresses to
// `<= $2`, its totals snap back to tripAgg's numbers and the eq() checks fail.
console.log(`  note: tripAgg(midnight-truncated)=${tripAgg.n} vs tripFull(closed-open)=${tripFull.n} — routes must match tripFull`);

// ---------------------------------------------------------------------------
// 1. /api/reports/financial
// ---------------------------------------------------------------------------
console.log(`\n1. reports/financial`);
const fin = await callReport("app/api/reports/financial/route.js");
eq("fuelCost", fin.fuelCost, fuelAgg.amount);
eq("maintCost", fin.maintCost, maintAgg.cost);
eq("totalCost", fin.totalCost, Number(fuelAgg.amount) + Number(maintAgg.cost));
eq("totalDistance", fin.totalDistance, tripFull.distance);
eq("costPerKm", fin.costPerKm, (Number(fuelAgg.amount) + Number(maintAgg.cost)) / Number(tripFull.distance), 0.01);
check("costPerKm is a finite number", Number.isFinite(fin.costPerKm), `got ${fin.costPerKm}`);

// ---------------------------------------------------------------------------
// 2. /api/reports/maintenance
// ---------------------------------------------------------------------------
console.log(`\n2. reports/maintenance`);
const mnt = await callReport("app/api/reports/maintenance/route.js");
eq("totalCost", mnt.totalCost, maintAgg.cost);
const byTypeSql = (await query(
  `SELECT COALESCE(maintenance_type,'Other') AS t, COUNT(*)::int AS n, COALESCE(SUM(cost),0) AS cost
     FROM vehiclemaintenance WHERE deleted_at IS NULL AND maintenance_date >= $1 AND maintenance_date <= $2
    GROUP BY 1 ORDER BY 1`,
  [FROM, TO]
)).rows;
const byTypeRoute = mnt.byType ?? mnt.costByType ?? mnt.types ?? [];check(`byType covers ${byTypeSql.length} types`, byTypeRoute.length === byTypeSql.length, `route returned ${byTypeRoute.length}`);
for (const row of byTypeSql) {
  const hit = byTypeRoute.find((r) => (r.type ?? r.maintenance_type) === row.t);
  if (!hit) { check(`byType[${row.t}] present`, false, "missing"); continue; }
  eq(`byType[${row.t}].cost`, hit.cost, row.cost);
  check(`byType[${row.t}].count`, Number(hit.count) === row.n, `route ${hit.count} vs ${row.n}`);
}
check(
  "byType costs sum to totalCost",
  near(byTypeRoute.reduce((s, r) => s + Number(r.cost || 0), 0), mnt.totalCost),
  `${byTypeRoute.reduce((s, r) => s + Number(r.cost || 0), 0)} vs ${mnt.totalCost}`
);
eq("totalRecords", mnt.totalRecords, maintAgg.n, 0);
check(
  `monthlyData is populated (${byTypeSql.length} types across the window)`,
  (mnt.monthlyData || []).length > 0,
  "route returns a hardcoded empty array"
);

// ---------------------------------------------------------------------------
// 3. /api/reports/fleet-utilization
// ---------------------------------------------------------------------------
console.log(`\n3. reports/fleet-utilization`);
const util = await callReport("app/api/reports/fleet-utilization/route.js");
eq("totalTrips", util.totalTrips, tripFull.n, 0);
eq("totalDistance", util.totalDistance, tripFull.distance);
const byVehSql = (await query(
  `SELECT COALESCE(v.plate_number,'Unknown') AS plate, COUNT(*)::int AS n, COALESCE(SUM(t.distance),0) AS distance
     FROM trips t LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
    WHERE t.deleted_at IS NULL AND t.start_time >= $1::date AND t.start_time < ($2::date + 1) GROUP BY 1 ORDER BY 1`,
  [FROM, TO]
)).rows;
check(`byVehicle covers ${byVehSql.length} vehicles`, (util.byVehicle || []).length === byVehSql.length, `route returned ${(util.byVehicle || []).length}`);
for (const row of byVehSql) {
  const hit = (util.byVehicle || []).find((r) => r.plate === row.plate);
  if (!hit) { check(`byVehicle[${row.plate}] present`, false, "missing"); continue; }
  eq(`byVehicle[${row.plate}].distance`, hit.distance, row.distance);
  check(`byVehicle[${row.plate}].trips`, hit.trips === row.n, `route ${hit.trips} vs ${row.n}`);
}
check(
  "byVehicle distances sum to totalDistance",
  near((util.byVehicle || []).reduce((s, r) => s + Number(r.distance || 0), 0), util.totalDistance),
  `${(util.byVehicle || []).reduce((s, r) => s + Number(r.distance || 0), 0)} vs ${util.totalDistance}`
);

// ---------------------------------------------------------------------------
// 4. /api/reports/fuel-consumption
// ---------------------------------------------------------------------------
console.log(`\n4. reports/fuel-consumption`);
const fc = await callReport("app/api/reports/fuel-consumption/route.js");
eq("totalLiters", fc.totalLiters, fuelReportAgg.liters);
eq("totalCost", fc.totalCost, fuelReportAgg.amount);
eq("avgCost", fc.avgCost, Number(fuelReportAgg.amount) / Number(fuelReportAgg.liters), 0.01);
eq("totalDistance", fc.totalDistance, fuelTripAgg.distance);
eq("fuelTransactionCount", fc.fuelTransactionCount, fuelReportAgg.n, 0);
eq("completedTrips", fc.completedTrips, fuelTripAgg.n, 0);
const expectedEfficiency = Number(fuelTripAgg.distance) >= 50 && Number(fuelReportAgg.liters) > 0
  ? Number(fuelTripAgg.distance) / Number(fuelReportAgg.liters)
  : null;
check("estimatedEfficiency follows the 50 km rule", expectedEfficiency == null ? fc.estimatedEfficiency == null : near(fc.estimatedEfficiency, expectedEfficiency, 0.01));
const monthsSql = (await query(
  `SELECT to_char(fuel_date,'YYYY-MM') AS m, COALESCE(SUM(liters),0) AS liters, COALESCE(SUM(amount),0) AS cost
     FROM fuelrecords
    WHERE deleted_at IS NULL AND status IN ('Approved', 'Completed')
      AND fuel_date >= $1::date AND fuel_date < ($2::date + 1)
    GROUP BY 1 ORDER BY 1`,
  [FROM, TO]
)).rows;
check(
  `monthlyData has ${monthsSql.length} calendar months`,
  (fc.monthlyData || []).length === monthsSql.length,
  `route returned ${(fc.monthlyData || []).length}: ${JSON.stringify((fc.monthlyData || []).map((r) => r.month))}`
);
for (const row of monthsSql) {
  const hit = (fc.monthlyData || []).find((r) => r.month === row.m);
  if (!hit) { check(`monthlyData[${row.m}] present`, false, `route months: ${(fc.monthlyData || []).map((r) => r.month).join(", ")}`); continue; }
  eq(`monthlyData[${row.m}].liters`, hit.liters, row.liters);
  eq(`monthlyData[${row.m}].cost`, hit.cost, row.cost);
}
const catSql = (await query(
  `SELECT COALESCE(vc.category_name,'General Fleet') AS c, COALESCE(SUM(f.liters),0) AS liters, COALESCE(SUM(f.amount),0) AS cost
     FROM fuelrecords f
     LEFT JOIN vehicles v ON v.vehicle_id = f.vehicle_id
     LEFT JOIN vehiclecategories vc ON vc.category_id = v.category_id
    WHERE f.deleted_at IS NULL AND f.status IN ('Approved', 'Completed')
      AND f.fuel_date >= $1::date AND f.fuel_date < ($2::date + 1)
    GROUP BY 1 ORDER BY 1`,
  [FROM, TO]
)).rows;
check(`byCategory covers ${catSql.length} categories`, (fc.byCategory || []).length === catSql.length, `route returned ${(fc.byCategory || []).length}`);
for (const row of catSql) {
  const hit = (fc.byCategory || []).find((r) => r.category === row.c);
  if (!hit) { check(`byCategory[${row.c}] present`, false, "missing"); continue; }
  eq(`byCategory[${row.c}].liters`, hit.liters, row.liters);
  eq(`byCategory[${row.c}].cost`, hit.cost, row.cost);
}
check(
  `byVehicle is populated (${fuelReportAgg.n} eligible fuel records exist)`,
  (fc.byVehicle || []).length > 0,
  "route returns a hardcoded empty array"
);

// ---------------------------------------------------------------------------
// 5. /api/reports/fleet-cost
// ---------------------------------------------------------------------------
console.log(`\n5. reports/fleet-cost`);
const cost = await callReport("app/api/reports/fleet-cost/route.js");
eq("totals.fuel_cost", cost.totals.fuel_cost, fuelAgg.amount);
eq("totals.maintenance_cost", cost.totals.maintenance_cost, maintAgg.cost);
eq("totals.distance", cost.totals.distance, tripFull.distance);
eq("totals.total_cost", cost.totals.total_cost, Number(fuelAgg.amount) + Number(maintAgg.cost));
eq("totals.cost_per_km", cost.totals.cost_per_km, (Number(fuelAgg.amount) + Number(maintAgg.cost)) / Number(tripFull.distance), 0.01);
const perVehSql = (await query(
  `SELECT v.vehicle_id, v.plate_number,
          (SELECT COALESCE(SUM(f.amount),0) FROM fuelrecords f
            WHERE f.vehicle_id = v.vehicle_id AND f.deleted_at IS NULL AND f.fuel_date >= $1 AND f.fuel_date <= $2) AS fuel_cost,
          (SELECT COALESCE(SUM(m.cost),0) FROM vehiclemaintenance m
            WHERE m.vehicle_id = v.vehicle_id AND m.deleted_at IS NULL AND m.maintenance_date >= $1 AND m.maintenance_date <= $2) AS maintenance_cost,
          (SELECT COALESCE(SUM(t.distance),0) FROM trips t
            WHERE t.vehicle_id = v.vehicle_id AND t.start_time >= $1::date AND t.start_time < ($2::date + 1)
              AND t.deleted_at IS NULL) AS distance
     FROM vehicles v WHERE v.deleted_at IS NULL ORDER BY v.plate_number`,
  [FROM, TO]
)).rows;
for (const row of perVehSql) {
  const hit = (cost.details || []).find((r) => r.vehicle_id === row.vehicle_id);
  if (!hit) { check(`details[${row.plate_number}] present`, false, "missing"); continue; }
  eq(`details[${row.plate_number}].fuel_cost`, hit.fuel_cost, row.fuel_cost);
  eq(`details[${row.plate_number}].maintenance_cost`, hit.maintenance_cost, row.maintenance_cost);
  eq(`details[${row.plate_number}].distance`, hit.distance, row.distance);
}

// ---------------------------------------------------------------------------
// 6. /api/reports/driver-performance
// ---------------------------------------------------------------------------
console.log(`\n6. reports/driver-performance`);
const perf = await callReport("app/api/reports/driver-performance/route.js");
const perfSql = (await query(
  `SELECT d.driver_id,
          (SELECT COUNT(*)::int FROM trips t WHERE t.driver_id = d.driver_id
             AND t.trip_status = 'Completed' AND t.deleted_at IS NULL
             AND t.end_time >= $1::date AND t.end_time < ($2::date + 1)) AS total_trips,
          (SELECT COALESCE(ROUND(SUM(t.distance)::numeric,1),0) FROM trips t WHERE t.driver_id = d.driver_id
             AND t.trip_status = 'Completed' AND t.deleted_at IS NULL
             AND t.end_time >= $1::date AND t.end_time < ($2::date + 1)) AS total_distance,
           (SELECT COUNT(*)::int FROM driverincidents di WHERE di.driver_id = d.driver_id
             AND di.deleted_at IS NULL
             AND di.incident_date >= $1::date AND di.incident_date < ($2::date + 1)) AS incidents
     FROM drivers d WHERE d.deleted_at IS NULL ORDER BY d.driver_id`,
  [FROM, TO]
)).rows;
eq("totalDrivers", perf.totalDrivers, perfSql.length, 0);
const tripSum = perfSql.reduce((s, r) => s + r.total_trips, 0);
const routeTripSum = (perf.details || []).reduce((s, r) => s + Number(r.total_trips || 0), 0);
check(`details total_trips sums to ${tripSum}`, routeTripSum === tripSum, `route ${routeTripSum}`);
for (const row of perfSql) {
  const hit = (perf.details || []).find((r) => r.driver_id === row.driver_id);
  if (!hit) { check(`details[driver ${row.driver_id}] present`, false, "missing"); continue; }
  check(`details[driver ${row.driver_id}].total_trips`, Number(hit.total_trips) === row.total_trips, `route ${hit.total_trips} vs ${row.total_trips}`);
  eq(`details[driver ${row.driver_id}].total_distance`, hit.total_distance, row.total_distance, 0.11);
}
const incidentTotal = perfSql.reduce((s, r) => s + r.incidents, 0);
const routeIncidents = (perf.details || []).reduce((s, r) => s + Number(r.incidents || 0), 0);
check(
  `details incidents sums to ${incidentTotal}`,
  routeIncidents === incidentTotal,
  `route reports ${routeIncidents} — the field is hardcoded`
);

// ---------------------------------------------------------------------------
// 7. /api/fuel/analytics  (no date params; filters status='Approved' itself)
// ---------------------------------------------------------------------------
console.log(`\n7. fuel/analytics`);
const fa = await callReport("app/api/fuel/analytics/route.js", "");
eq("recordsCount", fa.recordsCount, fuelApproved.n, 0);
eq("totalCost", fa.totalCost, fuelApproved.amount);
eq("totalLiters", fa.totalLiters, fuelApproved.liters);
eq("avgCostPerLiter", fa.avgCostPerLiter, Number(fuelApproved.liters) ? Number(fuelApproved.amount) / Number(fuelApproved.liters) : 0, 0.01);
const faMonths = (await query(
  `SELECT to_char(fuel_date,'YYYY-MM') AS m, COALESCE(SUM(amount),0) AS cost, COALESCE(SUM(liters),0) AS liters, COUNT(*)::int AS n
     FROM fuelrecords WHERE deleted_at IS NULL AND status='Approved' GROUP BY 1 ORDER BY 1`
)).rows;
check(
  `monthlyTrend has ${faMonths.length} calendar months`,
  (fa.monthlyTrend || []).length === faMonths.length,
  `route returned ${(fa.monthlyTrend || []).length}: ${JSON.stringify((fa.monthlyTrend || []).map((r) => r.month))}`
);
for (const row of faMonths) {
  const hit = (fa.monthlyTrend || []).find((r) => r.month === row.m);
  if (!hit) { check(`monthlyTrend[${row.m}] present`, false, "missing"); continue; }
  eq(`monthlyTrend[${row.m}].cost`, hit.cost, row.cost);
  eq(`monthlyTrend[${row.m}].liters`, hit.liters, row.liters);
}
const faTypes = (await query(
  `SELECT COALESCE(fuel_type,'Unknown') AS t, COALESCE(SUM(liters),0) AS liters, COALESCE(SUM(amount),0) AS cost, COUNT(*)::int AS n
     FROM fuelrecords WHERE deleted_at IS NULL AND status='Approved' GROUP BY 1 ORDER BY 1`
)).rows;
check(`byFuelType covers ${faTypes.length} types`, (fa.byFuelType || []).length === faTypes.length, `route returned ${(fa.byFuelType || []).length}`);
for (const row of faTypes) {
  const hit = (fa.byFuelType || []).find((r) => r.fuel_type === row.t);
  if (!hit) { check(`byFuelType[${row.t}] present`, false, "missing"); continue; }
  eq(`byFuelType[${row.t}].liters`, hit.liters, row.liters);
  eq(`byFuelType[${row.t}].cost`, hit.cost, row.cost);
}

// ---------------------------------------------------------------------------
// 8. Date-boundary probe.
//
// Reports use a closed-open calendar-day range. This asks the routes for a
// single day and compares against that day's non-deleted trip count.
// ---------------------------------------------------------------------------
console.log(`\n8. Date boundary — a one-day window`);
const probe = (await query(
   `SELECT to_char(start_time AT TIME ZONE '+08:00','YYYY-MM-DD') AS d, COUNT(*)::int AS n
      FROM trips WHERE deleted_at IS NULL AND start_time >= $1::date AND start_time < ($2::date + 1)
    GROUP BY 1 HAVING COUNT(*) > 2 ORDER BY 2 DESC LIMIT 1`,
  [FROM, TO]
)).rows[0];
if (!probe) {
  notes.push("no single day had >2 trips; date-boundary probe skipped");
} else {
  const dayN = (await query(
    `SELECT COUNT(*)::int AS n FROM trips
      WHERE deleted_at IS NULL AND start_time >= $1::date AND start_time < ($1::date + 1)`,
    [probe.d]
  )).rows[0].n;
  const oneDay = await callReport("app/api/reports/fleet-utilization/route.js", `from=${probe.d}&to=${probe.d}`);
  check(
    `fleet-utilization from=${probe.d}&to=${probe.d} returns that day's ${dayN} trips`,
    oneDay.totalTrips === dayN,
    `route ${oneDay.totalTrips} vs ${dayN}`
  );
  const finDay = await callReport("app/api/reports/financial/route.js", `from=${probe.d}&to=${probe.d}`);
  const dayDist = (await query(
    `SELECT COALESCE(SUM(distance),0) AS d FROM trips
      WHERE deleted_at IS NULL AND start_time >= $1::date AND start_time < ($1::date + 1)`,
    [probe.d]
  )).rows[0].d;
  check(
    `financial from=${probe.d}&to=${probe.d} totalDistance is that day's ${dayDist}`,
    near(finDay.totalDistance, dayDist),
    `route ${finDay.totalDistance} vs ${dayDist}`
  );
}

// ---------------------------------------------------------------------------
// 9. XLSX parity and editability smoke checks. ExcelJS can read the generated
// files back, so these assertions cover the values shown in Summary and the
// detail-row counts without relying on rendered images or a desktop Excel app.
// ---------------------------------------------------------------------------
console.log(`\n9. customized XLSX parity`);
try {
  const books = {
    fuel: await callWorkbook("app/api/reports/fuel-consumption/excel/route.js"),
    maintenance: await callWorkbook("app/api/reports/maintenance/excel/route.js"),
    fleet: await callWorkbook("app/api/reports/fleet-utilization/excel/route.js"),
    drivers: await callWorkbook("app/api/reports/driver-performance/excel/route.js"),
    cost: await callWorkbook("app/api/reports/fleet-cost/excel/route.js"),
    financial: await callWorkbook("app/api/reports/financial/excel/route.js"),
    analytics: await callWorkbook("app/api/reports/analytics/excel/route.js"),
    trips: await callWorkbook("app/api/reports/trip-performance/excel/route.js", ""),
    incidents: await callWorkbook("app/api/reports/incidents/excel/route.js", ""),
  };
  for (const [name, book] of Object.entries(books)) {
    const imageCount = book.worksheets.reduce((sum, sheet) => sum + sheet.getImages().length, 0);
    check(`${name} workbook has no static images`, imageCount === 0, `found ${imageCount}`);
    check(`${name} workbook has three native charts`, book.__package.chartCount === 3 && book.__package.drawingCount === 3, `charts ${book.__package.chartCount}, drawings ${book.__package.drawingCount}`);
    check(`${name} workbook package has no media files`, book.__package.mediaCount === 0, `found ${book.__package.mediaCount}`);
  }
  const fuelSummary = books.fuel.getWorksheet("Summary");
  eq("fuel Summary eligible liters", cellResult(fuelSummary.getCell("A7")), fc.totalLiters);
  eq("fuel Summary approved cost", cellResult(fuelSummary.getCell("C7")), fc.totalCost);
  check("fuel workbook detail rows match payload", books.fuel.getWorksheet("Fuel Details").rowCount - 1 === (fc.fuelRecords || []).length, "Fuel Details row count differs");
  check("maintenance Summary cost matches payload", near(cellResult(books.maintenance.getWorksheet("Summary").getCell("A6")), mnt.totalCost), `workbook ${cellResult(books.maintenance.getWorksheet("Summary").getCell("A6"))} vs ${mnt.totalCost}`);
  check("maintenance detail rows match payload", books.maintenance.getWorksheet("Details").rowCount - 1 === (mnt.records || []).length, "Details row count differs");
  check("fleet Summary distance matches payload", near(cellResult(books.fleet.getWorksheet("Summary").getCell("G6")), util.totalDistance), `workbook ${cellResult(books.fleet.getWorksheet("Summary").getCell("G6"))} vs ${util.totalDistance}`);
  check("fleet trip detail rows match payload", books.fleet.getWorksheet("Trip Details").rowCount - 1 === (util.trips || []).length, "Trip Details row count differs");
  check("driver Summary trip count matches payload", near(cellResult(books.drivers.getWorksheet("Summary").getCell("G6")), perf.totalTrips), `workbook ${cellResult(books.drivers.getWorksheet("Summary").getCell("G6"))} vs ${perf.totalTrips}`);
  check("driver detail rows match payload", books.drivers.getWorksheet("Driver Details").rowCount - 1 === (perf.details || []).length, "Driver Details row count differs");
  check("fleet-cost Summary total matches payload", near(cellResult(books.cost.getWorksheet("Summary").getCell("A6")), cost.totals.total_cost), `workbook ${cellResult(books.cost.getWorksheet("Summary").getCell("A6"))} vs ${cost.totals.total_cost}`);
  check("fleet-cost vehicle rows match payload", books.cost.getWorksheet("Vehicle Costs").rowCount - 1 === (cost.details || []).length, "Vehicle Costs row count differs");
  check("financial Summary total matches payload", near(cellResult(books.financial.getWorksheet("Summary").getCell("A6")), fin.totalCost), `workbook ${cellResult(books.financial.getWorksheet("Summary").getCell("A6"))} vs ${fin.totalCost}`);
  check("financial fuel detail rows match payload", books.financial.getWorksheet("Fuel Details").rowCount - 1 === (fin.fuelRecords || []).length, "Fuel Details row count differs");
  check("analytics Summary distance matches fleet payload", near(cellResult(books.analytics.getWorksheet("Summary").getCell("E6")), util.totalDistance), `workbook ${cellResult(books.analytics.getWorksheet("Summary").getCell("E6"))} vs ${util.totalDistance}`);
  check("trip workbook has a details sheet", books.trips.getWorksheet("Details").rowCount >= 1);
  check("incident workbook has a details sheet", books.incidents.getWorksheet("Details").rowCount >= 1);
} catch (error) {
  check("customized XLSX routes load", false, error.message);
}

// ---------------------------------------------------------------------------
console.log(`\n=== ${pass} passed, ${failures.length} failed ===`);
for (const n of notes) console.log(`  note: ${n}`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
await getPool().end();
process.exit(failures.length ? 1 : 0);
