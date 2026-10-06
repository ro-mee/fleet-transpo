// Trip geofence targets — I/O boundary for arrival intelligence.
//
// Resolves the two points a trip's geofences are drawn around:
//   pickup      ← dispatch route's origin location (coords + pickup_radius_m)
//   destination ← dispatch route's destination location (coords + dropoff_radius_m)
//
// Legacy fallback chain per end (never guessed): route location → text lookup
// (default 100 m radii) → null (geofence stays UNKNOWN). V2 requests bypass
// text lookup and use only active locations linked by the request's explicit IDs.
// Radii are operational tuning, not identity: they ride the location row and
// never trigger the coordinate-change versioning in PUT /api/locations/[id].

import { resolveCoordinatesWithDb } from "@/lib/geo/dynamic-locations";
import { getCoordinateProvenanceFields } from "@/lib/locations/coordinate-provenance";
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  GEOFENCE_FIX_FRESH_MS,
  resolveGeofenceRadius,
  evaluateGeofence,
  evaluateTripGeofences,
} from "@/lib/geo/geofence";

function toLatLng(lat, lng, { allowZero = false } = {}) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  if (la === 0 && ln === 0 && !allowZero) return null;
  return { lat: la, lng: ln };
}

function isV2Request(row) {
  return row?.external_create_fingerprint != null || row?._external_create_fingerprint != null;
}

function v2EndpointProvenance(row, endpoint) {
  const linkedId = row?.[`${endpoint}_location_id`];
  const registryId = row?.[`_${endpoint}_registry_location_id`];
  const location = getCoordinateProvenanceFields({
    is_active: linkedId != null
      && registryId != null
      && String(linkedId) === String(registryId)
      && row[`_${endpoint}_registry_is_active`] === true
      && row[`_${endpoint}_registry_retired_at`] == null,
    latitude: row?.[`_${endpoint}_registry_latitude`],
    longitude: row?.[`_${endpoint}_registry_longitude`],
  });
  if (location.coordinate_provenance === "canonical_registry") return "canonical_registry";
  const hasProposal = row?.[`_${endpoint}_proposal_present`] === true
    || row?.[`partner_${endpoint}_location_proposal`] != null;
  return hasProposal ? "pending_review" : "unknown";
}

function v2EndpointTarget(row, endpoint) {
  if (v2EndpointProvenance(row, endpoint) !== "canonical_registry") return null;
  const coordinates = toLatLng(
    row[`_${endpoint}_registry_latitude`],
    row[`_${endpoint}_registry_longitude`],
    { allowZero: true }
  );
  if (!coordinates) return null;
  return {
    ...coordinates,
    radiusM: resolveGeofenceRadius(row[`_${endpoint}_registry_radius`]),
    label: row[`_${endpoint}_registry_name`],
    source: "canonical_registry",
  };
}

function emptyTargets(row = null) {
  const empty = { pickup: null, destination: null };
  if (isV2Request(row)) {
    empty.pickup_location_provenance = v2EndpointProvenance(row, "pickup");
    empty.dropoff_location_provenance = v2EndpointProvenance(row, "dropoff");
  }
  return empty;
}

/**
 * @param {object} db  { query } — same shape the recommendation route passes
 * @param {object} trip  { trip_id } or a trip row with origin/destination/dispatch_id
 * @returns {Promise<{ pickup: object|null, destination: object|null,
 *   pickup_location_provenance?: "canonical_registry"|"pending_review"|"unknown",
 *   dropoff_location_provenance?: "canonical_registry"|"pending_review"|"unknown" }>}
 */
