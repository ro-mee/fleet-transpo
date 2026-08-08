// Grounding predicate for driver incident automation.
//
// A reported incident takes the vehicle out of service (vehicle_status →
// "Under Maintenance") when it is either a breakdown-type report or flagged
// Major/Critical severity. Extracted as a pure function so the rule is
// unit-testable and shared; the route owns the DB side effects.

const BREAKDOWN_RE = /breakdown|mechanical|engine|flat tire|battery|electrical|overheat/i;

export { BREAKDOWN_RE };

export const SEVERE_SEVERITIES = new Set(["Major", "Critical"]);

/**
 * Decide whether an incident report should ground the vehicle.
 * @param {{ incidentType?: string, severity?: string, vehicleId?: number|null }} input
 * @returns {boolean}
 */
export function shouldGroundVehicle({ incidentType, severity, vehicleId }) {
  if (!vehicleId) return false;
  const isBreakdown = BREAKDOWN_RE.test(String(incidentType || ""));
  const isSevere = SEVERE_SEVERITIES.has(severity);
  return isBreakdown || isSevere;
}
