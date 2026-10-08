/**
 * Dev-only OTP bypass switch for manual web testing.
 *
 * Dependency-free on purpose (same reason as session-policy.js / otp-policy.js):
 * it must be importable without pulling in `@/lib/db`.
 *
 * Fires only when DEV_BYPASS_OTP === "1" AND NODE_ENV !== "production".
 * Production ignores the flag unconditionally (fail closed).
 *
 * @param {NodeJS.ProcessEnv} [env] defaults to process.env; injectable for tests
 * @returns {boolean}
 */
export function isDevOtpBypassEnabled(env = process.env) {
  return env?.DEV_BYPASS_OTP === "1" && env?.NODE_ENV !== "production";
}
