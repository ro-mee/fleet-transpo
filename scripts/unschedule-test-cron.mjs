// One-off: unschedule the leftover `test` pg_cron job (`SELECT 1` every
// minute) that has been burning a run since before 2026-09-09. Vault recorded
// it as "cleanup candidate, pending owner approval" in the Trip Start Window
// acceptance preflight — approval given 2026-09-24 (cron wiring task).
// Safe: only calls cron.unschedule('test') and prints the job list after.
// Run: node scripts/unschedule-test-cron.mjs
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const pg = (await import("pg")).default;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const before = await client.query(
  "SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid"
);
console.log("BEFORE:", JSON.stringify(before.rows, null, 2));

const target = before.rows.find((r) => r.jobname === "test");
if (!target) {
  console.log("No job named 'test' — nothing to do.");
} else {
  const res = await client.query("SELECT cron.unschedule('test') AS removed");
  console.log("cron.unschedule('test') ->", res.rows[0]);
}

const after = await client.query(
  "SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid"
);
console.log("AFTER:", JSON.stringify(after.rows, null, 2));

await client.end();
