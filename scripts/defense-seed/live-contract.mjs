import { join } from "node:path";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";

const COUNT_TABLES = [
  "employees", "drivers", "vehicles", "vehiclecategories", "transportation_requests",
  "dispatchschedules", "trips", "driver_work_schedules", "driver_leave_balances",
  "driver_leave_requests", "fuelrecords", "fuelrequests", "vehiclemaintenance",
  "vehicleinspection", "driverincidents", "expense_records", "locations", "routes",
];

export async function inspectLiveContract(db) {
  const { rows: identity } = await db.query("SELECT current_database() AS database, current_schema() AS schema");
  const { rows: categories } = await db.query("SELECT category_id, category_name, status, deleted_at FROM vehiclecategories ORDER BY category_id");
  const { rows: roles } = await db.query("SELECT role_id,role_name FROM roles ORDER BY role_id");
  const { rows: seedSettings } = await db.query("SELECT setting_key FROM system_settings WHERE setting_key LIKE 'seed:%' ORDER BY setting_key");
  const { rows: policy } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'uvvrp_policy'");
  const { rows: buckets } = await db.query("SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id");
  const { rows: notificationRecipients } = await db.query(
    "SELECT r.role_name,COUNT(*)::int AS active_employees FROM employees e JOIN roles r ON r.role_id=e.role_id WHERE e.status='Active' AND e.deleted_at IS NULL AND r.role_name IN ('fleet_manager','admin') GROUP BY r.role_name ORDER BY r.role_name"
  );
  const { rows: baseSettings } = await db.query(
    "SELECT setting_key, setting_value FROM system_settings WHERE setting_key ~* '(hotel|base|location)' ORDER BY setting_key"
  );
  const { rows: locations } = await db.query(
    "SELECT location_id, name, latitude, longitude, is_active FROM locations ORDER BY location_id"
  );
  const counts = {};
  for (const table of COUNT_TABLES) {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS count FROM public.${table}`);
    counts[table] = rows[0].count;
  }
  const { rows: schema } = await db.query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position`,
    [COUNT_TABLES]
  );
  return {
    identity: identity[0], categories, roles, seedSettings: seedSettings.map((r) => r.setting_key),
    uvvrpPolicy: policy[0]?.setting_value ?? null, buckets, notificationRecipients,
    baseSettings, locations, counts, columns: schema,
  };
}

if (process.argv[1]?.endsWith("live-contract.mjs")) {
  if (!process.env.DATABASE_URL) {
    const dir = process.env.FLEETOPS_ENV_DIR;
    loadEnvLocal(dir ? [join(dir, ".env.local"), join(dir, ".env")] : undefined);
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const contract = await inspectLiveContract(client);
      await client.query("ROLLBACK");
      const output = process.argv.includes("--full") ? contract : { ...contract, columns: undefined };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
