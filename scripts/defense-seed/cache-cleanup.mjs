import { createHash } from "node:crypto";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { readLedger } from "./ledger.mjs";

loadEnvLocal();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const command = process.argv[2] ?? "plan";
if (!["plan", "apply"].includes(command)) throw new Error("Use plan or apply");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await db.connect();
try {
  await client.query(command === "plan" ? "BEGIN READ ONLY" : "BEGIN");
  if (command === "apply") await client.query("SELECT pg_advisory_xact_lock(hashtext('seed:defense-old-narratives'))");
  const ledger = await readLedger(client);
  if (!ledger || ledger.state === "media_cleanup" || !ledger.plantedAt) throw new Error("Applied defense ledger required");
  // A narrative generated before this seed cannot describe its business data.
  // A later zero-activity narrative is also stale when the live trip table has
  // completed trips in its reported range (observed after the reseed).
  const { rows } = await client.query(`SELECT id, to_jsonb(n) AS snapshot
    FROM ai_report_narratives n WHERE generated_at < $1::timestamptz
       OR (report='analytics' AND narrative ILIKE '%zero activity across all metrics%'
         AND EXISTS (SELECT 1 FROM trips t WHERE t.deleted_at IS NULL
           AND t.trip_status='Completed' AND t.start_time >= n.range_from::date
           AND t.start_time < (n.range_to::date + 1)))
    ORDER BY id`, [ledger.plantedAt]);
  const ids = rows.map((r) => r.id);
  const digest = createHash("sha256").update(JSON.stringify({ plantedAt: ledger.plantedAt, rows })).digest("hex").slice(0, 16);
  const { rows: totals } = await client.query("SELECT COUNT(*)::int AS total FROM ai_report_narratives");
  if (command === "plan") {
    console.log(JSON.stringify({ readOnly: true, digest, seedPlantedAt: ledger.plantedAt,
      deleteIds: ids, deleteCount: ids.length, preservedNewerCount: totals[0].total - ids.length,
      reason: "These narratives predate the corrected seed or claim zero activity despite completed trips in their range." }, null, 2));
    await client.query("ROLLBACK");
  } else {
    if (!process.argv.includes(`--apply=${digest}`)) throw new Error(`Cache cleanup requires --apply=${digest}`);
    const result = await client.query("DELETE FROM ai_report_narratives WHERE id=ANY($1::int[])", [ids]);
    if (result.rowCount !== ids.length) throw new Error("Narrative deletion count changed");
    await client.query("COMMIT");
    console.log(JSON.stringify({ state: "old-report-narratives-removed", deleted: result.rowCount, preservedNewer: totals[0].total - ids.length }));
  }
} catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
finally { client.release(); await db.end(); }
