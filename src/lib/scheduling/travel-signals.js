// Server-side resolution of the §4.8.3 travel+buffer signals.
//
// Why this exists: the gate's ETA used to come straight from the request body
// (`body.travel.vehicle.etaMinutes`), so a caller who simply omitted `travel`
// skipped the travel+buffer gate entirely — silently, with no record, while the
// sanctioned `force: true` path demands a written `override_reason` and writes
// it to the reservation timeline. The gate is a safety constraint; its input
// cannot be the caller's word for it.
//
// So the number is derived from server-held data instead:
//
//     previous commitment's drop-off   ->   this request's pickup
//
// The origin is the previous trip's DESTINATION, not the resource's last known
// GPS fix. A resource that has just finished a trip is at that trip's drop-off,
// and the stored endpoint is present in exactly the case the gate has something
// to gate on. Last-known position is also frequently absent or stale; the
// endpoint is not.
//
// Precedence: TomTom driving time, then a straight-line heuristic, then unknown.
// A caller-supplied estimate is reported alongside for comparison and is never
// the value the gate enforces.
import { query } from "@/lib/db";
import { resolveRouteEndpoints } from "@/services/route-resolver.service";
import { tomtomEtaMinutes, haversineKm, etaFromDistanceKm } from "@/lib/scheduling/travel-buffer";
import { CONFLICT_SEVERITY, CONFLICT_TYPE } from "@/lib/scheduling/conflict-types";

// Mirrors ACTIVE_DISPATCH_STATUSES in lib/scheduling/conflicts.js: the dispatch
// statuses that count as a live commitment on a resource.
const ACTIVE_DISPATCH_STATUSES = ["Scheduled", "In Progress"];

/** A caller estimate this far from the derived one is reported as divergent. */
export const TRAVEL_ETA_DIVERGENCE_MIN = 15;

/** Where a derived ETA came from, surfaced in the finding detail. */
export const ETA_SOURCE = {
  TOMTOM: "tomtom",
  HEURISTIC: "heuristic",
  UNKNOWN: "unknown",
};

