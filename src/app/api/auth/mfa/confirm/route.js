import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  decryptSecret,
  generateRecoveryCodes,
  recoveryCodeHash,
  verifyTotp,
} from "@/lib/auth/mfa";
import { revokeEmployeeSessions } from "@/lib/auth/sessions";
import { writeAudit } from "@/lib/audit";

export async function POST(req) {
  try {
    const session = await requireAuth(req, "*");
    const body = await parseBody(req);
    const employeeId = session.user.employeeId;
    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`mfa-confirm:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`mfa-confirm:account:${employeeId}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) return err("Too many verification attempts. Try again later.", 429);

    const recoveryCodes = generateRecoveryCodes();
    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT secret_ciphertext, secret_iv, secret_tag
           FROM employee_mfa
          WHERE employee_id = $1 AND enabled_at IS NULL AND setup_expires_at > NOW()
          FOR UPDATE`,
        [employeeId]
      );
      const pending = rows[0];
      if (!pending) return { ok: false, reason: "expired" };
      const match = verifyTotp(decryptSecret(pending), body?.code);
      if (!match) return { ok: false, reason: "invalid" };

      await tx.query(
        `UPDATE employee_mfa
            SET enabled_at = NOW(), setup_expires_at = NULL, last_used_step = $2, updated_at = NOW()
          WHERE employee_id = $1`,
        [employeeId, match.step]
      );
      await tx.query(`DELETE FROM mfa_recovery_codes WHERE employee_id = $1`, [employeeId]);
      for (const code of recoveryCodes) {
        await tx.query(
          `INSERT INTO mfa_recovery_codes (employee_id, code_hash) VALUES ($1, $2)`,
          [employeeId, recoveryCodeHash(code)]
        );
      }
      await tx.query(
        `UPDATE employees SET auth_version = auth_version + 1, updated_at = NOW() WHERE employee_id = $1`,
        [employeeId]
      );
      await revokeEmployeeSessions(tx, employeeId);
      return { ok: true };
    });

    if (!result.ok) return err(result.reason === "expired" ? "The setup code has expired. Start again." : "Invalid verification code", 400);
    await writeAudit(req, session, {
      action: "mfa_enabled",
      resource: "employee_mfa",
      newValues: { sessions_revoked: true, recovery_codes_issued: recoveryCodes.length },
    });
    return ok({ enabled: true, recoveryCodes, signInRequired: true });
  } catch (error) {
    return handleError(error);
  }
}
