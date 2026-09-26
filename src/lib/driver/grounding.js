// Grounding predicate for driver incident automation.
//
// A reported incident takes the vehicle out of service (vehicle_status →
// "Under Maintenance") when it is either a breakdown-type report or flagged
// Major/Critical severity. Extracted as a pure function so the rule is
// unit-testable and shared; the route owns the DB side effects.

const BREAKDOWN_RE = /breakdown|mechanical|engine|brake|flat tire|tire|tyre|battery|electrical|overheat|transmission|steering/i;
const ACCIDENT_RE = /accident|collision|crash/i;
const VEHICLE_DAMAGE_RE = /damage|damaged|dent|bumper|bodywork|mirror|windshield|impact/i;

export { BREAKDOWN_RE, ACCIDENT_RE, VEHICLE_DAMAGE_RE };

export const SEVERE_SEVERITIES = new Set(["Major", "Critical"]);

/**
 * Decide whether a report needs a linked maintenance work order. This is
 * intentionally narrower than shouldGroundVehicle: a severe medical or
 * passenger incident can temporarily ground a vehicle without inventing a
 * repair job. Accidents need a severe rating or an explicit damage signal.
 */
export function requiresVehicleMaintenance({ incidentType, severity, description, vehicleId }) {
  if (!vehicleId) return false;
  const type = String(incidentType ?? "");
  const text = `${type} ${String(description ?? "")}`;
  if (BREAKDOWN_RE.test(type)) return true;
  if (ACCIDENT_RE.test(type)) return SEVERE_SEVERITIES.has(severity) || VEHICLE_DAMAGE_RE.test(String(description ?? ""));
  return /vehicle\s+(?:damage|damaged)|damaged\s+vehicle|bodywork|bumper|windshield|transmission|steering/i.test(text);
}

/**
 * Decide whether an incident report should ground the vehicle.
 * @param {{ incidentType?: string, severity?: string, vehicleId?: number|null }} input
 * @returns {boolean}
 */
export function shouldGroundVehicle({ incidentType, severity, vehicleId }) {
  if (!vehicleId) return false;
  if (SEVERE_SEVERITIES.has(severity)) return true;
  return BREAKDOWN_RE.test(incidentType ?? "");
}

// The prose-safe spelling of the vocabulary above.
//
// The shared regexes are matched against short controlled strings (incident
// types), where substring matching is harmless. Prose is not: `tire` also
// matches "tired" and "entire", so "I am tired" and "the entire vehicle is
// fine" both ground a vehicle under BREAKDOWN_RE, and `dent` matches
// "accident", so "no accident today" grounds under VEHICLE_DAMAGE_RE. That is
// tolerable for a dropdown value and not for free text, where it would take a
// serviceable vehicle out of dispatch because a driver mentioned being tired —
// the kind of false positive that teaches dispatchers to ignore the flag.
//
// Same words, anchored. Kept in step with the regexes above by a parity test in
// grounding.test.js rather than by this comment, so a term added to one and not
// the other fails the suite instead of silently going unenforced.
export const PROSE_GROUNDING_RE = /\b(?:breakdown|mechanical|engine|brakes?|flat tire|tires?|tyres?|battery|electrical|overheat|transmission|steering|damaged?|dents?|bumper|bodywork|mirror|windshield|impact)\b/i;

// The Filipino terms for the same faults, plus leak and smoke, which have no
// English counterpart above. Chosen on a parity rule rather than by brainstorm:
// a statement must get the same answer in either language, so each entry
// corresponds to an anchored term — preno/brake, gulong/tire, manibela/steering,
// makina/engine, baterya/battery, basag/damage, usok/overheat, tagas/leak.
// Drivers report in the language they think in, and an English-only list misses
// the fault exactly when it matters.
export const TAGLISH_GROUNDING_RE = /\b(?:preno|gulong|manibela|makina|baterya|usok|tagas|tumutulo|basag)\b/i;

/**
 * Decide whether an End Duty report's free text should ground the vehicle.
 *
 * End Duty reports arrive as prose: no incident type, no severity, just what the
 * driver noticed. The vocabulary above is reused rather than reinvented, so
 * "brake" means the same thing wherever it is typed.
 *
 * The limits are real. This is keyword matching over free text and a fault
 * described in unexpected words will NOT match — which is why a non-matching
 * report still files a work order, just a Scheduled one for a human to read.
 * **The keywords decide urgency, never whether a report is recorded.** A miss
 * therefore delays a repair; it cannot lose one.
 *
 * @param {string} text the driver's own words
 * @returns {boolean} true when the vehicle should leave dispatch until inspected
 */
export function shouldGroundReportedDefect(text) {
  const s = String(text ?? "");
  return PROSE_GROUNDING_RE.test(s) || TAGLISH_GROUNDING_RE.test(s);
}