export async function getTripGeofenceTargets(db, trip) {
  if (!db || trip == null) return emptyTargets(trip);
  let row = trip;
  try {
    const hasV2RegistryProjection = row._pickup_registry_location_id !== undefined
      && row._dropoff_registry_location_id !== undefined;
    if (trip.trip_id != null && (trip.origin === undefined || trip.dispatch_id === undefined
      || (isV2Request(trip) && !hasV2RegistryProjection))) {
      // trips has NO origin/destination columns (migration 007 dropped them;
      // see src/lib/api/trips-query.js). Legacy endpoints are derived through
      // the booking request and then its route. For v2 requests, also load only
      // the Fleet rows linked by the request's explicit location IDs.
      const { rows } = await db.query(
        `SELECT t.trip_id, t.dispatch_id, t.route_id,
                COALESCE(NULLIF(tr.pickup_location, ''), NULLIF(r.origin, '')) AS origin,
                COALESCE(NULLIF(tr.dropoff_location, ''), NULLIF(r.destination, '')) AS destination,
                tr.external_create_fingerprint, tr.pickup_location_id, tr.dropoff_location_id,
                tr.partner_pickup_location_proposal IS NOT NULL AS _pickup_proposal_present,
                tr.partner_dropoff_location_proposal IS NOT NULL AS _dropoff_proposal_present,
                pickup_registry.location_id AS _pickup_registry_location_id,
                pickup_registry.name AS _pickup_registry_name,
                pickup_registry.is_active AS _pickup_registry_is_active,
                pickup_registry.retired_at AS _pickup_registry_retired_at,
                pickup_registry.latitude AS _pickup_registry_latitude,
                pickup_registry.longitude AS _pickup_registry_longitude,
                pickup_registry.pickup_radius_m AS _pickup_registry_radius,
                dropoff_registry.location_id AS _dropoff_registry_location_id,
                dropoff_registry.name AS _dropoff_registry_name,
                dropoff_registry.is_active AS _dropoff_registry_is_active,
                dropoff_registry.retired_at AS _dropoff_registry_retired_at,
                dropoff_registry.latitude AS _dropoff_registry_latitude,
                dropoff_registry.longitude AS _dropoff_registry_longitude,
                dropoff_registry.dropoff_radius_m AS _dropoff_registry_radius
           FROM trips t
           LEFT JOIN dispatchschedules ds ON t.dispatch_id = ds.dispatch_id
           LEFT JOIN routes r ON t.route_id = r.route_id
           LEFT JOIN transportation_requests tr
             ON ds.request_id = tr.request_id AND tr.deleted_at IS NULL
           LEFT JOIN locations pickup_registry ON pickup_registry.location_id = tr.pickup_location_id
           LEFT JOIN locations dropoff_registry ON dropoff_registry.location_id = tr.dropoff_location_id
          WHERE t.trip_id = $1
          LIMIT 1`,
        [trip.trip_id]
      );
      if (!rows?.[0]) return emptyTargets(trip);
      row = { ...trip, ...rows[0] };
    }

    if (isV2Request(row)) {
      return {
        pickup: v2EndpointTarget(row, "pickup"),
        destination: v2EndpointTarget(row, "dropoff"),
        pickup_location_provenance: v2EndpointProvenance(row, "pickup"),
        dropoff_location_provenance: v2EndpointProvenance(row, "dropoff"),
      };
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

    // Legacy-only fallback: live registry/hotel resolution then the gazetteer.
    if (!originLoc && row.origin) {
      const c = await resolveCoordinatesWithDb(db, row.origin);
      if (c) {
        originLoc = {
          lat: c.lat, lng: c.lng,
          radiusM: DEFAULT_GEOFENCE_RADIUS_M,
          label: c.label,
          source: c.source === "canonical" ? "canonical" : c.source === "hotel" ? "hotel" : "gazetteer",
        };
      }
    }
    if (!destLoc && row.destination) {
      const c = await resolveCoordinatesWithDb(db, row.destination);
      if (c) {
        destLoc = {
          lat: c.lat, lng: c.lng,
          radiusM: DEFAULT_GEOFENCE_RADIUS_M,
          label: c.label,
          source: c.source === "canonical" ? "canonical" : c.source === "hotel" ? "hotel" : "gazetteer",
        };
      }
    }

    return { pickup: originLoc, destination: destLoc };
  } catch {
    return emptyTargets(row);
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
 * Shared core for the arrival gates: latest server-side GPS ping vs one trip
 * end. `end` is "pickup" or "destination".
 */
async function checkEndProximity(db, tripId, now, end) {
  const isPickup = end === "pickup";
  const pointNoun = isPickup ? "pickup point" : "destination";
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
      return unknown("Latest GPS fix is stale; position cannot be trusted for the arrival check.");
    }
    const targets = await cachedTargets(db, { trip_id: id });
    const target = isPickup ? targets.pickup : targets.destination;
    if (!target) return unknown(isPickup
      ? "Pickup point is not resolved to coordinates."
      : "Destination is not resolved to coordinates.");
    const verdict = evaluateGeofence({
      position: { lat: ping.latitude, lng: ping.longitude },
      target,
      radiusM: target.radiusM,
      accuracyM: ping.accuracy,
    });
    return {
      ...verdict,
      label: target.label,
      source: target.source,
      recordedAt: ping.recorded_at instanceof Date ? ping.recorded_at.toISOString() : ping.recorded_at,
    };
  } catch {
    return unknown(isPickup
      ? "Pickup proximity check failed."
      : "Destination proximity check failed.");
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
  return checkEndProximity(db, tripId, now, "destination");
}

/**
 * Pickup proximity for the arrival gates (At Pickup / Passenger Onboard),
 * from the trip's latest GPS ping. Same fail-open contract as the
 * destination check: `unknown` never blocks — only a fresh, accurate fix
 * proving the driver is outside the pickup geofence does.
 *
 * @returns {Promise<{ state, distanceM, radiusM, label, source, reason, recordedAt }>}
 */
export async function checkPickupProximity(db, tripId, now = new Date()) {
  return checkEndProximity(db, tripId, now, "pickup");
}
