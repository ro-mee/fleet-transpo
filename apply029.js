const { Client } = require("pg");
const fs = require("fs");
(async () => {
  const g = (k) => (fs.readFileSync(".env.local", "utf8").match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1];
  const c = new Client({ connectionString: g("DATABASE_URL") });
  await c.connect();
  try {
    const sql = fs.readFileSync("supabase/migrations/029_incident_coordinates.sql", "utf8");
    await c.query("BEGIN");
    await c.query(sql);
    await c.query("COMMIT");
    console.log("migration applied");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  const cols = await c.query(
    "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='driverincidents' and column_name in ('latitude','longitude')"
  );
  console.log("verified cols:", JSON.stringify(cols.rows));
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
