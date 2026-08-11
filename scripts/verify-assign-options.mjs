// End-to-end check of the assign-dialog empty state after the assignment-readiness
// fix (valid vehicle+driver pairs only).
//
// The vehicle list comes from the REAL route handler (GET /api/vehicles/available),
// so the relaxed status filter and vehicleCanTravel both run as shipped. The
// option-building below mirrors the two branches in
// components/reservations/assign-dialog.jsx — that code lives in a React memo and
// cannot be imported, so it is restated here; keep the two in step.
//
// The dialog now offers a vehicle ONLY with its designated driver when that
// driver is on duty and free, or with a substitute explicitly assigned to that
// vehicle for the pickup date. It never auto-pairs a free vehicle with an
// unrelated free driver (the old `relief` branch is gone).
//
// Read-only: no writes, no transaction needed.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-assign-options.mjs
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
const { GET } = await app("app/api/vehicles/available/route.js");

globalThis.__HARNESS_SESSION__ = {
  user: { employeeId: 48, role: "admin" },
};

const personName = (r) =>
  `${r?.employees?.first_name || r?.first_name || ""} ${r?.employees?.last_name || r?.last_name || ""}`.trim() ||
  (r?.driver_id ? `Driver #${r.driver_id}` : "another driver");

async function availableVehicles(pickupAt) {
  const url = `http://localhost/api/vehicles/available?pickup_at=${encodeURIComponent(pickupAt)}`;
  const res = await GET(new Request(url));
  const body = await res.json();
  if (!res.ok) throw new Error(`route ${res.status}: ${JSON.stringify(body)}`);
  return body.data ?? body;
}

async function onDutyDrivers(pickupAt) {
  const { rows } = await query(
    `SELECT d.driver_id, e.first_name, e.last_name
       FROM drivers d LEFT JOIN employees e ON e.employee_id = d.employee_id
      WHERE d.driver_status = 'Available' AND d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules ds
           WHERE ds.driver_id = d.driver_id AND ds.deleted_at IS NULL
             AND ds.status = ANY(ARRAY['Scheduled','In Progress'])
             AND ds.scheduled_departure < $1::timestamptz
             AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $1::timestamptz
        )
      ORDER BY d.driver_id`,
    [pickupAt]
  );
  return rows;
}

// Mirrors the `options` memo in assign-dialog.jsx (custodian branch, then
// substitute branch for vehicles the custodian cannot take).
function buildOptions({ vehicles, drivers, pairs, subs, reqCategoryId, passengers }) {
  const vById = new Map(vehicles.map((v) => [v.vehicle_id, v]));
  const onDuty = new Set(drivers.map((d) => d.driver_id));
  const seatsTooFew = (v) => {
    const s = Number(v?.seating_capacity) || 0;
    return s > 0 && s < passengers;
  };
  const classOk = (v) => reqCategoryId == null || v.category_id === reqCategoryId;

  const custodian = pairs
    .filter((a) => {
      const v = vById.get(a.vehicle_id);
      return v && onDuty.has(a.driver_id) && !seatsTooFew(v) && classOk(v);
    })
    .map((a) => ({ branch: "custodian", vehicleId: a.vehicle_id, driverId: a.driver_id,
                   plate: vById.get(a.vehicle_id).plate_number, driverName: personName(a) }));

  // A vehicle whose custodian is not offered may still be offered with a
  // substitute — but only one explicitly assigned to that vehicle for this date.
  // The exclusion set is the vehicle ids already offered, NOT the driver ids,
  // so a vehicle with an on-duty custodian is never double-offered with a sub.
  const offered = new Set(custodian.map((o) => o.vehicleId));
  const substitute = subs
    .filter((s) => {
      const v = vById.get(s.vehicle_id);
      return v && !offered.has(s.vehicle_id) && onDuty.has(s.substitute_driver_id) &&
             !seatsTooFew(v) && classOk(v);
    })
    .map((s) => ({ branch: "substitute", vehicleId: s.vehicle_id, driverId: s.substitute_driver_id,
                   plate: vById.get(s.vehicle_id).plate_number, driverName: personName(s) }));

  return [...custodian, ...substitute];
}

