import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";
import { readFileSync } from "node:fs";

loadEnvLocal();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const sql = readFileSync("supabase/migrations/055_remove_dispatcher_leave_notification.sql", "utf8");
  console.log("Applying 055...");
  await pool.query(sql);
  console.log("Success! Applied 055.");
  
  // also let's delete the changed from schema_migrations so next time `up` won't complain
  await pool.query(`DELETE FROM schema_migrations WHERE filename IN ('036_trip_lifecycle_status.sql', '037_remove_review_statuses.sql', '048_trip_pretrip_gate.sql', '049_driver_work_schedule_and_leave.sql', '050_vehicle_images_bucket.sql', '051_fix_driver_work_schedules_constraint.sql')`);
  console.log("Cleaned up changed migrations");
}

run().catch(console.error).finally(() => pool.end());