function coordsOf(location) {
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

/**
 * Travel minutes from one named place to another, or an explicit unknown.
 * Never throws: an unresolvable name or an unreachable router yields
 * `{ etaMinutes: null }` so the caller can report an unverified buffer rather
 * than a clean one.
 */
async function estimateBetween({ from, to }) {
  if (!from || !to) return { etaMinutes: null, source: ETA_SOURCE.UNKNOWN };

  let endpoints = null;
  try {
    endpoints = await resolveRouteEndpoints(
      { query: (text, params) => query(text, params) },
      { origin: from, destination: to }
    );
  } catch {
    endpoints = null;
  }

  const origin = coordsOf(endpoints?.originLocation);
  const destination = coordsOf(endpoints?.destinationLocation);
  if (!origin || !destination) return { etaMinutes: null, source: ETA_SOURCE.UNKNOWN };

  const routed = await tomtomEtaMinutes({ origin, destination }).catch(() => null);
  if (routed != null) return { etaMinutes: routed, source: ETA_SOURCE.TOMTOM };

  const straightLine = etaFromDistanceKm(haversineKm(origin, destination));
  return straightLine != null
    ? { etaMinutes: straightLine, source: ETA_SOURCE.HEURISTIC }
    : { etaMinutes: null, source: ETA_SOURCE.UNKNOWN };
}

/**
 * The most recent commitment each resource finished before this pickup, with
 * the destination it finished at.
 *
 * `FULL OUTER JOIN ... ON TRUE` so a vehicle-only or driver-only lookup still
 * returns its row when the other side has nothing.
 */
async function previousCommitments(vehicleId, driverId, pickup) {
  const { rows } = await query(
    `SELECT
       v.end_at AS vehicle_end, v.dropoff AS vehicle_dropoff,
       d.end_at AS driver_end,  d.dropoff AS driver_dropoff
     FROM
       (SELECT ds.scheduled_arrival AS end_at, tr.dropoff_location AS dropoff
          FROM dispatchschedules ds
          LEFT JOIN transportation_requests tr ON tr.request_id = ds.request_id
         WHERE ds.deleted_at IS NULL AND ds.status = ANY($3::text[])
           AND ds.vehicle_id = $1 AND ds.scheduled_arrival < $4::timestamptz
         ORDER BY ds.scheduled_arrival DESC LIMIT 1) v
     FULL OUTER JOIN
       (SELECT ds.scheduled_arrival AS end_at, tr.dropoff_location AS dropoff
          FROM dispatchschedules ds
          LEFT JOIN transportation_requests tr ON tr.request_id = ds.request_id
         WHERE ds.deleted_at IS NULL AND ds.status = ANY($3::text[])
           AND ds.driver_id = $2 AND ds.scheduled_arrival < $4::timestamptz
         ORDER BY ds.scheduled_arrival DESC LIMIT 1) d ON TRUE`,
    [vehicleId ?? null, driverId ?? null, ACTIVE_DISPATCH_STATUSES, pickup]
  );
  return rows[0] || {};
}

/**
 * Resolve the travel+buffer signals for a proposed assignment.
 *
 * @param {object} p
 * @param {object} p.request          the transportation_requests row
 * @param {number|null} p.vehicleId
 * @param {number|null} p.driverId
 * @param {object|null} p.claimed     the caller's `body.travel`, for comparison only
 * @returns {Promise<{vehicle?: object, driver?: object}>} per-resource signals,
 *   or `undefined` for a resource with no prior commitment (nothing to gate on)
 */
export async function resolveTravelSignals({ request, vehicleId = null, driverId = null, claimed = null } = {}) {
  const pickup = request?.pickup_datetime || null;
  if (!pickup) return { vehicle: undefined, driver: undefined };

  let previous = {};
  try {
    previous = await previousCommitments(vehicleId, driverId, pickup);
  } catch {
    previous = {};
  }

  const pickupName = request?.pickup_location ?? null;

  const one = async (endAt, dropoff, claimedEta) => {
    // No prior commitment → the resource is available immediately. This is the
    // legitimate fail-open, and it stays a fail-open.
    if (endAt == null) return undefined;

    const { etaMinutes, source } = await estimateBetween({ from: dropoff, to: pickupName });
    const claimedNumber = claimedEta == null ? null : Number(claimedEta);
    return {
      previousEnd: endAt,
      etaMinutes,
      etaSource: source,
      claimedEtaMinutes: Number.isFinite(claimedNumber) ? claimedNumber : null,
      divergent: etaMinutes != null
        && Number.isFinite(claimedNumber)
        && Math.abs(claimedNumber - etaMinutes) > TRAVEL_ETA_DIVERGENCE_MIN,
    };
  };

  return {
    vehicle: await one(previous?.vehicle_end, previous?.vehicle_dropoff, claimed?.vehicle?.etaMinutes),
    driver: await one(previous?.driver_end, previous?.driver_dropoff, claimed?.driver?.etaMinutes),
  };
}

/**
 * Advisories describing what the gate could not verify, and where the caller's
 * own estimate disagreed with the derived one. WARNING severity: these are
 * surfaced to the dispatcher, they do not block.
 */
export function travelAdvisories(travel, { vehicleId = null, driverId = null, driverLabel = null } = {}) {
  const findings = [];
  for (const kind of ["vehicle", "driver"]) {
    const signal = travel?.[kind];
    if (!signal) continue;
    const idKey = kind === "vehicle" ? "vehicle_id" : "driver_id";
    const id = kind === "vehicle" ? vehicleId : driverId;
    const label = kind === "driver" && driverLabel ? driverLabel : kind;

    if (signal.divergent) {
      findings.push({
        type: CONFLICT_TYPE.TRAVEL_ETA_DIVERGENCE,
        severity: CONFLICT_SEVERITY.WARNING,
        message: `The travel estimate supplied for ${label} (${signal.claimedEtaMinutes} min) differs from the route the system computed (${signal.etaMinutes} min). The computed value is the one the buffer rule uses.`,
        detail: {
          [idKey]: id,
          claimed_eta_min: signal.claimedEtaMinutes,
          derived_eta_min: signal.etaMinutes,
          eta_source: signal.etaSource,
        },
      });
    }
  }
  return findings;
}
