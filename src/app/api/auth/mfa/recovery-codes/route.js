import { withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  consumeFactor,
  generateRecoveryCodes,
  recoveryCodeHash,
  verifyCurrentPassword,
} from "@/lib/auth/mfa";
import { writeAudit } from "@/lib/audit";

export async function POST(req) {
  try {
    const session = await requireAuth(req, "*");
    const body = await parseBody(req);
    const employeeId = session.user.employeeId;
    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`mfa-recovery:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`mfa-recovery:account:${employeeId}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) return err("Too many requests. Try again later.", 429);
    if (!(await verifyCurrentPassword(employeeId, body?.currentPassword))) {
      return err("Current password is incorrect", 403);
    }
    const code = String(body?.code || "").replace(/[\s-]/g, "");
    if (!/^\d{6}$/.test(code)) return err("Invalid verification code", 403);

    const recoveryCodes = generateRecoveryCodes();
    const valid = await withTransaction(async (tx) => {
      const factor = await consumeFactor(tx, employeeId, code);
      if (!factor.ok || factor.method !== "totp") return false;
      await tx.query(`DELETE FROM mfa_recovery_codes WHERE employee_id = $1`, [employeeId]);
      for (const recoveryCode of recoveryCodes) {
        await tx.query(
          `INSERT INTO mfa_recovery_codes (employee_id, code_hash) VALUES ($1, $2)`,
          [employeeId, recoveryCodeHash(recoveryCode)]
        );
      }
      return true;
    });
    if (!valid) return err("Invalid verification code", 403);
    await writeAudit(req, session, {
      action: "mfa_recovery_codes_regenerated",
      resource: "mfa_recovery_codes",
      newValues: { count: recoveryCodes.length },
    });
    return ok({ recoveryCodes });
  } catch (error) {
    return handleError(error);
  }
}