const { rows: pairs } = await query(
  `SELECT a.vehicle_id, a.driver_id, e.first_name, e.last_name
     FROM driver_vehicle_assignments a
     LEFT JOIN drivers d ON d.driver_id = a.driver_id
     LEFT JOIN employees e ON e.employee_id = d.employee_id
    WHERE a.assigned_until IS NULL`
);

const { rows: requests } = await query(
  `SELECT r.request_id, r.reservation_number, r.pickup_datetime, r.passenger_count,
          r.requested_category_id, vc.category_name
     FROM transportation_requests r
     LEFT JOIN vehiclecategories vc ON vc.category_id = r.requested_category_id
    WHERE r.request_id = ANY(ARRAY[60,61,62]) OR r.requested_category_id = 2
    ORDER BY r.request_id DESC LIMIT 6`
);

for (const r of requests) {
  const pickupAt = new Date(r.pickup_datetime).toISOString();
  const day = pickupAt.slice(0, 10);
  const vehicles = await availableVehicles(pickupAt);
  const drivers = await onDutyDrivers(pickupAt);
  const { rows: subs } = await query(
    `SELECT s.vehicle_id, s.substitute_driver_id, e.first_name, e.last_name
       FROM substitute_vehicle_schedules s
       LEFT JOIN drivers d ON d.driver_id = s.substitute_driver_id
       LEFT JOIN employees e ON e.employee_id = d.employee_id
      WHERE s.effective_from <= $1::date
        AND (s.effective_until IS NULL OR s.effective_until >= $1::date)`,
    [day]
  );

  const opts = buildOptions({
    vehicles, drivers, pairs, subs,
    reqCategoryId: r.requested_category_id ?? null,
    passengers: Number(r.passenger_count) || 1,
  });

  console.log(
    `\n=== ${r.reservation_number || `REQ-${r.request_id}`} · pickup ${pickupAt} · ` +
    `class ${r.category_name ?? "(unclassified)"} · ${r.passenger_count ?? 1} pax ===`
  );
  console.log(
    `    endpoint returned ${vehicles.length} vehicle(s): ` +
    (vehicles.map((v) => `${v.plate_number}[${v.vehicle_status}]`).join(", ") || "none")
  );
  console.log(`    on-duty & free drivers: ${drivers.length}`);
  console.log(`    OPTIONS: ${opts.length}`);
  if (opts.length) {
    console.table(
      opts.slice(0, 12).map((o) => ({
        branch: o.branch, plate: o.plate, driver: o.driverName, note: o.note ?? "",
      }))
    );
    if (opts.length > 12) console.log(`    …and ${opts.length - 12} more`);
  }

  // The footnote the dialog shows: free in the window, but nobody cleared to
  // take it. These are the vehicles the old `relief` branch used to offer with
  // an arbitrary driver.
  const offeredIds = new Set(opts.map((o) => o.vehicleId));
  const withheld = vehicles.filter((v) => !offeredIds.has(v.vehicle_id));
  if (withheld.length) {
    const custodianByVehicle = new Map(pairs.map((a) => [a.vehicle_id, a]));
    const subByVehicle = new Map(subs.map((s) => [s.vehicle_id, s]));
    const onDuty = new Set(drivers.map((d) => d.driver_id));
    console.log(`    WITHHELD (free, no cleared driver): ${withheld.length}`);
    console.table(
      withheld.slice(0, 12).map((v) => {
        const a = custodianByVehicle.get(v.vehicle_id);
        const s = subByVehicle.get(v.vehicle_id);
        let why;
        if (!a && !s) why = "no designated driver, no substitute";
        else if (a && !onDuty.has(a.driver_id) && !s) why = `designated ${personName(a)} not on duty, no substitute`;
        else if (s && !onDuty.has(s.substitute_driver_id)) why = `substitute ${personName(s)} not on duty`;
        else why = "seats/class filter";
        return { plate: v.plate_number, status: v.vehicle_status, why };
      })
    );
  }
}

await getPool().end();
