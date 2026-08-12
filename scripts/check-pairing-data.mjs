// Read-only snapshot of the pairing data the assignment rule depends on:
// who is on duty, which vehicle each driver is custodian of, and which
// substitute bookings exist. Confirms whether "no options" reflects the real
// fleet state or a lookup bug.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/check-pairing-data.mjs
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const eq = line.indexOf("=");
  if (eq > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = line.slice(eq + 1).trim();
  }
}

const app = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);
const { query, getPool } = await app("lib/db.js");

const { rows: drivers } = await query(
  `SELECT d.driver_id, d.driver_status, d.license_expiry,
          e.first_name, e.last_name,
          a.vehicle_id AS custodian_of, v.plate_number AS custodian_plate
     FROM drivers d
     LEFT JOIN employees e ON e.employee_id = d.employee_id
     LEFT JOIN driver_vehicle_assignments a
            ON a.driver_id = d.driver_id AND a.assigned_until IS NULL
     LEFT JOIN vehicles v ON v.vehicle_id = a.vehicle_id
    WHERE d.deleted_at IS NULL
    ORDER BY d.driver_id`
);
console.log(`\nDRIVERS (${drivers.length})`);
console.table(
  drivers.map((d) => ({
    id: d.driver_id,
    name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "(no employee)",
    status: d.driver_status,
    license: d.license_expiry ? String(d.license_expiry).slice(0, 10) : "(none)",
    custodian_of: d.custodian_plate ?? "—",
  }))
);

const { rows: vehicles } = await query(
  `SELECT v.vehicle_id, v.plate_number, v.vehicle_status, v.seating_capacity, v.category_id,
          a.driver_id AS designated_id, e.first_name, e.last_name, d.driver_status
     FROM vehicles v
     LEFT JOIN driver_vehicle_assignments a
            ON a.vehicle_id = v.vehicle_id AND a.assigned_until IS NULL
     LEFT JOIN drivers d ON d.driver_id = a.driver_id
     LEFT JOIN employees e ON e.employee_id = d.employee_id
    WHERE v.deleted_at IS NULL
    ORDER BY v.vehicle_id`
);
console.log(`\nVEHICLES (${vehicles.length})`);
console.table(
  vehicles.map((v) => ({
    plate: v.plate_number,
    status: v.vehicle_status,
    seats: v.seating_capacity,
    cat: v.category_id ?? "—",
    designated: v.designated_id
      ? `${`${v.first_name ?? ""} ${v.last_name ?? ""}`.trim() || `#${v.designated_id}`} [${v.driver_status}]`
      : "— none —",
  }))
);

const { rows: subs } = await query(
  `SELECT s.vehicle_id, v.plate_number, s.substitute_driver_id, s.effective_from, s.effective_until,
          e.first_name, e.last_name, d.driver_status
     FROM substitute_vehicle_schedules s
     LEFT JOIN vehicles v ON v.vehicle_id = s.vehicle_id
     LEFT JOIN drivers d ON d.driver_id = s.substitute_driver_id
     LEFT JOIN employees e ON e.employee_id = d.employee_id
    ORDER BY s.vehicle_id, s.effective_from`
);
console.log(`\nSUBSTITUTE SCHEDULES (${subs.length})`);
console.table(
  subs.map((s) => ({
    plate: s.plate_number,
    substitute: `${`${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || `#${s.substitute_driver_id}`} [${s.driver_status}]`,
    from: String(s.effective_from).slice(0, 10),
    until: s.effective_until ? String(s.effective_until).slice(0, 10) : "(open)",
  }))
);

await getPool().end();
