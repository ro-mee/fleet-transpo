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

await q(
  "dispatches for vehicles 1,37 (and any)",
  `SELECT ds.dispatch_id, ds.vehicle_id, ds.driver_id, ds.reservation_id, ds.status,
          ds.scheduled_departure, ds.scheduled_arrival
     FROM dispatchschedules ds
    WHERE ds.deleted_at IS NULL AND ds.vehicle_id IN (1,37)
    ORDER BY ds.scheduled_departure`
);

await q(
  "reservations for vehicles 1,37",
  `SELECT vr.reservation_id, vr.vehicle_id, vr.driver_id, vr.status, vr.start_datetime, vr.end_datetime,
          tr.reservation_number
     FROM vehiclereservations vr
     LEFT JOIN transportation_requests tr ON tr.request_id = vr.reservation_id
    WHERE vr.vehicle_id IN (1,37) AND vr.deleted_at IS NULL
    ORDER BY vr.start_datetime`
);

await q(
  "dispatches by driver 19,21,2",
  `SELECT ds.dispatch_id, ds.driver_id, ds.vehicle_id, ds.status, ds.scheduled_departure, ds.scheduled_arrival
     FROM dispatchschedules ds
    WHERE ds.deleted_at IS NULL AND ds.driver_id IN (19,21,2)
    ORDER BY ds.scheduled_departure`
);

await q(
  "all dispatches",
  `SELECT ds.dispatch_id, ds.vehicle_id, ds.driver_id, ds.status, ds.scheduled_departure, ds.scheduled_arrival
     FROM dispatchschedules ds
    WHERE ds.deleted_at IS NULL
    ORDER BY ds.scheduled_departure`
);

await pool.end();
