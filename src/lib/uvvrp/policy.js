// Number Coding (UVVRP) — pure policy helpers. No DB, no React, no env.
//
// Everything here is deterministic given a policy + a date + a plate, so the
// dispatch gate, the queue conflict chips, the board, and the unit tests all
// share identical logic. The DB-touching counterparts (reading/saving the
// policy, exemptions, violations, notifications) live in ./uvvrp.service.js.

// Standard Metro Manila number-coding window (Mon-Fri, by plate's last digit).
// Sunday/Saturday have no restrictions. Presets are references; the stored
// policy keeps its own weekdayRestrictions so an admin can override per day.
export const UVVRP_PRESETS = {
  Manila: {
    Monday: [1, 2],
    Tuesday: [3, 4],
    Wednesday: [5, 6],
    Thursday: [7, 8],
    Friday: [9, 0],
  },
  QuezonCity: {
    Monday: [1, 2],
    Tuesday: [3, 4],
    Wednesday: [5, 6],
    Thursday: [7, 8],
    Friday: [9, 0],
  },
  Makati: {
    Monday: [1, 2],
    Tuesday: [3, 4],
    Wednesday: [5, 6],
    Thursday: [7, 8],
    Friday: [9, 0],
  },
};

export const DEFAULT_POLICY = {
  enabled: false,
  location: "Manila",
  weekdayRestrictions: UVVRP_PRESETS.Manila,
  response: "block", // block | warn | approve
  exemptionCategories: [
    "Emergency Vehicles",
    "Government Vehicles",
    "VIP Transportation",
    "Executive Vehicles",
    "Hotel Shuttle Services",
  ],
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Merge a stored policy object over the defaults (never trust stored shape). */
export function mergePolicy(stored) {
  const base = {
    ...DEFAULT_POLICY,
    ...(stored || {}),
  };
  base.weekdayRestrictions = {
    ...DEFAULT_POLICY.weekdayRestrictions,
    ...(stored?.weekdayRestrictions || {}),
  };
  base.exemptionCategories = Array.isArray(stored?.exemptionCategories)
    ? stored.exemptionCategories
    : [...DEFAULT_POLICY.exemptionCategories];
  return base;
}

/** JS Date.getDay() (0=Sun..6=Sat) → weekday name. */
export function weekdayFor(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return WEEKDAYS[d.getDay()];
}

/**
 * Last numeric digit of a Philippine plate (e.g. "ABC-1234" → 4). Plates that
 * end in a letter, or have no digit, yield null (no coding applies).
 */
export function plateLastDigit(plate) {
  if (plate == null) return null;
  const normalized = String(plate).toUpperCase().replace(/[^0-9A-Z]/g, "");
  const m = normalized.match(/(\d)(?!.*\d)/);
  if (!m) return null;
  return Number(m[1]);
}

/** The restricted ending digits for a given date under a policy. */
export function restrictedDigitsFor(policy, date) {
  const weekday = weekdayFor(date);
  if (!weekday) return [];
  const map = policy?.weekdayRestrictions || {};
  const digits = map[weekday];
  return Array.isArray(digits) ? digits.map((d) => Number(d)) : [];
}

/** Whether a plate is coding-restricted on a given date under a policy. */
export function isRestricted(plate, policy, date) {
  if (!policy?.enabled) return false;
  const digit = plateLastDigit(plate);
  if (digit == null) return false;
  return restrictedDigitsFor(policy, date).includes(digit);
}

/** Whether a per-vehicle exemption row is currently effective. */
export function isExemptionActive(exemption, date) {
  if (!exemption) return false;
  if (exemption.active !== true) return false;
  if (exemption.expires_on) {
    const d = new Date(date);
    const e = new Date(exemption.expires_on);
    if (Number.isFinite(e.getTime()) && d.getTime() > e.getTime()) return false;
  }
  return true;
}
