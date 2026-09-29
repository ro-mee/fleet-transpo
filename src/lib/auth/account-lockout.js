import { rateLimit, peekRateLimit } from "@/lib/rate-limit";
import { query } from "@/lib/db";
import { DEFAULT_SECURITY_POLICY } from "@/lib/security-policy";
import { peekSecurityPolicy } from "@/services/security-policy.service";

// "Three strikes" policy: 10 failed password attempts freeze the account for
// 15 minutes by default. State lives in the existing auth_rate_limits table
// (migration 087) — no new table. peek-before-attempt, consume-on-failure,
// delete-on-success.
//
// The two exports below are the DEFAULTS, kept because callers and tests reach
// for them as "what the policy is out of the box". The functions resolve the
// configured values at call time instead — see `budgetFor`.
export const LOCKOUT_LIMIT = DEFAULT_SECURITY_POLICY.lockoutLimit;
export const LOCKOUT_WINDOW_MS = DEFAULT_SECURITY_POLICY.lockoutWindowMinutes * 60_000;

/**
 * Resolve the budget for one call.
 *
 * Takes an already-loaded policy when the caller has one (the login path reads
 * it once per attempt), otherwise falls back to whatever this instance has
 * cached, otherwise the defaults. Deliberately NEVER opens a database
 * connection: this runs on the failure path of every bad password, and a
 * settings read there would both add a round trip to the hottest endpoint and
 * turn a database blip into "nobody can be locked out". A cold cache answers
 * with the pre-config defaults, which is the behaviour the code had before the
 * policy was configurable.
 *
 * @param {{lockoutLimit?:number, lockoutWindowMinutes?:number}|null} [policy]
 */
function budgetFor(policy) {
  const p = policy || peekSecurityPolicy();
  return {
    limit: p?.lockoutLimit ?? DEFAULT_SECURITY_POLICY.lockoutLimit,
    windowMs: (p?.lockoutWindowMinutes ?? DEFAULT_SECURITY_POLICY.lockoutWindowMinutes) * 60_000,
  };
}

export function lockoutKey(email) {
  return `lockout:account:${String(email).toLowerCase().trim()}`;
}

/**
 * Read-only: does NOT consume the budget.
 *
 * @param {string} email
 * @param {object} [policy] pre-loaded security policy, to avoid a second read
 */
export async function checkAccountLockout(email, policy) {
  return peekRateLimit(lockoutKey(email), budgetFor(policy));
}

/**
 * Consume one attempt after a failed password check. Returns the bucket result.
 *
 * @param {string} email
 * @param {object} [policy] pre-loaded security policy, to avoid a second read
 */
export async function recordFailedAttempt(email, policy) {
  return rateLimit(lockoutKey(email), budgetFor(policy));
}

/** Remove the budget after a successful login. Never throws. */
export async function clearAccountLockout(email) {
  try {
    await query("DELETE FROM auth_rate_limits WHERE bucket_key = $1", [lockoutKey(email)]);
  } catch (error) {
    console.warn("clearAccountLockout failed:", error?.message || error);
  }
}
