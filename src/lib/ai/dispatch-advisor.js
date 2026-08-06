import { scoreReservationVehicles, scoreDispatchDrivers } from "@/lib/ai/rule-engine";
import { estimateTrip, estimateFuel } from "@/lib/geo/distance";

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

/**
 * Fuel efficiency (km/L) inferred from seating capacity and fuel type.
 * The schema carries no per-vehicle efficiency figure, so this heuristic stands
 * in — bigger vehicles burn more, diesel drivetrains stretch a litre further.
 */
function estimateEfficiency(vehicle) {
  const seats = Number(vehicle?.seating_capacity) || 4;
  let kmPerLiter;
  if (seats <= 5) kmPerLiter = 12;
  else if (seats <= 8) kmPerLiter = 9;
  else if (seats <= 15) kmPerLiter = 7;
  else kmPerLiter = 5;
  return /diesel/i.test(vehicle?.fuel_type || "") ? kmPerLiter * 1.15 : kmPerLiter;
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

  if (vehicle?.vehicle_status && vehicle.vehicle_status !== "Available") {
    risks.push({ level: "high", message: `Vehicle status is ${vehicle.vehicle_status}.` });
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
    detected_risks: driverRisks(driver),
  };
}

/**
 * Build the full dispatch recommendation for a request.
 *
 * Pure and synchronous: callers fetch the candidate pools (so they control the
 * availability window and RBAC scope), then pass them in. Returns a payload
 * safe to cache in transportation_requests.ai_*_recommendation.
 *
 * @param {object} params
 * @param {object} params.request   transportation_requests row
 * @param {object[]} params.vehicles candidate vehicles (already availability-filtered)
 * @param {object[]} params.drivers  candidate drivers
 * @returns {{
 *   generated_at: string,
 *   trip: object,
 *   vehicle: { recommended: object|null, alternate: object|null, considered: number },
 *   driver: { recommended: object|null, alternate: object|null, considered: number },
 *   narration: null
 * }}
 */
export function buildDispatchRecommendation({ request, vehicles = [], drivers = [] }) {
  const passengers = Number(request?.passenger_count) || 1;
  const trip = estimateTrip(request?.pickup_location, request?.dropoff_location);

  // scoreReservationVehicles drops anything that can't seat the party, so an
  // empty result after a non-empty pool means "nothing fits", not "no fleet".
  const scoredVehicles = scoreReservationVehicles(vehicles, passengers);
  const scoredDrivers = scoreDispatchDrivers(drivers);

  const vehicleCandidates = scoredVehicles.map((s) => toVehicleCandidate(s, request, trip));
  const driverCandidates = scoredDrivers.map(toDriverCandidate);

  return {
    generated_at: new Date().toISOString(),
    trip: {
      estimated_distance_km: trip.distanceKm,
      estimated_travel_minutes: trip.durationMin,
      estimate_confidence: trip.confidence,
      estimate_basis: trip.basis,
      passenger_count: passengers,
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
    // Null here keeps the payload shape stable when it isn't.
    narration: null,
  };
}
