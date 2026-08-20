import { scoreReservationVehicles, scoreDispatchDrivers, estimateEfficiency } from "@/lib/ai/rule-engine";
import { buildFleetPairRecommendations, vehicleOperationallyAvailable } from "@/lib/ai/pair-scoring";
import { estimateTrip, estimateFuel } from "@/lib/geo/distance";
import { DRIVER_STATUS } from "@/lib/constants";

// AI dispatch advisor — builds the Phase 14 recommendation payload.
//
// Wraps the deterministic scorers in rule-engine.js and enriches their output
// with the operational detail a dispatcher needs in order to accept or override
// a suggestion: fuel burn, travel time, concrete risks, and one alternate each.
//
// DETERMINISTIC AND ADVISORY. The same inputs always produce the same output,
// every number traces to a rule in this file, and nothing here writes an
// assignment — a human confirms via the assign endpoint. LLM narration, when
// enabled, is a nullable presentation layer on top and never the decision.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from now until an ISO/date string; null when absent or unparseable. */
function daysUntil(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / DAY_MS);
}

/** Driver display name from the joined employees row, with id fallback. */
function driverName(driver) {
  const first = driver?.employees?.first_name ?? driver?.first_name ?? "";
  const last = driver?.employees?.last_name ?? driver?.last_name ?? "";
  const name = `${first} ${last}`.trim();
  return name || `Driver #${driver?.driver_id ?? "?"}`;
}

/**
 * Risks detected for a candidate vehicle against this request.
 * Distinct from detectRequestConflicts(): that queries the DB for hard blockers
 * on an assigned pair; this reads the already-fetched candidate row to explain
 * why a suggestion is imperfect.
 */
function vehicleRisks(vehicle, request) {
  const risks = [];
  const passengers = Number(request?.passenger_count) || 1;
  const seats = Number(vehicle?.seating_capacity) || 0;

  if (seats > 0 && seats < passengers) {
    risks.push({
      level: "high",
      message: `Seats ${seats} but ${passengers} passengers expected.`,
    });
  } else if (seats > 0 && seats === passengers) {
    risks.push({ level: "low", message: "Exactly at capacity — no room for extra luggage." });
  }

  const fuel = Number(vehicle?.fuel_level);
  if (Number.isFinite(fuel)) {
    if (fuel < 25) {
      risks.push({ level: "high", message: `Fuel at ${fuel}% — refuel before departure.` });
    } else if (fuel < 50) {
      risks.push({ level: "medium", message: `Fuel at ${fuel}% — may need a top-up en route.` });
    }
  }

  const regDays = daysUntil(vehicle?.registration_expiry);
  if (regDays !== null) {
    if (regDays < 0) {
      risks.push({ level: "high", message: `Registration expired ${Math.abs(regDays)} day(s) ago.` });
    } else if (regDays <= 30) {
      risks.push({ level: "medium", message: `Registration expires in ${regDays} day(s).` });
    }
  }

  const serviceDays = daysUntil(vehicle?.next_service_date);
  if (serviceDays !== null) {
    if (serviceDays < 0) {
      risks.push({ level: "high", message: "Service is overdue." });
    } else if (serviceDays <= 7) {
      risks.push({ level: "medium", message: `Service due in ${serviceDays} day(s).` });
    }
  }

  // A status only counts as a risk when it describes the vehicle itself.
  // `Reserved` does not: it means "booked at some point today", which says
  // nothing about the requested window and is answered precisely by the
  // schedule-load check below. Flagging it high would have the panel warn about
  // a car that is genuinely free at the pickup time.
  if (vehicle?.vehicle_status && !vehicleOperationallyAvailable(vehicle)) {
    risks.push({ level: "high", message: `Vehicle status is ${vehicle.vehicle_status}.` });
  }

  const load = Number(vehicle?._schedule_load);
  if (Number.isFinite(load) && load > 0) {
    risks.push({ level: "high", message: `Already has ${load} dispatch(es) in this window.` });
  }

  return risks;
}

