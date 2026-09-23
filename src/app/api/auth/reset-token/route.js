import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { issueResetToken } from "@/lib/auth/reset-token";
import { canMutateAccount } from "@/lib/auth/privilege";

/**
 * POST /api/auth/reset-token
 *
 * Issues a short-lived one-time reset link for administrator-assisted
 * recovery. The plaintext token is returned once to the authorized operator;
 * only its hash is stored in PostgreSQL. The self-service forgot-password
 * endpoint mints from the same issuer, so both deliver the identical token
 * shape without changing the reset endpoint.
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
    if (!canMutateAccount(session.user.role, target.role_name)) {
      return err("Only a Super Admin may reset a privileged account.", 403);
    }

    let issued;
    try {
      issued = await issueResetToken(employeeId);
    } catch (e) {
      if (e?.message === "Application URL is not configured") {
        return err("Application URL is not configured", 500);
      }
      throw e;
    }

    await writeAudit(req, session, {
      action: "password_reset_issued",
      resource: "employees",
      resourceId: employeeId,
      newValues: { expires_in_minutes: 30, delivery: "administrator" },
    });

    return ok({
      resetUrl: issued.resetUrl,
      expiresInMinutes: 30,
    });
  } catch (e) {
    return handleError(e);
  }
}
