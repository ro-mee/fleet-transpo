// Fix 4 check: the `Reserved` writes in status.service.js are now bounded to
// bookings that are actually current (up to the end of today), instead of any
// open row at any future date.
//
// Phase 1 is read-only — it prints every open dispatch / reservation with the
// old and new verdict side by side, so the behaviour change is visible before
// anything is written.
//
// Phase 2 calls the REAL syncVehicleStatus for the affected vehicles. That does
// write vehicle_status, but it is the same call the cron and every dispatch
// route already make, so it only converges the row to what the app believes.
// Pass --dry to skip it.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-status-window.mjs [--dry]
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
const { syncVehicleStatus } = await app("services/status.service.js");

const dry = process.argv.includes("--dry");

// Same two expressions the service now uses.
const endOfToday = new Date();
endOfToday.setHours(23, 59, 59, 999);
const horizon = endOfToday.toISOString();
const pad = (n) => String(n).padStart(2, "0");
const todayStr = `${endOfToday.getFullYear()}-${pad(endOfToday.getMonth() + 1)}-${pad(endOfToday.getDate())}`;

const { rows: nowRow } = await query(`SELECT now() AS db_now`);
console.log(`db now      : ${nowRow[0].db_now.toISOString()}`);
console.log(`node now    : ${new Date().toISOString()} (local ${new Date().toString().slice(0, 33)})`);
console.log(`horizon     : ${horizon}`);
console.log(`today (date): ${todayStr}`);

const { rows: dispatches } = await query(
  `SELECT ds.dispatch_id, ds.vehicle_id, v.plate_number, ds.status, ds.scheduled_departure,
          ds.scheduled_arrival,
          (ds.scheduled_departure IS NULL OR ds.scheduled_departure <= $1::timestamptz) AS holds_now
     FROM dispatchschedules ds
     LEFT JOIN vehicles v ON v.vehicle_id = ds.vehicle_id
    WHERE ds.deleted_at IS NULL
      AND ds.status = ANY(ARRAY['Scheduled','In Progress'])
    ORDER BY ds.scheduled_departure NULLS FIRST`,
  [horizon]
);
console.log(`\n=== open dispatches (${dispatches.length}) — "holds_now" is the new predicate ===`);
console.table(
  dispatches.map((d) => ({
    dispatch: d.dispatch_id,
    vehicle: `${d.vehicle_id ?? "-"} ${d.plate_number ?? ""}`.trim(),
    status: d.status,
    departure: d.scheduled_departure ? d.scheduled_departure.toISOString() : null,
    old: "Reserved",
    new: d.holds_now ? "Reserved" : "(no hold)",
  }))
);

const { rows: reservations } = await query(
  `SELECT r.reservation_id, r.vehicle_id, v.plate_number, r.status, r.reservation_date,
          (r.reservation_date IS NULL OR r.reservation_date <= $1::date) AS holds_now
     FROM vehiclereservations r
     LEFT JOIN vehicles v ON v.vehicle_id = r.vehicle_id
    WHERE r.deleted_at IS NULL
      AND r.status = ANY(ARRAY['Approved','Dispatched'])
    ORDER BY r.reservation_date NULLS FIRST`,
  [todayStr]
);
console.log(`\n=== open reservations (${reservations.length}) ===`);
if (reservations.length) {
  console.table(
    reservations.map((r) => ({
      reservation: r.reservation_id,
      vehicle: `${r.vehicle_id ?? "-"} ${r.plate_number ?? ""}`.trim(),
      status: r.status,
      date: String(r.reservation_date).slice(0, 10),
      old: "Reserved",
      new: r.holds_now ? "Reserved" : "(no hold)",
    }))
  );
}

const affected = [
  ...new Set([...dispatches, ...reservations].map((r) => r.vehicle_id).filter(Boolean)),
];

const snapshot = async () => {
  const { rows } = await query(
    `SELECT vehicle_id, plate_number, vehicle_status FROM vehicles
      WHERE deleted_at IS NULL ORDER BY vehicle_id`
  );
  return rows;
};

const before = await snapshot();
console.log(`\n=== vehicle_status BEFORE ===`);
console.table(before.filter((v) => v.vehicle_status !== "Available"));
console.log(`(${before.filter((v) => v.vehicle_status === "Available").length} more are Available)`);

if (dry) {
  console.log("\n--dry: skipping syncVehicleStatus.");
} else {
  console.log(`\nrunning syncVehicleStatus for ${affected.length} vehicle(s): ${affected.join(", ")}`);
  for (const id of affected) await syncVehicleStatus(id);

  const after = await snapshot();
  const byId = new Map(before.map((v) => [v.vehicle_id, v.vehicle_status]));
  console.log(`\n=== vehicle_status AFTER ===`);
  console.table(
    after
      .filter((v) => affected.includes(v.vehicle_id) || v.vehicle_status !== "Available")
      .map((v) => ({
        vehicle: v.vehicle_id,
        plate: v.plate_number,
        before: byId.get(v.vehicle_id),
        after: v.vehicle_status,
        changed: byId.get(v.vehicle_id) === v.vehicle_status ? "" : "<-- changed",
      }))
  );
}

await getPool().end();
