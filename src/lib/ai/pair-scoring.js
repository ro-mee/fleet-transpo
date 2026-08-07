import { DRIVER_STATUS } from "@/lib/constants";
import { estimateEfficiency, scoreProximity, scheduleGapGain, maintenanceRiskGain } from "@/lib/ai/rule-engine";
import { RISK } from "@/lib/ai/predictive-maintenance";

/**
 * Fleet-Pair Recommendation Engine — scores vehicle+driver as ONE unit.
 *
 * Pure and deterministic, mirroring the rule-engine contract: callers fetch the
 * candidate pools (vehicles, drivers, active custodial pairings) and attach any
 * `_`-prefixed signals, then hand them in. Nothing here queries a DB or reads
 * the clock (callers pass a fixed `now` for tests).
 *
 * The core rule this fixes: a vehicle's DESIGNATED driver must be recommended
 * first. A substitute is only allowed when that custodian is provably
 * unavailable for the pickup window, and the substitution is always surfaced
 * with a reason.
 */

export const REASON_TYPE = {
  DESIGNATED: "designated",
  REPLACEMENT: "replacement",
};

const UNAVAILABLE_STATUSES = new Set([
  DRIVER_STATUS.ON_LEAVE,
  DRIVER_STATUS.SUSPENDED,
  DRIVER_STATUS.OFF_DUTY,
  DRIVER_STATUS.ON_TRIP,
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `now` to an ISO/date string; null when absent or unparseable. */
function daysUntil(value, now = new Date()) {
  if (!value) return null;
  const t = new Date(value).getTime();
  const n = new Date(now).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  return Math.round((t - n) / DAY_MS);
}

/**
 * The active designated driver of a vehicle, from the custodial pairing table.
 * Returns null when the vehicle has no active custodian.
 *
 * @param {number|string} vehicleId
 * @param {Array<{driver_id:number, vehicle_id:number}>} activePairs rows with assigned_until IS NULL
 * @param {Map<number, object>} driverById full driver rows keyed by id
 * @returns {object|null}
 */
export function resolveDesignatedDriver(vehicleId, activePairs, driverById) {
  const pair = (activePairs || []).find(
    (a) => a.assigned_until == null && Number(a.vehicle_id) === Number(vehicleId)
  );
  if (!pair) return null;
  return driverById.get(Number(pair.driver_id)) ?? null;
}

/**
 * Whether a driver is provably unavailable for the pickup window.
 *
 * Used ONLY to decide whether substituting for a vehicle's designated driver is
 * legitimate. "Provably" is the key word: absence of data must not fabricate an
 * excuse, so every check here requires an explicit blocking signal.
 *
 * @param {object} driver candidate driver row (with _schedule_load if computed)
 * @param {Date} [now]
 * @returns {{ unavailable: boolean, reason: string|null }}
 */
export function isDriverUnavailableFor(driver, now = new Date()) {
  const status = driver?.driver_status;
  if (UNAVAILABLE_STATUSES.has(status)) {
    return { unavailable: true, reason: `Driver is ${status}.` };
  }

  const licenseDays = daysUntil(driver?.license_expiry, now);
  if (licenseDays !== null && licenseDays < 0) {
    return {
      unavailable: true,
      reason: `Driver's license expired ${Math.abs(licenseDays)} day(s) ago.`,
    };
  }

  const load = Number(driver?._schedule_load);
  if (Number.isFinite(load) && load > 0) {
    return {
      unavailable: true,
      reason: `Driver already has ${load} dispatch(es) in this window.`,
    };
  }

  return { unavailable: false, reason: null };
}

/** Vehicle readiness signal, 0..1. Higher is better. */
function vehicleReadiness(vehicle) {
  let s = 0;
  if (vehicle?.vehicle_status === "Available") s += 0.3;

  const fuel = Number(vehicle?.fuel_level);
  if (Number.isFinite(fuel)) s += Math.min(0.25, (fuel / 100) * 0.25);

  const risk = vehicle?._maintenance?.risk;
  s += (maintenanceRiskGain(risk) + 1.5) / 2.5 * 0.2; // -1.5..1 -> 0..1, scaled to 0.2

  const load = Number(vehicle?._schedule_load);
  if (Number.isFinite(load)) s += scheduleGapGain(load) * 0.15;

  return Math.min(1, Math.max(0, s));
}

/** Driver readiness signal, 0..1. Higher is better. */
function driverReadiness(driver) {
  let s = 0;
  if (driver?.driver_status === "Available") s += 0.35;

  const rating = Number(driver?.avg_guest_rating);
  if (Number.isFinite(rating) && rating > 0) s += Math.min(0.2, (rating / 5) * 0.2);

  const experience = Number(driver?.years_of_experience);
  if (Number.isFinite(experience)) s += Math.min(0.1, (experience / 10) * 0.1);

  const licenseDays = daysUntil(driver?.license_expiry);
  if (licenseDays !== null) s += (licenseDays > 90 ? 1 : licenseDays > 30 ? 0.5 : 0) * 0.15;

  const load = Number(driver?._schedule_load);
  if (Number.isFinite(load)) s += scheduleGapGain(load) * 0.1;

  return Math.min(1, Math.max(0, s));
}

/**
 * Score one vehicle+driver pair as a unit, 0..100.
 *
 * Designated-driver match is the dominant factor: a pair where the driver IS
 * the vehicle's custodian is always preferred. A substitute still scores, but
 * loses the match bonus so it ranks below the intact pair.
 *
 * @param {object} params
 * @param {object} params.vehicle candidate vehicle row
 * @param {object} params.driver  candidate driver row
 * @param {object|null} params.designated the vehicle's active custodian (or null)
 * @param {object} params.request  transportation_requests row
 * @param {object} params.trip     estimateTrip() result
 * @param {number} [params.passengers]
 * @returns {{ score:number, confidence:number, reasons:string[], is_designated:boolean,
 *             reason_type:'designated'|'replacement', replacement_reason:string|null,
 *             estimated_pickup_minutes:number|null, distance_km:number|null }}
 */
export function scoreFleetPair({ vehicle, driver, designated, request, trip, passengers }) {
  const pax = Number(passengers) || Number(request?.passenger_count) || 1;
  let score = 0;
  const reasons = [];

  // --- Designated match (dominant) ---
  const isDesignated = designated != null && Number(driver?.driver_id) === Number(designated.driver_id);
  if (isDesignated) {
    score += 45;
    reasons.push("Driver is the vehicle's designated driver.");
  } else if (designated) {
    score += 10;
    reasons.push("Substitute driver — vehicle has a designated custodian.");
  } else {
    score += 15;
    reasons.push("Vehicle has no designated driver.");
  }

  // --- Vehicle readiness (0..1 -> up to 25) ---
  score += vehicleReadiness(vehicle) * 25;
  const fuel = Number(vehicle?.fuel_level);
  if (Number.isFinite(fuel)) reasons.push(`Vehicle fuel ${fuel}%.`);

  // Capacity fit.
  const seats = Number(vehicle?.seating_capacity) || 0;
  if (seats > 0) {
    if (seats >= pax && seats <= pax + 4) {
      score += 10;
      reasons.push(`Ideal capacity (${seats} seats for ${pax}).`);
    } else if (seats < pax) {
      score -= 15;
      reasons.push(`Too small (${seats} seats for ${pax}).`);
    }
  }

  // Proximity (only meaningful for immediate dispatch).
  if (driver?._proximity_relevant !== false) {
    const prox = scoreProximity(driver?._pickup_distance_km);
    score += prox.points;
    if (prox.reason) reasons.push(prox.reason);
  }

  // --- Driver readiness (0..1 -> up to 20) ---
  score += driverReadiness(driver) * 20;
  const rating = Number(driver?.avg_guest_rating);
  if (Number.isFinite(rating) && rating > 0) reasons.push(`Guest rating ${rating.toFixed(1)}/5.`);

  const estimatedPickupMinutes = Number.isFinite(Number(driver?._pickup_distance_km))
    ? Math.max(1, Math.round((Number(driver._pickup_distance_km) / 25) * 60))
    : null;

  const final = Math.min(100, Math.max(0, Math.round(score)));
  return {
    score: final,
    confidence: final / 100,
    reasons,
    is_designated: isDesignated,
    reason_type: isDesignated ? REASON_TYPE.DESIGNATED : REASON_TYPE.REPLACEMENT,
    replacement_reason: null, // set by the caller when substituting
    estimated_pickup_minutes: estimatedPickupMinutes,
    distance_km: driver?._pickup_distance_km != null ? Number(driver._pickup_distance_km) : null,
  };
}

/**
 * Build ranked fleet-pair recommendations for a request.
 *
 * For every candidate vehicle that fits, the primary driver is its designated
 * custodian (when available). Only when that custodian is provably unavailable
 * is a substitute scored, with the reason carried on the pair.
 *
 * @param {object} params
 * @param {object} params.request
 * @param {object[]} params.vehicles candidate vehicles (availability-filtered)
 * @param {object[]} params.drivers  candidate drivers
 * @param {Array} params.activePairs active custodial pairs (assigned_until IS NULL)
 * @param {object} [params.trip] precomputed trip estimate
 * @param {Date} [params.now]
 * @returns {{ pairs: object[], recommended: object|null, alternate: object|null }}
 */
export function buildFleetPairRecommendations({ request, vehicles = [], drivers = [], activePairs = [], trip, now = new Date() }) {
  const passengers = Number(request?.passenger_count) || 1;
  const driverById = new Map(drivers.map((d) => [d.driver_id, d]));
  const pairs = [];

  for (const vehicle of vehicles) {
    const seats = Number(vehicle?.seating_capacity) || 0;
    if (seats > 0 && seats < passengers) continue;

    const designated = resolveDesignatedDriver(vehicle.vehicle_id, activePairs, driverById);
    let chosen;
    let replacement_reason = null;

    if (designated) {
      const unavail = isDriverUnavailableFor(designated, now);
      if (unavail.unavailable) {
        replacement_reason = unavail.reason;
        // Fall back to the next-best available driver for this vehicle.
        chosen = drivers
          .filter((d) => d.driver_id !== designated.driver_id && !isDriverUnavailableFor(d, now).unavailable)
          .sort((a, b) => driverReadiness(b) - driverReadiness(a))[0] ?? null;
      } else {
        chosen = designated;
      }
    } else {
      chosen = drivers
        .filter((d) => !isDriverUnavailableFor(d, now).unavailable)
        .sort((a, b) => driverReadiness(b) - driverReadiness(a))[0] ?? null;
    }

    if (!chosen) continue;

    const scored = scoreFleetPair({
      vehicle,
      driver: chosen,
      designated,
      request,
      trip,
      passengers,
    });
    if (replacement_reason) scored.replacement_reason = replacement_reason;

    pairs.push({
      vehicle,
      driver: chosen,
      designated,
      ...scored,
    });
  }

  pairs.sort((a, b) => b.score - a.score);
  const recommended = pairs[0] ?? null;
  const alternate = pairs[1] ?? null;
  if (recommended) recommended.checklist = buildChecklist(recommended, recommended === pairs[0]);
  if (alternate) alternate.checklist = buildChecklist(alternate, false);
  return {
    pairs,
    recommended,
    alternate,
  };
}

/**
 * The human-facing "Why this pair?" checklist. Each row is a concise claim a
 * dispatcher can read at a glance and defend in review — assembled from signals
 * the scorer already computed. Always present so the panel can show it without
 * waiting on the LLM narration.
 */
export function buildChecklist(pair, isTopRanked) {
  const items = [];
  const vehicle = pair?.vehicle;
  const driver = pair?.driver;

  // Designated vs substitute — the core pairing rule.
  if (pair?.is_designated) {
    items.push({ text: "Designated driver available", pass: true });
  } else if (pair?.reason_type === REASON_TYPE.REPLACEMENT) {
    items.push({
      text: `Substitute driver — designated unavailable (${pair.replacement_reason || "no reason"}).`,
      pass: false,
    });
  } else {
    items.push({ text: "Vehicle has no designated driver", pass: true });
  }

  // Proximity — closest driver to pickup (only meaningful for immediate dispatch).
  const dist = Number(driver?._pickup_distance_km);
  if (Number.isFinite(dist) && driver?._proximity_relevant !== false) {
    items.push({ text: dist <= 5 ? "Closest available vehicle" : `${dist} km from pickup`, pass: dist <= 5 });
  }

  // Schedule conflict.
  const vLoad = Number(vehicle?._schedule_load);
  if (Number.isFinite(vLoad)) {
    items.push({
      text: vLoad <= 0 ? "No schedule conflict in this window" : `${vLoad} dispatch(es) in this window`,
      pass: vLoad <= 0,
    });
  }

  // Fuel.
  const fuel = Number(vehicle?.fuel_level);
  if (Number.isFinite(fuel)) {
    items.push({ text: `Fuel sufficient (${fuel}%)`, pass: fuel >= 25 });
  }

  // Maintenance.
  const risk = vehicle?._maintenance?.risk;
  if (risk) {
    const ok = !["high", "critical", "overdue"].includes(String(risk).toLowerCase());
    items.push({ text: ok ? "No maintenance due" : `Maintenance risk: ${risk}`, pass: ok });
  }

  // Fleet score — top ranked.
  if (isTopRanked) items.push({ text: `Highest fleet score (${pair?.score ?? "?"}/100)`, pass: true });

  return items;
}
