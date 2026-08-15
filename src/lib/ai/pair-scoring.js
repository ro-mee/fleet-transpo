import { DRIVER_STATUS, VEHICLE_STATUS } from "@/lib/constants";
import {
  estimateEfficiency,
  scoreProximity,
  scheduleGapGain,
  maintenanceRiskGain,
  workloadIndex,
  scoreWorkloadBalance,
} from "@/lib/ai/rule-engine";
import { RISK } from "@/lib/ai/predictive-maintenance";
import { driverBlockReason } from "@/lib/scheduling/driver-schedule";

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

// Statuses that truly rule a driver out, regardless of when the trip is.
// `On Trip` is deliberately absent (see NON_DISPATCHABLE_VEHICLE_STATUSES for
// the vehicle-side reasoning): a driver busy now is still provably eligible for
// a future window once their current and scheduled assignments clear it. The
// time-aware `_schedule_load` signal is the authority on overlap, so a driver
// mid-trip with an overlapping dispatch IS caught there, while a mid-trip
// driver who is free in the requested window is correctly offered.
const UNAVAILABLE_STATUSES = new Set([
  DRIVER_STATUS.ON_LEAVE,
  DRIVER_STATUS.SUSPENDED,
  DRIVER_STATUS.OFF_DUTY,
]);

const DAY_MS = 24 * 60 * 60 * 1000;

// AI Fair Workload Distribution weight: how many points (0..100) a lighter
// workload is worth when ranking eligible pairs. MEDIUM-HIGH — it breaks ties
// and pulls toward the least-loaded driver, but it is never a hard rule and
// never overrides the designated-driver match (+45) or a big ETA gap.
const FAIRNESS_WEIGHT = 15;

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

