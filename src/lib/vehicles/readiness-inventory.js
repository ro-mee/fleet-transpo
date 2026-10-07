/**
 * Staged-rollout fleet inventory (Release B Task 7).
 *
 * Pure summarizer behind `scripts/audit-fleet-readiness.mjs`. Reads
 * database-shaped rows and reports which vehicles hold complete static
 * evidence for the passenger cohort, the cargo cohort, or neither — plus every
 * missing-evidence class by vehicle id and blocked-reason counts.
 *
 * Read-only by construction: inputs are never mutated (the audit must not
 * cancel or rewrite committed history), and live maintenance/safety clearance
 * is NOT evaluated here. Static inventory assumes nothing about the live
 * gates; they are evaluated at dispatch time and listed transparently in
 * `liveGatesDeferred`.
 */
import { evaluateRoadReadiness } from "./readiness.js";

export const LIVE_GATES_DEFERRED = ["MAINTENANCE_NOT_CLEARED", "SAFETY_NOT_CLEARED"];

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

/**
 * @param {object} args
 * @param {Array<{vehicle:object,documents:object[]}>} args.rows
 * @param {Array<object>} args.assignments driver_vehicle_assignments rows
 * @param {Date} [args.now]
 */
export function summarizeFleetInventory({ rows = [], assignments = [], now } = {}) {
  const ref = now instanceof Date ? now : new Date(now);
  const list = Array.isArray(rows) ? rows : [];
  const pairs = new Set(
    (Array.isArray(assignments) ? assignments : [])
      .filter((a) => a && a.assigned_until == null && a.vehicle_id != null)
      .map((a) => Number(a.vehicle_id))
  );

  const missing = {
    assetCode: [],
    operationalUse: [],
    plate: [],
    commissioning: [],
    licenseClass: [],
    category: [],
    orCr: [],
    insurance: [],
    payload: [],
    pairing: [],
  };
  const blockedReasons = {};
  const passengerCohort = [];
  const cargoCohort = [];

  for (const entry of list) {
    const vehicle = entry?.vehicle && typeof entry.vehicle === "object" ? entry.vehicle : {};
    const documents = Array.isArray(entry?.documents) ? entry.documents : [];
    const id = vehicle.vehicle_id;

    if (isBlank(vehicle.fleet_asset_code)) missing.assetCode.push(id);
    if (vehicle.operational_use !== "Passenger" && vehicle.operational_use !== "Cargo") missing.operationalUse.push(id);
    if (isBlank(vehicle.plate_number)) missing.plate.push(id);
    if (vehicle.commissioning_status !== "Ready") missing.commissioning.push(id);
    if (isBlank(vehicle.required_license_class)) missing.licenseClass.push(id);
    if (vehicle.category_id == null) missing.category.push(id);
    if (!pairs.has(Number(id))) missing.pairing.push(id);

    const docs = documents.filter((d) => d && typeof d === "object" && d.deleted_at == null);
    const verifiedOf = (type) => docs.filter((d) => d.document_type === type && d.verification_status === "Verified");
    if (verifiedOf("OR_CR").length !== 1) missing.orCr.push(id);
    if (verifiedOf("Insurance").length !== 1) missing.insurance.push(id);

    // Usable payload evidence for the declared use. Unclassified legacy stock
    // records no payload expectation, so it is not accused of missing one.
    if (vehicle.operational_use === "Passenger") {
      if (!(Number(vehicle.seating_capacity) > 0)) missing.payload.push(id);
    } else if (vehicle.operational_use === "Cargo") {
      if (!(Number(vehicle.cargo_capacity_kg) > 0)) missing.payload.push(id);
    }

    // Cohort membership: the pure road-readiness contract with the two live
    // gates assumed clear for inventory purposes and disclosed as deferred,
    // plus recorded usable capacity for the declared use and an active
    // custodial pairing. A vehicle joins a cohort only when no static
    // evidence gap remains.
    const readiness = evaluateRoadReadiness(
      {
        plate_number: vehicle.plate_number,
        commissioning_status: vehicle.commissioning_status,
        maintenance_clear: true,
        safety_clear: true,
      },
      documents,
      ref
    );
    const staticBlockers = readiness.blockers.filter((c) => !LIVE_GATES_DEFERRED.includes(c));
    for (const code of staticBlockers) blockedReasons[code] = (blockedReasons[code] ?? 0) + 1;

    const capacityRecorded =
      vehicle.operational_use === "Passenger"
        ? Number(vehicle.seating_capacity) > 0
        : vehicle.operational_use === "Cargo"
          ? Number(vehicle.cargo_capacity_kg) > 0
          : false;

    if (staticBlockers.length === 0 && capacityRecorded && pairs.has(Number(id))) {
      if (vehicle.operational_use === "Cargo") cargoCohort.push(id);
      else if (vehicle.operational_use === "Passenger") passengerCohort.push(id);
    }
  }

  return {
    totals: {
      vehicles: list.length,
      passengerCohort: passengerCohort.length,
      cargoCohort: cargoCohort.length,
    },
    missing,
    blockedReasons,
    passengerCohort,
    cargoCohort,
    liveGatesDeferred: [...LIVE_GATES_DEFERRED],
    // The audit reads rows and never writes: committed trips and legacy
    // completed rows are preserved for review by construction.
    legacyCompletedUntouched: true,
  };
}
