import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";

/**
 * Break-glass recovery codes, and the password re-confirmation they are gated on.
 *
 * This module used to hold the TOTP factor — secret generation, AES-256-GCM
 * secret storage, `otpauth` verification and replay protection. That factor is
 * gone: the second factor is now a six-digit code emailed to the account holder,
 * in `src/lib/auth/email-otp.js`. What survives here is the one piece of the old
 * design that email OTP cannot replace, because it exists for the case where
 * email does not work:
 *
 *   - `mfa_recovery_codes` — ten single-use codes, stored as SHA-256 digests.
 *   - `verifyCurrentPassword` — what guards regenerating them.
 *
 * Both are still named after the old factor because the table and its audit
 * resource are, and renaming a table for tidiness is not worth the migration.
 *
 * Why SHA-256 and not bcrypt: a recovery code is 20 hex characters (80 bits)
 * drawn from a CSPRNG, so there is no dictionary to attack and no need for a
 * slow KDF. A six-digit email code is the opposite case — see the note in
 * `email-otp.js` about why its digest is not the protection.
 *
 * `employee_mfa` is retained for rollback and is no longer read by anything.
 */

export function recoveryCodeHash(code) {
  return createHash("sha256")
    .update(String(code || "").replace(/[\s-]/g, "").toUpperCase())
    .digest("hex");
}

/** Ten codes, 80 bits of entropy each, formatted as uppercase hex. */
export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => randomBytes(10).toString("hex").toUpperCase());
}

/**
 * Re-confirms the signed-in account's own password. Always spends the bcrypt
 * work, even for a missing account, so the caller does not become a timing
 * oracle for account existence.
 */
export async function verifyCurrentPassword(employeeId, password) {
  const { rows } = await query(
    `SELECT password_hash FROM employees
      WHERE employee_id = $1 AND deleted_at IS NULL AND status = 'Active'`,
    [employeeId]
  );
  return bcrypt.compare(
    String(password || ""),
    rows[0]?.password_hash || "$2b$10$c9wQOSTVJPfSVsx6lrokNeg.W0aGtDnZreMk1p4JMIEXKaFPu.bkW"
  );
}
