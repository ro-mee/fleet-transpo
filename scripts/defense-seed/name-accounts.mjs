import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { BASE_INBOXES, DEFENSE_KEY, DIRECT, desiredEmail, digest, eventKey, ROTATION_KEY } from "./name-accounts-logic.mjs";

const BACKUP_PATH = join(process.cwd(), "scratch", "defense-name-accounts-backup.json");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function rotationLedger(db) {
  const { rows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1", [ROTATION_KEY]);
  return rows[0]?.setting_value ?? null;
}

async function buildPlan(db) {
  const defense = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1", [DEFENSE_KEY]);
  const seed = defense.rows[0]?.setting_value;
  if (!seed || seed.state === "media_cleanup") throw new Error("Defense seed must be present and complete before account rotation");
  const employeeIds = seed.ids?.employees ?? [];
  const driverIds = seed.ids?.drivers ?? [];
  if (employeeIds.length !== 10 || driverIds.length !== 10) throw new Error("Defense ledger must own exactly 10 employees and drivers");
  const { rows } = await db.query(`
    SELECT d.driver_id, d.driver_id::text AS driver_key, e.employee_id, e.first_name, e.last_name,
           e.email, e.status, e.deleted_at, e.auth_version, e.password_hash IS NOT NULL AS has_password,
           r.role_name
      FROM drivers d JOIN employees e ON e.employee_id=d.employee_id
      LEFT JOIN roles r ON r.role_id=e.role_id
     WHERE d.driver_id=ANY($1::int[]) AND e.employee_id=ANY($2::int[])
     ORDER BY d.driver_id`, [driverIds, employeeIds]);
  const semantic = seed.semantic ?? {};
  const byKey = new Map(Object.entries(semantic).filter(([key]) => /^D\d{2}$/.test(key)).map(([key, value]) => [String(value.id), key]));
  const drivers = rows.map((row) => ({ ...row, driver_key: byKey.get(String(row.driver_id)) ?? null }));
  const errors = [];
  if (drivers.length !== 10) errors.push(`Expected 10 owned driver employees, found ${drivers.length}`);
  if (drivers.some((row) => !row.driver_key)) errors.push("Every owned driver must have a D01-D10 semantic key");
  if (drivers.some((row) => row.deleted_at || row.status !== "Active" || row.role_name !== "driver")) errors.push("Every target employee must be active and have the driver role");
  const targets = drivers.map((row) => ({
    driver_key: row.driver_key, driver_id: row.driver_id, employee_id: row.employee_id,
    first_name: row.first_name, last_name: row.last_name, old_email: row.email,
    new_email: desiredEmail({ ...row, driver_key: row.driver_key }),
    auth_version: row.auth_version, has_password: row.has_password,
  })).sort((a, b) => a.driver_key.localeCompare(b.driver_key));
  if (targets.some((row) => !EMAIL_RE.test(row.new_email))) errors.push("A target email is invalid");
  const unique = new Set(targets.map((row) => row.new_email.toLowerCase()));
  if (unique.size !== targets.length) errors.push("Target emails are not distinct");
  const { rows: holders } = await db.query(`SELECT employee_id,email,deleted_at FROM employees
    WHERE lower(email)=ANY($1::text[]) AND employee_id<>ALL($2::int[])`, [targets.map((row) => row.new_email.toLowerCase()), employeeIds]);
  if (holders.length) errors.push(`Target email already held by employee ${holders.map((row) => row.employee_id).join(",")}`);
  const { rows: baseHolders } = await db.query("SELECT email FROM employees WHERE lower(email)=ANY($1::text[])", [BASE_INBOXES.map((email) => email.toLowerCase())]);
  const expectedBase = new Set(Object.values(DIRECT).map((email) => email.toLowerCase()));
  if (baseHolders.some((row) => !expectedBase.has(row.email.toLowerCase()))) errors.push("A supplied base inbox is held by an unexpected account");
  const plan = { rotationKey: ROTATION_KEY, targets, errors, baseInboxes: BASE_INBOXES };
  return { ...plan, digest: digest(targets) };
}

loadEnvLocal();
const command = process.argv[2] ?? "plan";
if (!["plan", "apply", "verify", "rollback", "record"].includes(command)) throw new Error("Use plan | apply | verify | rollback | record");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
try {
  if (command === "plan" || command === "verify") {
    await db.query("BEGIN READ ONLY");
    const plan = await buildPlan(db);
    const ledger = await rotationLedger(db);
    if (command === "plan") {
      console.log(JSON.stringify({ readOnly: true, digest: plan.digest, rotationKey: ROTATION_KEY,
        targets: plan.targets.map(({ driver_key, driver_id, employee_id, first_name, last_name, old_email, new_email, auth_version, has_password }) =>
          ({ driver_key, driver_id, employee_id, name: `${first_name} ${last_name}`, old_email, new_email, auth_version, has_password })),
        errors: plan.errors, note: "Passwords are unchanged and never printed. D04-D10 are Gmail plus aliases routed to the supplied inboxes." }, null, 2));
      if (plan.errors.length) process.exitCode = 1;
    } else {
      const mismatches = plan.targets.filter((row) => row.old_email.toLowerCase() !== row.new_email.toLowerCase());
      console.log(JSON.stringify({ state: ledger?.state ?? "absent", digest: plan.digest,
        appliedDigest: ledger?.digest ?? null, pendingTargets: mismatches.map((row) => ({ driver_key: row.driver_key, employee_id: row.employee_id })),
        emailsMatch: mismatches.length === 0, errors: plan.errors }, null, 2));
      if (plan.errors.length || !ledger || ledger.state !== "applied" || ledger.digest !== plan.digest || mismatches.length) process.exitCode = 1;
    }
    await db.query("ROLLBACK");
  } else {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ROTATION_KEY]);
    const plan = await buildPlan(db);
    const existing = await rotationLedger(db);
    const guardFlag = command === "record" ? `--record=${plan.digest}` : `--apply=${plan.digest}`;
    if (!process.argv.includes(guardFlag)) throw new Error(`Account rotation requires current ${guardFlag}`);
    if (plan.errors.length) throw new Error(`Account rotation blocked: ${plan.errors.join("; ")}`);
    if (command === "record") {
      const rotation = await rotationLedger(db);
      if (!rotation || rotation.state !== "applied" || rotation.digest !== plan.digest) throw new Error("Applied name-based account rotation ledger required");
      const { rows: defenseRows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1 FOR UPDATE", [DEFENSE_KEY]);
      const defenseLedger = defenseRows[0]?.setting_value;
      if (!defenseLedger?.snapshots?.employees) throw new Error("Defense employee snapshots are missing");
      for (const target of plan.targets) {
        const { rows } = await db.query("SELECT to_jsonb(e) AS snapshot FROM employees e WHERE e.employee_id=$1 AND e.email=$2", [target.employee_id, target.new_email]);
        if (rows.length !== 1) throw new Error(`Employee ${target.employee_id} is not at the rotated email`);
        defenseLedger.snapshots.employees[String(target.employee_id)] = rows[0].snapshot;
      }
      defenseLedger.accountRotation = { digest: plan.digest, recordedAt: new Date().toISOString(), employeeIds: plan.targets.map((target) => target.employee_id) };
      await db.query("UPDATE system_settings SET setting_value=$2::jsonb WHERE setting_key=$1", [DEFENSE_KEY, JSON.stringify(defenseLedger)]);
      await db.query("COMMIT");
      console.log(JSON.stringify({ state: "defense-ledger-account-rotation-recorded", digest: plan.digest, employees: plan.targets.length }, null, 2));
    } else if (command === "apply") {
      if (existing) throw new Error(`Account rotation ledger already exists with state ${existing.state}; use verify or rollback`);
      await mkdir(dirname(BACKUP_PATH), { recursive: true });
      await writeFile(BACKUP_PATH, JSON.stringify({ digest: plan.digest, targets: plan.targets }, null, 2));
      const changed = [];
      for (const target of plan.targets) {
        const { rows } = await db.query(`SELECT e.email,e.auth_version FROM employees e WHERE e.employee_id=$1 FOR UPDATE`, [target.employee_id]);
        if (rows.length !== 1 || rows[0].email !== target.old_email || rows[0].auth_version !== target.auth_version) throw new Error(`Employee ${target.employee_id} changed after plan`);
        await db.query(`UPDATE employees SET email=$1,auth_version=auth_version+1,updated_at=NOW()
          WHERE employee_id=$2 AND email=$3 AND auth_version=$4`, [target.new_email, target.employee_id, target.old_email, target.auth_version]);
        await db.query(`UPDATE device_tokens SET active=false WHERE employee_id=$1 AND active=true`, [target.employee_id]);
        await db.query(`DELETE FROM password_reset_tokens WHERE employee_id=$1 AND used_at IS NULL`, [target.employee_id]);
        await db.query(`UPDATE web_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=$1 AND revoked_at IS NULL`, [target.employee_id]);
        await db.query(`UPDATE mobile_refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=$1 AND revoked_at IS NULL`, [target.employee_id]);
        await db.query(`UPDATE trusted_web_devices SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=$1 AND revoked_at IS NULL`, [target.employee_id]);
        const { writeAuditRequired } = await import("@/lib/audit");
        await writeAuditRequired(db, null, null, { action: "update", resource: "employees", resourceId: target.employee_id,
          oldValues: { changed_fields: ["email"] }, newValues: { changed_fields: ["email"], reason_code: "defense_name_based_account_mapping" },
          eventKey: eventKey(target.employee_id, "apply") });
        changed.push({ driver_key: target.driver_key, employee_id: target.employee_id });
      }
      const ledger = { version: 1, state: "applied", rotationKey: ROTATION_KEY, digest: plan.digest,
        appliedAt: new Date().toISOString(), targets: plan.targets.map(({ driver_key, driver_id, employee_id, first_name, last_name, old_email, new_email, auth_version }) =>
          ({ driver_key, driver_id, employee_id, first_name, last_name, old_email, new_email, auth_version })) };
      await db.query("INSERT INTO system_settings(setting_key,setting_value) VALUES($1,$2::jsonb)", [ROTATION_KEY, JSON.stringify(ledger)]);
      await db.query("COMMIT");
      console.log(JSON.stringify({ state: "applied", digest: plan.digest, changed, backup: BACKUP_PATH, passwords: "unchanged" }, null, 2));
    } else {
      if (!existing || existing.state !== "applied") throw new Error("No applied account rotation ledger found");
      const rollback = existing.targets ?? [];
      for (const target of rollback) {
        const { rows } = await db.query("SELECT email,auth_version FROM employees WHERE employee_id=$1 FOR UPDATE", [target.employee_id]);
        if (rows.length !== 1 || rows[0].email !== target.new_email) throw new Error(`Rollback refused for employee ${target.employee_id}: email changed`);
        await db.query("UPDATE employees SET email=$1,auth_version=auth_version+1,updated_at=NOW() WHERE employee_id=$2 AND email=$3", [target.old_email, target.employee_id, target.new_email]);
        await db.query("UPDATE device_tokens SET active=false WHERE employee_id=$1 AND active=true", [target.employee_id]);
        await db.query("UPDATE web_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=$1 AND revoked_at IS NULL", [target.employee_id]);
        await db.query("UPDATE mobile_refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=$1 AND revoked_at IS NULL", [target.employee_id]);
        await db.query("UPDATE trusted_web_devices SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=$1 AND revoked_at IS NULL", [target.employee_id]);
        const { writeAuditRequired } = await import("@/lib/audit");
        await writeAuditRequired(db, null, null, { action: "update", resource: "employees", resourceId: target.employee_id,
          oldValues: { changed_fields: ["email"] }, newValues: { changed_fields: ["email"], reason_code: "defense_name_based_account_mapping_rollback" },
          eventKey: eventKey(target.employee_id, "rollback") });
      }
      await db.query("UPDATE system_settings SET setting_value=$2::jsonb WHERE setting_key=$1", [ROTATION_KEY, JSON.stringify({ ...existing, state: "rolled_back", rolledBackAt: new Date().toISOString() })]);
      await db.query("COMMIT");
      console.log(JSON.stringify({ state: "rolled_back", digest: existing.digest, restored: rollback.length, passwords: "unchanged" }, null, 2));
    }
  }
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  throw error;
} finally { db.release(); await pool.end(); }
