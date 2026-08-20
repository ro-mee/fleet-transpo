import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/auth/reset-password
 *
 * Authenticated reset of the CALLER's own password. Replaces the old
 * browser-side Supabase anon-key write (`updatePassword`), which updated
 * employees.password_hash keyed by email from the client — a latent
 * account-takeover primitive.
 *
 * The employee is derived from the session, never from the request body, and
 * mobile refresh tokens are revoked so a stolen session can't survive the
 * change. Rate-limited per IP and per account.
 */
export async function POST(req) {
  try {
    const session = await requireAuth(req);
    const employeeId = session.user.employeeId;
    if (employeeId == null) return err("This account is not linked to an employee", 400);

    const body = await parseBody(req);
    const errors = validateBody(body, {
      newPassword: { required: true, type: "password", label: "New password" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    if (body.newPassword.length < 6) {
      return err("New password must be at least 6 characters", 400);
    }

    const ipBucket = rateLimit(`reset-password:${clientIp(req)}`, { limit: 5, windowMs: 60_000 });
    const accountBucket = rateLimit(`reset-password:${employeeId}`, { limit: 5, windowMs: 60_000 });
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    const hash = await bcrypt.hash(body.newPassword, 10);
    const { rowCount } = await query(
      `UPDATE employees SET password_hash = $1, updated_at = NOW() WHERE employee_id = $2 AND deleted_at IS NULL`,
      [hash, employeeId]
    );
    if (rowCount === 0) return err("Account not found", 404);

    // Revoke mobile sessions so a leaked refresh token dies with the password.
    await query(`DELETE FROM mobile_refresh_tokens WHERE employee_id = $1`, [employeeId]);

    return ok({ message: "Password updated successfully" });
  } catch (e) { return handleError(e); }
}