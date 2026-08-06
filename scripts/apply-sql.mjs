// Apply a migration file to the database named by DATABASE_URL in .env.local.
//
// The file is sent as one simple-query batch, so the BEGIN/COMMIT the migration
// already wraps itself in governs the whole thing: any statement that fails
// rolls the entire migration back rather than leaving the schema half-applied.
//
// Credentials are resolved at runtime from .env.local — never hardcoded here.
//
// Run: node scripts/apply-sql.mjs supabase/migrations/017_driver_vehicle_assignments.sql
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";

loadEnvLocal();

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/apply-sql.mjs <path-to-.sql>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local.");
  process.exit(1);
}

const sql = readFileSync(resolve(process.cwd(), file), "utf8");
if (!/\bBEGIN\b/i.test(sql) || !/\bCOMMIT\b/i.test(sql)) {
  console.error(`${file} is not wrapped in BEGIN/COMMIT — refusing to apply it unwrapped.`);
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  console.log(`\nApplying ${file} (${sql.split("\n").length} lines)...`);
  await pool.query(sql);
  console.log("Applied — the migration's COMMIT succeeded.\n");
} catch (e) {
  console.error(`\nFAILED — rolled back, schema unchanged.\n  ${e.message}`);
  if (e.position) console.error(`  at character ${e.position}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
