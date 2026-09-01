import bcrypt from "bcryptjs";
import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { hashResetToken } from "@/lib/auth/reset-token";
import { revokeEmployeeSessions } from "@/lib/auth/sessions";

/**
 * POST /api/auth/reset-password
 *
 * Accepts either a short-lived administrator-issued reset token or, for
 * backwards compatibility, an authenticated current-password change.
 *
 * Token recovery derives the employee from the hashed token row; session mode
 * derives it from the authenticated identity. Neither accepts an employee id.
 */
async function resetWithToken(req, body) {
  const errors = validateBody(body, {
    token: { required: true, label: "Reset token" },
    newPassword: { required: true, type: "password", label: "New password" },
  });
  if (!isValidObject(errors)) return errValidation(errors);

  const tokenHash = hashResetToken(String(body.token));
  const [ipBucket, tokenBucket] = await Promise.all([
    rateLimit(`password-reset:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
    rateLimit(`password-reset:token:${tokenHash}`, { limit: 5, windowMs: 60_000 }),
  ]);
  if (!ipBucket.allowed || !tokenBucket.allowed) {
    return err("Too many requests. Try again later.", 429);
  }

  const hash = await bcrypt.hash(body.newPassword, 10);
  const employeeId = await withTransaction(async (tx) => {
    const { rows: tokens } = await tx.query(
      `SELECT token_id, employee_id
         FROM password_reset_tokens
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
        FOR UPDATE`,
      [tokenHash]
    );
    const reset = tokens[0];
    if (!reset) return null;

    const { rows: updated } = await tx.query(
      `UPDATE employees
          SET password_hash = $1,
              auth_version = auth_version + 1,
              updated_at = NOW()
        WHERE employee_id = $2 AND deleted_at IS NULL AND status = 'Active'
        RETURNING employee_id`,
      [hash, reset.employee_id]
    );
    if (!updated.length) return null;
    await revokeEmployeeSessions(tx, reset.employee_id);
    await tx.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE token_id = $1`, [reset.token_id]);
    await tx.query(`DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`, [reset.employee_id]);
    return reset.employee_id;
  });

  if (!employeeId) return err("Invalid or expired reset link", 400);
  await writeAudit(req, null, {
    action: "password_reset",
    resource: "employees",
    resourceId: employeeId,
    newValues: { sessions_revoked: true },
  });
  return ok({ message: "Password updated successfully", signInRequired: true });
}

export async function POST(req) {
  try {
    const body = await parseBody(req);
    if (body?.token) return resetWithToken(req, body);

    const session = await requireAuth(req, "*");
    const employeeId = session.user.employeeId;
    if (employeeId == null) return err("This account is not linked to an employee", 400);

    const errors = validateBody(body, {
      currentPassword: { required: true, label: "Current password" },
      newPassword: { required: true, type: "password", label: "New password" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`reset-password:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`reset-password:account:${employeeId}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    const { rows } = await query(
      `SELECT password_hash FROM employees
        WHERE employee_id = $1 AND deleted_at IS NULL AND status = 'Active'`,
      [employeeId]
    );
    const valid = await bcrypt.compare(
      String(body.currentPassword),
      rows[0]?.password_hash || "$2b$10$c9wQOSTVJPfSVsx6lrokNeg.W0aGtDnZreMk1p4JMIEXKaFPu.bkW"
    );
    if (!rows[0]?.password_hash || !valid) return err("Current password is incorrect", 403);

    const hash = await bcrypt.hash(body.newPassword, 10);
    const changed = await withTransaction(async (tx) => {
      const { rows: updated } = await tx.query(
        `UPDATE employees
            SET password_hash = $1,
                auth_version = auth_version + 1,
                updated_at = NOW()
          WHERE employee_id = $2
            AND password_hash = $3
            AND deleted_at IS NULL
            AND status = 'Active'
          RETURNING auth_version`,
        [hash, employeeId, rows[0].password_hash]
      );
      if (!updated.length) return false;
      await revokeEmployeeSessions(tx, employeeId);
      await tx.query(`DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`, [employeeId]);
      return true;
    });
    if (!changed) return err("Password was changed already. Please sign in again.", 409);

    await writeAudit(req, session, {
      action: "password_change",
      resource: "employees",
      resourceId: employeeId,
      newValues: { sessions_revoked: true, via: "reset-alias" },
    });

    return ok({ message: "Password updated successfully", signInRequired: true });
  } catch (e) { return handleError(e); }
}
