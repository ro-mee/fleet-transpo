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
import { SUPPORTED_LICENSE_CLASSES } from '../drivers/license-eligibility.js';

export const LIVE_GATES_DEFERRED = ["MAINTENANCE_NOT_CLEARED", "SAFETY_NOT_CLEARED"];

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";
const positiveFinite = v=>Number.isFinite(Number(v)) && Number(v) > 0;

// Usable payload from a measured cargo profile, mirroring
// deriveUsablePayload's positivity rule (least of rated and gross-minus-
// operating, less reserve, strictly positive) with plain finite-number
// semantics. It stays local instead of importing
// `../cargo/physical-load.js` because that module's `@/` specifiers do not
// resolve under the plain-node audit script that loads this summarizer;
// the commission gate remains the enforcing consumer of deriveUsablePayload.
function profileUsableKg(profile) {
  if (!profile || typeof profile !== "object") return null;
  const mass = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const rated = mass(profile.rated_payload_kg);
  const gross = mass(profile.gross_vehicle_weight_limit_kg);
  const operating = mass(profile.operating_mass_kg);
  const reserve = mass(profile.operational_reserve_kg);
  if (rated === null || rated <= 0 || gross === null || operating === null || reserve === null || reserve < 0) return null;
  const usable = Math.min(rated, gross - operating) - reserve;
  return usable > 0 ? usable : null;
}

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
    if (!SUPPORTED_LICENSE_CLASSES.includes(vehicle.required_license_class)) missing.licenseClass.push(id);
    if (vehicle.category_id == null) missing.category.push(id);
    if (!pairs.has(Number(id))) missing.pairing.push(id);

    const docs = documents.filter((d) => d && typeof d === "object" && d.deleted_at == null);
    const verifiedOf = (type) => docs.filter((d) => d.document_type === type && d.verification_status === "Verified");
    if (verifiedOf("OR_CR").length !== 1) missing.orCr.push(id);
    if (verifiedOf("Insurance").length !== 1) missing.insurance.push(id);

    // Usable payload evidence for the declared use. Unclassified legacy stock
    // records no payload expectation, so it is not accused of missing one.
    // A Cargo row carrying its measured profile is judged on the profile's
    // usable payload; legacy kg stays a display fallback and never counts as
    // evidence once the measured path is present.
    if (vehicle.operational_use === "Passenger") {
      if (!positiveFinite(vehicle.seating_capacity)) missing.payload.push(id);
    } else if (vehicle.operational_use === "Cargo") {
      const profile = entry?.cargoProfile;
      if (profile !== undefined && profile !== null) {
        if (profileUsableKg(profile) === null) missing.payload.push(id);
      } else if (!positiveFinite(vehicle.cargo_capacity_kg)) missing.payload.push(id);
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
    if (isBlank(vehicle.fleet_asset_code)) staticBlockers.push('ASSET_CODE_MISSING');
    if (isBlank(vehicle.required_license_class)) staticBlockers.push('LICENSE_CLASS_MISSING');
    else if (!SUPPORTED_LICENSE_CLASSES.includes(vehicle.required_license_class)) staticBlockers.push('LICENSE_CLASS_UNSUPPORTED');
    if (vehicle.category_id == null) staticBlockers.push('CATEGORY_MISSING');
    const capacityRecorded =
      vehicle.operational_use === "Passenger"
        ? positiveFinite(vehicle.seating_capacity)
        : vehicle.operational_use === "Cargo"
          ? positiveFinite(vehicle.cargo_capacity_kg)
          : false;
    if (!['Passenger','Cargo'].includes(vehicle.operational_use)) staticBlockers.push('OPERATIONAL_USE_MISSING');
    else if (!capacityRecorded) staticBlockers.push('CAPACITY_MISSING');
    if (!pairs.has(Number(id))) staticBlockers.push('PAIRING_MISSING');
    for (const code of staticBlockers) blockedReasons[code] = (blockedReasons[code] ?? 0) + 1;

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
