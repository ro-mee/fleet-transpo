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
