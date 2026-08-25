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

const round2 = (value) => Number(Number(value).toFixed(2));

export function calculateFuelRecommendation({
  tankCapacityL,
  currentFuelLevelPercent,
  fuelEfficiencyKmpl,
  oneWayDistanceKm,
}) {
  const tank = Number(tankCapacityL);
  const level = Number(currentFuelLevelPercent);
  const efficiency = Number(fuelEfficiencyKmpl);
  const oneWayDistance = Math.max(0, Number(oneWayDistanceKm) || 0);
  if (!Number.isFinite(tank) || tank <= 0) throw new Error("Tank capacity is not configured");
  if (!Number.isFinite(efficiency) || efficiency <= 0) throw new Error("Fuel efficiency is not configured");
  if (!Number.isFinite(level) || level < 0 || level > 100) throw new Error("Current fuel level must be between 0 and 100%");

  const currentLiters = tank * (level / 100);
  const forecastDistanceKm = oneWayDistance * 2;
  const forecastConsumptionLiters = forecastDistanceKm / efficiency;
  const reserveLiters = tank * 0.1;
  const minimumSafeLiters = Math.max(0, forecastConsumptionLiters + reserveLiters - currentLiters);
  const projectedRemainingLiters = currentLiters - forecastConsumptionLiters;
  const needsRefuel = projectedRemainingLiters < reserveLiters;
  const targetLiters = Math.min(tank, Math.max(tank * 0.9, forecastConsumptionLiters + reserveLiters));
  const recommendedLiters = needsRefuel ? Math.max(0, targetLiters - currentLiters) : 0;

  return {
    tank_capacity_l: round2(tank),
    current_fuel_level_percent: round2(level),
    current_liters: round2(currentLiters),
    forecast_distance_km: round2(forecastDistanceKm),
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
  distanceSinceLastReportKm,
  efficiencyKmpl,
  reportedPercent,
}) {
  const empty = { expected_liters: null, variance_liters: null, variance_detected: false };
  const tank = Number(tankCapacityL);
  const efficiency = Number(efficiencyKmpl);
  if (!Number.isFinite(tank) || tank <= 0) return empty;
  if (!Number.isFinite(efficiency) || efficiency <= 0) return empty;
  if (lastReportedPercent == null || reportedPercent == null) return empty;
  const lastLiters = tank * (Number(lastReportedPercent) / 100);
  const reportedLiters = tank * (Number(reportedPercent) / 100);
  const distance = Math.max(0, Number(distanceSinceLastReportKm) || 0);
  if (!Number.isFinite(lastLiters) || !Number.isFinite(reportedLiters)) return empty;

  const expectedLiters = Math.max(0, lastLiters - distance / efficiency);
  const varianceLiters = expectedLiters - reportedLiters;
  const varianceDetected = varianceLiters > tank * 0.15;

  return {
    expected_liters: round2(expectedLiters),
    variance_liters: round2(Math.max(0, varianceLiters)),
    variance_detected: varianceDetected,
  };
}

export function evaluateFuelPolicy({ calculation, variance, monthlyRemainingLiters }) {
  const reasons = [];
  const recommended = Number(calculation?.recommended_liters);
  if (!Number.isFinite(recommended) || recommended <= 0) {
    reasons.push("No refill recommendation is active");
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
