import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";

const DEFENSE_KEY = "seed:defense-2026-10";
const CLEANUP_KEY = "seed:defense-old-accounts-2026-10";
const BACKUP_PATH = join(process.cwd(), "scratch", "defense-old-accounts-backup.json");
const RETIRED_EMAIL = (id) => `retired-driver-${id}@example.invalid`;
const SECURITY_TABLES = new Set([
  "audit_logs", "auth_rate_limits", "email_otp_challenges", "employee_mfa",
  "mfa_recovery_codes", "password_reset_tokens", "mobile_refresh_tokens",
  "web_sessions", "trusted_web_devices", "device_tokens", "app_errors",
  "schema_migrations",
]);
const quote = (value) => `"${value.replaceAll('"', '""')}"`;

async function readTargets(db) {
  const { rows: defenseRows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1", [DEFENSE_KEY]);
  const ledger = defenseRows[0]?.setting_value;
  if (!ledger || ledger.state === "media_cleanup") throw new Error("Complete defense ledger required");
  const owned = (ledger.ids?.employees ?? []).map(Number);
  if (owned.length !== 10) throw new Error("Defense ledger must own exactly 10 employees");
  const { rows } = await db.query(`
    SELECT e.employee_id,e.first_name,e.last_name,e.email,e.status,e.deleted_at,e.role_id,
           r.role_name,d.driver_id,d.deleted_at AS driver_deleted,to_jsonb(e) AS employee_snapshot,
           to_jsonb(d) AS driver_snapshot
      FROM employees e
      LEFT JOIN roles r ON r.role_id=e.role_id
      LEFT JOIN drivers d ON d.employee_id=e.employee_id
     WHERE (r.role_name='driver' AND e.employee_id<>ALL($1::int[])) OR e.role_id IS NULL
     ORDER BY e.employee_id`, [owned]);
  const oldDrivers = rows.filter((row) => row.role_name === "driver");
  const unassigned = rows.filter((row) => row.role_id === null);
  if (oldDrivers.length !== 23) throw new Error(`Expected 23 old driver accounts, found ${oldDrivers.length}`);
  if (unassigned.length !== 54) throw new Error(`Expected 54 unassigned accounts, found ${unassigned.length}`);
  return { ledger, oldDrivers, unassigned, owned };
}

async function foreignKeys(db) {
  const { rows } = await db.query(`
    SELECT child.relname AS child_table,parent.relname AS parent_table,
           child_col.attname AS child_column,parent_col.attname AS parent_column,
           con.confdeltype AS delete_action
      FROM pg_constraint con
      JOIN pg_class child ON child.oid=con.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
      JOIN pg_class parent ON parent.oid=con.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
      JOIN pg_attribute child_col ON child_col.attrelid=child.oid AND child_col.attnum=con.conkey[1]
      JOIN pg_attribute parent_col ON parent_col.attrelid=parent.oid AND parent_col.attnum=con.confkey[1]
     WHERE con.contype='f' AND array_length(con.conkey,1)=1 AND array_length(con.confkey,1)=1
       AND child_ns.nspname='public' AND parent_ns.nspname='public'
       AND parent.relname IN ('employees','drivers')
     ORDER BY parent.relname,child.relname,child_col.attname`);
  return rows;
}

async function referenceReport(db, targets, fks) {
  const employeeIds = targets.oldDrivers.concat(targets.unassigned).map((row) => String(row.employee_id));
  const driverIds = targets.oldDrivers.filter((row) => row.driver_id !== null).map((row) => String(row.driver_id));
  const references = [];
  for (const fk of fks) {
    const ids = fk.parent_table === "employees" ? employeeIds : driverIds;
    if (!ids.length) continue;
    const { rows } = await db.query(`SELECT ${quote(fk.child_column)}::text AS parent_id,COUNT(*)::int AS count FROM ${quote(fk.child_table)} WHERE ${quote(fk.child_column)}::text=ANY($1::text[]) GROUP BY ${quote(fk.child_column)} ORDER BY ${quote(fk.child_column)}`, [ids]);
    if (rows.length) references.push({ ...fk, rows });
  }
  return references;
}

function digest(plan) {
  return createHash("sha256").update(JSON.stringify({
    oldDriverIds: plan.oldDrivers.map((row) => row.employee_id),
    unassignedIds: plan.unassigned.map((row) => row.employee_id),
    references: plan.references,
  })).digest("hex").slice(0, 16);
}

async function buildPlan(db) {
  const targets = await readTargets(db);
  const references = await referenceReport(db, targets, await foreignKeys(db));
  const unassignedIds = new Set(targets.unassigned.map((row) => String(row.employee_id)));
  const hardDeleteBlockers = references.filter((ref) => ref.parent_table === "employees" &&
    ref.child_table !== "audit_logs" && ref.rows.some((row) => unassignedIds.has(String(row.parent_id))));
  const auditDetach = references.find((ref) => ref.parent_table === "employees" && ref.child_table === "audit_logs") ?? null;
  const detachAuditEmployeeIds = (auditDetach?.rows ?? []).map((row) => row.parent_id).filter((id) => unassignedIds.has(String(id)));
  const detachAuditRowCount = (auditDetach?.rows ?? []).filter((row) => unassignedIds.has(String(row.parent_id)))
    .reduce((total, row) => total + Number(row.count), 0);
  const plan = {
    readOnly: true, cleanupKey: CLEANUP_KEY,
    oldDrivers: targets.oldDrivers.map(({ employee_id, first_name, last_name, email, status, deleted_at, driver_id, driver_deleted }) =>
      ({ employee_id, name: `${first_name} ${last_name}`, email, status, deleted_at, driver_id, driver_deleted, retiredEmail: RETIRED_EMAIL(employee_id) })),
    unassigned: targets.unassigned.map(({ employee_id, email, deleted_at }) => ({ employee_id, email, deleted_at })),
    hardDeleteUnassigned: targets.unassigned.map((row) => row.employee_id),
    retireOldDrivers: targets.oldDrivers.map((row) => row.employee_id),
    references,
    hardDeleteBlockers,
    detachAuditEmployeeIds, detachAuditRowCount,
    preservedSecurityTables: [...SECURITY_TABLES].sort(),
  };
  return { ...plan, digest: digest({ ...targets, references }) };
}

loadEnvLocal();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const command = process.argv[2] ?? "plan";
if (!["plan", "apply"].includes(command)) throw new Error("Use plan or apply");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
try {
  await db.query(command === "plan" ? "BEGIN READ ONLY" : "BEGIN");
  if (command === "apply") await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CLEANUP_KEY]);
  const plan = await buildPlan(db);
  if (command === "plan") {
    console.log(JSON.stringify(plan, null, 2));
    await db.query("ROLLBACK");
  } else {
    if (!process.argv.includes(`--apply=${plan.digest}`)) throw new Error(`Old-account cleanup requires --apply=${plan.digest}`);
    if (plan.hardDeleteBlockers.length) throw new Error(`Hard deletion blocked by exact FK references: ${JSON.stringify(plan.hardDeleteBlockers)}`);
    const targets = await readTargets(db);
    await mkdir(dirname(BACKUP_PATH), { recursive: true });
    await writeFile(BACKUP_PATH, JSON.stringify({ digest: plan.digest, oldDrivers: targets.oldDrivers, unassigned: targets.unassigned }, null, 2));
    const oldDriverIds = plan.retireOldDrivers;
    const retired = await db.query(`UPDATE employees SET email=('retired-driver-' || employee_id || '@example.invalid'), status='Inactive', deleted_at=COALESCE(deleted_at,NOW()), auth_version=auth_version+1, updated_at=NOW() WHERE employee_id=ANY($1::int[])`, [oldDriverIds]);
    if (retired.rowCount !== oldDriverIds.length) throw new Error("Old driver retirement count changed");
    await db.query("UPDATE drivers SET deleted_at=COALESCE(deleted_at,NOW()) WHERE employee_id=ANY($1::int[])", [oldDriverIds]);
    await db.query("UPDATE device_tokens SET active=false WHERE employee_id=ANY($1::int[])", [oldDriverIds]);
    await db.query("DELETE FROM password_reset_tokens WHERE employee_id=ANY($1::int[]) AND used_at IS NULL", [oldDriverIds]);
    await db.query("UPDATE web_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=ANY($1::int[]) AND revoked_at IS NULL", [oldDriverIds]);
    await db.query("UPDATE mobile_refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=ANY($1::int[]) AND revoked_at IS NULL", [oldDriverIds]);
    await db.query("UPDATE trusted_web_devices SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=ANY($1::int[]) AND revoked_at IS NULL", [oldDriverIds]);
    const unassignedIds = plan.hardDeleteUnassigned;
    if (unassignedIds.length) {
      const auditRows = await db.query("UPDATE audit_logs SET employee_id=NULL WHERE employee_id=ANY($1::int[])", [unassignedIds]);
      const result = await db.query("DELETE FROM employees WHERE employee_id=ANY($1::int[]) AND role_id IS NULL AND deleted_at IS NOT NULL", [unassignedIds]);
      if (result.rowCount !== unassignedIds.length) throw new Error("Unassigned account deletion count changed");
      if (auditRows.rowCount !== plan.detachAuditRowCount) throw new Error("Audit actor detachment count changed");
    }
    await db.query("INSERT INTO system_settings(setting_key,setting_value) VALUES($1,$2::jsonb) ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value", [CLEANUP_KEY, JSON.stringify({ version: 1, state: "applied", digest: plan.digest, retiredOldDrivers: oldDriverIds, deletedUnassigned: unassignedIds, appliedAt: new Date().toISOString() })]);
    await db.query("COMMIT");
    console.log(JSON.stringify({ state: "old-accounts-cleaned", digest: plan.digest, retiredOldDrivers: oldDriverIds.length, deletedUnassigned: unassignedIds.length, backup: BACKUP_PATH, securityTables: "preserved" }, null, 2));
  }
} catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
finally { db.release(); await pool.end(); }
