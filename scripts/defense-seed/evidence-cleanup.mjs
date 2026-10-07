import { createHash } from "node:crypto";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { readLedger } from "./ledger.mjs";

// Only typed references to removed or retired business entities qualify.
const references = [
  ["dispatch", "dispatchschedules", "dispatch_id", "NULL"],
  ["trip", "trips", "trip_id", "deleted_at"],
  ["incident", "driverincidents", "incident_id", "deleted_at"],
  ["leave_request", "driver_leave_requests", "leave_request_id", "NULL"],
  ["reservation", "transportation_requests", "request_id", "deleted_at"],
  ["document", "vehicledocuments", "document_id", "NULL"],
  ["driver", "drivers", "driver_id", "deleted_at"],
  ["vehicle", "vehicles", "vehicle_id", "deleted_at"],
];
const stalePredicate = (alias) => references.map(([type, table, key, deleted]) =>
  `(${alias}.reference_type='${type}' AND ${alias}.reference_id IS NOT NULL AND
    NOT EXISTS (SELECT 1 FROM ${table} current WHERE current.${key}=${alias}.reference_id
      AND ${deleted === "NULL" ? "TRUE" : `current.${deleted} IS NULL`}))`).join(" OR ");

loadEnvLocal();
const command = process.argv[2] ?? "plan";
if (!["plan", "apply"].includes(command)) throw new Error("Use plan or apply");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await db.connect();
try {
  await client.query(command === "plan" ? "BEGIN READ ONLY" : "BEGIN");
  if (command === "apply") await client.query("SELECT pg_advisory_xact_lock(hashtext('seed:defense-old-evidence'))");
  const ledger = await readLedger(client);
  if (!ledger || ledger.state === "media_cleanup") throw new Error("Applied defense ledger required");
  const targets = {};
  for (const [table, key] of [["notifications", "notification_id"], ["push_outbox", "id"]]) {
    const { rows } = await client.query(`SELECT ${key} AS id,reference_type,reference_id,to_jsonb(t) AS snapshot
      FROM ${table} t WHERE ${stalePredicate("t")} ORDER BY ${key}`);
    const owned = new Set((ledger.ids?.[table] ?? []).map(String));
    if (rows.some((r) => owned.has(String(r.id)))) throw new Error(`Seed-owned ${table} row appears stale`);
    targets[table] = rows;
  }
  const digest = createHash("sha256").update(JSON.stringify(targets)).digest("hex").slice(0, 16);
  if (command === "plan") {
    console.log(JSON.stringify({ readOnly: true, digest,
      targets: Object.fromEntries(Object.entries(targets).map(([table, rows]) =>
        [table, rows.map(({ id, reference_type, reference_id }) => ({ id, reference_type, reference_id }))])),
      note: "Only typed references to missing or retired old business entities; security/UVVRP/unlinked evidence stays." }, null, 2));
    await client.query("ROLLBACK");
  } else {
    if (!process.argv.includes(`--apply=${digest}`)) throw new Error(`Evidence cleanup requires --apply=${digest}`);
    const deleted = {};
    for (const [table, key] of [["notifications", "notification_id"], ["push_outbox", "id"]]) {
      const ids = targets[table].map((r) => r.id);
      const result = await client.query(`DELETE FROM ${table} WHERE ${key}=ANY($1::int[])`, [ids]);
      if (result.rowCount !== ids.length) throw new Error(`${table} changed during cleanup`);
      deleted[table] = result.rowCount;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ state: "old-typed-evidence-removed", digest, deleted }));
  }
} catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
finally { client.release(); await db.end(); }
