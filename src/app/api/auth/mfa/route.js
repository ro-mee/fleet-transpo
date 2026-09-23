import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { isEmailConfigured } from "@/lib/email/smtp";
import { OTP_CODE_DIGITS, OTP_TTL_SECONDS, describeOtpTtl } from "@/lib/auth/otp-policy";

/**
 * GET /api/auth/mfa — the client's view of the second factor.
 *
 * There is nothing to enroll and nothing to turn off, so this reports state
 * rather than offering control: the factor is mandatory for every account, and
 * the only variable is whether the server can currently *deliver* it. The
 * security settings page renders a warning when `emailConfigured` is false,
 * because in that state nobody can sign in at all.
 *
 * `employee_mfa` is deliberately not consulted — see src/lib/auth.js.
 */
export async function GET(req) {
  try {
    const session = await requireAuth(req, "*");
    const { rows } = await query(
      `SELECT COUNT(*)::int AS remaining
         FROM mfa_recovery_codes
        WHERE employee_id = $1 AND used_at IS NULL`,
      [session.user.employeeId]
    );
    return ok({
      method: "email_otp",
      required: true,
      emailConfigured: isEmailConfigured(),
      codeDigits: OTP_CODE_DIGITS,
      codeTtlSeconds: OTP_TTL_SECONDS,
      codeTtlLabel: describeOtpTtl(OTP_TTL_SECONDS),
      recoveryCodesRemaining: rows[0]?.remaining ?? 0,
    });
  } catch (error) {
    return handleError(error);
  }
}
