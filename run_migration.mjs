import { readFileSync } from "fs";
import pg from "pg";
const { Pool } = pg;

const sql = readFileSync("supabase/migrations/009_auth_migration.sql", "utf8");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const statements = sql.split(";").filter(s => s.trim());
  for (const stmt of statements) {
    const result = await pool.query(stmt);
    console.log(`OK: ${result.command} ${result.rowCount ?? 0} rows`);
  }
  console.log("Migration complete");
  await pool.end();
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
