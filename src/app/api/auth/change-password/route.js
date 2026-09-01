import bcrypt from "bcryptjs";
import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { revokeEmployeeSessions } from "@/lib/auth/sessions";

export async function POST(req) {
  try {
    const session = await requireAuth(req, "*");

    const body = await parseBody(req);
    const { currentPassword, newPassword } = body;
    const employeeId = session.user.employeeId;

    if (!currentPassword || !newPassword) {
      return err("Current password and new password are required", 400);
    }

    const errors = validateBody(body, {
      currentPassword: { required: true, label: "Current password" },
      newPassword: { required: true, type: "password", label: "New password" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`password-change:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`password-change:account:${employeeId}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    if (currentPassword === newPassword) {
      return err("New password must be different from current password", 400);
    }

    const { rows } = await query(
      `SELECT password_hash FROM employees
        WHERE employee_id = $1 AND deleted_at IS NULL AND status = 'Active'`,
      [employeeId]
    );

    if (!rows?.[0]?.password_hash) {
      return err("Account not found", 404);
    }

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) {
      return err("Current password is incorrect", 403);
    }

    const hash = await bcrypt.hash(newPassword, 10);
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
      newValues: { sessions_revoked: true },
    });

    return ok({ message: "Password updated successfully", signInRequired: true });
  } catch (e) {
    return handleError(e);
  }
}
