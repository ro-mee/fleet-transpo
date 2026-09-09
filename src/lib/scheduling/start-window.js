// Shared start-window resolution — the ONE place that turns (trip, driver
// position, policy) into a departure window, so the three consumers never
// drift:
//
//   1. GET /api/mobile/driver/trips  — preStart enrichment ("when can I start")
//   2. PUT /api/trips/[id]/start     — the enforcement gate (authoritative)
//   3. start-window-notifications.service — time-driven driver notifications
//
// The math itself lives in computeDepartureWindow() (departure-window.js).
// What this module owns is the ETA ladder in front of it:
//
//     TomTom route  →  haversine/25km-per-h heuristic  →  stored estimate
//     COALESCE(r.estimated_duration, tr.estimated_duration)
//
// Everything fail-opens to null: absent data must never fabricate a window.

import { computeDepartureWindow } from "@/lib/scheduling/departure-window";
import { tomtomEtaMinutes, etaFromDistanceKm, haversineKm } from "@/lib/scheduling/travel-buffer";

/**
 * The ETA ladder: minutes from the driver's current position to the pickup,
 * falling back the same way the start gate and the driver trips feed do.
 * Pure except for the optional TomTom call, which is an explicit injectable.
 *
 * @param {object} p
 * @param {[number,number]|null} p.driverPosition [lat, lng] or null
 * @param {[number,number]|null} p.pickupPosition [lat, lng] or null
 * @param {number|null} p.storedDurationMinutes  COALESCE(r.estimated_duration, tr.estimated_duration)
 * @param {typeof fetch} [p.fetchImpl]          injectable fetch (tests)
 * @returns {Promise<number|null>} minutes, or null when nothing resolves
 */
export async function resolveEtaMinutes({ driverPosition, pickupPosition, storedDurationMinutes, fetchImpl = fetch }) {
  const src = driverPosition || null;
  const dest = pickupPosition || null;
  let eta = null;
  if (src && dest) eta = await tomtomEtaMinutes({ origin: src, destination: dest, fetchImpl });
  if (eta == null && src && dest) eta = etaFromDistanceKm(haversineKm(src, dest));
  if (eta == null) {
    const d = Number(storedDurationMinutes);
    eta = Number.isFinite(d) && d > 0 ? d : null;
  }
  return eta;
}

/**
 * Full window for a trip: the ETA ladder + computeDepartureWindow with the
 * policy buffers. Mirrors the start gate's exact inputs (pickup from
 * dispatchschedules.scheduled_departure, ETA from the driver's live position
 * to the trip origin).
 *
 * @param {object} p
 * @param {Date|string|null} p.pickup               scheduled pickup
 * @param {[number,number]|null} p.driverPosition   [lat, lng] or null
 * @param {[number,number]|null} p.pickupPosition   [lat, lng] or null
 * @param {number|null} p.storedDurationMinutes     stored estimate fallback
 * @param {number} [p.departureBufferMinutes]
 * @param {number} [p.earlyStartAllowanceMinutes]
 * @param {typeof fetch} [p.fetchImpl]
 * @returns {Promise<{recommended_departure: Date|null, earliest_start: Date|null, latest_start: Date|null, eta_minutes: number|null}>}
 */
export async function resolveStartWindow({
  pickup,
  driverPosition,
  pickupPosition,
  storedDurationMinutes,
  departureBufferMinutes,
  earlyStartAllowanceMinutes,
  fetchImpl = fetch,
}) {
  if (pickup == null || pickup === "") {
    return { recommended_departure: null, earliest_start: null, latest_start: null, eta_minutes: null };
  }
  const etaMinutes = await resolveEtaMinutes({ driverPosition, pickupPosition, storedDurationMinutes, fetchImpl });
  return computeDepartureWindow({ pickup, etaMinutes, departureBufferMinutes, earlyStartAllowanceMinutes });
}

/**
 * Which start-window threshold has been crossed, if any — the catch-up rule
 * in pure form: when several thresholds are behind `now`, only the MOST
 * ADVANCED event fires (a scan that slept through earliest_start jumps
 * straight to departure_due; one that slept through both goes overdue).
 * One threshold event per trip per run.
 *
 * @param {object} window result of resolveStartWindow / computeDepartureWindow
 * @param {Date|number|string} [now]
 * @returns {"window_open"|"departure_due"|"overdue"|null}
 */
export function crossedStartWindowThreshold(window, now = new Date()) {
  if (!window) return null;
  const t = new Date(now).getTime();
  if (!Number.isFinite(t)) return null;
  const past = (d) => d != null && Number.isFinite(new Date(d).getTime()) && t >= new Date(d).getTime();
  // latest_start is always the pickup (even when the ETA is unknown), so the
  // overdue event never depends on the ETA resolving.
  if (past(window.latest_start)) return "overdue";
  if (past(window.recommended_departure)) return "departure_due";
  if (past(window.earliest_start)) return "window_open";
  return null;
}
