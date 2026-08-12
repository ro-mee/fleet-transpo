import { readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";

loadEnvLocal();

const DIR = "supabase/migrations";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local or .env).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  
  let i = 1;
  for (const oldName of files) {
    const prefix = String(i).padStart(3, "0");
    const rest = oldName.substring(oldName.indexOf("_"));
    const newName = `${prefix}${rest}`;
    
    if (oldName !== newName) {
      console.log(`Renaming: ${oldName} -> ${newName}`);
      
      const oldPath = join(DIR, oldName);
      const newPath = join(DIR, newName);
      
      await pool.query("BEGIN");
      try {
        await pool.query(
          "UPDATE schema_migrations SET filename = $1 WHERE filename = $2",
          [newName, oldName]
        );
        renameSync(oldPath, newPath);
        await pool.query("COMMIT");
      } catch (err) {
        await pool.query("ROLLBACK");
        console.error(`Failed on ${oldName}:`, err);
        process.exit(1);
      }
    }
    i++;
  }
  
  console.log("Migration files re-sequenced successfully.");
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
