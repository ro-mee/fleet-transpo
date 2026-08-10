import { readFileSync } from "fs";
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const sql = readFileSync("supabase/migrations/031_perf_ai_provider_and_board_index.sql", "utf8");

  await pool.query("BEGIN");
  try {
    await pool.query(sql);
    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }

  const tbl = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='aiproviders'`
  );
  const idx = await pool.query(
    `SELECT COUNT(*)::int AS n FROM pg_indexes WHERE schemaname='public' AND indexname='idx_dispatch_active_departure'`
  );
  console.log("aiproviders table:", tbl.rows[0].n === 1 ? "OK" : "MISSING");
  console.log("idx_dispatch_active_departure:", idx.rows[0].n === 1 ? "OK" : "MISSING");
  if (tbl.rows[0].n !== 1 || idx.rows[0].n !== 1) throw new Error("VERIFY FAILED");
  await pool.end();
}

main()
  .then(() => console.log("Migration 031 complete"))
  .catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  });
