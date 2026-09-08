// Shared trip-phase resolver — ONE interpretation of trip_status → phase.
//
// The live map used to hardcode its own status sets (PICKUP_ROUTE_STATUSES,
// …) while every other consumer guessed independently; a second private list
// in the PR #4 monitor would eventually disagree with the map about whether a
// trip is heading to pickup or to destination. This module is the single
// source of truth for that question:
//
//   resolveTripPhase("Passenger Onboard") → { phase: "to_destination", drawRoute: true }
//
// `phase` is which target the vehicle is working toward; `drawRoute` is
// whether a live GPS→target route line is meaningful yet (false while
// dispatched-but-not-started and while sitting at an endpoint).
//
// Everything here is pure — no DB, no network. Statuses outside the live
// window (Pending, Completed, …) resolve to a null phase.

import { TRIP_STATUS } from "@/lib/constants";

export const TRIP_PHASES = {
  TO_PICKUP: "to_pickup",
  TO_DESTINATION: "to_destination",
};

// status → { phase, drawRoute }. Kept as one literal table so a new
// LIVE_TRIP_STATUSES entry that is missing here fails the exhaustive test
// rather than silently resolving to null.
const PHASE_BY_STATUS = {
  [TRIP_STATUS.DISPATCHED]: { phase: TRIP_PHASES.TO_PICKUP, drawRoute: false },
  [TRIP_STATUS.DRIVER_ACCEPTED]: { phase: TRIP_PHASES.TO_PICKUP, drawRoute: false },
  [TRIP_STATUS.TRIP_STARTED]: { phase: TRIP_PHASES.TO_PICKUP, drawRoute: true },
  [TRIP_STATUS.AT_PICKUP]: { phase: TRIP_PHASES.TO_PICKUP, drawRoute: false },
  [TRIP_STATUS.PASSENGER_ONBOARD]: { phase: TRIP_PHASES.TO_DESTINATION, drawRoute: true },
  [TRIP_STATUS.EN_ROUTE]: { phase: TRIP_PHASES.TO_DESTINATION, drawRoute: true },
  [TRIP_STATUS.IN_PROGRESS]: { phase: TRIP_PHASES.TO_DESTINATION, drawRoute: true },
  [TRIP_STATUS.DROP_OFF]: { phase: TRIP_PHASES.TO_DESTINATION, drawRoute: false },
  [TRIP_STATUS.ARRIVED]: { phase: TRIP_PHASES.TO_DESTINATION, drawRoute: false },
};

/**
 * @param {string} tripStatus  a trips.trip_status value
 * @returns {{ phase: "to_pickup"|"to_destination"|null, drawRoute: boolean }}
 */
export function resolveTripPhase(tripStatus) {
  const entry = PHASE_BY_STATUS[tripStatus];
  if (entry) return { ...entry };
  return { phase: null, drawRoute: false };
}

/** Every trip_status that maps to a phase — the live operational window. */
export function phaseCapableStatuses() {
  return Object.keys(PHASE_BY_STATUS);
}
