const { Client } = require("pg");
const fs = require("fs");
(async () => {
  const g = (k) => (fs.readFileSync(".env.local", "utf8").match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1];
  const c = new Client({ connectionString: g("DATABASE_URL") });
  await c.connect();
  try {
    // Jack (driver 21) is paired to vehicle 1 (XYZ 5678). Reassign the test
    // dispatch + trip to his actual car.
    await c.query(`UPDATE dispatchschedules SET vehicle_id = 1, updated_at = NOW() WHERE dispatch_id = 44`);
    await c.query(`UPDATE trips SET vehicle_id = 1, updated_at = NOW() WHERE trip_id = 30`);
    const r = await c.query(
      `SELECT t.trip_id, t.trip_status, d.dispatch_id, d.status AS dispatch_status,
              d.vehicle_id, v.plate_number, v.model
         FROM trips t
         JOIN dispatchschedules d ON d.dispatch_id = t.dispatch_id
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
        WHERE t.trip_id = 30`
    );
    console.log("FIXED:", JSON.stringify(r.rows, null, 2));
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
