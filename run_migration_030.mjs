import { readFileSync } from "fs";
import pg from "pg";
const { Pool } = pg;

// Direct-connection migration runner (AGENTS.md: the reliable path).
// Wraps the migration in BEGIN/COMMIT and verifies the column exists.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const sql = readFileSync("supabase/migrations/030_dispatch_cancel_reason.sql", "utf8");

  await pool.query("BEGIN");
  try {
    await pool.query(sql);
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }

  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dispatchschedules' AND column_name = 'cancel_reason'`
  );
  if (rows.length === 0) {
    throw new Error("VERIFY FAILED: dispatchschedules.cancel_reason not found");
  }
  console.log("VERIFY OK:", JSON.stringify(rows[0]));
  await pool.end();
}

main()
  .then(() => console.log("Migration 030 complete"))
  .catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  });
