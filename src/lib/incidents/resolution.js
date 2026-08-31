// Pure decision helpers for the incident resolution workflow.
//
// Extracted from the routes so the rules are unit-testable without a database
// (same pattern as src/lib/driver/grounding.js). The routes own all DB and
// notification side effects.

// The closed status vocabulary enforced by chk_driverincidents_status
// (migration 062). Code only ever produces these two values.
export const INCIDENT_STATUSES = ["Open", "Resolved"];
export const INCIDENT_READ_ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management"];
export const INCIDENT_ACTION_ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher"];
export const INCIDENT_MAINTENANCE_ROLES = ["system_admin", "admin", "fleet_manager"];

export const INCIDENT_SEVERITIES = ["Minor", "Moderate", "Major", "Critical"];

// Keep the stored type human-readable for legacy clients, while normalizing
// the categories emitted by the mobile and web forms so reports can group them
// reliably. Unknown legacy text is preserved rather than discarded.
export const INCIDENT_TYPES = [
  "breakdown",
  "accident",
  "weather",
  "cargo",
  "medical",
  "near_miss",
  "emergency",
  "other",
];

export const INCIDENT_TYPE_LABELS = {
  breakdown: "Vehicle Breakdown",
  accident: "Traffic Accident",
  weather: "Severe Weather",
  cargo: "Cargo Issue",
  medical: "Medical Emergency",
  near_miss: "Near Miss",
  emergency: "Emergency",
  other: "Other Incident",
};

export const GROUNDING_STATUSES = ["Not Required", "Pending", "Complete", "Failed"];

export const INCIDENT_ASSISTANCE_OPTIONS = [
  "Tow Truck",
  "Mechanic",
  "Medical Assistance",
  "Police",
  "Alternative Vehicle",
  "Fuel",
];

/**
 * Normalize the controlled categories used by the report forms. Existing
 * free-text categories remain valid so older reports are never rewritten to a
 * less useful value.
 */
export function normalizeIncidentType(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[\-_]+/g, " ").replace(/\s+/g, " ");
  if (/breakdown|mechanical|engine|brake|flat tire|tire|tyre|battery|electrical|overheat|transmission|steering/.test(normalized)) return "breakdown";
  if (normalized.includes("accident")) return "accident";
  if (normalized.includes("weather")) return "weather";
  if (normalized.includes("cargo")) return "cargo";
  if (normalized.includes("medical")) return "medical";
  if (normalized === "near miss" || normalized === "near-miss") return "near_miss";
  if (normalized === "emergency") return "emergency";
  if (normalized === "other" || normalized === "other incident") return "other";
  return raw;
}

export function incidentTypeLabel(value) {
  const normalized = normalizeIncidentType(value);
  return INCIDENT_TYPE_LABELS[normalized] || value || "Incident";
}

/**
 * Map any legacy/case-variant status spelling onto the canonical vocabulary.
 * @param {string|undefined} value
 * @returns {string|null} canonical status, or null when unrecognized
 */
export function normalizeIncidentStatus(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "open" || v === "pending") return "Open";
  if (v === "resolved") return "Resolved";
  return null;
}

/**
 * Decide whether a status transition is allowed.
 *
 * Resolving an already-resolved incident is rejected (409 at the call site) so
 * a double-click or stale tab cannot fire duplicate side effects — driver
 * notifications, vehicle syncs. Reopening is intentionally not supported by
 * the current UI; a future reopen action should carry its own reason and audit.
 *
 * @param {string} from current status
 * @param {string} to requested status
 * @returns {{ ok: boolean, reason?: "not-found"|"conflict" }}
 */
export function canTransition(from, to) {
  if (from === "Resolved") {
    return { ok: false, reason: "conflict" };
  }
  return { ok: true };
}

/**
 * Validate the actions_taken narrative required to resolve.
 * @param {string|undefined} actionsTaken
 * @returns {string|null} error message, or null when acceptable
 */
export function resolutionActionsError(actionsTaken) {
  if (typeof actionsTaken !== "string" || !actionsTaken.trim()) {
    return "Actions taken is required to resolve an incident";
  }
  return null;
}

/**
 * Incident resolution must not release a vehicle whose required work order is
 * still open (or has not been created after an automation failure).
 */
export function shouldKeepVehicleGrounded({ status, requiresVehicleMaintenance, maintenanceStatus }) {
  return status === "Resolved" && Boolean(requiresVehicleMaintenance) && maintenanceStatus !== "Completed";
}

const EMERGENCY_TYPE = "Emergency Repair";
const EMERGENCY_STATUS = "In Progress";
const EMERGENCY_PRIORITY = "High";

function todayIsoDate() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * Build the vehiclemaintenance row fields generated from an incident.
 *
 * The caller supplies the incident columns it read inside its transaction;
 * nothing here touches the database.
 *
 * Cost is deliberately booked at 0: the driver-reported expense_amount is a
 * *claim*, not an invoice. Booking it straight into cost made an unverified
 * number flow into fleet-cost analytics; instead the claim travels in remarks
 * where staff see and replace it with the real figure.
 *
 * @param {{
 *   incident_id: number|string,
 *   description?: string|null,
 *   expense_amount?: string|number|null,
 *   incident_type?: string|null,
 * }} incident
 * @returns {{
 *   maintenance_date: string,
 *   maintenance_type: string,
 *   description: string,
 *   cost: number,
 *   status: string,
 *   priority: string,
 *   remarks: string,
 * }}
 */
export function buildEmergencyMaintenancePayload(incident) {
  const rawClaim = Number(incident.expense_amount);
  const claimed = Number.isFinite(rawClaim) && rawClaim > 0 ? rawClaim : null;
  return {
    maintenance_date: todayIsoDate(),
    maintenance_type: EMERGENCY_TYPE,
    description: `Emergency repair generated from Incident #${incident.incident_id}: ${incident.description || ""}`,
    // Real cost lands here after the work, via the maintenance register.
    cost: 0,
    status: EMERGENCY_STATUS,
    priority: EMERGENCY_PRIORITY,
    remarks:
      `Incident Type: ${incident.incident_type || "Unknown"}` +
      (claimed != null ? ` | Driver-reported expense claim: ₱${claimed.toLocaleString("en-PH")} (unverified — confirm against actual invoice)` : ""),
  };
}

/** Build the automatic work order variant for a vehicle-related incident. */
export function buildIncidentMaintenancePayload(incident) {
  const payload = buildEmergencyMaintenancePayload(incident);
  if (!/(accident|collision|crash)/i.test(String(incident.incident_type || ""))) return payload;
  return {
    ...payload,
    maintenance_type: "Vehicle Inspection",
    description: `Safety inspection generated from Incident #${incident.incident_id}: ${incident.description || ""}`,
    remarks: `${payload.remarks} | Inspect for accident-related vehicle damage before release.`,
  };
}