/** Risks detected for a candidate driver. */
function driverRisks(driver) {
  const risks = [];

  const licenseDays = daysUntil(driver?.license_expiry);
  if (licenseDays !== null) {
    if (licenseDays < 0) {
      risks.push({ level: "high", message: `License expired ${Math.abs(licenseDays)} day(s) ago.` });
    } else if (licenseDays <= 30) {
      risks.push({ level: "medium", message: `License expires in ${licenseDays} day(s).` });
    }
  }

  if (driver?.driver_status && driver.driver_status !== "Available") {
    risks.push({ level: "high", message: `Driver status is ${driver.driver_status}.` });
  }

  const experience = Number(driver?.years_of_experience);
  if (Number.isFinite(experience) && experience < 1) {
    risks.push({ level: "low", message: "Under one year of experience." });
  }

  const rating = Number(driver?.rating);
  if (Number.isFinite(rating) && rating > 0 && rating < 3) {
    risks.push({ level: "medium", message: `Performance rating is ${rating}/5.` });
  }

  return risks;
}

/** Shape one scored vehicle candidate into the advisor payload. */
function toVehicleCandidate(scored, request, trip) {
  const vehicle = scored.vehicle;
  const efficiency = estimateEfficiency(vehicle);
  const fuel = estimateFuel(trip.distanceKm, efficiency, vehicle?.tank_capacity ?? null);

  return {
    vehicle_id: vehicle.vehicle_id,
    plate_number: vehicle.plate_number,
    vehicle_name: vehicle.vehicle_name,
    seating_capacity: vehicle.seating_capacity,
    fuel_level: vehicle.fuel_level,
    vehicle_status: vehicle.vehicle_status,
    score: scored.score,
    confidence: Number(scored.confidence),
    reasons: scored.reasons,
    estimated_fuel_liters: fuel.liters,
    estimated_fuel_percent_of_tank: fuel.percentOfTank,
    schedule_load: vehicle._schedule_load ?? null,
    availability: availabilityLabel(vehicle.vehicle_status, vehicle._schedule_load, "vehicle"),
    maintenance: vehicle._maintenance
      ? {
          score: vehicle._maintenance.score,
          risk: vehicle._maintenance.risk,
          next_service_date: vehicle._maintenance.next_service_date ?? null,
          basis: vehicle._maintenance.basis ?? null,
        }
      : null,
    detected_risks: vehicleRisks(vehicle, request),
  };
}

/** Shape one scored driver candidate into the advisor payload. */
function toDriverCandidate(scored) {
  const driver = scored.driver;
  return {
    driver_id: driver.driver_id,
    driver_name: driverName(driver),
    driver_status: driver.driver_status,
    years_of_experience: driver.years_of_experience,
    avg_guest_rating: scored.avg_guest_rating ?? driver.avg_guest_rating ?? null,
    avg_driving_score: scored.avg_driving_score ?? driver.avg_driving_score ?? null,
    total_completed_trips: scored.total_completed_trips ?? driver.total_completed_trips ?? 0,
    // legacy field kept for LLM rationale prompt compatibility
    rating: scored.avg_guest_rating ?? driver.avg_guest_rating ?? null,
    license_expiry: driver.license_expiry,
    score: scored.score,
    confidence: Number(scored.confidence),
    reasons: scored.reasons,
    distance_from_pickup_km: driver._pickup_distance_km ?? null,
    // How the distance was derived ("recorded position", "last GPS ping",
    // "assumed at hotel base"). The narration must not present an assumed
    // position as a tracked one.
    position_basis: driver._position_basis ?? null,
    estimated_arrival_minutes:
      driver._pickup_distance_km != null ? Math.max(1, Math.round((driver._pickup_distance_km / 25) * 60)) : null,
    proximity_relevant: driver._proximity_relevant ?? false,
    schedule_load: driver._schedule_load ?? null,
    availability: availabilityLabel(driver.driver_status, driver._schedule_load),
    detected_risks: driverRisks(driver),
  };
}

