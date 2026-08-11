// Read-only check of the recommendation pipeline against the live fleet: same
// queries the recommendation route runs, handed to the pure advisor, without
// persisting any snapshot. Confirms that when the DB cannot form a single valid
// vehicle+driver pair, the advisor says so explicitly and never reaches into
// unrelated available drivers.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-recommendation-pipeline.mjs
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
const { buildDispatchRecommendation } = await app("lib/ai/dispatch-advisor.js");

const { rows: requests } = await query(
  `SELECT request_id, reservation_number, pickup_datetime, passenger_count, requested_category_id
     FROM transportation_requests
    WHERE deleted_at IS NULL AND pickup_datetime IS NOT NULL
    ORDER BY request_id DESC LIMIT 3`
);

const { rows: pairs } = await query(
  `SELECT vehicle_id, driver_id FROM driver_vehicle_assignments WHERE assigned_until IS NULL`
);
const { rows: subs } = await query(
  `SELECT vehicle_id, substitute_driver_id, effective_from, effective_until
     FROM substitute_vehicle_schedules`
);

for (const r of requests) {
  const pickup = new Date(r.pickup_datetime);
  const start = pickup;
  const end = new Date(pickup.getTime() + 60 * 60 * 1000);
  const pickupAt = pickup.toISOString();

  const { rows: vehicles } = await query(
    `SELECT v.*, vc.category_name,
            (SELECT COUNT(*) FROM dispatchschedules ds
              WHERE ds.vehicle_id = v.vehicle_id AND ds.deleted_at IS NULL
                AND ds.status = ANY(ARRAY['Scheduled','In Progress'])
                AND ds.scheduled_departure < $2::timestamptz
                AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $1::timestamptz)::int AS schedule_load
       FROM vehicles v
       LEFT JOIN vehiclecategories vc ON vc.category_id = v.category_id
      WHERE v.deleted_at IS NULL
        AND v.vehicle_status <> ALL(ARRAY['In Use','Under Maintenance','Decommissioned','Registration Expired'])
      ORDER BY v.vehicle_id`,
    [start.toISOString(), end.toISOString()]
  );

  const { rows: drivers } = await query(
    `SELECT d.*, e.first_name, e.last_name,
            (SELECT COUNT(*) FROM dispatchschedules ds
              WHERE ds.driver_id = d.driver_id AND ds.deleted_at IS NULL
                AND ds.status = ANY(ARRAY['Scheduled','In Progress'])
                AND ds.scheduled_departure < $2::timestamptz
                AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $1::timestamptz)::int AS schedule_load
       FROM drivers d
       LEFT JOIN employees e ON e.employee_id = d.employee_id
      WHERE d.deleted_at IS NULL
      ORDER BY d.driver_id`,
    [start.toISOString(), end.toISOString()]
  );

  for (const v of vehicles) v._schedule_load = Number(v.schedule_load) || 0;
  for (const d of drivers) d._schedule_load = Number(d.schedule_load) || 0;

  console.log(
    `\n=== ${r.reservation_number || `REQ-${r.request_id}`} · pickup ${pickupAt} · ` +
    `${r.passenger_count ?? 1} pax ===`
  );
  console.log(
    `    vehicles: ` +
    (vehicles.map((v) => `${v.plate_number}[${v.vehicle_status}]load${v._schedule_load}`).join(", ") || "none")
  );
  console.log(
    `    drivers: ` +
    (drivers
      .map((d) => `#${d.driver_id} ${(d.first_name || "").split(" ")[0]}[${d.driver_status}]load${d._schedule_load}`)
      .join(", ") || "none")
  );

  const rec = buildDispatchRecommendation({
    request: r,
    vehicles,
    drivers,
    activePairs: pairs,
    activeSubstitutes: subs,
  });
  const pair = rec?.pair ?? null;
  if (pair?.vehicle && pair?.driver) {
    console.log(
      `    PAIR: ${pair.vehicle.plate_number} + driver #${pair.driver.driver_id} ` +
      `(${pair.pairing_kind ?? pair.reason_type}) score ${pair.score}`
    );
    if (pair.replacement_reason) console.log(`      replacement: ${pair.replacement_reason}`);
  } else {
    console.log("    PAIR: none — no assignment-ready vehicle+driver");
  }
  const reasons = pair?.none_reasons ?? [];
  if (reasons.length) {
    console.log(`    WITHHELD (${reasons.length}):`);
    for (const s of reasons) console.log(`      ${s.plate ?? `#${s.vehicle_id}`} — ${s.reason}`);
  }
}

await getPool().end();
