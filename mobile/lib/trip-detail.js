// Pure display/action decisions for the Trip Details screen.
// The screen owns rendering and navigation; these helpers decide WHAT is true:
// which primary action a trip admits, its start readiness, and which real
// timestamps/fields may be shown. No react-native/theme imports — vitest-runnable.

import { PRE_START } from './trips-queue';

const parseMs = (value) => {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The single primary action a trip's detail screen may offer:
 *  - 'accept-start' — pre-start trips: the existing accept→start flow
 *  - 'navigate'     — ACTIVE trips: navigation to the live map ONLY. Never a
 *                     status write: continuing an in-progress trip must not
 *                     re-issue accept/start (regression-guarded in tests).
 *  - 'closed'       — Completed/Cancelled: read-only.
 */
export function detailPrimaryAction(trip) {
  const status = trip?.trip_status;
  if (!status) return null;
  if (status === "Completed" || status === "Cancelled") return "closed";
  if (PRE_START.includes(status)) return "accept-start";
  return "navigate";
}

/**
 * Start readiness for pre-start trips. Both gates stay decisive here (the
 * server re-checks them; this only decides what the UI claims):
 * a valid earliest_start window that has opened AND a passed pre-trip
 * inspection. `unavailableReason` explains the blocking gate, in priority
 * order, for the disabled-action label.
 */
export function readinessFor(trip, nowMs) {
  const earliestStart = parseMs(trip?.earliest_start);
  const recommended = parseMs(trip?.recommended_departure);
  const preTripPassed = trip?.pre_trip_status === "Passed";
  const windowOpen = earliestStart != null && nowMs >= earliestStart;
  const startReady = windowOpen && preTripPassed;
  const minsToStart = earliestStart != null
    ? Math.max(0, Math.ceil((earliestStart - nowMs) / 60000))
    : null;
  let unavailableReason = null;
  if (!startReady) {
    if (earliestStart == null) unavailableReason = "schedule";
    else if (!windowOpen) unavailableReason = "window";
    else unavailableReason = "inspection";
  }
  return { earliestStart, recommended, windowOpen, preTripPassed, startReady, minsToStart, unavailableReason };
}

/**
 * Verified completion time. `end_time` is the column the trips table actually
 * has (there is no completed_at), set when the trip completes. Never fall back
 * to updated_at — a generic update is not an arrival.
 */
export function completionTime(trip) {
  return parseMs(trip?.end_time);
}

/** Scheduled departure as ms, or null — the screen shows "Not provided". */
export function scheduledDeparture(trip) {
  return parseMs(trip?.departure_time);
}

/**
 * Passenger facts as supplied. `count` is null when the field is missing —
 * a supplied 0 is a real value and is preserved; it never becomes 1.
 */
export function passengerSummary(trip) {
  const raw = trip?.passenger_count;
  const count = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))
    ? Number(raw)
    : null;
  return {
    name: trip?.passenger_name ? String(trip.passenger_name) : null,
    count,
  };
}
