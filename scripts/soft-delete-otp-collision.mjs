// One-off fix for the employees_email_key collision blocking the email-OTP rollout.
//
// `crypticalrome@gmail.com` is the address that should belong to the admin
// account (employee 48), but employee 7 currently holds it. It is employee 7's
// login credential and cannot simply be reassigned, because employees.email is
// NOT NULL and employees_email_key is a PLAIN unique index (not partial) — so
// soft-deleting employee 7 alone would NOT release the address. Its email must
// be moved off first.
//
// Employee 7 is being retired (its driver row, driver_id=4, is already Suspended
// with suspension_reason='license_expired', so it is not dispatchable today).
// This mirrors the app's own disable path in
// src/app/api/settings/users/route.js:74-99 — same columns, same session
// revocation — plus the email move, in one transaction.
//
// The parked address is on a reserved domain that cannot receive mail, so the
// retired account fails closed rather than silently holding a live address.
// Employee 7's original address is preserved in the audit log's oldValues.
//
// Run: node --import ./scripts/alias-loader.mjs scripts/soft-delete-otp-collision.mjs

import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const { withTransaction, query } = await import("@/lib/db");
const { writeAudit } = await import("@/lib/audit");

const HOLDER_ID = 7; // currently holds the address; being retired
const RECIPIENT_ID = 48; // admin that should own it
const TARGET_KEY = "OTP_FIX_ADMIN_EMAIL";
const PARKED_EMAIL = `deleted-employee-${HOLDER_ID}@example.com`;

const target = process.env[TARGET_KEY];

function fail(msg) {
  console.error(`x ${msg}`);
  process.exitCode = 1;
}

// ---- read the "before" state, and guard every assumption -------------------
const { rows: before } = await query(
  `SELECT e.employee_id, e.email, e.status, e.deleted_at, e.auth_version,
          coalesce(r.role_name, '(no role)') AS role_name
     FROM employees e
     LEFT JOIN roles r ON r.role_id = e.role_id
    WHERE e.employee_id = ANY($1::bigint[])`,
  [[HOLDER_ID, RECIPIENT_ID]]
);
const holder = before.find((r) => Number(r.employee_id) === HOLDER_ID);
const recipient = before.find((r) => Number(r.employee_id) === RECIPIENT_ID);

if (!target) throw new Error(`${TARGET_KEY} is not set (.env.local)`);
if (!holder) throw new Error(`employee ${HOLDER_ID} not found — nothing to retire`);
if (!recipient) throw new Error(`employee ${RECIPIENT_ID} not found`);
if (holder.deleted_at) throw new Error(`employee ${HOLDER_ID} is already deleted — refusing`);
if (recipient.deleted_at) throw new Error(`employee ${RECIPIENT_ID} is deleted — refusing`);
if (recipient.role_name !== "admin") {
  throw new Error(
    `employee ${RECIPIENT_ID} has role "${recipient.role_name}", expected "admin" — refusing`
  );
}
if (holder.email?.toLowerCase() !== target.toLowerCase()) {
  throw new Error(
    `employee ${HOLDER_ID} holds "${holder.email}", not "${target}" — refusing ` +
      `(the collision may already be resolved)`
  );
}
if (recipient.email?.toLowerCase() === target.toLowerCase()) {
  throw new Error(`employee ${RECIPIENT_ID} already holds ${target} — nothing to do`);
}

