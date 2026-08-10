const { Client } = require("pg");
const fs = require("fs");
const { execSync } = require("child_process");
(async () => {
  const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env";
  const g = (k) => (fs.readFileSync(envPath, "utf8").match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1];
  const raw = g("DATABASE_URL");
  if (!raw) throw new Error("DATABASE_URL not found in " + envPath);
  const connectionString = raw.trim().replace(/^["']|["']$/g, "");
  const c = new Client({ connectionString });
  await c.connect();
  try {
    const sql = fs.readFileSync("supabase/migrations/030_notification_preferences.sql", "utf8");
    await c.query(sql);
    console.log("migration applied");
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  }
  const cols = await c.query(
    "select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='notification_preferences' order by ordinal_position"
  );
  console.log("notification_preferences columns:", JSON.stringify(cols.rows));
  const pks = await c.query(
    `select kcu.column_name from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
     where tc.table_schema='public' and tc.table_name='notification_preferences'
       and tc.constraint_type='PRIMARY KEY' order by kcu.ordinal_position`
  );
  console.log("pk columns:", JSON.stringify(pks.rows));
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });