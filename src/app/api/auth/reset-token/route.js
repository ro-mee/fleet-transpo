import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { createResetToken, hashResetToken } from "@/lib/auth/reset-token";

/**
 * POST /api/auth/reset-token
 *
 * Issues a short-lived one-time reset link for administrator-assisted
 * recovery. The plaintext token is returned once to the authorized operator;
 * only its hash is stored in PostgreSQL. A future email provider can consume
 * the same token table without changing the reset endpoint.
 */
export async function POST(req) {
  try {
    const session = await requirePermission(req, "accounts", "update");
    const body = await parseBody(req);
    const employeeId = Number(body?.employee_id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return err("employee_id is required", 400);
    }

    const { rows } = await query(
      `SELECT e.employee_id, e.email, r.role_name
         FROM employees e
        LEFT JOIN roles r ON r.role_id = e.role_id
        WHERE e.employee_id = $1 AND e.deleted_at IS NULL AND e.status = 'Active'
        LIMIT 1`,
      [employeeId]
    );
    const target = rows[0];
    if (!target) return err("Employee not found", 404);
    if (target.role_name === "system_admin" && session.user.role !== "system_admin") {
      return err("Only a system administrator may reset a system administrator account.", 403);
    }

    let origin;
    try {
      origin = new URL(process.env.NEXT_PUBLIC_APP_URL).origin;
    } catch {
      return err("Application URL is not configured", 500);
    }

    const token = createResetToken();
    const tokenHash = hashResetToken(token);
    await withTransaction(async (tx) => {
      await tx.query(
        `DELETE FROM password_reset_tokens
          WHERE employee_id = $1 AND used_at IS NULL`,
        [employeeId]
      );
      await tx.query(
        `INSERT INTO password_reset_tokens (employee_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [employeeId, tokenHash]
      );
    });

    await writeAudit(req, session, {
      action: "password_reset_issued",
      resource: "employees",
      resourceId: employeeId,
      newValues: { expires_in_minutes: 30, delivery: "administrator" },
    });

    return ok({
      resetUrl: `${origin}/reset-password?token=${encodeURIComponent(token)}`,
      expiresInMinutes: 30,
    });
  } catch (e) {
    return handleError(e);
  }
}
