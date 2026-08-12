// Read-only: does chk_dispatch_status admit 'Pending Reassignment'?
// Run: node scripts/check-dispatch-status.mjs
import fs from "node:fs";
import pg from "pg";

// .env line 8 is an orphaned bare host string with no '=' — skip any such line.
const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env
  .split(/\r?\n/)
  .filter((l) => l.includes("="))
  .map((l) => l.slice(0, l.indexOf("=")).trim() + "=" + l.slice(l.indexOf("=") + 1).trim())
  .find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");

if (!url) throw new Error("DATABASE_URL not found in .env");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows: cons } = await client.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'public.dispatchschedules'::regclass AND contype = 'c'
  ORDER BY conname
`);
console.log("— CHECK constraints on public.dispatchschedules —");
for (const c of cons) console.log(`${c.conname}: ${c.def}`);

const { rows: counts } = await client.query(`
  SELECT status, COUNT(*)::int AS n
  FROM public.dispatchschedules
  GROUP BY status
  ORDER BY n DESC
`);
console.log("\n— row counts by status —");
console.log(counts.length ? counts : "(no dispatches)");

const { rows: cols } = await client.query(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'dispatchschedules'
    AND column_name IN ('status','vehicle_id','driver_id','scheduled_departure')
  ORDER BY column_name
`);
console.log("\n— columns the detector reads —");
console.log(cols);

await client.end();
