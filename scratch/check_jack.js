const { Client } = require("pg");
const fs = require("fs");
(async () => {
  const g = (k) => (fs.readFileSync(".env.local", "utf8").match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1];
  const c = new Client({ connectionString: g("DATABASE_URL") });
  await c.connect();
  try {
    const vehicles = await c.query(
      `SELECT vehicle_id, plate_number, vehicle_status, registration_expiry, insurance_expiry
         FROM vehicles WHERE deleted_at IS NULL AND vehicle_status = 'Available' LIMIT 10`
    );
    console.log("AVAILABLE VEHICLES:", JSON.stringify(vehicles.rows, null, 2));

    const routes = await c.query(
      `SELECT route_id, route_name, origin, destination FROM routes WHERE deleted_at IS NULL LIMIT 10`
    );
    console.log("ROUTES:", JSON.stringify(routes.rows, null, 2));
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
