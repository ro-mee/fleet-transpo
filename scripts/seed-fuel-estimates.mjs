// Seeds demo trips with locked fuel estimates so /fuel/estimates shows real rows.
// Runs against the LIVE database from .env.local/.env (same as the app).
//   node scripts/seed-fuel-estimates.mjs          # seed demo rows
//   node scripts/seed-fuel-estimates.mjs --clean  # soft-delete demo trips/vehicles,
//                                                 # hard-delete demo snapshots, soft-delete demo staff
// Demo rows are tagged: plates LIKE 'FE-DEMO-%', emails LIKE 'fuelo_demo_%@example.com'.
import { loadEnvLocal } from "./load-env.mjs";
loadEnvLocal();
import pg from "pg";

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.error("seed-fuel-estimates: DATABASE_URL is not set (needs .env.local/.env). Refusing to run.");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TAG = `FE-DEMO-${Date.now().toString(36).toUpperCase()}`;
const EMAIL = `fuelo_demo_${Date.now()}@example.com`;
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;

async function clean() {
  const { rows: emps } = await pool.query(`SELECT employee_id FROM employees WHERE email LIKE 'fuelo_demo_%@example.com'`);
  const empIds = emps.map((e) => e.employee_id);
  if (!empIds.length) { console.log("clean: no demo staff found"); return; }
  const { rows: drvs } = await pool.query(`SELECT driver_id FROM drivers WHERE employee_id = ANY($1::int[])`, [empIds]);
  const drvIds = drvs.map((d) => d.driver_id);
  await pool.query(`UPDATE trips SET fuel_price_snapshot_id = NULL WHERE driver_id = ANY($1::int[])`, [drvIds]);
  const trips = await pool.query(`UPDATE trips SET deleted_at = NOW() WHERE driver_id = ANY($1::int[]) AND deleted_at IS NULL`, [drvIds]);
  console.log(`clean: soft-deleted ${trips.rowCount} trip(s)`);
  const snaps = await pool.query(`DELETE FROM fuel_price_snapshots WHERE verified_by = ANY($1::int[])`, [empIds]);
  console.log(`clean: deleted ${snaps.rowCount} snapshot(s)`);
  const vehs = await pool.query(`UPDATE vehicles SET deleted_at = NOW() WHERE plate_number LIKE 'FE-DEMO-%' AND deleted_at IS NULL`);
  console.log(`clean: soft-deleted ${vehs.rowCount} vehicle(s)`);
  await pool.query(`UPDATE drivers SET deleted_at = NOW() WHERE driver_id = ANY($1::int[])`, [drvIds]);
  await pool.query(`UPDATE employees SET deleted_at = NOW() WHERE employee_id = ANY($1::int[])`, [empIds]);
  console.log(`clean: soft-deleted ${empIds.length} demo staff`);
}

async function seed() {
  console.log(`target: ${new URL(process.env.DATABASE_URL).host} (password redacted)`);
  const { rows: roles } = await pool.query(`SELECT role_id FROM roles WHERE role_name = 'fleet_manager' LIMIT 1`);
  if (!roles.length) throw new Error("fleet_manager role not found");
  const { rows: empRows } = await pool.query(
    `INSERT INTO employees (first_name, last_name, email, role_id) VALUES ('Demo', 'Manager', $1, $2) RETURNING employee_id`,
    [EMAIL, roles[0].role_id]
  );
  const employeeId = empRows[0].employee_id;
  const { rows: drvRows } = await pool.query(
    `INSERT INTO drivers (employee_id, license_number) VALUES ($1, $2) RETURNING driver_id`,
    [employeeId, `DL-${TAG}`]
  );
  const driverId = drvRows[0].driver_id;

  const vehicles = [];
  for (const [plate, name, eff, fuel] of [[`${TAG}-D`, "Demo Diesel Van", 9, "Diesel"], [`${TAG}-G`, "Demo Gas Sedan", 12, "Gasoline"]]) {
    const { rows } = await pool.query(
      `INSERT INTO vehicles (plate_number, vehicle_name, fuel_efficiency_kmpl, fuel_type, tank_capacity_l) VALUES ($1, $2, $3, $4, 60) RETURNING vehicle_id`,
      [plate, name, eff, fuel]
    );
    vehicles.push({ id: rows[0].vehicle_id, eff, fuel, plate });
  }

  const monday = new Date();
  const day = (monday.getDay() + 6) % 7; // days since Monday
  monday.setDate(monday.getDate() - day);
  const effective = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}T00:00:00+08:00`;
  const pdf = "https://d24qbtp4vooyzi.cloudfront.net/api/media/file/NCR%20Liquid%20Fuel%20Price%20Monitoring%2029%20Sep%20to%205%20Oct%202026.pdf?prefix=dev%2Fmedia";
  const snaps = {};
  for (const [product, price] of [["Diesel", 94.8], ["Gasoline", 86.85]]) {
    const { rows } = await pool.query(
      `INSERT INTO fuel_price_snapshots (fuel_product, region, reference_price, effective_at, source_url, verification_method, verified_by, lifecycle)
       VALUES ($1, 'NCR', $2, $3, $4, 'Manual', $5, 'Active') RETURNING snapshot_id`,
      [product, price, effective, pdf, employeeId]
    );
    snaps[product] = { id: rows[0].snapshot_id, price };
  }

  const now = Date.now();
  const trips = [
    { v: 0, km: 120.5, priced: true, daysAgo: 1 },
    { v: 0, km: 85, priced: true, daysAgo: 3 },
    { v: 1, km: 200, priced: true, daysAgo: 2 },
    { v: 1, km: 60, priced: true, daysAgo: 5 },
    { v: 0, km: 45, priced: false, daysAgo: 4 },
  ];
  for (const t of trips) {
    const veh = vehicles[t.v];
    const end = new Date(now - t.daysAgo * 86400000).toISOString();
    if (!t.priced) {
      await pool.query(
        `INSERT INTO trips (vehicle_id, driver_id, trip_status, start_time, end_time, distance, actual_distance_km, fuel_region, fuel_estimate_reason, fuel_estimate_captured_at)
         VALUES ($1, $2, 'Completed', $3, $3, $4, $4, 'NCR', 'no-price', NOW())`,
        [veh.id, driverId, end, t.km]
      );
      continue;
    }
    const snap = snaps[veh.fuel];
    const liters = r3(t.km / veh.eff);
    const cost = r2(liters * snap.price);
    await pool.query(
      `INSERT INTO trips (vehicle_id, driver_id, trip_status, start_time, end_time, distance, actual_distance_km,
        estimated_fuel_l, estimated_fuel_cost, fuel_reference_price, fuel_price_snapshot_id, fuel_region,
        fuel_efficiency_snapshot_kmpl, planned_estimated_fuel_l, planned_estimated_fuel_cost,
        fuel_estimate_reason, fuel_estimate_captured_at)
       VALUES ($1, $2, 'Completed', $3, $3, $4, $4, $5, $6, $7, $8, 'NCR', $9, $5, $6, 'priced', NOW())`,
      [veh.id, driverId, end, t.km, liters, cost, snap.price, snap.id, veh.eff]
    );
  }
  console.log(`seeded 2 snapshots (Diesel 94.80, Gasoline 86.85, Active) + 5 completed trips (4 priced, 1 no-price)`);
  console.log(`vehicles: ${vehicles.map((v) => v.plate).join(", ")}`);
  console.log(`view: /fuel/estimates  |  remove: node scripts/seed-fuel-estimates.mjs --clean`);
}

try {
  if (process.argv.includes("--clean")) await clean();
  else await seed();
} finally {
  await pool.end();
}
