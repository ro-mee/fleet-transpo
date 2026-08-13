// Travel-time + safety-buffer eligibility rule (SYSTEM.md §4.8.3).
//
// A resource that is FREE in the requested window may still be ineligible if its
// previous commitment ends so close to the next pickup that the driver cannot
// realistically get there on time. The rule:
//
//     earliest_next_available =
//         previous_scheduled_end
//       + travel_time_to_next_pickup   (TomTom travelTimeMin, else heuristic)
//       + safety_buffer
//
//     pickup < earliest_next_available  →  blocked (BLOCKING)
//     pickup >= earliest_next_available →  eligible
//
// The safety buffer is a configurable offset (on top of the travel time) with a
// configurable floor for very short hops — NOT a fixed 30 minutes forced onto
// every trip. See dispatch-policy.js (safetyBufferMinutes / bufferFloorMinutes).
//
// Everything here is pure (no DB, no network) except tomtomEtaMinutes, which is
// an explicit, fail-open integration point for the routing proxy.

/**
 * The exact instant a resource is next available for a pickup.
 *
 * Fail-open: returns null whenever a required input is missing/illegal so the
 * gate can never fabricate a conflict from absent data (mirrors the "provably"
 * principle in pair-scoring).
 *
 * @param {object} p
 * @param {Date|string|number} p.previousEnd         end of the previous scheduled commitment
 * @param {number|null} p.etaMinutes                 travel time to the next pickup (minutes)
 * @param {number} [p.safetyBufferMinutes=10]        configurable buffer on top of travel time
 * @param {number} [p.bufferFloorMinutes=5]          configurable floor for very short hops
 * @returns {Date|null}
 */
export function earliestNextAvailable({
  previousEnd,
  etaMinutes,
  safetyBufferMinutes = 10,
  bufferFloorMinutes = 5,
}) {
  if (previousEnd == null) return null;
  const end = new Date(previousEnd).getTime();
  if (etaMinutes == null) return null;
  const eta = Number(etaMinutes);
  if (!Number.isFinite(end) || !Number.isFinite(eta) || eta < 0) return null;

  const floor = Number(bufferFloorMinutes);
  const safety = Number(safetyBufferMinutes);
  const buffer = Math.max(
    Number.isFinite(floor) && floor > 0 ? floor : 0,
    Number.isFinite(safety) && safety > 0 ? safety : 0
  );

  return new Date(end + (eta + buffer) * 60 * 1000);
}

/**
 * Whether a pickup is blocked because the resource cannot get there in time.
 *
 * Fail-open: blocked is false whenever the signal is missing (no conflict is
 * invented from absent data).
 *
 * @param {object} p
 * @param {Date|string|number} p.pickup              the requested pickup datetime
 * @param {Date|string|number|null} p.previousEnd    end of the previous commitment (null = no prior commitment)
 * @param {number|null} p.etaMinutes                 travel minutes to the pickup (null = unknown)
 * @param {number} [p.safetyBufferMinutes]
 * @param {number} [p.bufferFloorMinutes]
 * @returns {{ blocked: boolean, earliest: Date|null }}
 */
export function travelBufferBlocked({
  pickup,
  previousEnd,
  etaMinutes,
  safetyBufferMinutes,
  bufferFloorMinutes,
}) {
  // No prior commitment, or no travel estimate → nothing to gate on. A resource
  // with nothing booked after him is available immediately; the buffer exists to
  // reserve slack AFTER a real commitment, not to delay a stand-by resource.
  if (previousEnd == null) return { blocked: false, earliest: null };
  const earliest = earliestNextAvailable({
    previousEnd,
    etaMinutes,
    safetyBufferMinutes,
    bufferFloorMinutes,
  });
  if (!earliest) return { blocked: false, earliest: null };

  const pickupMs = new Date(pickup).getTime();
  if (!Number.isFinite(pickupMs)) return { blocked: false, earliest };

  return { blocked: pickupMs < earliest.getTime(), earliest };
}

/**
 * Convenience helper: a resource's "earliest next availability" octet, all
 * signals collapsed, or null when nothing useful is present. Kept so callers
 * (conflict evaluator, assign route) read one function name.
 */
export function useTravelBufferSignals(signals) {
  return travelBufferBlocked(signals);
}

/**
 * Straight-line distance in kilometres between two coordinate pairs.
 * @param {[number,number]|null} a [lat, lng]
 * @param {[number,number]|null} b [lat, lng]
 * @returns {number|null}
 */
export function haversineKm(a, b) {
  if (!a || !b) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

/**
 * Fallback travel-time estimate: drive time for a road-based speed. Mirrors the
 * heuristic used by dispatch-advisor / pair-scoring (25 km/h effective speed).
 *
 * @param {number|null} distanceKm
 * @returns {number|null} minutes, or null when distance is unknown
 */
export function etaFromDistanceKm(distanceKm) {
  if (distanceKm == null) return null;
  const d = Number(distanceKm);
  if (!Number.isFinite(d) || d < 0) return null;
  return Math.max(1, Math.round((d / 25) * 60));
}

/**
 * TomTom routing travel-time (minutes) between two coordinate pairs.
 *
 * Integration point for SYSTEM.md §4.8.3 "TomTom travelTimeMin". Fail-open:
 * returns null on a missing key, network error, or malformed response, so the
 * hard gate falls back to the heuristic rather than crashing or over-blocking.
 *
 * @param {object} p
 * @param {[number,number]} p.origin                [lat, lng]
 * @param {[number,number]} p.destination          [lat, lng]
 * @param {typeof fetch} [p.fetchImpl]             injectable fetch (tests / server edge)
 * @returns {Promise<number|null>}
 */
export async function tomtomEtaMinutes({ origin, destination, fetchImpl = fetch }) {
  const src = origin && destination ? origin : null;
  if (!src) return null;

  // Reuse the same URL builder the route proxy uses so the key handling and the
  // lat/lon ordering can never drift between the two call sites.
  const { buildRouteUrl } = await import("@/lib/tomtom");
  const url = buildRouteUrl(src, destination);

  let res;
  try {
    res = await fetchImpl(url);
    if (!res.ok) return null;
    const json = await res.json();
    const summary = json?.routes?.[0]?.summary;
    const secs = Number(summary?.travelTimeInSeconds);
    return Number.isFinite(secs) && secs >= 0 ? Math.round(secs / 60) : null;
  } catch {
    return null;
  }
}