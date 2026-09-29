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

/** Wire prefix of the account-lock token the server sends. Mirrors otp-policy. */
export const OTP_LOCKED_PREFIX = "OTP_LOCKED:";

/**
 * Seconds from an `OTP_LOCKED:<seconds>` token, or null for anything else.
 * Mirrors the server's parseOtpLock: one helper decides both the branch and
 * the countdown, and a malformed token falls through to the caller's generic
 * message instead of a bogus wait.
 */
export function parseOtpLock(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_LOCKED_PREFIX)) return null;
  const seconds = Number(message.slice(OTP_LOCKED_PREFIX.length));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/** Failed verifications before a challenge burns. Mirrors otp-policy. */
export const OTP_MAX_ATTEMPTS = 3;

/** Burned challenges before the account freezes. Mirrors otp-policy. */
export const OTP_LOCKOUT_LIMIT = 3;

/** Fixed freeze window, measured from the account's first burn. Mirrors otp-policy. */
export const OTP_LOCKOUT_WINDOW_MS = 15 * 60_000;

/** Wire prefix of the attempts-left token. Mirrors otp-policy. */
export const OTP_ATTEMPTS_LEFT_PREFIX = "OTP_ATTEMPTS_LEFT:";

/** Wire prefix of the burn-strike token. Mirrors otp-policy. */
export const OTP_STRIKE_PREFIX = "OTP_STRIKE:";

/**
 * Remaining attempts from an `OTP_ATTEMPTS_LEFT:<n>` token, or null.
 * Mirrors the server's parseOtpAttemptsLeft — same range check, so a corrupt
 * token falls through to the generic message instead of a bogus count.
 */
export function parseOtpAttemptsLeft(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_ATTEMPTS_LEFT_PREFIX)) return null;
  const count = Number(message.slice(OTP_ATTEMPTS_LEFT_PREFIX.length));
  return Number.isInteger(count) && count >= 1 && count <= OTP_MAX_ATTEMPTS ? count : null;
}

/**
 * Strike number from an `OTP_STRIKE:<n>` token, or null. Mirrors the
 * server's parseOtpStrike.
 */
export function parseOtpStrike(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_STRIKE_PREFIX)) return null;
  const strike = Number(message.slice(OTP_STRIKE_PREFIX.length));
  return Number.isInteger(strike) && strike >= 1 && strike <= OTP_LOCKOUT_LIMIT ? strike : null;
}

/** "7 minutes" / "45 seconds" / "1 second". Mirrors the server's formatLockWait. */
export function formatLockWait(seconds) {
  const total = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (total < 60) return `${total} second${total === 1 ? "" : "s"}`;
  const minutes = Math.ceil(total / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Copy for a wrong code with attempts left. Mirrors the server's
 * describeOtpAttemptsLeft word for word — the OTP step and the login form must
 * not be able to say different things about the same verdict.
 */
export function describeOtpAttemptsLeft(attemptsLeft) {
  const left = Number(attemptsLeft);
  const n = Number.isFinite(left)
    ? Math.min(OTP_MAX_ATTEMPTS, Math.max(1, Math.floor(left)))
    : OTP_MAX_ATTEMPTS;
  if (n === 1) {
    return "Incorrect code. 1 attempt left. One more wrong code cancels this code, and you'll need your password again for a new one.";
  }
  return `Incorrect code. ${n} attempt${n === 1 ? "" : "s"} left.`;
}

/**
 * Copy for the burned challenge — the code is cancelled after OTP_MAX_ATTEMPTS
 * wrong codes. Mirrors the server's describeOtpBurn word for word (parity pins
 * compare the strings), in three lines: what happened, what to do, what it
 * costs. The screen says "cancelled code", never "strike" — the token and the
 * field keep the name, the reader does not, and "failed codes" was wrong by a
 * factor of three (three wrong codes cancel one code).
 */
export function describeOtpBurn({ strike } = {}) {
  const raw = Number(strike);
  const n = Number.isFinite(raw)
    ? Math.min(OTP_LOCKOUT_LIMIT, Math.max(1, Math.floor(raw)))
    : 1;
  const more = OTP_LOCKOUT_LIMIT - n;
  const windowMinutes = Math.round(OTP_LOCKOUT_WINDOW_MS / 60_000);
  const consequence =
    more > 0
      ? ` — ${more} more will lock this account for ` +
        `${windowMinutes} minute${windowMinutes === 1 ? "" : "s"}.`
      : ".";
  return (
    `Your code was cancelled after ${OTP_MAX_ATTEMPTS} wrong codes.\n` +
    "Enter your password again to get a new code.\n" +
    `Cancelled code ${n} of ${OTP_LOCKOUT_LIMIT}${consequence}`
  );
}
