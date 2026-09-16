import { rateLimit, peekRateLimit } from "@/lib/rate-limit";
import { query } from "@/lib/db";

// "Three strikes" policy: 10 failed password attempts freeze the account for
// 15 minutes. State lives in the existing auth_rate_limits table (migration
// 087) — no new table. peek-before-attempt, consume-on-failure, delete-on-success.
export const LOCKOUT_LIMIT = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60_000;

export function lockoutKey(email) {
  return `lockout:account:${String(email).toLowerCase().trim()}`;
}

/** Read-only: does NOT consume the budget. */
export async function checkAccountLockout(email) {
  return peekRateLimit(lockoutKey(email), { limit: LOCKOUT_LIMIT, windowMs: LOCKOUT_WINDOW_MS });
}

/** Consume one attempt after a failed password check. Returns the bucket result. */
export async function recordFailedAttempt(email) {
  return rateLimit(lockoutKey(email), { limit: LOCKOUT_LIMIT, windowMs: LOCKOUT_WINDOW_MS });
}

/** Remove the budget after a successful login. Never throws. */
export async function clearAccountLockout(email) {
  try {
    await query("DELETE FROM auth_rate_limits WHERE bucket_key = $1", [lockoutKey(email)]);
  } catch (error) {
    console.warn("clearAccountLockout failed:", error?.message || error);
  }
}
