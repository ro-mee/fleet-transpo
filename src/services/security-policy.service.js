import { getSetting, setSetting, peekSetting, warmSetting } from "@/lib/system-settings";
import {
  SECURITY_POLICY_KEY,
  DEFAULT_SECURITY_POLICY,
  mergeSecurityPolicy,
} from "@/lib/security-policy";

/**
 * Read the security/session policy. Always returns a complete, in-range object:
 * a missing row, a corrupt row and an unknown key all resolve to the defaults
 * in src/lib/security-policy.js.
 *
 * Read on the login path and on every session INSERT, so it goes through the
 * cached reader in src/lib/system-settings.js rather than hitting Postgres per
 * sign-in.
 */
export async function getSecurityPolicy() {
  return mergeSecurityPolicy(await getSetting(SECURITY_POLICY_KEY));
}

/**
 * Last-known policy without touching the database, or `null` when this instance
 * has not read it yet.
 *
 * Backs the `maxAge` getter on `authOptions.session` — see the note on
 * `peekSetting`. `null` means "unknown", and the caller falls back to
 * DEFAULT_SECURITY_POLICY, which is exactly the pre-config behaviour.
 *
 * @returns {object|null}
 */
export function peekSecurityPolicy() {
  const raw = peekSetting(SECURITY_POLICY_KEY);
  if (raw === undefined) return null;
  return mergeSecurityPolicy(raw);
}

/** Start warming the cache at module load. Never throws. */
export function warmSecurityPolicy() {
  warmSetting(SECURITY_POLICY_KEY);
}

/**
 * Absolute session lifetime in seconds, resolved from cache with the default as
 * the cold-start answer.
 *
 * @returns {number}
 */
export function absoluteTtlSecondsOrDefault() {
  return peekSecurityPolicy()?.absoluteTtlSeconds ?? DEFAULT_SECURITY_POLICY.absoluteTtlSeconds;
}

/**
 * Upsert the security/session policy and invalidate its cached entry in this
 * instance, so the next login reads the new values.
 *
 * NOTE: other serverless instances keep their copy until the 30s TTL lapses —
 * see the staleness note in src/lib/system-settings.js. Sessions created before
 * the save keep the `idle_timeout_seconds` stored on their own row, which is why
 * a change applies to NEW sessions only.
 *
 * @param {object} policy partial or complete; merged over the stored value
 * @param {?number} actorId `employees.employee_id`
 * @returns {Promise<object>} the persisted (merged) policy
 */
export async function saveSecurityPolicy(policy, actorId) {
  const stored = await getSetting(SECURITY_POLICY_KEY);
  const merged = mergeSecurityPolicy({ ...(stored || {}), ...(policy || {}) });
  await setSetting(SECURITY_POLICY_KEY, merged, actorId);
  return merged;
}
