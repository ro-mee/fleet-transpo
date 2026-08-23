// Pure decision helpers for the incident resolution workflow.
//
// Extracted from the routes so the rules are unit-testable without a database
// (same pattern as src/lib/driver/grounding.js). The routes own all DB and
// notification side effects.

// The closed status vocabulary enforced by chk_driverincidents_status
// (migration 062). Code only ever produces these two values.
export const INCIDENT_STATUSES = ["Open", "Resolved"];

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
 * notifications, vehicle syncs. Reopening is allowed; re-resolving after a
 * reopen is just Open → Resolved again.
 *
 * @param {string} from current status
 * @param {string} to requested status
 * @returns {{ ok: boolean, reason?: "not-found"|"conflict" }}
 */
export function canTransition(from, to) {
  if (from === "Resolved" && to === "Resolved") {
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

// Fixed audit text written on the incident when it is routed to emergency
// repairs, shared by the atomic endpoint and its tests.
export const MAINTENANCE_ACTIONS_TAKEN =
  "Sent to vehicle maintenance team for emergency repairs.";

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
  const rawCost = Number(incident.expense_amount);
  const cost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
  return {
    maintenance_date: todayIsoDate(),
    maintenance_type: EMERGENCY_TYPE,
    description: `Emergency repair generated from Incident #${incident.incident_id}: ${incident.description || ""}`,
    cost,
    status: EMERGENCY_STATUS,
    priority: EMERGENCY_PRIORITY,
    remarks: `Incident Type: ${incident.incident_type || "Unknown"}`,
  };
}
