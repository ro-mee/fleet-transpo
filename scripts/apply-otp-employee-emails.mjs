// One-off data fix: give three accounts a deliverable email address.
//
// Mandatory email OTP fails closed, so an account whose `employees.email` is a
// placeholder domain can never receive a code — and cannot use the email-based
// forgot-password flow to recover either. Three accounts with real roles were on
// undeliverable domains; the super_admin one is load-bearing, because
// /api/auth/reset-token (the break-glass path of last resort) needs an admin who
// can still sign in.
//
// The addresses live in .env.local (gitignored) and are read by KEY here, so no
// personal address is committed. Mirrors the app's own email-change behaviour:
// bump auth_version so existing sessions for these accounts cannot survive a
// change to the credential that identifies them.
//
// `employees.email` is UNIQUE, and this dataset has near-duplicate addresses, so
// each fix pre-checks who already holds the target and refuses with a message
// naming the holder rather than dying on a raw 23505. One refusal never aborts
// the remaining fixes.
//
// Run: node --import ./scripts/alias-loader.mjs scripts/apply-otp-employee-emails.mjs

import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

// Imported after loadEnvLocal so @/lib/db sees DATABASE_URL at module init.
const { query } = await import("@/lib/db");
const { writeAudit } = await import("@/lib/audit");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The expected role is asserted per row: if ids ever shift, this refuses rather
// than writing a personal address onto the wrong employee.
const FIXES = [
  { employeeId: 8, key: "OTP_FIX_SUPER_ADMIN_EMAIL", expectRole: "super_admin" },
  { employeeId: 48, key: "OTP_FIX_ADMIN_EMAIL", expectRole: "admin" },
  { employeeId: 1, key: "OTP_FIX_DRIVER_EMAIL", expectRole: "driver" },
];

async function applyFix(fix) {
  const target = process.env[fix.key];

  if (!target) return `x ${fix.key} is not set (.env.local)`;
  if (!EMAIL_RE.test(target)) return `x ${fix.key} is not a valid address`;

  const { rows } = await query(
    `SELECT e.email, e.status, e.deleted_at,
            coalesce(r.role_name, '(no role)') AS role_name
       FROM employees e
       LEFT JOIN roles r ON r.role_id = e.role_id
      WHERE e.employee_id = $1`,
    [fix.employeeId]
  );
  const row = rows[0];

  if (!row) return `x employee ${fix.employeeId} does not exist — refusing`;
  if (row.deleted_at) return `x employee ${fix.employeeId} is deleted — refusing`;
  if (row.role_name !== fix.expectRole) {
    return (
      `x employee ${fix.employeeId} has role "${row.role_name}", expected ` +
      `"${fix.expectRole}" — refusing (ids may have shifted)`
    );
  }
  if (row.email === target) {
    return `= employee ${fix.employeeId} already set to ${target} — no change`;
  }

  // employees.email is UNIQUE. Name the current holder instead of surfacing
  // a constraint violation the reader has to decode.
  const { rows: holders } = await query(
    `SELECT employee_id, deleted_at IS NOT NULL AS deleted
       FROM employees
      WHERE lower(email) = lower($1) AND employee_id <> $2`,
    [target, fix.employeeId]
  );
  if (holders.length) {
    const h = holders[0];
    return (
      `x ${target} is already held by employee ${h.employee_id}` +
      `${h.deleted ? " (deleted)" : ""} — refusing. ` +
      `Reassign or free that address first (employees_email_key is UNIQUE).`
    );
  }

  await query(
    `UPDATE employees
        SET email = $1, auth_version = auth_version + 1, updated_at = NOW()
      WHERE employee_id = $2`,
    [target, fix.employeeId]
  );

  // No request context here, so the actor is null and resourceId names the
  // subject — the same shape src/lib/auth.js uses for credential events.
  await writeAudit(null, null, {
    action: "update",
    resource: "employees",
    resourceId: fix.employeeId,
    oldValues: { email: row.email },
    newValues: { email: target, reason: "email_otp_rollout" },
  });

  return `+ employee ${fix.employeeId} (${row.role_name}): ${row.email} -> ${target}`;
}

let changed = 0;
let refused = 0;

for (const fix of FIXES) {
  let line;
  try {
    line = await applyFix(fix);
  } catch (e) {
    line = `x employee ${fix.employeeId} failed: ${e.message}`;
  }
  console.log(`  ${line}`);
  if (line.startsWith("+")) changed++;
  else if (line.startsWith("x")) refused++;
}

console.log(`\n${changed} updated, ${refused} refused.`);
if (changed) {
  console.log(
    "auth_version was bumped for each: any live session on those accounts is now invalid."
  );
}
process.exitCode = refused ? 1 : 0;
