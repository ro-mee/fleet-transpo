/**
 * One load-capacity and pair-eligibility gate (Release B Task 5).
 *
 * Pure evaluator shared by every commit and read path: queue conflict chips
 * (`evaluateRequestConflicts`), the assign gate, direct dispatch, reassignment
 * and trip start (all via `validatePairAvailability`). Sharing this function is
 * what guarantees every path returns the SAME blocker for a changed
 * weight/vehicle — no option path may bypass the server gate, and an override
 * reason NEVER bypasses a load safety blocker.
 *
 * Legacy preservation: rows without an explicit `load_type` keep the exact
 * historical seats behavior (`passenger_count || 1` against seats, silent when
 * the vehicle records no seats). Typed (`Passenger`/`Cargo`) rows fail closed:
 * unknown type, requirement, operational use, or capacity is not eligible.
 */

export const CAPACITY_CODES = {
  LOAD_UNKNOWN: "LOAD_UNKNOWN",
  PASSENGER_COUNT_INVALID: "PASSENGER_COUNT_INVALID",
  CARGO_WEIGHT_INVALID: "CARGO_WEIGHT_INVALID",
  USE_MISMATCH: "USE_MISMATCH",
  CAPACITY_UNKNOWN: "CAPACITY_UNKNOWN",
  OVER_CAPACITY: "OVER_CAPACITY",
};

function toPositiveNumber(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {object} request transportation_requests row (load_type, passenger_count, cargo_weight_kg)
 * @param {object} vehicle vehicles row (operational_use, seating_capacity, cargo_capacity_kg)
 * @returns {{ eligible:boolean, code:string|null, required:number|null, capacity:number|null, unit:'passengers'|'kg'|null }}
 */
export function evaluateVehicleCapacity(request = {}, vehicle = {}) {
  const req = request && typeof request === "object" ? request : {};
  const veh = vehicle && typeof vehicle === "object" ? vehicle : {};
  const loadType = req.load_type;

  // Legacy untyped rows: historical behavior, unchanged.
  if (loadType !== "Passenger" && loadType !== "Cargo") {
    if (loadType === null || loadType === undefined) {
      const required = Number(req.passenger_count) || 1;
      const seats = Number(veh.seating_capacity);
      if (!(seats > 0) || seats >= required) {
        return { eligible: true, code: null, required, capacity: Number.isFinite(seats) ? seats : null, unit: "passengers" };
      }
      return { eligible: false, code: CAPACITY_CODES.OVER_CAPACITY, required, capacity: seats, unit: "passengers" };
    }
    return { eligible: false, code: CAPACITY_CODES.LOAD_UNKNOWN, required: null, capacity: null, unit: null };
  }

  if (loadType === "Passenger") {
    const count = Number(req.passenger_count);
    if (!Number.isInteger(count) || count <= 0) {
      return { eligible: false, code: CAPACITY_CODES.PASSENGER_COUNT_INVALID, required: null, capacity: null, unit: "passengers" };
    }
    if (veh.operational_use !== "Passenger") {
      return { eligible: false, code: CAPACITY_CODES.USE_MISMATCH, required: count, capacity: null, unit: "passengers" };
    }
    const seats = toPositiveNumber(veh.seating_capacity);
    if (seats === null) {
      return { eligible: false, code: CAPACITY_CODES.CAPACITY_UNKNOWN, required: count, capacity: null, unit: "passengers" };
    }
    if (seats >= count) {
      return { eligible: true, code: null, required: count, capacity: seats, unit: "passengers" };
    }
    return { eligible: false, code: CAPACITY_CODES.OVER_CAPACITY, required: count, capacity: seats, unit: "passengers" };
  }

  // Cargo: weight is gross declared consignment weight in kg. NUMERIC NaN
  // compares greater than every ordinary number in Postgres, so finiteness is
  // checked here rather than trusted to the column type.
  const weight = Number(req.cargo_weight_kg);
  if (!Number.isFinite(weight) || weight <= 0) {
    return { eligible: false, code: CAPACITY_CODES.CARGO_WEIGHT_INVALID, required: null, capacity: null, unit: "kg" };
  }
  if (veh.operational_use !== "Cargo") {
    return { eligible: false, code: CAPACITY_CODES.USE_MISMATCH, required: weight, capacity: null, unit: "kg" };
  }
  const payload = toPositiveNumber(veh.cargo_capacity_kg);
  if (payload === null) {
    return { eligible: false, code: CAPACITY_CODES.CAPACITY_UNKNOWN, required: weight, capacity: null, unit: "kg" };
  }
  if (payload >= weight) {
    return { eligible: true, code: null, required: weight, capacity: payload, unit: "kg" };
  }
  return { eligible: false, code: CAPACITY_CODES.OVER_CAPACITY, required: weight, capacity: payload, unit: "kg" };
}

/**
 * The single blocker sentence every gate returns for an ineligible pair, so a
 * changed weight/vehicle reads identically at assign, reassign, dispatch and
 * trip start. Legacy over-capacity keeps its exact historical wording.
 */
export function formatCapacityBlocker(result, vehicleLabel = "Vehicle") {
  const label = vehicleLabel || "Vehicle";
  switch (result?.code) {
    case CAPACITY_CODES.OVER_CAPACITY:
      if (result.unit === "kg") {
        const over = result.required - result.capacity;
        return `${label} cargo capacity ${result.capacity} kg, request needs ${result.required} kg (over by ${over} kg).`;
      }
      return `Vehicle seats ${result.capacity}, request needs ${result.required}.`;
    case CAPACITY_CODES.USE_MISMATCH:
      if (result.unit === "kg") {
        return `${label} is not a cargo vehicle and cannot carry cargo (${result.required} kg requested).`;
      }
      return `${label} is not a passenger vehicle and has no passenger seats (${result.required} passengers requested).`;
    case CAPACITY_CODES.CAPACITY_UNKNOWN:
      return `${label} has no recorded ${result.unit === "kg" ? "cargo payload" : "seating"} capacity — inventory it before typed dispatch.`;
    case CAPACITY_CODES.PASSENGER_COUNT_INVALID:
      return `Request needs a positive passenger count before a vehicle can be checked.`;
    case CAPACITY_CODES.CARGO_WEIGHT_INVALID:
      return `Request needs a positive cargo weight in kg before a vehicle can be checked.`;
    case CAPACITY_CODES.LOAD_UNKNOWN:
    default:
      return `Request load type is unknown — resolve it to Passenger or Cargo before dispatch.`;
  }
}
