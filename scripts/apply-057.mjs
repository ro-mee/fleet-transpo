import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

loadEnvLocal();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const filename = "057_vehicle_names_proper_case.sql";
const sql = readFileSync("supabase/migrations/" + filename, "utf8");
const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);

try {
  console.log("Applying " + filename + " ...");
  await pool.query(sql);
  // The model column is an identifier, not a title — restore the Lamborghini
  // SVJ that the earlier (pre-hyphen-split) draft of this migration mangled.
  await pool.query(`UPDATE vehicles SET model = 'SVJ' WHERE upper(model) = 'SVJ'`);
  console.log("Applied. Recording in schema_migrations ledger...");
  await pool.query(
    `INSERT INTO schema_migrations (filename, checksum, applied_by)
     VALUES ($1, $2, 'up') ON CONFLICT (filename) DO NOTHING`,
    [filename, checksum]
  );
  console.log("Done.");
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
