// Dispatch policy — pure defaults/merge for the Smart Transportation Queue.
// No DB, no React. Mirrors src/lib/uvvrp/policy.js mergePolicy().
//
// The priority engine (src/lib/scheduling/priority.js) reads these thresholds
// to turn time-to-pickup + VIP/emergency/overdue into a derived level. Stored in
// system_settings under 'dispatch_policy'; defaults apply whenever a key is
// missing so the queue never depends on the admin having saved a policy.

export const DEFAULT_DISPATCH_POLICY = {
  // Minutes before pickup that separate the derived bands.
  criticalMinutes: 15, // ≤ this → Critical
  highMinutes: 30,     // ≤ this → High
  mediumMinutes: 120,  // ≤ this → Medium; later today → Normal; other day → Future
  // Whether VIP / emergency flags are shown and considered by the queue.
  enableVipFlag: true,
  enableEmergencyFlag: true,
};

const POSITIVE_MINUTES = (v) =>
  Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined;

/** Merge a stored policy object over the defaults (never trust stored shape). */
export function mergeDispatchPolicy(stored) {
  const s = stored || {};
  const base = {
    ...DEFAULT_DISPATCH_POLICY,
    ...s,
  };
  base.criticalMinutes = POSITIVE_MINUTES(s.criticalMinutes) ?? DEFAULT_DISPATCH_POLICY.criticalMinutes;
  base.highMinutes = POSITIVE_MINUTES(s.highMinutes) ?? DEFAULT_DISPATCH_POLICY.highMinutes;
  base.mediumMinutes = POSITIVE_MINUTES(s.mediumMinutes) ?? DEFAULT_DISPATCH_POLICY.mediumMinutes;
  base.enableVipFlag = s.enableVipFlag === undefined ? DEFAULT_DISPATCH_POLICY.enableVipFlag : s.enableVipFlag === true;
  base.enableEmergencyFlag =
    s.enableEmergencyFlag === undefined ? DEFAULT_DISPATCH_POLICY.enableEmergencyFlag : s.enableEmergencyFlag === true;
  return base;
}

/** Validate an incoming threshold set; returns { ok, error? }. */
export function validateDispatchPolicy(policy) {
  for (const key of ["criticalMinutes", "highMinutes", "mediumMinutes"]) {
    const v = policy?.[key];
    if (v === undefined || v === null) continue;
    if (!Number.isFinite(Number(v)) || Number(v) <= 0) {
      return { ok: false, error: `${key} must be a positive number` };
    }
  }
  if (policy?.criticalMinutes != null && policy?.highMinutes != null && policy?.mediumMinutes != null) {
    if (Number(policy.criticalMinutes) >= Number(policy.highMinutes)) {
      return { ok: false, error: "criticalMinutes must be less than highMinutes" };
    }
    if (Number(policy.highMinutes) >= Number(policy.mediumMinutes)) {
      return { ok: false, error: "highMinutes must be less than mediumMinutes" };
    }
  }
  return { ok: true };
}
