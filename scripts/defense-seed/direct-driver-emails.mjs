import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { loadEnvLocal } from "../load-env.mjs";
import { DEFENSE_KEY, ROTATION_KEY } from "./name-accounts-logic.mjs";
import { DIRECT_DRIVER_KEYS, DIRECT_EMAIL_KEY, directDriverEmail, directEmailDigest, directEmailEventKey, gmailMailboxKey } from "./direct-driver-email-logic.mjs";

const BACKUP_PATH = join(process.cwd(), "scratch", "defense-direct-driver-emails-backup.json");
const command = process.argv[2] ?? "plan";
if (!["plan", "apply", "verify", "rollback"].includes(command)) throw new Error("Use plan | apply | verify | rollback");

loadEnvLocal();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();

async function readSetting(key) {
  const { rows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1", [key]);
  return rows[0]?.setting_value ?? null;
}

async function buildPlan() {
  const defense = await readSetting(DEFENSE_KEY);
  const previous = await readSetting(ROTATION_KEY);
  const current = await readSetting(DIRECT_EMAIL_KEY);
  if (!defense || defense.state === "media_cleanup") throw new Error("A complete defense seed ledger is required");
  if (previous?.state !== "applied" || previous.targets?.length !== 10) throw new Error("The original ten-account rotation ledger is required");
  if (current) throw new Error(`Direct-email rotation ledger already exists with state ${current.state}`);
  const prior = new Map(previous.targets.map((target) => [target.driver_key, target]));
  const keys = DIRECT_DRIVER_KEYS.map((key) => {
    const target = prior.get(key);
    if (!target || defense.semantic?.[key]?.id !== target.driver_id) throw new Error(`Missing owned prior account for ${key}`);
    if (!defense.ids?.employees?.includes(target.employee_id)) throw new Error(`Employee ${target.employee_id} is not defense-owned`);
    return target;
  });
  const { rows } = await db.query(`
    SELECT d.driver_id, e.employee_id, e.first_name, e.last_name, e.email, e.status,
           e.deleted_at, e.auth_version, e.password_hash IS NOT NULL AS has_password, r.role_name
      FROM drivers d JOIN employees e ON e.employee_id=d.employee_id
      LEFT JOIN roles r ON r.role_id=e.role_id
     WHERE d.driver_id=ANY($1::int[])`, [keys.map((target) => target.driver_id)]);
  const byEmployee = new Map(rows.map((row) => [row.employee_id, row]));
  const errors = [];
  const targets = keys.map((priorTarget) => {
    const row = byEmployee.get(priorTarget.employee_id);
    if (!row || row.driver_id !== priorTarget.driver_id) {
      errors.push(`${priorTarget.driver_key} employee/driver link changed`);
      return null;
    }
    if (row.deleted_at || row.status !== "Active" || row.role_name !== "driver") errors.push(`${priorTarget.driver_key} is not an active driver`);
    if (row.first_name !== priorTarget.first_name || row.last_name !== priorTarget.last_name) errors.push(`${priorTarget.driver_key} name changed`);
    if (row.email?.toLowerCase() !== priorTarget.new_email?.toLowerCase()) errors.push(`${priorTarget.driver_key} no longer has its recorded plus alias`);
    return { driver_key: priorTarget.driver_key, driver_id: row.driver_id, employee_id: row.employee_id,
      first_name: row.first_name, last_name: row.last_name, old_email: row.email,
      new_email: directDriverEmail({ ...row, driver_key: priorTarget.driver_key }),
      auth_version: String(row.auth_version), has_password: row.has_password };
  }).filter(Boolean);
  if (targets.length !== 7) errors.push("Expected seven exact driver accounts");
  if (targets.find((target) => target.driver_key === "D04")?.new_email !== "nico.bautista@gmail.com") errors.push("D04 is not Nico Bautista");
  if (new Set(targets.map((target) => target.new_email)).size !== 7) errors.push("Direct email addresses collide");
  const { rows: holders } = await db.query("SELECT employee_id, email FROM employees WHERE lower(email)=ANY($1::text[])",
    [targets.map((target) => target.new_email)]);
  if (holders.length) errors.push(`Direct email already held by employee ${holders.map((holder) => holder.employee_id).join(",")}`);
  const { rows: gmailHolders } = await db.query("SELECT employee_id, email FROM employees WHERE lower(email) LIKE '%@gmail.com' OR lower(email) LIKE '%@googlemail.com'");
  const mailboxKeys = new Set(targets.map((target) => gmailMailboxKey(target.new_email)));
  const ownedIds = new Set(targets.map((target) => target.employee_id));
  const equivalent = gmailHolders.filter((row) => !ownedIds.has(row.employee_id) && mailboxKeys.has(gmailMailboxKey(row.email)));
  if (equivalent.length) errors.push(`A Gmail-equivalent inbox is held by employee ${equivalent.map((row) => row.employee_id).join(",")}`);
  return { targets, errors, digest: directEmailDigest(targets) };
}

async function updateDefenseSnapshots(targets, direction) {
  const { rows: ledgerRows } = await db.query("SELECT setting_value FROM system_settings WHERE setting_key=$1 FOR UPDATE", [DEFENSE_KEY]);
  const defense = ledgerRows[0]?.setting_value;
  if (!defense?.snapshots?.employees) throw new Error("Defense employee snapshots missing");
  for (const target of targets) {
    const expectedEmail = direction === "apply" ? target.new_email : target.old_email;
    const { rows } = await db.query("SELECT to_jsonb(e) AS snapshot FROM employees e WHERE e.employee_id=$1 AND e.email=$2", [target.employee_id, expectedEmail]);
    if (rows.length !== 1) throw new Error(`Employee ${target.employee_id} snapshot mismatch`);
    defense.snapshots.employees[String(target.employee_id)] = rows[0].snapshot;
  }
  defense.directEmailRotation = { state: direction === "apply" ? "applied" : "rolled_back",
    digest: directEmailDigest(targets), employeeIds: targets.map((target) => target.employee_id), recordedAt: new Date().toISOString() };
  await db.query("UPDATE system_settings SET setting_value=$2::jsonb WHERE setting_key=$1", [DEFENSE_KEY, JSON.stringify(defense)]);
}

async function revokeTargetSessions(employeeId) {
  await db.query("UPDATE device_tokens SET active=false WHERE employee_id=$1 AND active=true", [employeeId]);
  await db.query("DELETE FROM password_reset_tokens WHERE employee_id=$1 AND used_at IS NULL", [employeeId]);
  await db.query("UPDATE web_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=$1 AND revoked_at IS NULL", [employeeId]);
  await db.query("UPDATE mobile_refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=$1 AND revoked_at IS NULL", [employeeId]);
  await db.query("UPDATE trusted_web_devices SET revoked_at=COALESCE(revoked_at,NOW()) WHERE employee_id=$1 AND revoked_at IS NULL", [employeeId]);
}

async function verifyApplied(ledger) {
  if (ledger?.state !== "applied" || ledger.targets?.length !== 7) throw new Error("No applied direct-email rotation ledger");
  const { rows } = await db.query(`SELECT e.employee_id, e.email, e.auth_version, e.status, e.deleted_at, r.role_name,
      e.password_hash IS NOT NULL AS has_password FROM employees e LEFT JOIN roles r ON r.role_id=e.role_id
      WHERE e.employee_id=ANY($1::int[])`, [ledger.targets.map((target) => target.employee_id)]);
  const byId = new Map(rows.map((row) => [row.employee_id, row]));
  const errors = [];
  for (const target of ledger.targets) {
    const row = byId.get(target.employee_id);
    if (!row || row.email?.toLowerCase() !== target.new_email || String(row.auth_version) !== target.new_auth_version ||
      row.status !== "Active" || row.deleted_at || row.role_name !== "driver" || row.has_password !== target.has_password) {
      errors.push(`${target.driver_key} account differs from the applied direct-email rotation`);
    }
  }
  return { state: ledger.state, digest: ledger.digest, checked: ledger.targets.length, errors };
}

try {
  if (command === "plan" || command === "verify") {
    await db.query("BEGIN READ ONLY");
    if (command === "plan") {
      const plan = await buildPlan();
      console.log(JSON.stringify({ readOnly: true, digest: plan.digest,
        targets: plan.targets.map(({ driver_key, employee_id, first_name, last_name, old_email, new_email }) =>
          ({ driver_key, employee_id, name: `${first_name} ${last_name}`, old_email, new_email })),
        errors: plan.errors, ownership: "unverified; each standalone inbox must be controlled before apply" }, null, 2));
      if (plan.errors.length) process.exitCode = 1;
    } else {
      const result = await verifyApplied(await readSetting(DIRECT_EMAIL_KEY));
      console.log(JSON.stringify(result, null, 2));
      if (result.errors.length) process.exitCode = 1;
    }
    await db.query("ROLLBACK");
  } else {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [DIRECT_EMAIL_KEY]);
    const { writeAuditRequired } = await import("@/lib/audit");
    if (command === "apply") {
      const plan = await buildPlan();
      if (!process.argv.includes(`--apply=${plan.digest}`) || !process.argv.includes("--inboxes-confirmed"))
        throw new Error(`Apply requires --apply=${plan.digest} and --inboxes-confirmed`);
      if (plan.errors.length) throw new Error(plan.errors.join("; "));
      await mkdir(dirname(BACKUP_PATH), { recursive: true });
      await writeFile(BACKUP_PATH, JSON.stringify({ digest: plan.digest, targets: plan.targets }, null, 2));
      const applied = [];
      for (const target of plan.targets) {
        const result = await db.query(`UPDATE employees SET email=$1, auth_version=auth_version+1, updated_at=NOW()
          WHERE employee_id=$2 AND email=$3 AND auth_version=$4`, [target.new_email, target.employee_id, target.old_email, target.auth_version]);
        if (result.rowCount !== 1) throw new Error(`${target.driver_key} changed after planning`);
        await revokeTargetSessions(target.employee_id);
        await writeAuditRequired(db, null, null, { action: "update", resource: "employees", resourceId: target.employee_id,
          oldValues: { changed_fields: ["email"] }, newValues: { changed_fields: ["email"], reason_code: "defense_direct_driver_email" },
          eventKey: directEmailEventKey(target.employee_id, "apply") });
        applied.push({ ...target, new_auth_version: String(BigInt(target.auth_version) + 1n) });
      }
      await updateDefenseSnapshots(applied, "apply");
      await db.query("INSERT INTO system_settings(setting_key,setting_value) VALUES($1,$2::jsonb)",
        [DIRECT_EMAIL_KEY, JSON.stringify({ version: 1, state: "applied", digest: plan.digest,
          appliedAt: new Date().toISOString(), targets: applied })]);
      await db.query("COMMIT");
      console.log(JSON.stringify({ state: "applied", digest: plan.digest, changed: applied.map((target) => target.driver_key), backup: BACKUP_PATH }, null, 2));
    } else {
      const ledger = await readSetting(DIRECT_EMAIL_KEY);
      if (!process.argv.includes(`--rollback=${ledger?.digest}`)) throw new Error(`Rollback requires --rollback=${ledger?.digest}`);
      const verified = await verifyApplied(ledger);
      if (verified.errors.length) throw new Error(verified.errors.join("; "));
      for (const target of ledger.targets) {
        const result = await db.query(`UPDATE employees SET email=$1, auth_version=auth_version+1, updated_at=NOW()
          WHERE employee_id=$2 AND email=$3 AND auth_version=$4`, [target.old_email, target.employee_id, target.new_email, target.new_auth_version]);
        if (result.rowCount !== 1) throw new Error(`${target.driver_key} changed before rollback`);
        await revokeTargetSessions(target.employee_id);
        await writeAuditRequired(db, null, null, { action: "update", resource: "employees", resourceId: target.employee_id,
          oldValues: { changed_fields: ["email"] }, newValues: { changed_fields: ["email"], reason_code: "defense_direct_driver_email_rollback" },
          eventKey: directEmailEventKey(target.employee_id, "rollback") });
      }
      await updateDefenseSnapshots(ledger.targets, "rollback");
      await db.query("UPDATE system_settings SET setting_value=$2::jsonb WHERE setting_key=$1",
        [DIRECT_EMAIL_KEY, JSON.stringify({ ...ledger, state: "rolled_back", rolledBackAt: new Date().toISOString() })]);
      await db.query("COMMIT");
      console.log(JSON.stringify({ state: "rolled_back", digest: ledger.digest, restored: ledger.targets.length }, null, 2));
    }
  }
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  db.release();
  await pool.end();
}