// ---- apply ----------------------------------------------------------------
const result = await withTransaction(async (tx) => {
  // 1. Release the address from the retired account. Must precede step 4,
  //    because employees_email_key is unique across all rows including deleted.
  const freed = await tx.query(
    `UPDATE employees SET email = $1, updated_at = NOW()
      WHERE employee_id = $2 AND lower(email) = lower($3)`,
    [PARKED_EMAIL, HOLDER_ID, target]
  );
  if (freed.rowCount !== 1) {
    throw new Error(`expected to release ${target} from employee ${HOLDER_ID}, freed ${freed.rowCount}`);
  }

  // 2. Retire the account, matching src/app/api/settings/users/route.js:76.
  const retired = await tx.query(
    `UPDATE employees
        SET deleted_at = COALESCE(deleted_at, NOW()),
            status = 'Inactive',
            auth_version = auth_version + 1,
            updated_at = NOW()
      WHERE employee_id = $1
      RETURNING employee_id, status, deleted_at`,
    [HOLDER_ID]
  );

  // 3. Revoke everything that could still authenticate as the retired account.
  //    web_sessions/trusted_web_devices are marked revoked; the app deletes
  //    mobile_refresh_tokens and unused password_reset_tokens instead.
  const revoked = {};
  revoked.web_sessions = (
    await tx.query(
      `UPDATE web_sessions SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE employee_id = $1 AND revoked_at IS NULL`,
      [HOLDER_ID]
    )
  ).rowCount;
  revoked.trusted_web_devices = (
    await tx.query(
      `UPDATE trusted_web_devices SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE employee_id = $1 AND revoked_at IS NULL`,
      [HOLDER_ID]
    )
  ).rowCount;
  revoked.mobile_refresh_tokens = (
    await tx.query(`DELETE FROM mobile_refresh_tokens WHERE employee_id = $1`, [HOLDER_ID])
  ).rowCount;
  revoked.password_reset_tokens = (
    await tx.query(
      `DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`,
      [HOLDER_ID]
    )
  ).rowCount;

  // 4. Now the address is free — give it to the admin account.
  const assigned = await tx.query(
    `UPDATE employees
        SET email = $1, auth_version = auth_version + 1, updated_at = NOW()
      WHERE employee_id = $2
      RETURNING employee_id, email`,
    [target, RECIPIENT_ID]
  );
  if (assigned.rowCount !== 1) {
    throw new Error(`failed to assign ${target} to employee ${RECIPIENT_ID}`);
  }

  return { retired: retired.rows[0], revoked, assigned: assigned.rows[0] };
});

// ---- audit (after commit, so a rollback cannot leave a false trail) --------
// No request context: actor is null and resourceId names the subject, matching
// the shape src/lib/auth.js uses for credential events.
await writeAudit(null, null, {
  action: "update",
  resource: "employees",
  resourceId: HOLDER_ID,
  oldValues: { email: holder.email, status: holder.status, deleted_at: holder.deleted_at },
  newValues: {
    email: PARKED_EMAIL,
    status: "Inactive",
    deleted_at: result.retired.deleted_at,
    reason: "email_otp_rollout_released_address",
  },
});
await writeAudit(null, null, {
  action: "update",
  resource: "employees",
  resourceId: RECIPIENT_ID,
  oldValues: { email: recipient.email },
  newValues: { email: target, reason: "email_otp_rollout" },
});

// ---- report ---------------------------------------------------------------
console.log(`+ employee ${HOLDER_ID} (${holder.role_name}) retired`);
console.log(`    ${holder.email} -> ${PARKED_EMAIL}   (address released)`);
console.log(`    status ${holder.status} -> Inactive, deleted_at set, auth_version +1`);
console.log(
  `    revoked: web_sessions=${result.revoked.web_sessions} ` +
    `trusted_web_devices=${result.revoked.trusted_web_devices} ` +
    `mobile_refresh_tokens=${result.revoked.mobile_refresh_tokens} ` +
    `password_reset_tokens=${result.revoked.password_reset_tokens}`
);
console.log(`+ employee ${RECIPIENT_ID} (admin)`);
console.log(`    ${recipient.email} -> ${result.assigned.email}, auth_version +1`);
console.log(
  `\nNote: employee ${HOLDER_ID}'s driver row (driver_id=4) is left untouched — it is\n` +
    `already Suspended (license_expired), so it is not dispatchable. It will still\n` +
    `appear in driver lists as Suspended.`
);
