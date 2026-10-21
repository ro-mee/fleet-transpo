export const ACTIVE_FUEL_TRIP_STATUSES = [
  "Assigned", "Driver Accepted", "Trip Started", "At Pickup",
  "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress",
];

export const FORECAST_FUEL_TRIP_STATUSES = [
  "Pending", "Approved", "Vehicle Assigned", "Driver Assigned", "Dispatched",
  ...ACTIVE_FUEL_TRIP_STATUSES,
];

export const CURRENT_FUEL_TRIP_STATUSES = [
  "Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard",
  "En Route", "Drop-off", "Arrived", "In Progress",
];

import { mergeFuelPolicy } from "./fuel-policy";

const round2 = (value) => Number(Number(value).toFixed(2));

/**
 * Sum the planned forecast distance for a vehicle's current and upcoming trips.
 *
 * Every scheduled leg counts once. A leg is only doubled when no reverse leg
 * (origin/destination swapped) is scheduled: the vehicle still has to come
 * back, so ONE return leg is assumed and recorded (`assumed_return_km`).
 * Legs without route endpoints cannot be paired with anything, so they keep
 * that same single-return assumption instead of being silently doubled twice.
 *
 * Returns `{ forecast_distance_km, assumed_return_km, paired_legs, legs,
 * round_trip_assumed }`.
 */
export function planForecastDistance(legs = []) {
  const rows = Array.isArray(legs) ? legs : [];
  const norm = (value) => String(value ?? "").trim().toLowerCase();
  const endpoint = (leg) => {
    const origin = norm(leg?.origin);
    const destination = norm(leg?.destination);
    return origin && destination ? { origin, destination } : null;
  };

  const matched = new Set();
  let pairedLegs = 0;
  for (let a = 0; a < rows.length; a += 1) {
    if (matched.has(a)) continue;
    const first = endpoint(rows[a]);
    if (!first) continue;
    for (let b = a + 1; b < rows.length; b += 1) {
      if (matched.has(b)) continue;
      const second = endpoint(rows[b]);
      if (!second) continue;
      if (first.origin === second.destination && first.destination === second.origin) {
        matched.add(a);
        matched.add(b);
        pairedLegs += 1;
        break;
      }
    }
  }

  let scheduledKm = 0;
  let assumedReturnKm = 0;
  rows.forEach((leg, index) => {
    const distance = Math.max(0, Number(leg?.distanceKm) || 0);
    scheduledKm += distance;
    if (!matched.has(index)) assumedReturnKm += distance;
  });

  return {
    forecast_distance_km: round2(scheduledKm + assumedReturnKm),
    assumed_return_km: round2(assumedReturnKm),
    paired_legs: pairedLegs,
    legs: rows.length,
    round_trip_assumed: assumedReturnKm > 0,
  };
}

/**
 * Refill recommendation over a caller-supplied total forecast distance.
 * `forecastDistanceKm` is total planned travel — every scheduled leg counted
 * once plus any assumed return legs (see planForecastDistance). This function
 * does not invent a return factor of its own.
 */
export function calculateFuelRecommendation({
  tankCapacityL,
  currentFuelLevelPercent,
  fuelEfficiencyKmpl,
  forecastDistanceKm,
  policy,
}) {
  const pol = mergeFuelPolicy(policy);
  const tank = Number(tankCapacityL);
  const level = Number(currentFuelLevelPercent);
  const efficiency = Number(fuelEfficiencyKmpl);
  const forecastDistance = Math.max(0, Number(forecastDistanceKm) || 0);
  if (!Number.isFinite(tank) || tank <= 0) throw new Error("Tank capacity is not configured");
  if (!Number.isFinite(efficiency) || efficiency <= 0) throw new Error("Fuel efficiency is not configured");
  if (!Number.isFinite(level) || level < 0 || level > 100) throw new Error("Current fuel level must be between 0 and 100%");

  const currentLiters = tank * (level / 100);
  const forecastConsumptionLiters = forecastDistance / efficiency;
  const reserveLiters = tank * (pol.reserveBufferPercent / 100);
  const minimumSafeLiters = Math.max(0, forecastConsumptionLiters + reserveLiters - currentLiters);
  const projectedRemainingLiters = currentLiters - forecastConsumptionLiters;
  const needsRefuel = projectedRemainingLiters < reserveLiters;
  const maxCapLiters = tank * (pol.maxFillCapPercent / 100);
  const preferredTargetLiters = tank * (pol.preferredTargetPercent / 100);
  const targetLiters = Math.min(maxCapLiters, Math.max(preferredTargetLiters, forecastConsumptionLiters + reserveLiters));
  const recommendedLiters = needsRefuel ? Math.max(0, targetLiters - currentLiters) : 0;

  return {
    tank_capacity_l: round2(tank),
    current_fuel_level_percent: round2(level),
    current_liters: round2(currentLiters),
    forecast_distance_km: round2(forecastDistance),
    fuel_efficiency_kmpl: round2(efficiency),
    forecast_consumption_liters: round2(forecastConsumptionLiters),
    reserve_liters: round2(reserveLiters),
    minimum_safe_liters: round2(minimumSafeLiters),
    projected_remaining_liters: round2(projectedRemainingLiters),
    target_liters: round2(targetLiters),
    recommended_liters: round2(recommendedLiters),
    needs_refuel: needsRefuel,
    range_warning: forecastConsumptionLiters + reserveLiters > tank,
  };
}

