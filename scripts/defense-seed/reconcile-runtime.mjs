import { createHash } from "node:crypto";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { SEED_KEY } from "./config.mjs";
import { KEYS, captureSnapshots, checkExternalReferences, readLedger } from "./ledger.mjs";

const allowed = {
  drivers: new Set(["updated_at", "driver_status", "suspension_reason"]),
  vehicles: new Set(["updated_at"]),
  transportation_requests: new Set(["updated_at", "derived_priority"]),
};
loadEnvLocal();
const command = process.argv[2] ?? "plan";
if (!["plan", "apply"].includes(command)) throw new Error("Use plan or apply");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await db.connect();
try {
  await client.query(command === "plan" ? "BEGIN READ ONLY" : "BEGIN");
  if (command === "apply") await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [SEED_KEY]);
  const ledger = await readLedger(client);
  if (!ledger || ledger.state === "media_cleanup") throw new Error("Applied defense ledger required");
  const external = await checkExternalReferences(client, ledger);
  if (external.length) throw new Error(`Outside references: ${external.join("; ")}`);
  const changes = [];
  for (const [table, ids] of Object.entries(ledger.ids)) {
    const key = KEYS[table];
    const { rows } = await client.query(`SELECT ${key} AS id,to_jsonb(t) AS snapshot FROM ${table} t
      WHERE ${key}::text=ANY($1::text[])${command === "apply" ? " FOR UPDATE" : ""}`, [ids.map(String)]);
    if (rows.length !== ids.length) throw new Error(`Missing ${table} rows`);
    for (const row of rows) {
      const prior = ledger.snapshots?.[table]?.[String(row.id)];
      if (!prior) throw new Error(`Missing ${table} snapshot ${row.id}`);
      const fields = [...new Set([...Object.keys(prior), ...Object.keys(row.snapshot)])]
        .filter((field) => JSON.stringify(prior[field]) !== JSON.stringify(row.snapshot[field]));
      if (fields.some((field) => !allowed[table]?.has(field))) throw new Error(`Unexpected change ${table} ${row.id}: ${fields.join(",")}`);
      if (table === "drivers" && fields.length &&
          (row.snapshot.driver_status !== "Suspended" || row.snapshot.suspension_reason !== "license_expired" ||
           row.snapshot.license_expiry >= "2026-10-03")) throw new Error(`Unexpected driver state ${row.id}`);
      if (table === "transportation_requests" && fields.includes("derived_priority") &&
          row.snapshot.derived_priority !== "Future") throw new Error(`Unexpected request priority ${row.id}`);
      if (fields.length) changes.push({ table, id: String(row.id), fields });
    }
  }
  const digest = createHash("sha256").update(JSON.stringify({ planHash: ledger.planHash, changes })).digest("hex").slice(0, 16);
  if (command === "plan") {
    console.log(JSON.stringify({ readOnly: true, digest, changes }, null, 2));
    await client.query("ROLLBACK");
  } else {
    if (!process.argv.includes(`--apply=${digest}`)) throw new Error(`Snapshot reconciliation requires --apply=${digest}`);
    await captureSnapshots(client, ledger);
    ledger.runtimeReconciliations ??= [];
    ledger.runtimeReconciliations.push({ at: new Date().toISOString(), digest,
      changes: Object.fromEntries([...new Set(changes.map((row) => row.table))]
        .map((table) => [table, changes.filter((row) => row.table === table).length])) });
    const result = await client.query("UPDATE system_settings SET setting_value=$2::jsonb WHERE setting_key=$1", [SEED_KEY, JSON.stringify(ledger)]);
    if (result.rowCount !== 1) throw new Error("Ledger update failed");
    await client.query("COMMIT");
    console.log(JSON.stringify({ state: "runtime-snapshots-reconciled", digest, changedRows: changes.length }));
  }
} catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
finally { client.release(); await db.end(); }
