import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";

const DEFENSE_KEY = "seed:defense-2026-10";
const CLEANUP_KEY = "seed:defense-hard-delete-old-drivers-2026-10";
const BACKUP_PATH = join(process.cwd(), "scratch", "defense-hard-delete-old-drivers-backup.json");
const DETACH_EMPLOYEE_FKS = new Set([
  "audit_logs.employee_id",
  "notifications.employee_id",
  "employees.created_by",
  "employees.updated_by",
]);
const quote = (value) => `"${value.replaceAll('"', '""')}"`;

async function catalog(db) {
  const { rows } = await db.query(`
    SELECT child.relname AS child_table,parent.relname AS parent_table,
           child_col.attname AS child_column,parent_col.attname AS parent_column,
           con.confdeltype AS delete_action,
           child_col.attnotnull AS child_not_null
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

async function targets(db) {
  const { rows: defenseRows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1", [DEFENSE_KEY]);
  const owned = defenseRows[0]?.setting_value?.ids?.employees ?? [];
  if (owned.length !== 10) throw new Error("Defense ledger must own exactly 10 employees");
  const { rows: employees } = await db.query(`
    SELECT e.employee_id,e.first_name,e.last_name,e.email,e.status,e.deleted_at,e.role_id,
           r.role_name,to_jsonb(e) AS employee_snapshot,d.driver_id,d.deleted_at AS driver_deleted,
           to_jsonb(d) AS driver_snapshot
      FROM employees e
      JOIN roles r ON r.role_id=e.role_id
      LEFT JOIN drivers d ON d.employee_id=e.employee_id
     WHERE r.role_name='driver' AND e.employee_id<>ALL($1::int[])
       AND e.deleted_at IS NOT NULL AND e.email LIKE 'retired-driver-%@example.invalid'
     ORDER BY e.employee_id`, [owned]);
  if (employees.length !== 23) throw new Error(`Expected 23 retired old driver accounts, found ${employees.length}`);
  return { employees, driverIds: employees.flatMap((row) => row.driver_id === null ? [] : [row.driver_id]), employeeIds: employees.map((row) => row.employee_id) };
}

async function references(db, t, fks) {
  const result = [];
  for (const fk of fks) {
    const ids = fk.parent_table === "employees" ? t.employeeIds : t.driverIds;
    if (!ids.length) continue;
    const { rows } = await db.query(`SELECT ${quote(fk.child_column)}::text AS parent_id,COUNT(*)::int AS count FROM ${quote(fk.child_table)} WHERE ${quote(fk.child_column)}::text=ANY($1::text[]) GROUP BY ${quote(fk.child_column)} ORDER BY ${quote(fk.child_column)}`, [ids.map(String)]);
    if (rows.length) result.push({ ...fk, rows });
  }
  return result;
}

function digest(plan) {
  return createHash("sha256").update(JSON.stringify({ employeeIds: plan.employeeIds, driverIds: plan.driverIds, references: plan.references })).digest("hex").slice(0, 16);
}

async function buildPlan(db) {
  const t = await targets(db);
  const refs = await references(db, t, await catalog(db));
  const blockers = refs.filter((ref) => {
    const key = `${ref.child_table}.${ref.child_column}`;
    if (key === "drivers.employee_id") return false;
    if (ref.delete_action === "c") return false;
    if (DETACH_EMPLOYEE_FKS.has(key) && !ref.child_not_null) return false;
    return true;
  });
  return {
    readOnly: true, cleanupKey: CLEANUP_KEY,
    employeeIds: t.employeeIds, driverIds: t.driverIds,
    employees: t.employees.map(({ employee_id, first_name, last_name, email, status, deleted_at, driver_id, driver_deleted }) =>
      ({ employee_id, name: `${first_name} ${last_name}`, email, status, deleted_at, driver_id, driver_deleted })),
    references: refs, blockers,
    detachEmployeeFks: [...DETACH_EMPLOYEE_FKS],
    note: "Hard-deletes only the 23 exact retired driver accounts. Driver-consent rows linked to their old driver profiles may be removed by their declared FK cascade; audit/security rows are preserved or detached, never globally purged.",
  };
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
  const planDigest = digest(plan);
  if (command === "plan") {
    console.log(JSON.stringify({ ...plan, digest: planDigest }, null, 2));
    await db.query("ROLLBACK");
  } else {
    if (!process.argv.includes(`--apply=${planDigest}`)) throw new Error(`Hard-delete requires --apply=${planDigest}`);
    if (plan.blockers.length) throw new Error(`Hard-delete blocked by exact FK references: ${JSON.stringify(plan.blockers)}`);
    const t = await targets(db);
    await mkdir(dirname(BACKUP_PATH), { recursive: true });
    await writeFile(BACKUP_PATH, JSON.stringify({ digest: planDigest, employees: t.employees, references: plan.references }, null, 2));
    for (const fk of plan.detachEmployeeFks) {
      const [table, column] = fk.split(".");
      await db.query(`UPDATE ${quote(table)} SET ${quote(column)}=NULL WHERE ${quote(column)}=ANY($1::int[])`, [plan.employeeIds]);
    }
    if (plan.driverIds.length) {
      const result = await db.query("DELETE FROM drivers WHERE driver_id=ANY($1::int[]) AND deleted_at IS NOT NULL", [plan.driverIds]);
      if (result.rowCount !== plan.driverIds.length) throw new Error("Old driver profile deletion count changed");
    }
    const result = await db.query("DELETE FROM employees WHERE employee_id=ANY($1::int[]) AND role_id=(SELECT role_id FROM roles WHERE role_name='driver') AND deleted_at IS NOT NULL", [plan.employeeIds]);
    if (result.rowCount !== plan.employeeIds.length) throw new Error("Old driver employee deletion count changed");
    await db.query("INSERT INTO system_settings(setting_key,setting_value) VALUES($1,$2::jsonb) ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value", [CLEANUP_KEY, JSON.stringify({ version: 1, state: "applied", digest: planDigest, deletedEmployees: plan.employeeIds, deletedDrivers: plan.driverIds, appliedAt: new Date().toISOString() })]);
    await db.query("COMMIT");
    console.log(JSON.stringify({ state: "old-drivers-hard-deleted", digest: planDigest, deletedEmployees: plan.employeeIds.length, deletedDriverProfiles: plan.driverIds.length, backup: BACKUP_PATH }, null, 2));
  }
} catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
finally { db.release(); await pool.end(); }