/**
 * One-line readiness label for a vehicle or driver: "Available", or how busy
 * they are in the pickup window. Backs the availability chip in the panel.
 *
 * `kind` matters because the two status vocabularies mean different things. A
 * driver who is not `Available` really is out of action. A vehicle that is
 * `Reserved` is not — that label only records a booking somewhere in the day,
 * so the schedule load is what decides whether this window is free. Only the
 * statuses that ground the vehicle make it unavailable.
 */
function availabilityLabel(status, scheduleLoad, kind = "driver") {
  const load = Number(scheduleLoad);
  if (Number.isFinite(load) && load > 0) {
    return { free: false, label: `${load} dispatch(es) in this window` };
  }
  if (status) {
    const blocked =
      kind === "vehicle" ? !vehicleOperationallyAvailable({ vehicle_status: status }) : status !== "Available";
    if (blocked) return { free: false, label: `Status: ${status}` };
  }
  return { free: true, label: "Available" };
}

/**
 * Shape one fleet-pair recommendation into the advisor payload.
 *
 * The vehicle/driver halves keep the enriched detail (risks, fuel burn, reasons)
 * the panel renders, but the SCORE, confidence and reasons come from the pair —
 * the two halves are never scored independently anymore.
 */
function toPairCandidate(pair, request, trip) {
  const vehicleCandidate = toVehicleCandidate(
    { vehicle: pair.vehicle, score: pair.score, confidence: pair.confidence, reasons: pair.reasons },
    request,
    trip
  );
  const driverCandidate = toDriverCandidate({
    driver: pair.driver,
    score: pair.score,
    confidence: pair.confidence,
    reasons: pair.reasons,
  });

  return {
    vehicle: vehicleCandidate,
    driver: driverCandidate,
    vehicle_id: pair.vehicle.vehicle_id,
    driver_id: pair.driver.driver_id,
    designated_driver_id: pair.designated?.driver_id ?? null,
    is_designated: pair.is_designated,
    reason_type: pair.reason_type,
    replacement_reason: pair.replacement_reason ?? null,
    score: pair.score,
    confidence: Number(pair.confidence),
    reasons: pair.reasons,
    checklist: pair.checklist ?? [],
    // AI Fair Workload Distribution — pool-relative fairness score + the
    // driver's rolling workload detail (null when no history exists).
    fairness_score: pair.fairness_score ?? null,
    workload: pair.workload ?? null,
    estimated_pickup_minutes: pair.estimated_pickup_minutes,
    distance_km: pair.distance_km,
  };
}

/**
 * Shape a caller-pinned vehicle/driver into the advisor's candidate payload.
 *
 * Used when the UI has already decided which pair it is committing and needs the
 * narration to describe that pair rather than the independently-scored one. No
 * score is invented: `score` stays null unless the caller supplies one, since
 * these rows never went through the pair engine.
 */
export function shapePinnedPair({ vehicle, driver, request, score = null }) {
  const trip = estimateTrip(request?.pickup_location, request?.dropoff_location);

  return {
    vehicle: vehicle
      ? toVehicleCandidate({ vehicle, score, confidence: 0, reasons: [] }, request, trip)
      : null,
    driver: driver ? toDriverCandidate({ driver, score, confidence: 0, reasons: [] }) : null,
    score,
  };
}

