// Arrival geofences — PURE evaluation, no DB, no network.
//
// Answers "inside / outside / unknown" for a position against a circular
// geofence, with an accuracy guard in front: a fix whose reported accuracy is
// worse than GEOFENCE_ACCURACY_LIMIT_M is still a stored ping, but it must
// never produce a confident arrival claim — state becomes UNKNOWN with an
// explicit reason instead of a fake "arrived".
//
// A geofence NEVER changes trip status. Callers use the result to SUGGEST
// ("You're near the pickup point — [Arrived at Pickup]"); the driver confirms
// through the normal lifecycle transition.

import { haversineKm } from "@/lib/geo/distance";

/** Default radius when a location carries none (migration 108 backfills 100). */
export const DEFAULT_GEOFENCE_RADIUS_M = 100;
/** Hard ceiling — mirrors chk_locations_geofence_radii. */
export const MAX_GEOFENCE_RADIUS_M = 1000;
/** Fixes worse than this are stored but unusable for arrival decisions. */
export const GEOFENCE_ACCURACY_LIMIT_M = 150;
/** A fix older than this cannot gate completion (fail-open to unknown). */
export const GEOFENCE_FIX_FRESH_MS = 10 * 60 * 1000;
/** Segments implying faster than this are teleports, not driving. */
export const TRAIL_MAX_KMH = 180;

function toLatLng(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Sanitize a configured radius: positive and within the ceiling, else the
 * default. A corrupt radius must widen/narrow honestly to 100 m, never to 0
 * (which would make arrival impossible) or infinity (which would fake it).
 */
export function resolveGeofenceRadius(value, fallback = DEFAULT_GEOFENCE_RADIUS_M) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0 && n <= MAX_GEOFENCE_RADIUS_M) return Math.round(n);
  const f = Number(fallback);
  if (Number.isFinite(f) && f > 0 && f <= MAX_GEOFENCE_RADIUS_M) return Math.round(f);
  return DEFAULT_GEOFENCE_RADIUS_M;
}

/**
 * @param {object} p
 * @param {{lat:number,lng:number}|{latitude:number,longitude:number}} p.position
 * @param {{lat:number,lng:number}|{latitude:number,longitude:number}} p.target
 * @param {number} [p.radiusM] geofence radius in metres
 * @param {number|null} [p.accuracyM] reported fix accuracy in metres (null = unreported)
 * @returns {{ state: "inside"|"outside"|"unknown", distanceM: number|null, radiusM: number, reason: string }}
 */
export function evaluateGeofence({ position, target, radiusM, accuracyM = null }) {
  const radius = resolveGeofenceRadius(radiusM);
  const pos = toLatLng(position);
  const tgt = toLatLng(target);
  if (!pos || !tgt) {
    return { state: "unknown", distanceM: null, radiusM: radius, reason: "Position or target is missing." };
  }

  const distanceM = Math.round(haversineKm(pos, tgt) * 1000);

  // Accuracy guard: an explicit poor fix is stored but cannot claim arrival.
  // Null (unreported) proceeds — there is no evidence of a bad fix — and the
  // reason records that the guard had nothing to check.
  if (accuracyM != null && accuracyM !== "") {
    const acc = Number(accuracyM);
    if (Number.isFinite(acc) && acc >= 0 && acc > GEOFENCE_ACCURACY_LIMIT_M) {
      return {
        state: "unknown",
        distanceM,
        radiusM: radius,
        reason: `GPS accuracy insufficient (±${Math.round(acc)} m exceeds the ${GEOFENCE_ACCURACY_LIMIT_M} m limit).`,
      };
    }
  }

  if (distanceM <= radius) {
    return { state: "inside", distanceM, radiusM: radius, reason: `Within the ${radius} m geofence.` };
  }
  return { state: "outside", distanceM, radiusM: radius, reason: `${distanceM} m from the geofence center.` };
}

/**
 * Evaluate both trip ends at once. Targets that cannot be resolved stay
 * unknown — never guessed.
 */export function evaluateTripGeofences({ position, accuracyM = null, pickup = null, destination = null }) {
  const pick = pickup
    ? evaluateGeofence({ position, target: pickup, radiusM: pickup.radiusM, accuracyM })
    : { state: "unknown", distanceM: null, radiusM: DEFAULT_GEOFENCE_RADIUS_M, reason: "Pickup point is not resolved." };
  const dest = destination
    ? evaluateGeofence({ position, target: destination, radiusM: destination.radiusM, accuracyM })
    : { state: "unknown", distanceM: null, radiusM: DEFAULT_GEOFENCE_RADIUS_M, reason: "Destination is not resolved." };
  return {
    near_pickup: pick.state === "inside",
    near_destination: dest.state === "inside",
    distance_to_pickup_m: pick.distanceM,
    distance_to_destination_m: dest.distanceM,
    geofence_state: pick.state === "unknown" || dest.state === "unknown" ? "unknown" : "known",
    pickup: pick,
    destination: dest,
  };
}

/**
 * Server-derived trip distance from the GPS trail.
 *
 * Sums haversine segments between consecutive fixes, skipping segments with
 * non-positive time deltas or implied speeds above TRAIL_MAX_KMH (teleports
 * from bad fixes, not driving). Returns null when fewer than two usable
 * fixes exist — the caller keeps its existing distance logic untouched.
 *
 * @param {Array<{latitude:number|string, longitude:number|string, recorded_at:string}>} points
 * @returns {number|null} kilometres, 1 decimal
 */
export function trailDistanceKm(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let totalKm = 0;
  let usable = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const pa = toLatLng({ lat: a?.latitude, lng: a?.longitude });
    const pb = toLatLng({ lat: b?.latitude, lng: b?.longitude });
    if (!pa || !pb) continue;
    const dtMs = new Date(b?.recorded_at).getTime() - new Date(a?.recorded_at).getTime();
    if (!Number.isFinite(dtMs) || dtMs <= 0) continue;
    const segKm = haversineKm(pa, pb);
    const kmh = segKm / (dtMs / 3600000);
    if (!(kmh <= TRAIL_MAX_KMH)) continue;
    totalKm += segKm;
    usable++;
  }
  if (!usable) return null;
  return Math.round(totalKm * 10) / 10;
}
