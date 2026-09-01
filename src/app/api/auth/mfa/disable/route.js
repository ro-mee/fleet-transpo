import { withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { consumeFactor, verifyCurrentPassword } from "@/lib/auth/mfa";
import { revokeEmployeeSessions } from "@/lib/auth/sessions";
import { writeAudit } from "@/lib/audit";

export async function POST(req) {
  try {
    const session = await requireAuth(req, "*");
    const body = await parseBody(req);
    const employeeId = session.user.employeeId;
    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`mfa-disable:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`mfa-disable:account:${employeeId}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) return err("Too many requests. Try again later.", 429);
    if (!(await verifyCurrentPassword(employeeId, body?.currentPassword))) {
      return err("Current password is incorrect", 403);
    }

    const result = await withTransaction(async (tx) => {
      const factor = await consumeFactor(tx, employeeId, body?.code);
      if (!factor.ok) return factor;
      await tx.query(`DELETE FROM mfa_recovery_codes WHERE employee_id = $1`, [employeeId]);
      await tx.query(`DELETE FROM employee_mfa WHERE employee_id = $1`, [employeeId]);
      await tx.query(
        `UPDATE employees SET auth_version = auth_version + 1, updated_at = NOW() WHERE employee_id = $1`,
        [employeeId]
      );
      await revokeEmployeeSessions(tx, employeeId);
      return { ok: true, method: factor.method };
    });
    if (!result.ok) return err("Invalid verification code", 403);
    await writeAudit(req, session, {
      action: "mfa_disabled",
      resource: "employee_mfa",
      newValues: { sessions_revoked: true, verification_method: result.method },
    });
    return ok({ enabled: false, signInRequired: true });
  } catch (error) {
    return handleError(error);
  }
}
