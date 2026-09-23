import { withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { generateRecoveryCodes, recoveryCodeHash, verifyCurrentPassword } from "@/lib/auth/mfa";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/auth/mfa/recovery-codes — regenerate the break-glass recovery codes.
 *
 * These are the fallback that works when mail does not arrive, which under
 * mandatory email OTP is the failure everyone eventually hits: a dead SMTP
 * provider, a full mailbox, an address the company does not own. Losing them
 * entirely is what makes the administrator-issued emergency code necessary.
 *
 * The gate is the account's current password. It used to also require a TOTP
 * code, but the TOTP factor is gone — requiring an emailed code here would be
 * circular, since this endpoint exists precisely for when email is not working.
 * The rate limiter is therefore doing real work rather than being a backstop.
 */
export async function POST(req) {
  try {
    const session = await requireAuth(req, "*");
    const body = await parseBody(req);
    const employeeId = session.user.employeeId;
    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`mfa-recovery:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`mfa-recovery:account:${employeeId}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }
    if (!(await verifyCurrentPassword(employeeId, body?.currentPassword))) {
      return err("Current password is incorrect", 403);
    }

    const recoveryCodes = generateRecoveryCodes();
    await withTransaction(async (tx) => {
      // Replace rather than append: the previous set may be sitting in a
      // screenshot, a notes app or a chat thread, and regeneration is the only
      // way to retire it.
      await tx.query(`DELETE FROM mfa_recovery_codes WHERE employee_id = $1`, [employeeId]);
      for (const recoveryCode of recoveryCodes) {
        await tx.query(
          `INSERT INTO mfa_recovery_codes (employee_id, code_hash) VALUES ($1, $2)`,
          [employeeId, recoveryCodeHash(recoveryCode)]
        );
      }
    });

    await writeAudit(req, session, {
      action: "mfa_recovery_codes_regenerated",
      resource: "mfa_recovery_codes",
      newValues: { count: recoveryCodes.length },
    });
    // Returned exactly once. Only the hashes are stored, so this response is
    // the sole opportunity to write them down.
    return ok({ recoveryCodes });
  } catch (error) {
    return handleError(error);
  }
}
