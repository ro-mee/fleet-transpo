import { createHash } from "node:crypto";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { readLedger } from "./ledger.mjs";

loadEnvLocal();
const command = process.argv[2] ?? "plan";
if (!["plan", "apply"].includes(command)) throw new Error("Use plan or apply");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await db.connect();
try {
  await client.query(command === "plan" ? "BEGIN READ ONLY" : "BEGIN");
  if (command === "apply") await client.query("SELECT pg_advisory_xact_lock(hashtext('seed:defense-old-test-accounts'))");
  const ledger = await readLedger(client);
  if (!ledger || ledger.state === "media_cleanup") throw new Error("Applied defense ledger required");
  const { rows } = await client.query(`SELECT e.employee_id AS id,e.email,r.role_name,
      to_jsonb(e) AS snapshot FROM employees e JOIN roles r ON r.role_id=e.role_id
     WHERE e.deleted_at IS NULL AND r.role_name='driver'
       AND e.email ~* '(test|demo|example|harness|analytics|codex[.]qa)'
       AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.employee_id=e.employee_id AND d.deleted_at IS NULL)
     ORDER BY e.employee_id`);
  const owned = new Set((ledger.ids.employees ?? []).map(String));
  if (rows.some((r) => owned.has(String(r.id)))) throw new Error("Defense-owned employee selected");
  const digest = createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  if (command === "plan") {
    console.log(JSON.stringify({ readOnly: true, digest,
      retire: rows.map(({ id, email, role_name }) => ({ id, email, role_name })),
      note: "Only explicit old test/QA driver emails without an active driver profile; real staff, roles, and security evidence stay." }, null, 2));
    await client.query("ROLLBACK");
  } else {
    if (!process.argv.includes(`--apply=${digest}`)) throw new Error(`Test-account retirement requires --apply=${digest}`);
    const ids = rows.map((r) => r.id);
    const result = await client.query("UPDATE employees SET deleted_at=NOW() WHERE employee_id=ANY($1::int[]) AND deleted_at IS NULL", [ids]);
    if (result.rowCount !== ids.length) throw new Error("Employee retirement count changed");
    await client.query("COMMIT");
    console.log(JSON.stringify({ state: "old-test-accounts-retired", count: result.rowCount, ids }));
  }
} catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
finally { client.release(); await db.end(); }