/** Local YYYY-MM-DD key for a Date or parseable date string. */
function dateKey(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The substitute driver (id) scheduled to cover a vehicle on a date, if any.
 *
 * A schedule covers the date when `effective_from <= date` and
 * (`effective_until IS NULL` (open-ended) OR `effective_until >= date`).
 *
 * @param {number|string}  vehicleId
 * @param {Date|string}    date        the date to test coverage for
 * @param {Array<{vehicle_id:number, substitute_driver_id:number,
 *                 effective_from:string, effective_until:string|null}>} substitutes
 * @returns {number|null}  the covering substitute driver id, or null
 */
export function resolveSubstituteForDate(vehicleId, date, substitutes) {
  if (!Array.isArray(substitutes) || !date) return null;
  const want = dateKey(date);
  if (!want) return null;
  const match = substitutes.find((s) => {
    if (Number(s.vehicle_id) !== Number(vehicleId)) return false;
    const from = dateKey(s.effective_from);
    if (!from || want < from) return false;
    if (s.effective_until != null) {
      const until = dateKey(s.effective_until);
      if (!until || want > until) return false;
    }
    return true;
  });
  return match ? Number(match.substitute_driver_id) : null;
}

/** Whether a day-scoped substitute covers a vehicle on a given date. */
export function hasSubstituteForDate(vehicleId, date, substitutes) {
  return resolveSubstituteForDate(vehicleId, date, substitutes) != null;
}

/**
 * Whether a driver is provably unavailable for the pickup window.
 *
 * Used ONLY to decide whether substituting for a vehicle's designated driver is
 * legitimate. "Provably" is the key word: absence of data must not fabricate an
 * excuse, so every check here requires an explicit blocking signal.
 *
 * `window` (optional) carries the pickup window + schedule/leave context loaded
 * by the caller (migration 049). When present, the driver's standing work
 * schedule and approved leave are consulted: approved leave covering the pickup
 * date, no schedule on file (fail-closed), a rest day, or an out-of-shift /
 * break-overlapping window all count as provably unavailable.
 *
 * @param {object} driver candidate driver row (with _schedule_load if computed)
 * @param {Date} [now]
 * @param {object} [window] { pickup, returnAt, scheduleContext }
 * @returns {{ unavailable: boolean, reason: string|null }}
 */
export function isDriverUnavailableFor(driver, now = new Date(), window) {
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

  if (window?.pickup && driver?.driver_id != null) {
    const block = driverBlockReason({
      driverId: driver.driver_id,
      pickup: window.pickup,
      returnAt: window.returnAt,
      ctx: window.scheduleContext,
    });
    if (block?.blocked) {
      return { unavailable: true, reason: block.reason };
    }
  }

  return { unavailable: false, reason: null };
}

/**
 * Statuses that describe a CONDITION OF THE VEHICLE, so they rule it out of any
 * dispatch regardless of when the trip is.
 *
 * `Reserved` is deliberately absent. It is a cached, whole-day schedule label
 * (see status.service.js) meaning "this vehicle has a booking today" — not
 * "this vehicle is taken at the time you asked about". A vehicle booked 10-11am
 * is genuinely free at 2pm, so treating Reserved as unavailable hides usable
 * capacity. `In Use` is deliberately absent for the same reason: a vehicle
 * currently driving is free for a later window. Time-specific availability is
 * answered by real schedule-overlap (`_schedule_load`), which remains the
 * authority; this set only removes vehicles that cannot go out at all.
 */
export const NON_DISPATCHABLE_VEHICLE_STATUSES = [
  VEHICLE_STATUS.UNDER_MAINTENANCE,
  VEHICLE_STATUS.DECOMMISSIONED,
  VEHICLE_STATUS.REGISTRATION_EXPIRED,
];

const NON_DISPATCHABLE_SET = new Set(NON_DISPATCHABLE_VEHICLE_STATUSES);

/** Whether a vehicle's own status permits dispatch at all (Reserved does). */
export function vehicleOperationallyAvailable(vehicle) {
  const status = vehicle?.vehicle_status;
  if (!status) return true;
  return !NON_DISPATCHABLE_SET.has(status);
}

/** How a vehicle earned its driver — or why it did not get one. */
export const PAIRING_KIND = {
  DESIGNATED: "designated",
  SUBSTITUTE: "substitute",
  NONE: "none",
};

/**
 * The ONE rule deciding whether a vehicle may be offered for assignment, and
 * with which driver. Shared by the assignment UI, the AI candidate filter and
 * the assignment-time revalidation so the three can never disagree.
 *
 * A vehicle is offered only when it has a VALID PAIRING:
 *   - its designated driver is available and eligible, or
 *   - its designated driver is unavailable AND a substitute has already been
 *     explicitly assigned to that vehicle for the pickup date, and that
 *     substitute is itself available and eligible.
 *
 * Everything else is withheld. In particular a merely-available driver is never
 * paired with a vehicle they are not the custodian or booked substitute of: a
 * substitute is an explicit, recorded relationship, not "whoever is free".
 * A vehicle with no custodian and no substitute has nobody who may drive it, so
 * it is withheld until a dispatcher records one.
 *
 * @param {object} params
 * @param {number|string} params.vehicleId
 * @param {Date|string} params.pickupDate  date the substitute schedule is tested against
 * @param {Array} params.activePairs       custodial pairs (assigned_until IS NULL)
 * @param {Array} params.activeSubstitutes day-scoped substitute schedules
 * @param {Map<number, object>} params.driverById  full driver rows by id
 * @param {Date} [params.now]
 * @returns {{ ok:boolean, kind:string, driver:object|null, designated:object|null,
 *             reason:string|null }}
 */
export function resolveVehiclePairing({
  vehicleId,
  pickupDate,
  activePairs = [],
  activeSubstitutes = [],
  driverById = new Map(),
  now = new Date(),
  returnAt,
  scheduleContext,
}) {
  const designated = resolveDesignatedDriver(vehicleId, activePairs, driverById);
  const window = { pickup: pickupDate, returnAt, scheduleContext };

  if (designated) {
    const unavail = isDriverUnavailableFor(designated, now, window);
    if (!unavail.unavailable) {
      // Rule 1: the intact pairing is the only offer. No substitute is
      // considered while the custodian can drive, and no unrelated driver is
      // ever offered alongside them.
      return { ok: true, kind: PAIRING_KIND.DESIGNATED, driver: designated, designated, reason: null };
    }

    const subId = resolveSubstituteForDate(vehicleId, pickupDate, activeSubstitutes);
    if (subId == null) {
      // Rule 3: no recorded substitute means nobody may take the car. The
      // dispatcher assigns a substitute first; the app does not invent one.
      return {
        ok: false,
        kind: PAIRING_KIND.NONE,
        driver: null,
        designated,
        reason: `${unavail.reason} No substitute driver is assigned to this vehicle for ${dateKey(pickupDate) ?? "this date"}.`,
      };
    }

    const substitute = driverById.get(Number(subId)) ?? null;
    if (!substitute) {
      return {
        ok: false,
        kind: PAIRING_KIND.NONE,
        driver: null,
        designated,
        reason: `${unavail.reason} The assigned substitute driver could not be loaded.`,
      };
    }

    // Rule 7: being the booked substitute is not enough — they are validated
    // for this dispatch exactly as the custodian was.
    const subUnavail = isDriverUnavailableFor(substitute, now, window);
    if (subUnavail.unavailable) {
      return {
        ok: false,
        kind: PAIRING_KIND.NONE,
        driver: null,
        designated,
        reason: `${unavail.reason} Assigned substitute is also unavailable: ${subUnavail.reason}`,
      };
    }

    return {
      ok: true,
      kind: PAIRING_KIND.SUBSTITUTE,
      driver: substitute,
      designated,
      reason: `${unavail.reason} Substitute assigned for ${dateKey(pickupDate) ?? "this date"}.`,
    };
  }

  // No custodian. A substitute schedule can still stand on its own — it is an
  // explicit assignment of a driver to this vehicle.
  const subId = resolveSubstituteForDate(vehicleId, pickupDate, activeSubstitutes);
  if (subId == null) {
    // Rule 4.
    return {
      ok: false,
      kind: PAIRING_KIND.NONE,
      driver: null,
      designated: null,
      reason: "Vehicle has no designated driver and no assigned substitute for this date.",
    };
  }

  const substitute = driverById.get(Number(subId)) ?? null;
  if (!substitute) {
    return {
      ok: false,
      kind: PAIRING_KIND.NONE,
      driver: null,
      designated: null,
      reason: "The assigned substitute driver could not be loaded.",
    };
  }

  const subUnavail = isDriverUnavailableFor(substitute, now, window);
  if (subUnavail.unavailable) {
    return {
      ok: false,
      kind: PAIRING_KIND.NONE,
      driver: null,
      designated: null,
      reason: `Assigned substitute is unavailable: ${subUnavail.reason}`,
    };
  }

  return {
    ok: true,
    kind: PAIRING_KIND.SUBSTITUTE,
    driver: substitute,
    designated: null,
    reason: `Substitute assigned for ${dateKey(pickupDate) ?? "this date"}.`,
  };
}

/** Vehicle readiness signal, 0..1. Higher is better. */
function vehicleReadiness(vehicle) {
  let s = 0;
  // Readiness is judged on what the vehicle can actually do in the requested
  // window, not on the cached status label. `Reserved` earns the same credit as
  // `Available` — it only means the vehicle has a booking somewhere today, and
  // the schedule-load term below is what prices an actual clash. Penalising the
  // label as well would double-count it and rank a genuinely-free car below an
  // equal one purely for having an unrelated trip that morning. Statuses that
  // really do rule the vehicle out are removed by the candidate filter before
  // scoring, so they never reach here.
  if (vehicleOperationallyAvailable(vehicle)) s += 0.3;

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

  // No upper clamp here: the score must keep headroom so the fairness term
  // (added by buildFleetPairRecommendations once the pool is known) can actually
  // reorder near-saturated pairs. The caller clamps to 0..100 at the end.
  const final = Math.max(0, Math.round(score));
  return {
    score: final,
    confidence: Math.min(1, final / 100),
    reasons,
    is_designated: isDesignated,
    reason_type: isDesignated ? REASON_TYPE.DESIGNATED : REASON_TYPE.REPLACEMENT,
    replacement_reason: null, // set by the caller when substituting
    estimated_pickup_minutes: estimatedPickupMinutes,
    distance_km: driver?._pickup_distance_km != null ? Number(driver._pickup_distance_km) : null,
  };
}

/** Extract a driver's rolling-workload signals (AI Fair Workload Distribution). */
function driverWorkload(driver) {
  if (!driver) return null;
  const w = {
    trips_7d: Number(driver._workload_trips_7d),
    trips_30d: Number(driver._workload_trips_30d),
    km_7d: Number(driver._workload_km_7d),
    km_30d: Number(driver._workload_km_30d),
    hours_7d: Number(driver._workload_hours_7d),
    hours_30d: Number(driver._workload_hours_30d),
  };
  // No recorded history anywhere → the pair carries no workload signal.
  if (
    !(w.trips_7d > 0) && !(w.trips_30d > 0) &&
    !(w.km_7d > 0) && !(w.km_30d > 0) &&
    !(w.hours_7d > 0) && !(w.hours_30d > 0)
  ) {
    return null;
  }
  return w;
}

/**
 * AI Fair Workload Distribution — rank eligible pairs by pool-relative workload.
 *
 * This runs AFTER every pair has been scored and judged eligible (hard rules
 * already decided WHO CAN). Among those valid pairs it adds up to FAIRNESS_WEIGHT
 * points to the least-loaded driver and attaches a fairness score + the workload
 * detail for the panel. The final score is clamped to 0..100 here, once fairness
 * is in, so near-saturated pairs can still be reordered by load.
 *
 * When no candidate has any workload history, nothing is added and no fairness
 * is reported — absent data never invents a ranking.
 */
function applyWorkloadFairness(pairs) {
  const workloads = pairs.map((p) => driverWorkload(p.driver));
  const indices = workloads.map((w) => (w ? workloadIndex(w) : 0));
  const poolMax = Math.max(...indices, 0);

  if (!(poolMax > 0)) {
    for (const p of pairs) {
      p.workload = null;
      p.fairness_score = null;
    }
    return;
  }

  for (let i = 0; i < pairs.length; i++) {
    const w = workloads[i];
    if (!w) {
      pairs[i].workload = null;
      pairs[i].fairness_score = null;
      pairs[i].is_lightest = false;
      continue;
    }
    const fairness = scoreWorkloadBalance(indices[i], poolMax);
    pairs[i].workload = w;
    pairs[i].fairness_score = Math.round(fairness * 100);
    pairs[i].is_lightest = false;
    const total = Math.min(100, Math.max(0, Math.round(pairs[i].score + fairness * FAIRNESS_WEIGHT)));
    pairs[i].score = total;
    pairs[i].confidence = total / 100;
  }

  // The least-loaded eligible driver is the one with the highest pool-relative
  // fairness (not necessarily 100 — that is only true when their index is 0).
  let lightestScore = -1;
  for (const p of pairs) {
    if (p.fairness_score != null && p.fairness_score > lightestScore) lightestScore = p.fairness_score;
  }
  for (const p of pairs) {
    if (p.fairness_score != null && p.fairness_score === lightestScore) p.is_lightest = true;
  }
}

/**
 * Build ranked fleet-pair recommendations for a request.
 *
 * Vehicle availability and driver availability are evaluated SEPARATELY, then
 * required together: a vehicle only becomes a candidate pair when it is
 * operational, free in the window, AND has a valid pairing (see
 * `resolveVehiclePairing`). A vehicle whose custodian cannot drive and which has
 * no explicitly assigned substitute is withheld with a reason, so the dispatcher
 * is told to assign a substitute rather than shown a car nobody may take.
 *
 * @param {object} params
 * @param {object} params.request
 * @param {object[]} params.vehicles candidate vehicles (availability-filtered)
 * @param {object[]} params.drivers  candidate drivers
 * @param {Array} params.activePairs active custodial pairs (assigned_until IS NULL)
 * @param {Array} [params.activeSubstitutes] day-scoped substitute schedules
 * @param {object} [params.trip] precomputed trip estimate
 * @param {Date} [params.now]
 * @returns {{ pairs: object[], recommended: object|null, alternate: object|null }}
 */
export function buildFleetPairRecommendations({
  request,
  vehicles = [],
  drivers = [],
  activePairs = [],
  activeSubstitutes = [],
  trip,
  now = new Date(),
  returnAt,
  scheduleContext,
}) {
  const passengers = Number(request?.passenger_count) || 1;
  const pickupDate = request?.pickup_datetime || now;
  const driverById = new Map(drivers.map((d) => [d.driver_id, d]));
  const pairs = [];
  // Why candidate vehicles did not make it to a pair — surfaced so the panel can
  // explain "no candidates" instead of just showing an empty state.
  const skipped = [];

  for (const vehicle of vehicles) {
    const seats = Number(vehicle?.seating_capacity) || 0;
    if (seats > 0 && seats < passengers) {
      skipped.push({ vehicle_id: vehicle.vehicle_id, plate: vehicle.plate_number, reason: `Seats ${seats} — too small for ${passengers} passenger(s).` });
      continue;
    }

    // A restriction on the vehicle itself outranks any driver being free.
    if (!vehicleOperationallyAvailable(vehicle)) {
      skipped.push({
        vehicle_id: vehicle.vehicle_id,
        plate: vehicle.plate_number,
        reason: `Vehicle status is ${vehicle.vehicle_status}.`,
      });
      continue;
    }

    // A real clash in the requested window, computed by the caller. This is the
    // authority on time-specific availability — not the cached status label.
    const vLoad = Number(vehicle?._schedule_load);
    if (Number.isFinite(vLoad) && vLoad > 0) {
      skipped.push({
        vehicle_id: vehicle.vehicle_id,
        plate: vehicle.plate_number,
        reason: `Already has ${vLoad} dispatch(es) in this window.`,
      });
      continue;
    }

    const pairing = resolveVehiclePairing({
      vehicleId: vehicle.vehicle_id,
      pickupDate,
      activePairs,
      activeSubstitutes,
      driverById,
      now,
      returnAt,
      scheduleContext,
    });
    if (!pairing.ok) {
      skipped.push({
        vehicle_id: vehicle.vehicle_id,
        plate: vehicle.plate_number,
        reason: pairing.reason,
      });
      continue;
    }

    const chosen = pairing.driver;
    const designated = pairing.designated;
    const replacement_reason = pairing.kind === PAIRING_KIND.SUBSTITUTE ? pairing.reason : null;

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
      pairing_kind: pairing.kind,
      ...scored,
    });
  }

  pairs.sort((a, b) => b.score - a.score);
  applyWorkloadFairness(pairs);
  pairs.sort((a, b) => b.score - a.score);
  const recommended = pairs[0] ?? null;
  const alternate = pairs[1] ?? null;
  if (recommended) recommended.checklist = buildChecklist(recommended, recommended === pairs[0]);
  if (alternate) alternate.checklist = buildChecklist(alternate, false);
  return {
    pairs,
    recommended,
    alternate,
    // Distinct vehicle-level "why not" reasons, newest-first. Empty when a pair
    // was produced (pairs.length > 0) or no pools were passed at all.
    skipped,
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

  // Designated vs substitute — the core pairing rule. `pairing_kind` is the
  // precise signal; `is_designated` alone cannot tell a substitute covering an
  // absent custodian apart from one assigned to a vehicle that never had a
  // custodian, and only the former is a downgrade worth flagging.
  if (pair?.is_designated) {
    items.push({ text: "Designated driver available", pass: true });
  } else if (pair?.pairing_kind === PAIRING_KIND.SUBSTITUTE && !pair?.designated) {
    items.push({ text: "Assigned substitute driver for this vehicle", pass: true });
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

  // AI Fair Workload Distribution — only reported when the pool actually has
  // workload history. The least-loaded eligible driver gets the headline claim.
  if (pair?.workload) {
    const t7 = Number(pair.workload.trips_7d) || 0;
    const t30 = Number(pair.workload.trips_30d) || 0;
    const km7 = Number(pair.workload.km_7d) || 0;
    const km30 = Number(pair.workload.km_30d) || 0;
    const trips = t7 > 0 ? t7 : t30;
    const km = km7 > 0 ? km7 : km30;
    const period = t7 > 0 ? "this week" : "this month";
    const lightest = pair.is_lightest;
    items.push({
      text: lightest
        ? `Lowest workload among eligible drivers (${trips} trip${trips === 1 ? "" : "s"}${km ? `, ${Math.round(km)} km` : ""} ${period})`
        : `${trips} trip${trips === 1 ? "" : "s"}${km ? `, ${Math.round(km)} km` : ""} in ${period}`,
      pass: true,
    });
  }

  return items;
}
