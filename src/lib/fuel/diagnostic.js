// Fuel efficiency diagnostics: the pure part of turning a below-baseline
// efficiency window into a maintenance work order.
//
// Split from the DB work (src/lib/fuel/maintenance.js) for the same reason
// buildInspectionMaintenancePayload is split from
// src/lib/inspections/maintenance.js — the decision worth testing is the
// payload shape ("Scheduled/Normal/cost-0/dated-tomorrow"), and testing it
// should not require a database.
//
// MANUAL FILING ONLY. Nothing in this module files, schedules, or auto-creates
// anything: the reports page calls buildFuelDiagnosticPayload for one specific
// row a Fleet Manager or admin looked at and chose to investigate. There is no
// cron, no auto-file on "Below baseline", and no grounding — see
// nextCalendarDay below for why the date is tomorrow rather than today.
import { manilaDateKey } from "@/lib/dates";

// Machine-readable marker. POST /api/vehicle-maintenance keys its
// maintenance-queue notification off this (isFuelDiagnosticPayload), and the
// remarks stay greppable for later audit. Free text around it is fine.
export const FUEL_DIAGNOSTIC_MARKER = "[fuel-diagnostic v1]";

export const FUEL_DIAGNOSTIC_TYPE = "Inspection";

/**
 * Tomorrow, as a Manila operational calendar day.
 *
 * syncVehicleStatus (src/services/status.service.js) treats a work order as
 * vehicle-grounding when it is `In Progress`, `Pending Inspection`, OR
 * `Scheduled AND maintenance_date <= <Manila today>` (manilaDateKey string
 * comparison; the vehicle list uses the equivalent
 * `(NOW() AT TIME ZONE 'Asia/Manila')::date`). So `Scheduled` alone does
 * NOT keep a vehicle dispatchable while the order is dated today — the date is
 * half of that predicate, not decoration.
 *
 * A fuel diagnostic is deliberately non-grounding (a below-baseline window is
 * a period aggregate, not a per-fill fault — the vehicle is inspected, not
 * impounded), so its date must be strictly after today for that claim to hold.
 * Same precedent as the office-raised checklist payload
 * (buildChecklistMaintenancePayload): tomorrow reads as triage due next, not
 * as an order forgotten in six months. maintenanceDateRule accepts a future
 * Scheduled date, so validation passes.
 */
export function nextCalendarDay(from = new Date()) {
  const tomorrow = new Date(`${manilaDateKey(from)}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

/**
 * Whether a maintenance POST body is a fuel diagnostic filing. The server
 * notifier keys off this — never off status/priority/type alone, so an
 * ordinary Inspection order never pages the queue with fuel copy.
 */
export function isFuelDiagnosticPayload(body) {
  return (
    body?.maintenance_type === FUEL_DIAGNOSTIC_TYPE &&
    typeof body?.remarks === "string" &&
    body.remarks.includes(FUEL_DIAGNOSTIC_MARKER)
  );
}

/**
 * Build the work order for a below-baseline efficiency window a Fleet Manager
 * or admin chose to investigate.
 *
 * @param {object} input
 * @param {number} input.vehicleId
 * @param {string} [input.plate] plate shown in the description when known
 * @param {number} input.estimatedKmpl period estimate (completed-trip km / eligible liters)
 * @param {number} input.baselineKmpl vehicles.fuel_efficiency_kmpl
 * @param {number} input.variancePercent (estimated - baseline) / baseline * 100
 * @param {string} input.from report window start (YYYY-MM-DD)
 * @param {string} input.to report window end (YYYY-MM-DD)
 * @param {number} input.trips completed trips in the window
 * @param {number} input.km completed-trip distance in the window
 * @param {number} input.liters eligible fuel volume in the window
 * @returns {object} a vehiclemaintenance insert payload (minus provenance;
 *   the POST route forces status Scheduled and stamps created_by itself)
 */
export function buildFuelDiagnosticPayload({
  vehicleId,
  plate,
  estimatedKmpl,
  baselineKmpl,
  variancePercent,
  from,
  to,
  trips,
  km,
  liters,
}) {
  const plateLabel = String(plate ?? "").trim() || `vehicle #${vehicleId}`;
  const estimate = Number(estimatedKmpl).toFixed(2);
  const baseline = Number(baselineKmpl).toFixed(2);
  // Round at build time: callers pass pre-rounded values today, but raw
  // floats must never leak into the work order copy.
  const varianceNum = variancePercent == null ? null : Number(variancePercent);
  const variance = varianceNum == null || !Number.isFinite(varianceNum) ? "n/a" : `${varianceNum.toFixed(2)}%`;

  return {
    vehicle_id: vehicleId,
    // Tomorrow, not today: a Scheduled order dated today grounds the vehicle
    // (see nextCalendarDay). A diagnostic must not take a truck off dispatch.
    maintenance_date: nextCalendarDay(),
    maintenance_type: FUEL_DIAGNOSTIC_TYPE,
    description:
      `Fuel efficiency diagnostic: ${plateLabel} estimated ${estimate} km/L vs baseline ${baseline} km/L ` +
      `(variance ${variance}) over ${from}–${to} (${trips} trips, ${km} km / ${liters} L). Review before dispatch action.`,
    // Real cost lands here after the work, via the maintenance register.
    cost: 0,
    status: "Scheduled",
    priority: "Normal",
    // Machine-readable reference first (source range + the exact numbers the
    // report showed, so the work order stands alone), then the honesty line:
    // a below-baseline window is a period aggregate, never evidence about a
    // single fill — the mechanic inspects, and pilferage is not inferred.
    remarks:
      `${FUEL_DIAGNOSTIC_MARKER} source=fuel-consumption report; range=${from}..${to}; ` +
      `vehicle_id=${vehicleId}; estimated_kmpl=${estimatedKmpl}; baseline_kmpl=${baselineKmpl}; ` +
      `variance_pct=${variancePercent}; trips=${trips}; distance_km=${km}; liters=${liters}. ` +
      `Below-baseline is period-aggregate, not a per-fill fault — inspect, do not infer pilferage.`,
  };
}
