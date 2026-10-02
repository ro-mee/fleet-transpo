// Fuel policy — pure defaults, merge, and validation for fuel planning and approval.
// No DB, no React. Mirrors src/lib/dispatch-policy.js and src/lib/security-policy.js.
//
// Stored in system_settings under 'fuel_policy'. Every default below is the value
// the code previously hard-coded, so a database without a saved policy behaves
// with exact historical parity.

export const FUEL_POLICY_KEY = "fuel_policy";

export const DEFAULT_FUEL_POLICY = Object.freeze({
  // Refueling & planning thresholds (% of tank capacity)
  reserveBufferPercent: 10,
  preferredTargetPercent: 90,
  maxFillCapPercent: 100,

  // Consumption variance & pilferage detection
  varianceThresholdPercent: 15,
  enableVarianceAlerts: true,

  // Auto-authorization engine
  autoApprovalEnabled: true,
  autoApprovalMaxLiters: 60,
  requireGaugePhoto: true,

  // Budget & cost controls
  budgetEnforcementMode: "warning", // "warning" (manager override allowed) | "strict" (hard block)
  maxPricePerLiter: 120,            // Historical anomaly threshold (PHP)
  strictFuelTypeMatching: false,    // Block vs warn on receipt fuel-type mismatch
});

export const FUEL_POLICY_RANGES = Object.freeze({
  reserveBufferPercent: { min: 5, max: 40 },
  preferredTargetPercent: { min: 40, max: 100 },
  maxFillCapPercent: { min: 80, max: 100 },
  varianceThresholdPercent: { min: 5, max: 40 },
  autoApprovalMaxLiters: { min: 10, max: 200 },
  maxPricePerLiter: { min: 40, max: 200 },
});

const FINITE_NUM = (v) =>
  v === null || v === undefined || v === "" ? undefined :
    Number.isFinite(Number(v)) ? Number(v) : undefined;

const CLAMP = (val, min, max) =>
  Math.min(max, Math.max(min, Number(val)));

/** Merge a stored policy object over the defaults (never trust stored shape). */
export function mergeFuelPolicy(stored) {
  const s = stored || {};
  const base = { ...DEFAULT_FUEL_POLICY, ...s };

  const reserve = FINITE_NUM(s.reserveBufferPercent) ?? DEFAULT_FUEL_POLICY.reserveBufferPercent;
  base.reserveBufferPercent = CLAMP(reserve, FUEL_POLICY_RANGES.reserveBufferPercent.min, FUEL_POLICY_RANGES.reserveBufferPercent.max);

  const target = FINITE_NUM(s.preferredTargetPercent) ?? DEFAULT_FUEL_POLICY.preferredTargetPercent;
  base.preferredTargetPercent = CLAMP(target, Math.max(base.reserveBufferPercent + 5, FUEL_POLICY_RANGES.preferredTargetPercent.min), FUEL_POLICY_RANGES.preferredTargetPercent.max);

  const cap = FINITE_NUM(s.maxFillCapPercent) ?? DEFAULT_FUEL_POLICY.maxFillCapPercent;
  base.maxFillCapPercent = CLAMP(cap, FUEL_POLICY_RANGES.maxFillCapPercent.min, FUEL_POLICY_RANGES.maxFillCapPercent.max);
  base.preferredTargetPercent = Math.min(base.preferredTargetPercent, base.maxFillCapPercent);

  const variance = FINITE_NUM(s.varianceThresholdPercent) ?? DEFAULT_FUEL_POLICY.varianceThresholdPercent;
  base.varianceThresholdPercent = CLAMP(variance, FUEL_POLICY_RANGES.varianceThresholdPercent.min, FUEL_POLICY_RANGES.varianceThresholdPercent.max);

  const maxLiters = FINITE_NUM(s.autoApprovalMaxLiters) ?? DEFAULT_FUEL_POLICY.autoApprovalMaxLiters;
  base.autoApprovalMaxLiters = CLAMP(maxLiters, FUEL_POLICY_RANGES.autoApprovalMaxLiters.min, FUEL_POLICY_RANGES.autoApprovalMaxLiters.max);

  const maxPrice = FINITE_NUM(s.maxPricePerLiter) ?? DEFAULT_FUEL_POLICY.maxPricePerLiter;
  base.maxPricePerLiter = CLAMP(maxPrice, FUEL_POLICY_RANGES.maxPricePerLiter.min, FUEL_POLICY_RANGES.maxPricePerLiter.max);

  base.enableVarianceAlerts = s.enableVarianceAlerts === undefined ? DEFAULT_FUEL_POLICY.enableVarianceAlerts : s.enableVarianceAlerts === true;
  base.autoApprovalEnabled = s.autoApprovalEnabled === undefined ? DEFAULT_FUEL_POLICY.autoApprovalEnabled : s.autoApprovalEnabled === true;
  base.requireGaugePhoto = s.requireGaugePhoto === undefined ? DEFAULT_FUEL_POLICY.requireGaugePhoto : s.requireGaugePhoto === true;
  base.strictFuelTypeMatching = s.strictFuelTypeMatching === undefined ? DEFAULT_FUEL_POLICY.strictFuelTypeMatching : s.strictFuelTypeMatching === true;
  base.budgetEnforcementMode = s.budgetEnforcementMode === "strict" ? "strict" : "warning";

  return base;
}

/** Validate an incoming policy update; returns { ok: boolean, error?: string }. */
export function validateFuelPolicy(policy) {
  if (!policy || typeof policy !== "object") {
    return { ok: false, error: "Policy must be an object" };
  }

  for (const [key, range] of Object.entries(FUEL_POLICY_RANGES)) {
    const v = policy[key];
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `${key} must be a number` };
    }
    if (n < range.min || n > range.max) {
      return { ok: false, error: `${key} must be between ${range.min} and ${range.max}` };
    }
  }

  const reserve = policy.reserveBufferPercent ?? DEFAULT_FUEL_POLICY.reserveBufferPercent;
  const target = policy.preferredTargetPercent ?? DEFAULT_FUEL_POLICY.preferredTargetPercent;
  const cap = policy.maxFillCapPercent ?? DEFAULT_FUEL_POLICY.maxFillCapPercent;
  if (Number(reserve) >= Number(target)) {
    return { ok: false, error: "Reserve buffer percentage must be less than preferred target fill percentage" };
  }
  if (Number(target) > Number(cap)) {
    return { ok: false, error: "Preferred target fill percentage must not exceed the maximum fill cap" };
  }

  if (policy.budgetEnforcementMode !== undefined && !["warning", "strict"].includes(policy.budgetEnforcementMode)) {
    return { ok: false, error: "budgetEnforcementMode must be either 'warning' or 'strict'" };
  }
  for (const key of ["enableVarianceAlerts", "autoApprovalEnabled", "requireGaugePhoto", "strictFuelTypeMatching"]) {
    if (policy[key] !== undefined && typeof policy[key] !== "boolean") {
      return { ok: false, error: `${key} must be a boolean` };
    }
  }

  return { ok: true };
}
