import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  createTotp,
  encryptSecret,
  generateSecret,
  qrDataUrl,
  verifyCurrentPassword,
} from "@/lib/auth/mfa";
import { writeAudit } from "@/lib/audit";

const SETUP_TTL_MS = 10 * 60 * 1000;

export async function POST(req) {
  try {
    const session = await requireAuth(req, "*");
    const body = await parseBody(req);
    const employeeId = session.user.employeeId;
    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`mfa-setup:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`mfa-setup:account:${employeeId}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) return err("Too many requests. Try again later.", 429);
    if (!(await verifyCurrentPassword(employeeId, body?.currentPassword))) {
      return err("Current password is incorrect", 403);
    }

    const { rows: employees } = await query(
      `SELECT email, first_name, last_name FROM employees WHERE employee_id = $1 LIMIT 1`,
      [employeeId]
    );
    const employee = employees[0];
    if (!employee) return err("Account not found", 404);

    const secret = generateSecret();
    const encrypted = encryptSecret(secret);
    const expiresAt = new Date(Date.now() + SETUP_TTL_MS).toISOString();
    const label = `${employee.email}`;
    const uri = createTotp(secret, label).toString();
    const qrCode = await qrDataUrl(uri);
    const saved = await withTransaction(async (tx) => {
      const { rows: existing } = await tx.query(
        `SELECT enabled_at FROM employee_mfa WHERE employee_id = $1 FOR UPDATE`,
        [employeeId]
      );
      if (existing[0]?.enabled_at) return false;
      await tx.query(
        `INSERT INTO employee_mfa
           (employee_id, secret_ciphertext, secret_iv, secret_tag, setup_expires_at, enabled_at, last_used_step, updated_at)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL, NOW())
         ON CONFLICT (employee_id) DO UPDATE SET
           secret_ciphertext = EXCLUDED.secret_ciphertext,
           secret_iv = EXCLUDED.secret_iv,
           secret_tag = EXCLUDED.secret_tag,
           setup_expires_at = EXCLUDED.setup_expires_at,
           enabled_at = NULL,
           last_used_step = NULL,
           updated_at = NOW()`,
        [employeeId, encrypted.secretCiphertext, encrypted.secretIv, encrypted.secretTag, expiresAt]
      );
      return true;
    });
    if (!saved) return err("Two-factor authentication is already enabled", 409);

    await writeAudit(req, session, {
      action: "mfa_setup_started",
      resource: "employee_mfa",
      newValues: { expires_at: expiresAt },
    });
    return ok({ qrCode, manualKey: secret, uri, expiresAt });
  } catch (error) {
    return handleError(error);
  }
}
