// End Duty reports: the pure part of turning a driver's observation into a
// maintenance work order.
//
// Split from the DB work (src/lib/inspections/maintenance.js) for the same
// reason buildEmergencyMaintenancePayload is split from
// src/lib/incidents/maintenance.js — the decision worth testing is "grounded or
// scheduled", and testing it should not require a database.
import { toCalendarDay } from "@/lib/dates";

// A driver-reported defect is a repair, not an emergency. The incident path can
// say "Emergency Repair" because an incident already implies the vehicle is
// stopped and someone is dealing with it; an End Duty report is filed at the
// end of a shift, often about something noticed hours earlier, so it enters the
// register as an ordinary repair for the office to triage.
//
// `maintenance_type` is free varchar with no CHECK, and the office has two forms
// with different type lists (MaintenanceFormDialog: Routine/Corrective/
// Preventive/Emergency; maintenance/page.js: Routine/Repair/Emergency/
// Inspection). "Repair" at least appears in one of them. The pre-existing
// situation is that auto-generated types sit outside both lists — the incident
// path writes "Emergency Repair" and "Vehicle Inspection", which are in
// neither — so this is consistent with the established behaviour rather than a
// new wrinkle.
const DEFECT_TYPE = "Repair";

// status is the operational lever, not decoration: /api/vehicles/available
// excludes vehicles whose maintenance is "In Progress" or "Pending Inspection",
// so "In Progress" is what actually removes a vehicle from dispatch.
const GROUNDED_STATUS = "In Progress";
const SCHEDULED_STATUS = "Scheduled";
const GROUNDED_PRIORITY = "High";
const SCHEDULED_PRIORITY = "Normal";

/**
 * Build the work order for an End Duty report.
 *
 * @param {object} input
 * @param {number} input.inspectionId  the vehicleinspection row this came from
 * @param {number} input.vehicleId
 * @param {string} [input.plateNumber] shown in the description when known
 * @param {string} input.findings      the driver's own words, unedited
 * @param {boolean} input.grounded     from shouldGroundReportedDefect
 * @returns {object} a vehiclemaintenance insert payload (minus provenance)
 */
export function buildInspectionMaintenancePayload({ inspectionId, vehicleId, plateNumber, findings, grounded }) {
  const described = String(findings ?? "").trim();
  const vehicle = plateNumber
    ? `vehicle #${vehicleId} / ${plateNumber}`
    : `vehicle #${vehicleId}`;

  return {
    maintenance_date: toCalendarDay(new Date()),
    maintenance_type: DEFECT_TYPE,
    description:
      `Repair reported by driver at end of shift (inspection #${inspectionId}, ${vehicle}): ${described}`,
    // Real cost lands here after the work, via the maintenance register.
    cost: 0,
    status: grounded ? GROUNDED_STATUS : SCHEDULED_STATUS,
    priority: grounded ? GROUNDED_PRIORITY : SCHEDULED_PRIORITY,
    // The honesty note. This is unedited driver prose, not a diagnosis — a human
    // decides what the fault is. Mirrors the incident path's "unverified —
    // confirm against actual invoice" remark, and states which branch the
    // keyword test took so a reviewer can tell an automatic grounding from a
    // routine filing without re-reading the keywords.
    remarks: grounded
      ? "Reported via End Duty | Grounded automatically: the report matched a severe-fault keyword — verify before returning the vehicle to service."
      : "Reported via End Duty | Filed for triage: no severe-fault keyword matched, so the vehicle stays dispatchable until this is reviewed.",
  };
}

/**
 * Tomorrow, as a local calendar day.
 *
 * /api/vehicles/available (route.js:73-84) hides a vehicle when it has a
 * maintenance row that is `In Progress`, `Pending Inspection`, OR
 * `Scheduled AND maintenance_date <= CURRENT_DATE`. So `Scheduled` alone does
 * NOT keep a vehicle dispatchable while the order is dated today — the date is
 * half of that predicate, not decoration.
 *
 * An office raise is deliberately non-grounding ("the office decides that", not
 * the button), so its date has to be strictly after today for the claim to be
 * true. Using tomorrow rather than a far-future date keeps it inside the normal
 * scheduling window: it reads as triage due next, not as an order forgotten in
 * six months.
 */
function nextCalendarDay() {
  const now = new Date();
  return toCalendarDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

/**
 * Build the work order for a failed checklist inspection, raised by the office.
 *
 * Deliberately not the function above with different arguments — the
 * differences are load-bearing:
 *
 *  - There is no `grounded` parameter, so there is no branch: status is always
 *    SCHEDULED_STATUS. That is not caution, it is arithmetic. A Pre-Trip's four
 *    items ARE the critical set (CRITICAL_ITEM_IDS = [...PRE_TRIP_ITEMS]), so
 *    every failed Pre-Trip is 'High' by construction, and a Pre-Trip runs per
 *    trip. Ground-on-High here would take a vehicle out of service on a mis-tap
 *    several times a day, which is how drivers learn to pass things.
 *  - It does not call shouldGroundReportedDefect, which keyword-matches free
 *    prose. `findings` for a checklist type is a JSON array of items, so that
 *    test would be run against the wrong input entirely.
 *  - The wording names the inspection type. The End Duty sentence ("reported by
 *    driver at end of shift") would be false: nobody ended a shift.
 *  - `maintenance_date` is TOMORROW, not today — see nextCalendarDay. Today's
 *    date would satisfy the `Scheduled AND maintenance_date <= CURRENT_DATE`
 *    arm of /api/vehicles/available and ground the vehicle, contradicting the
 *    "not grounded" remark this payload writes.
 */
export function buildChecklistMaintenancePayload({
  inspectionId, vehicleId, plateNumber, inspectionType, severity, failedItems,
}) {
  const vehicle = plateNumber ? `vehicle #${vehicleId} / ${plateNumber}` : `vehicle #${vehicleId}`;
  const items = Array.isArray(failedItems) ? failedItems : [];
  const described = items
    .map((item) => (item.remarks ? `${item.label}: ${item.remarks}` : item.label))
    .join("; ");

  return {
    maintenance_date: nextCalendarDay(),
    maintenance_type: DEFECT_TYPE,
    description: `${inspectionType} inspection failed (inspection #${inspectionId}, ${vehicle}): ${described}`,
    cost: 0,
    status: SCHEDULED_STATUS,
    priority: SCHEDULED_PRIORITY,
    remarks:
      `Raised by the office from a failed ${inspectionType} inspection | Severity ${severity || "Not assessed"} | ` +
      "Filed for triage, not grounded — a failed checklist does not remove a vehicle from dispatch; the office decides that.",
  };
}
