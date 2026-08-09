const { Client } = require("pg");
const fs = require("fs");
(async () => {
  const g = (k) => (fs.readFileSync(".env.local", "utf8").match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1];
  const c = new Client({ connectionString: g("DATABASE_URL") });
  await c.connect();
  try {
    await c.query(
      `UPDATE trips SET trip_status = 'Assigned', start_time = NULL, updated_at = NOW()
        WHERE trip_id = 30 AND dispatch_id = 44`
    );
    await c.query(
      `UPDATE dispatchschedules SET status = 'Scheduled', actual_departure = NULL, updated_at = NOW()
        WHERE dispatch_id = 44`
    );
    const r = await c.query(
      `SELECT t.trip_id, t.trip_status, d.dispatch_id, d.status AS dispatch_status
         FROM trips t JOIN dispatchschedules d ON d.dispatch_id = t.dispatch_id
        WHERE t.trip_id = 30`
    );
    console.log("RESET:", JSON.stringify(r.rows));
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
