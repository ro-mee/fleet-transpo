import { query } from "@/lib/db";
import { ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { issueResetToken } from "@/lib/auth/reset-token";
import { isEmailConfigured, sendPasswordResetEmail } from "@/lib/email/smtp";

/**
 * POST /api/auth/forgot-password
 *
 * Public (pre-auth) self-service recovery. Replaces the old browser-side
 * Supabase anon-key lookup, which let anyone enumerate accounts via the
 * public anon key.
 *
 * The response is identical whether or not the email exists, so this endpoint
 * cannot be used to enumerate accounts, and the existence check stays
 * server-side. Rate-limited per IP and per email. Which message is returned
 * depends only on provider configuration — never on the lookup result.
 *
 * When SMTP email is configured, an existing Active account
 * gets a 30-minute single-use token emailed to it — the same token shape the
 * administrator-issued flow mints, consumable both by the web reset link and
 * by pasting the code into the mobile app's reset screen. Without a provider
 * the response falls back to the administrator-issued path.
 */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const email = (body?.email || "").toString().toLowerCase().trim();
    if (!email) return err("Email is required", 400);

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`forgot-password:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`forgot-password:account:${email}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    const deliverByEmail = isEmailConfigured();

    const { rows } = await query(
      `SELECT employee_id, email
         FROM employees
        WHERE LOWER(email) = $1 AND deleted_at IS NULL AND status = 'Active'
        LIMIT 1`,
      [email]
    );
    const account = rows[0];

    if (account && deliverByEmail) {
      try {
        const { token, resetUrl } = await issueResetToken(account.employee_id);
        await sendPasswordResetEmail({ to: account.email, resetUrl, token });
        await writeAudit(req, null, {
          action: "password_reset_requested",
          resource: "employees",
          resourceId: account.employee_id,
          newValues: { expires_in_minutes: 30, delivery: "email" },
        });
      } catch (e) {
        // Never leak delivery internals (or account existence) to a public
        // caller — the generic response below still applies. The failure is
        // logged server-side for the operator to pick up.
        console.warn(`forgot-password delivery failed for employee ${account.employee_id}: ${e?.message || e}`);
      }
    }

    return ok({
      message: deliverByEmail
        ? "If an account exists for that email, a reset link has been sent. It expires in 30 minutes."
        : "If an account exists for that email, contact your FleetOps administrator to receive a reset link.",
    });
  } catch (e) { return handleError(e); }
}
