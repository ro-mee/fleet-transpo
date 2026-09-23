import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { raiseSecurityAlert } from "@/lib/auth/security-alerts";
import { issueEmergencyCode, OTP_PURPOSE_BREAK_GLASS } from "@/lib/auth/email-otp";
import { OTP_BREAK_GLASS_TTL_SECONDS, describeOtpTtl } from "@/lib/auth/otp-policy";

/**
 * POST /api/auth/mfa/emergency-code — break-glass (3).
 *
 * Mints a single-use code an administrator reads to a locked-out user, for the
 * case the recovery codes cannot cover: the user has lost their printed codes
 * *and* cannot receive mail. Nothing is emailed — the operator is the transport.
 *
 * The plaintext is returned exactly once, in this response, and never appears
 * in the audit row, the alert, or any log. That makes this endpoint the only
 * place in the system where a live credential is displayed to a human, which is
 * why it is the most restricted route in the app:
 *
 *   - `accounts: update` — admin and super_admin only (see MATRIX in
 *     src/lib/auth/permissions.js); fleet_manager, dispatcher and management
 *     are all `false`.
 *   - An admin may not issue one for their own account. They are already
 *     authenticated, so they cannot be locked out; the only thing self-issuance
 *     would buy is a way to sign in elsewhere without the emailed code, which
 *     would quietly turn the mandatory factor into an optional one.
 *   - Rate-limited per admin, audited, and raised as a security alert, so an
 *     unexpected issuance surfaces in GET /api/system/security-alerts.
 */
export async function POST(req) {
  try {
    const session = await requirePermission(req, "accounts", "update");
    const body = await parseBody(req);
    const employeeId = Number(body?.employeeId);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return err("employeeId is required", 400);
    }

    if (employeeId === Number(session.user.employeeId)) {
      return err(
        "You cannot issue an emergency code for your own account. Use a recovery code, or ask another administrator.",
        403
      );
    }

    const bucket = await rateLimit(`mfa-emergency:account:${session.user.employeeId}`, {
      limit: 5,
      windowMs: 60_000,
    });
    if (!bucket.allowed) {
      return err("Too many emergency codes issued. Try again in a minute.", 429);
    }

    const { rows } = await query(
      `SELECT employee_id, email, first_name, last_name
         FROM employees
        WHERE employee_id = $1 AND deleted_at IS NULL AND status = 'Active'`,
      [employeeId]
    );
    const target = rows[0];
    if (!target) return err("No active account with that id", 404);

    const issued = await issueEmergencyCode({
      employeeId,
      ip: clientIp(req),
      userAgent: req.headers?.get?.("user-agent") || null,
    });

    if (!issued?.ok) {
      if (issued?.reason === "cooldown") {
        return err(
          `That account received a code less than a minute ago. Try again in ${issued.retryAfterSeconds} seconds.`,
          429
        );
      }
      if (issued?.reason === "no_account") return err("No active account with that id", 404);
      return err("Could not issue an emergency code", 500);
    }

    // Audited as the admin's action against the target account — the actor is
    // the session, the subject is `resourceId`, and the code itself is not in
    // here. `raiseSecurityAlert` writes a second, actor-less row so the event
    // is visible on its own in the security-alerts feed.
    await writeAudit(req, session, {
      action: "mfa_emergency_code_issued",
      resource: "email_otp_challenges",
      resourceId: employeeId,
      newValues: { purpose: OTP_PURPOSE_BREAK_GLASS, ttl_seconds: OTP_BREAK_GLASS_TTL_SECONDS },
    });
    await raiseSecurityAlert(req, {
      type: "emergency_code_issued",
      employeeId,
      details: {
        issued_by: session.user.employeeId,
        target_email: target.email,
        expires_at: issued.expiresAt,
      },
    });

    return ok({
      code: issued.code,
      expiresAt: issued.expiresAt,
      expiresInLabel: describeOtpTtl(OTP_BREAK_GLASS_TTL_SECONDS),
      employee: {
        employeeId: target.employee_id,
        name: [target.first_name, target.last_name].filter(Boolean).join(" "),
        email: target.email,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