/**
 * Build the full dispatch recommendation for a request.
 *
 * Pure and synchronous: callers fetch the candidate pools (so they control the
 * availability window and RBAC scope) and pass them in, along with the active
 * custodial pairings. Returns a payload safe to cache.
 *
 * The DECISION is the fleet pair (vehicle + designated driver as one unit).
 * `vehicle`/`driver` sub-blocks remain for the LLM rationale prompt and any
 * legacy consumer, but they now carry the pair's score rather than an
 * independent score.
 *
 * @param {object} params
 * @param {object} params.request       transportation_requests row
 * @param {object[]} params.vehicles    candidate vehicles (already availability-filtered)
 * @param {object[]} params.drivers     candidate drivers
 * @param {Array} [params.activePairs]  active custodial pairs (assigned_until IS NULL)
 * @param {Array} [params.activeSubstitutes] day-scoped substitute schedules
 * @param {Date} [params.now]           fixed clock for tests
 * @returns {{
 *   generated_at: string,
 *   trip: object,
 *   pair: { recommended: object|null, alternate: object|null,
 *           candidates: object[], considered: number,
 *           none_reasons: Array<{vehicle_id:number, plate:string, reason:string}> },
 *   vehicle: object, driver: object, narration: null
 * }}
 */
export function buildDispatchRecommendation({
  request,
  vehicles = [],
  drivers = [],
  activePairs = [],
  activeSubstitutes = [],
  now = new Date(),
  returnAt,
  scheduleContext,
}) {
  const passengers = Number(request?.passenger_count) || 1;
  const trip = estimateTrip(request?.pickup_location, request?.dropoff_location);

  // Pair engine ranks complete vehicle+driver pairs; designated match dominates.
  const { pairs = [], recommended, alternate, skipped = [] } = buildFleetPairRecommendations({
    request,
    vehicles,
    drivers,
    activePairs,
    activeSubstitutes,
    trip,
    now,
    returnAt,
    scheduleContext,
  });

  // Legacy independent scores, retained ONLY for backward compatibility of the
  // `vehicle`/`driver` payload shape. The recommended pair is the decision.
  //
  // Callers hand in the full driver roster, not just the free ones, so the pair
  // engine can recognise an absent custodian and say so precisely ("designated
  // driver is On Leave and no substitute is assigned") instead of mistaking the
  // car for one that never had a custodian. These legacy blocks predate that and
  // are meant to list only drivers who could take a job, so they are filtered
  // back down here rather than changing their published shape.
  const availableDrivers = drivers.filter((d) => d?.driver_status === DRIVER_STATUS.AVAILABLE);
  const scoredVehicles = scoreReservationVehicles(vehicles, passengers);
  const scoredDrivers = scoreDispatchDrivers(availableDrivers);
  const vehicleCandidates = scoredVehicles.map((s) => toVehicleCandidate(s, request, trip));
  const driverCandidates = scoredDrivers.map(toDriverCandidate);

  // Every eligible pair the engine formed, top-ranked first. The top two are
  // `recommended`/`alternate`; the rest let a dispatcher choose any valid
  // vehicle+driver for the window instead of being pinned to the runner-up.
  const candidatePairs = pairs.map((p) => toPairCandidate(p, request, trip));

  return {
    generated_at: new Date().toISOString(),
    trip: {
      estimated_distance_km: trip.distanceKm,
      estimated_travel_minutes: trip.durationMin,
      estimate_confidence: trip.confidence,
      estimate_basis: trip.basis,
      passenger_count: passengers,
    },
    pair: {
      recommended: recommended ? toPairCandidate(recommended, request, trip) : null,
      alternate: alternate ? toPairCandidate(alternate, request, trip) : null,
      candidates: candidatePairs,
      considered: vehicles.length,
      // "Why no candidates" — distinct vehicle-level reasons the pairing engine
      // skipped when it could not form a pair. Empty when a pair exists.
      none_reasons: skipped.map((s) => ({ vehicle_id: s.vehicle_id, plate: s.plate, reason: s.reason })),
    },
    vehicle: {
      recommended: vehicleCandidates[0] ?? null,
      alternate: vehicleCandidates[1] ?? null,
      considered: vehicles.length,
    },
    driver: {
      recommended: driverCandidates[0] ?? null,
      alternate: driverCandidates[1] ?? null,
      considered: drivers.length,
    },
    // Optional LLM narration is attached by the API route when AI mode is on.
    narration: null,
  };
}
