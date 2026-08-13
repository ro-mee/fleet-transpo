// Dispatch policy — pure defaults/merge for the Smart Transportation Queue.
// No DB, no React. Mirrors src/lib/uvvrp/policy.js mergePolicy().
//
// The priority engine (src/lib/scheduling/priority.js) reads these thresholds
// to turn time-to-pickup + VIP/emergency/overdue into a derived level. Stored in
// system_settings under 'dispatch_policy'; defaults apply whenever a key is
// missing so the queue never depends on the admin having saved a policy.

import { normalizeTiers } from "@/lib/scheduling/departure-alerts";

export const DEFAULT_DISPATCH_POLICY = {
  // Minutes before pickup that separate the derived bands.
  criticalMinutes: 15, // ≤ this → Critical
  highMinutes: 30,     // ≤ this → High
  mediumMinutes: 120,  // ≤ this → Medium; later today → Normal; other day → Future
  // Whether VIP / emergency flags are shown and considered by the queue.
  enableVipFlag: true,
  enableEmergencyFlag: true,
  // Unassigned-departure warnings on the dispatch board. Tiers are minutes
  // before scheduled_departure, widest first; see
  // src/lib/scheduling/departure-alerts.js for how they are matched.
  departureAlertsEnabled: true,
  departureAlertTiers: [30, 20, 10],
  // Travel-time + safety-buffer eligibility (SYSTEM.md §4.8.3): when a resource
  // has a previous commitment ending near the next pickup, the pickup must be at
  // or after `prev_end + travel_time_to_pickup + buffer` to be eligible. The
  // buffer is a configurable offset on TOP of TomTom travel time (not a fixed 30
  // minutes), with a separate floor for very short hops.
  travelBufferEnabled: true,
  safetyBufferMinutes: 10,
  bufferFloorMinutes: 5,
};

/** Upper bound on tier count — the settings UI and the card both stay legible. */
export const MAX_DEPARTURE_TIERS = 5;

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
  base.departureAlertsEnabled =
    s.departureAlertsEnabled === undefined
      ? DEFAULT_DISPATCH_POLICY.departureAlertsEnabled
      : s.departureAlertsEnabled === true;
  // normalizeTiers drops junk and sorts widest-first, returning null when
  // nothing usable survives — so a corrupt stored array falls back to defaults.
  base.departureAlertTiers =
    normalizeTiers(s.departureAlertTiers)?.slice(0, MAX_DEPARTURE_TIERS) ??
    DEFAULT_DISPATCH_POLICY.departureAlertTiers;
  base.travelBufferEnabled =
    s.travelBufferEnabled === undefined ? DEFAULT_DISPATCH_POLICY.travelBufferEnabled : s.travelBufferEnabled === true;
  base.safetyBufferMinutes = POSITIVE_MINUTES(s.safetyBufferMinutes) ?? DEFAULT_DISPATCH_POLICY.safetyBufferMinutes;
  base.bufferFloorMinutes = POSITIVE_MINUTES(s.bufferFloorMinutes) ?? DEFAULT_DISPATCH_POLICY.bufferFloorMinutes;
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
  const tiers = policy?.departureAlertTiers;
  if (tiers !== undefined && tiers !== null) {
    if (!Array.isArray(tiers)) {
      return { ok: false, error: "departureAlertTiers must be an array of minutes" };
    }
    if (tiers.length === 0) {
      return { ok: false, error: "departureAlertTiers needs at least one threshold" };
    }
    if (tiers.length > MAX_DEPARTURE_TIERS) {
      return { ok: false, error: `departureAlertTiers allows at most ${MAX_DEPARTURE_TIERS} thresholds` };
    }
    for (const t of tiers) {
      if (!Number.isFinite(Number(t)) || Number(t) <= 0) {
        return { ok: false, error: "each departure alert threshold must be a positive number" };
      }
    }
    if (new Set(tiers.map(Number)).size !== tiers.length) {
      return { ok: false, error: "departure alert thresholds must be distinct" };
    }
  }
  for (const key of ["safetyBufferMinutes", "bufferFloorMinutes"]) {
    const v = policy?.[key];
    if (v === undefined || v === null) continue;
    if (!Number.isFinite(Number(v)) || Number(v) <= 0) {
      return { ok: false, error: `${key} must be a positive number` };
    }
  }
  return { ok: true };
}
