// Trip geofence targets — I/O boundary for arrival intelligence.
//
// Resolves the two points a trip's geofences are drawn around:
//   pickup      ← dispatch route's origin location (coords + pickup_radius_m)
//   destination ← dispatch route's destination location (coords + dropoff_radius_m)
//
// Fallback chain per end (never guessed): canonical location → gazetteer
// text match (default 100 m radii) → null (geofence stays UNKNOWN).
// Radii are operational tuning, not identity: they ride the location row and
// never trigger the coordinate-change versioning in PUT /api/locations/[id].

import { resolveCoordinates } from "@/lib/geo/distance";
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  GEOFENCE_FIX_FRESH_MS,
  resolveGeofenceRadius,
  evaluateGeofence,
  evaluateTripGeofences,
} from "@/lib/geo/geofence";

function toLatLng(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

/**
 * @param {object} db  { query } — same shape the recommendation route passes
 * @param {object} trip  { trip_id } or a trip row with origin/destination/dispatch_id
 * @returns {Promise<{ pickup: object|null, destination: object|null }>}
 */
export async function getTripGeofenceTargets(db, trip) {
  const empty = { pickup: null, destination: null };
  if (!db || trip == null) return empty;
  try {
    let row = trip;
    if (trip.trip_id != null && (trip.origin === undefined || trip.dispatch_id === undefined)) {
      // trips has NO origin/destination columns (migration 007 dropped them;
      // see src/lib/api/trips-query.js). The endpoints are DERIVED through the
      // dispatch's booking request first, the route as fallback — the same
      // chain every other reader of trip endpoints uses. The previous version
      // selected origin/destination straight from trips, which raised
      // "column does not exist" on the real database; this function's
      // try/catch swallowed it and every caller silently got
      // {pickup: null, destination: null} — no geofence verdicts, no monitor
      // target, no route line on the live map.
      const { rows } = await db.query(
        `SELECT t.trip_id, t.dispatch_id, t.route_id,
                COALESCE(NULLIF(tr.pickup_location, ''), NULLIF(r.origin, ''))  AS origin,
                COALESCE(NULLIF(tr.dropoff_location, ''), NULLIF(r.destination, '')) AS destination
           FROM trips t
           LEFT JOIN dispatchschedules ds ON t.dispatch_id = ds.dispatch_id
           LEFT JOIN routes r ON t.route_id = r.route_id
           LEFT JOIN transportation_requests tr
             ON ds.request_id = tr.request_id AND tr.deleted_at IS NULL
          WHERE t.trip_id = $1
          LIMIT 1`,
        [trip.trip_id]
      );
      if (!rows?.[0]) return empty;
      row = rows[0];
    }

    let originLoc = null;
    let destLoc = null;
    const routeId = row.route_id ?? null;
    let dispatchRouteId = null;
    if (routeId == null && row.dispatch_id != null) {
      const { rows } = await db.query(
        `SELECT route_id FROM dispatchschedules WHERE dispatch_id = $1 LIMIT 1`,
        [row.dispatch_id]
      );
      dispatchRouteId = rows?.[0]?.route_id ?? null;
    }
    const effectiveRouteId = routeId ?? dispatchRouteId;
    if (effectiveRouteId != null) {
      const { rows } = await db.query(
        `SELECT r.route_id,
                ol.location_id AS o_id, ol.name AS o_name,
                ol.latitude AS o_lat, ol.longitude AS o_lng, ol.pickup_radius_m AS o_radius,
                dl.location_id AS d_id, dl.name AS d_name,
                dl.latitude AS d_lat, dl.longitude AS d_lng, dl.dropoff_radius_m AS d_radius
           FROM routes r
           LEFT JOIN locations ol ON ol.location_id = r.origin_location_id
           LEFT JOIN locations dl ON dl.location_id = r.destination_location_id
          WHERE r.route_id = $1
          LIMIT 1`,
        [effectiveRouteId]
      );
      const hit = rows?.[0];
      if (hit) {
        const o = toLatLng(hit.o_lat, hit.o_lng);
        if (o && hit.o_id != null) {
          originLoc = {
            ...o,
            radiusM: resolveGeofenceRadius(hit.o_radius),
            label: hit.o_name,
            source: "canonical",
          };
        }
        const d = toLatLng(hit.d_lat, hit.d_lng);
        if (d && hit.d_id != null) {
          destLoc = {
            ...d,
            radiusM: resolveGeofenceRadius(hit.d_radius),
            label: hit.d_name,
            source: "canonical",
          };
        }
      }
    }

    // Gazetteer fallback per end — default radii, honestly labelled.
    if (!originLoc && row.origin) {
      const c = resolveCoordinates(row.origin);
      if (c) {
        originLoc = {
          lat: c.lat, lng: c.lng,
          radiusM: DEFAULT_GEOFENCE_RADIUS_M,
          label: c.label,
          source: "gazetteer",
        };
      }
    }
    if (!destLoc && row.destination) {
      const c = resolveCoordinates(row.destination);
      if (c) {
        destLoc = {
          lat: c.lat, lng: c.lng,
          radiusM: DEFAULT_GEOFENCE_RADIUS_M,
          label: c.label,
          source: "gazetteer",
        };
      }
    }

    return { pickup: originLoc, destination: destLoc };
  } catch {
    return empty;
  }
}

// Trip targets are static for the life of a trip (radii retunes are rare and
// converge within the TTL). Without this, every 30 s ping would re-resolve
// trip → dispatch → route → locations.
const TARGET_TTL_MS = 5 * 60 * 1000;
const targetCache = new Map();

export function clearTripGeofenceCache() {
  targetCache.clear();
}

export async function cachedTargets(db, trip) {
  const key = trip?.trip_id != null ? Number(trip.trip_id) : null;
  if (key != null) {
    const hit = targetCache.get(key);
    if (hit && Date.now() - hit.cachedAt < TARGET_TTL_MS) return hit.targets;
  }
  const targets = await getTripGeofenceTargets(db, trip);
  if (key != null) targetCache.set(key, { targets, cachedAt: Date.now() });
  return targets;
}

/**
 * Evaluate one ingested ping against its trip's geofences.
 *
 * Fail-open and side-effect free: the ping is already stored by the caller;
 * this only describes it. A geofence NEVER transitions trip status — the
 * mobile client turns `near_*` into a human-confirmed suggestion.
 *
 * @returns {object} { near_pickup, near_destination, distance_to_pickup_m,
 *   distance_to_destination_m, geofence_state, pickup, destination }
 */
export async function evaluatePingGeofence(db, trip, { latitude, longitude, accuracy = null } = {}) {
  try {
    const targets = await cachedTargets(db, trip);
    return evaluateTripGeofences({
      position: { lat: Number(latitude), lng: Number(longitude) },
      accuracyM: accuracy,
      pickup: targets.pickup,
      destination: targets.destination,
    });
  } catch {
    return {
      near_pickup: false,
      near_destination: false,
      distance_to_pickup_m: null,
      distance_to_destination_m: null,
      geofence_state: "unknown",
      pickup: { state: "unknown", distanceM: null, reason: "Geofence evaluation failed." },
      destination: { state: "unknown", distanceM: null, reason: "Geofence evaluation failed." },
    };
  }
}

/**
 * Destination proximity for the completion gate, from the trip's latest GPS
 * ping (not the client-supplied position — the server checks its own trail).
 *
 * Fail-open: no ping, a stale ping (> GEOFENCE_FIX_FRESH_MS), or an
 * unresolvable destination all yield `unknown`, which never blocks.
 *
 * @returns {Promise<{ state, distanceM, radiusM, label, source, reason, recordedAt }>}
 */
export async function checkDestinationProximity(db, tripId, now = new Date()) {
  const unknown = (reason) => ({
    state: "unknown", distanceM: null, radiusM: null,
    label: null, source: null, reason, recordedAt: null,
  });
  try {
    const id = Number(tripId);
    if (!Number.isInteger(id)) return unknown("Invalid trip id.");
    const { rows } = await db.query(
      `SELECT latitude, longitude, accuracy, recorded_at
         FROM gpstracking
        WHERE trip_id = $1
        ORDER BY recorded_at DESC
        LIMIT 1`,
      [id]
    );
    const ping = rows?.[0];
    if (!ping) return unknown("No GPS fixes recorded for this trip.");
    const ageMs = new Date(now).getTime() - new Date(ping.recorded_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > GEOFENCE_FIX_FRESH_MS) {
      return unknown("Latest GPS fix is stale; position cannot be trusted for the completion check.");
    }
    const targets = await cachedTargets(db, { trip_id: id });
    if (!targets.destination) return unknown("Destination is not resolved to coordinates.");
    const verdict = evaluateGeofence({
      position: { lat: ping.latitude, lng: ping.longitude },
      target: targets.destination,
      radiusM: targets.destination.radiusM,
      accuracyM: ping.accuracy,
    });
    return {
      ...verdict,
      label: targets.destination.label,
      source: targets.destination.source,
      recordedAt: ping.recorded_at instanceof Date ? ping.recorded_at.toISOString() : ping.recorded_at,
    };
  } catch {
    return unknown("Destination proximity check failed.");
  }
}
