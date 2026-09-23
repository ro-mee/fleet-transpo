/**
 * Mobile OTP verification helpers — FleetOps Driver Companion.
 *
 * Dependency-free on purpose (mirrors `src/lib/auth/otp-policy.js` on the
 * server): the OTP screen reads the digit count, TTL and resend cooldown from
 * here so the client can never drift from the server contract. The backend is
 * the source of truth — these values are display/UX mirrors, never enforcement.
 *
 * Digit count is 6: the server issues a 6-digit emailed code
 * (`OTP_CODE_DIGITS`). The spec sketch shows four cells, but a four-digit
 * entry could never verify against the live challenge, so the screen renders
 * six cells and auto-submits on the sixth digit — same as the web modal.
 */

/** Digits in a login code. Must match the server's OTP_CODE_DIGITS. */
export const OTP_CODE_DIGITS = 6;

/** How long an emailed login code stays valid (seconds). */
export const OTP_TTL_SECONDS = 300;

/** Minimum gap between self-service code sends for one account (seconds). */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Minimum time the verifying indicator stays visible (ms) so the
 *  loader→success transition is perceptible even on a fast network. */
export const OTP_VERIFY_MIN_MS = 500;

/** How long the success check shows before navigating away (ms). */
export const OTP_SUCCESS_HOLD_MS = 650;

/**
 * Hides the mailbox name but keeps the domain legible: `za••••@gmail.com`.
 * Mirrors the server's maskEmailAddress: the domain is the signal worth
 * showing (a code going to the wrong mailbox is the one failure mode the
 * user can act on). Non-email identifiers (driver IDs) are returned as-is
 * so the caller can fall back to generic copy.
 */
export function maskEmailAddress(email) {
  const address = String(email ?? "").trim();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return address;
  const local = address.slice(0, at);
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(3, local.length - head.length))}@${address.slice(at + 1)}`;
}

/** True when the identifier looks like an email address worth masking. */
export function isEmailLike(value) {
  const address = String(value ?? "").trim();
  const at = address.lastIndexOf("@");
  return at > 0 && at < address.length - 1 && address.slice(at + 1).includes(".");
}

/** Format a second count as MM:SS for the expiry / cooldown countdowns. */
export function formatCountdown(totalSeconds) {
  const clamped = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** Keep only decimal digits, capped at the OTP length (paste-safe). */
export function sanitizeOtpInput(text, maxLength = OTP_CODE_DIGITS) {
  return String(text ?? "").replace(/[^0-9]/g, "").slice(0, maxLength);
}
