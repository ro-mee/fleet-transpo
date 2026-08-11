import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(".env", "utf8");
const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
const DATABASE_URL = line.slice("DATABASE_URL=".length).trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL });

const q = async (label, sql, params = []) => {
  try {
    const r = await pool.query(sql, params);
    console.log(`\n=== ${label} (${r.rowCount}) ===`);
    console.table(r.rows);
  } catch (e) {
    console.log(`\n=== ${label} ERROR ===`);
    console.log(e.message);
  }
};

await q("vehicle categories", `SELECT category_id, category_name, seating_capacity FROM vehiclecategories ORDER BY category_id`);

await q(
  "recent requests (has requested_category_id)",
  `SELECT request_id, reservation_number, pickup_datetime, passenger_count, requested_category_id, requested_vehicle_type, guest_name,
          vehicle_id, driver_id, fleet_status
     FROM transportation_requests
    ORDER BY created_at DESC
    LIMIT 10`
);

await q(
  "vehicles by category",
  `SELECT v.vehicle_id, v.plate_number, v.vehicle_status, v.seating_capacity, v.category_id, vc.category_name
     FROM vehicles v LEFT JOIN vehiclecategories vc ON vc.category_id = v.category_id
    WHERE v.deleted_at IS NULL
    ORDER BY v.category_id, v.vehicle_id`
);

await q(
  "active custodial pairings",
  `SELECT a.assignment_id, a.driver_id, a.vehicle_id, a.assigned_from, v.plate_number, v.vehicle_status, d.driver_status
     FROM driver_vehicle_assignments a
     LEFT JOIN vehicles v ON v.vehicle_id = a.vehicle_id
     LEFT JOIN drivers d ON d.driver_id = a.driver_id
    WHERE a.assigned_until IS NULL`
);

await q(
  "drivers",
  `SELECT d.driver_id, d.driver_status, d.license_expiry, e.first_name, e.last_name
     FROM drivers d LEFT JOIN employees e ON e.employee_id = d.employee_id
    WHERE d.deleted_at IS NULL
    ORDER BY d.driver_id`
);

await q(
  "substitute schedules",
  `SELECT * FROM substitute_vehicle_schedules ORDER BY vehicle_id`
);

await pool.end();