export function minimumSafeFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const direct = Number(snapshot.minimum_safe_liters);
  if (Number.isFinite(direct) && direct >= 0) return round2(direct);
  const consumption = Number(snapshot.forecast_consumption_liters);
  const reserve = Number(snapshot.reserve_liters);
  const current = Number(snapshot.current_liters);
  if ([consumption, reserve, current].every(Number.isFinite)) {
    return round2(Math.max(0, consumption + reserve - current));
  }
  return null;
}

export function assessFuelVariance({
  tankCapacityL,
  lastReportedPercent,
  distanceSinceLastReportKm = null,
  efficiencyKmpl,
  refilledLiters = 0,
  reportedPercent,
  policy,
}) {
  // Shape-stable empty verdict: a snapshot with no verdict still carries every
  // key the verdict path carries, so consumers can read the object uniformly.
  const empty = { expected_liters: null, variance_liters: null, refilled_liters: null, variance_detected: false };
  const tank = Number(tankCapacityL);
  const efficiency = Number(efficiencyKmpl);
  if (!Number.isFinite(tank) || tank <= 0) return empty;
  if (!Number.isFinite(efficiency) || efficiency <= 0) return empty;
  if (lastReportedPercent == null || reportedPercent == null) return empty;
  // Unknown distance is not zero distance: with no trustworthy consumption
  // figure the check returns no verdict rather than flagging phantom variance.
  if (distanceSinceLastReportKm == null) return empty;
  const lastLiters = tank * (Number(lastReportedPercent) / 100);
  const reportedLiters = tank * (Number(reportedPercent) / 100);
  const distance = Math.max(0, Number(distanceSinceLastReportKm) || 0);
  const refilled = Math.max(0, Number(refilledLiters) || 0);
  if (!Number.isFinite(lastLiters) || !Number.isFinite(reportedLiters)) return empty;

  const pol = mergeFuelPolicy(policy);
  // Verified refills between the two reports raise the level the tank should
  // hold; ignoring them lets a real gap pass as "explained by the top-up".
  const expectedLiters = Math.max(0, lastLiters - distance / efficiency + refilled);
  const varianceLiters = expectedLiters - reportedLiters;
  const thresholdLiters = tank * (pol.varianceThresholdPercent / 100);
  const varianceDetected = pol.enableVarianceAlerts ? varianceLiters > thresholdLiters : false;

  return {
    expected_liters: round2(expectedLiters),
    variance_liters: round2(Math.max(0, varianceLiters)),
    refilled_liters: round2(refilled),
    variance_detected: varianceDetected,
  };
}

export function evaluateFuelPolicy({ calculation, variance, monthlyRemainingLiters, policy }) {
  const pol = mergeFuelPolicy(policy);
  const reasons = [];
  const recommended = Number(calculation?.recommended_liters);
  if (!Number.isFinite(recommended) || recommended <= 0) {
    reasons.push("No refill recommendation is active");
  }
  if (!pol.autoApprovalEnabled) {
    reasons.push("Automatic fuel request approval is disabled by fleet policy");
  }
  if (pol.autoApprovalMaxLiters && recommended > pol.autoApprovalMaxLiters) {
    reasons.push(`The recommended refill volume (${recommended} L) exceeds the policy auto-approval limit of ${pol.autoApprovalMaxLiters} L`);
  }
  if (variance?.variance_detected) {
    reasons.push("Fuel variance was detected in the reported level");
  }
  if (calculation?.range_warning) {
    reasons.push("The forecast requirement exceeds the tank capacity");
  }
  if (calculation?.minimum_safe_liters != null && Number(calculation.minimum_safe_liters) > recommended) {
    reasons.push("The minimum safe refill exceeds the recommendation");
  }
  const remaining = Number(monthlyRemainingLiters);
  if (!Number.isFinite(remaining) || recommended > remaining) {
    reasons.push("The monthly fuel budget cannot cover the recommendation");
  }
  return { within_policy: reasons.length === 0, policy_reasons: reasons };
}

export function fuelTankCapacityError({ tankCapacityL, estimatedCurrentLiters, liters }) {
  const amount = Number(liters);
  const tank = Number(tankCapacityL);
  const estimated = Number(estimatedCurrentLiters);
  if (!Number.isFinite(amount) || !Number.isFinite(tank) || tank <= 0 || !Number.isFinite(estimated)) return null;
  if (amount + estimated > tank) {
    const space = Math.max(0, tank - estimated);
    return `Impossible fuel quantity — the ${tank} L tank only has about ${round2(space)} L of space left`;
  }
  return null;
}

const FUEL_TYPE_SYNONYMS = [
  ["gasoline", "petrol", "gas"],
];

export function fuelTypeMismatch(vehicleFuelType, receiptFuelType) {
  const expected = String(vehicleFuelType || "").trim().toLowerCase();
  const actual = String(receiptFuelType || "").trim().toLowerCase();
  if (!expected || !actual || expected === "unspecified") return false;
  if (expected === actual) return false;
  for (const group of FUEL_TYPE_SYNONYMS) {
    if (group.includes(expected) && group.includes(actual)) return false;
  }
  return true;
}

export function fuelAllocationError(approvedLiters, liters) {
  const amount = Number(liters);
  if (!Number.isFinite(amount) || amount <= 0) return "liters must be a positive number";
  if (amount > Number(approvedLiters)) {
    return `Fuel volume exceeds the ${Number(approvedLiters)} L allocation`;
  }
  return null;
}

export function fuelFulfillmentError(request, liters) {
  if (!request || request.status !== "Approved") return "An approved fuel request is required";
  return fuelAllocationError(request.approved_liters, liters);
}
