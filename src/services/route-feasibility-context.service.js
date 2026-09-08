// I/O boundary for three-leg route feasibility (PR #1).
//
// This module gathers the outside-world inputs — TomTom live routes (via the
// short-TTL cache), canonical snapshots, haversine fallbacks, driver position,
// and the next ASSIGNED dispatch — and shapes the plain object that the pure
// engine in src/lib/scheduling/route-feasibility.js consumes.
//
// Semantics (locked):
// - "Next booking" = the next already-assigned dispatch (Scheduled /
//   In Progress) touching this vehicle or driver. A pending queue request is
//   NEVER a next booking; scarcity/lookahead reasoning belongs to Phase 2.
// - Passenger leg priority: canonical verified snapshot → live TomTom only
//   when freshness is required → legacy fallback. Driver→pickup is the leg
//   where live routing matters most (the position moves).
// - Two-stage costing: only a shortlist (default 5, nearest by Haversine)
//   ever gets a live routed ETA — never the whole roster. A routing matrix is
//   the documented future evolution, not a PR #1 dependency.
// - Everything here is fail-open: any missing signal yields null minutes with
//   a provenance tag, and the pure engine turns that into UNKNOWN, never a
//   fabricated block.

import { fetchTomTomRoute } from "@/lib/tomtom";
import { getCachedRoute, setCachedRoute } from "@/lib/routing/route-cache";
import { etaFromDistanceKm, haversineKm } from "@/lib/scheduling/travel-buffer";
import { resolveCoordinates } from "@/lib/geo/distance";
import { resolveRequestEstimate } from "@/services/route-resolver.service";
import { evaluateRouteFeasibility } from "@/lib/scheduling/route-feasibility";
import { DEFAULT_DISPATCH_POLICY } from "@/lib/dispatch-policy";

export const DEADHEAD_SHORTLIST_LIMIT = 5;

function toLatLng(value) {
  if (Array.isArray(value) && value.length === 2) {
    const lat = Number(value[0]);
    const lng = Number(value[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
    return null;
  }
  if (value && typeof value === "object") {
    const lat = Number(value.lat ?? value.latitude);
    const lng = Number(value.lng ?? value.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }
  return null;
}

/**
 * Pure shortlist: nearest drivers by existing Haversine distance, capped.
 * Only these candidates qualify for a live routed deadhead ETA.
 */
export function selectShortlistCandidates(drivers = [], limit = DEADHEAD_SHORTLIST_LIMIT) {
  const n = Math.max(1, Math.floor(Number(limit) || DEADHEAD_SHORTLIST_LIMIT));
  return (Array.isArray(drivers) ? drivers : [])
    .filter((d) => Number.isFinite(Number(d?._pickup_distance_km)))
    .sort((a, b) => Number(a._pickup_distance_km) - Number(b._pickup_distance_km))
    .slice(0, n);
}

/**
 * Resolve driver→pickup minutes: cached live route → live TomTom →
 * haversine fallback. Never throws; returns { minutes, provenance }.
 */
export async function resolveDeadheadMinutes(origin, destination, opts = {}) {
  const o = toLatLng(origin);
  const d = toLatLng(destination);
  if (!o || !d) return { minutes: null, provenance: "unknown" };

  const cacheOpts = { departAt: opts.departAt, maxAlternatives: 0 };
  try {
    const cached = getCachedRoute(o, d, cacheOpts);
    if (cached?.durationMin != null) {
      return { minutes: cached.durationMin, provenance: "cached" };
    }
    const live = await fetchTomTomRoute(o, d, { departAt: opts.departAt, maxAlternatives: 0 });
    if (live?.durationMin != null) {
      setCachedRoute(o, d, live, cacheOpts);
      return { minutes: live.durationMin, provenance: "live", trafficDelayMin: live.trafficDelayMin ?? 0 };
    }
  } catch {
    // fall through to the heuristic below
  }
  const km = haversineKm(o, d);
  const minutes = etaFromDistanceKm(km);
  return { minutes, provenance: minutes != null ? "fallback" : "unknown" };
}

/**
 * Honest provenance label for a request estimate. A "Stored …" basis means the
 * canonical snapshot won (no live call was made); a bare TomTom basis means
 * the estimate was just fetched live.
 */
export function provenanceOfEstimate(estimate) {
  if (!estimate || estimate.durationMin == null) return "unknown";
  const basis = String(estimate.basis || "");
  if (basis.startsWith("Stored")) return "snapshot";
  if (estimate.source === "TomTom") return "live";
  return "fallback";
}

/**
 * Resolve pickup→destination minutes, preserving the resolver's priority:
 * canonical snapshot first, live TomTom only on demand, legacy fallback last.
 * `resolveRequestEstimate` already implements snapshot → live → legacy, so
 * this is a thin provenance-tagging wrapper around it.
 */
export async function resolvePassengerMinutes(request, db) {
  try {
    const estimate = await resolveRequestEstimate(request, db, { persistRoute: false });
    if (estimate?.durationMin == null) return { minutes: null, provenance: "unknown" };
    return {
      minutes: Math.round(Number(estimate.durationMin)),
      provenance: provenanceOfEstimate(estimate),
      source: estimate.source || null,
    };
  } catch {
    return { minutes: null, provenance: "unknown" };
  }
}

/**
 * Next ASSIGNED dispatch touching this vehicle or driver after `after`.
 * Either resource being committed blocks the pair, so the lookup is OR.
 *
 * pickup/dropoff locations live on transportation_requests (reached via
 * dispatchschedules.request_id), NOT on dispatchschedules — an earlier
 * revision selected them from the dispatch table, which raised "column does
 * not exist" on the live DB and the catch below silently returned null, so
 * the next-booking signal was permanently UNKNOWN in live use. A dispatch
 * without a request (trip created outside the dispatch flow) has null
 * locations → reposition stays honestly unknown rather than guessed.
 */
export async function findNextAssignedDispatch(db, { vehicleId = null, driverId = null, after = null, excludeDispatchId = null } = {}) {
  if (!db || (vehicleId == null && driverId == null)) return null;
  const afterIso = after != null && after !== "" ? new Date(after).toISOString() : null;
  try {
    const { rows } = await db.query(
      `SELECT ds.dispatch_id, ds.vehicle_id, ds.driver_id,
              ds.scheduled_departure, ds.scheduled_arrival,
              tr.pickup_location, tr.dropoff_location
         FROM dispatchschedules ds
         LEFT JOIN transportation_requests tr
           ON tr.request_id = ds.request_id AND tr.deleted_at IS NULL
        WHERE ds.deleted_at IS NULL
          AND ds.status IN ('Scheduled', 'In Progress')
          AND (ds.vehicle_id = $1 OR ds.driver_id = $2)
          AND ($3::timestamptz IS NULL OR ds.scheduled_departure > $3)
          AND ($4::integer IS NULL OR ds.dispatch_id <> $4)
        ORDER BY ds.scheduled_departure ASC
        LIMIT 1`,
      [vehicleId, driverId, afterIso, excludeDispatchId]
    );
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Build the full input object for `evaluateRouteFeasibility`, plus a
 * provenance map for honest UI labels (live / cached / snapshot / fallback).
 */
export async function buildFeasibilityContext(db, {
  request,
  driverPosition = null,
  pickupCoords = null,
  destinationCoords = null,
  vehicleId = null,
  driverId = null,
  now = new Date(),
  policy = DEFAULT_DISPATCH_POLICY,
} = {}) {
  const safetyBufferMinutes = Number(policy?.safetyBufferMinutes)
    || DEFAULT_DISPATCH_POLICY.safetyBufferMinutes;

  const deadhead = await resolveDeadheadMinutes(driverPosition, pickupCoords, {
    departAt: now,
  });
  const passenger = await resolvePassengerMinutes(request, db);

  const next = await findNextAssignedDispatch(db, {
    vehicleId, driverId, after: request?.pickup_datetime,
  });
  let reposition = { minutes: null, provenance: "unknown" };
  if (next) {
    // Next-dispatch rows carry free-text pickup locations, so resolve them
    // through the gazetteer first. Unresolvable text stays honestly unknown
    // rather than guessed.
    const nextCoords = resolveCoordinates(next.pickup_location);
    if (nextCoords) {
      reposition = await resolveDeadheadMinutes(destinationCoords, nextCoords, {
        departAt: request?.pickup_datetime,
      });
    }
  }

  return {
    now,
    pickupAt: request?.pickup_datetime ?? null,
    deadheadMinutes: deadhead.minutes,
    passengerMinutes: passenger.minutes,
    nextPickupAt: next?.scheduled_departure ?? null,
    repositionMinutes: next ? reposition.minutes : null,
    safetyBufferMinutes,
    provenance: {
      deadhead: deadhead.provenance,
      passenger: passenger.provenance,
      reposition: next ? reposition.provenance : "unknown",
    },
    nextDispatchId: next?.dispatch_id ?? null,
  };
}

/** Max pair-level feasibility computations per recommendation payload. */
export const PAIR_FEASIBILITY_LIMIT = 3;
const PAIR_FEASIBILITY_CAP = 5;

const toIsoOrNull = (value) => {
  if (value == null || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/**
 * Build the feasibility verdict for ONE vehicle+driver pair.
 *
 * Deadhead reuses the shortlist's routed minutes when present
 * (`_deadhead_minutes_routed`), otherwise resolves through the cached live
 * route with a haversine fallback — all fail-open. Passenger minutes come
 * from the already-resolved trip estimate (snapshot-first preserved), never
 * a second live call. The next booking is the next ASSIGNED dispatch only.
 *
 * Returns a JSON-safe object (ISO strings, no Dates) or null on unexpected
 * failure — callers render nothing rather than a fabricated verdict.
 */
export async function buildPairFeasibility(db, {
  request,
  passengerMinutes = null,
  passengerProvenance = "unknown",
  driverRow = null,
  pickupCoords = null,
  destinationCoords = null,
  vehicleId = null,
  driverId = null,
  now = new Date(),
  policy = DEFAULT_DISPATCH_POLICY,
} = {}) {
  try {
    const safetyBufferMinutes = Number(policy?.safetyBufferMinutes)
      || DEFAULT_DISPATCH_POLICY.safetyBufferMinutes;

    const position = driverRow?._position_lat != null && driverRow?._position_lng != null
      ? [Number(driverRow._position_lat), Number(driverRow._position_lng)]
      : null;
    // The shortlist's routed minutes were computed seconds ago for this same
    // pickup — prefer them over a re-resolve (which would cache-hit to the
    // same value in prod anyway, and keeps tests deterministic offline).
    let deadhead = Number.isFinite(Number(driverRow?._deadhead_minutes_routed))
      ? {
          minutes: Math.round(Number(driverRow._deadhead_minutes_routed)),
          provenance: driverRow._deadhead_provenance || "unknown",
        }
      : await resolveDeadheadMinutes(position, pickupCoords, { departAt: now });
    if (deadhead.minutes == null) {
      const fallback = etaFromDistanceKm(driverRow?._pickup_distance_km);
      deadhead = { minutes: fallback, provenance: fallback != null ? "fallback" : "unknown" };
    }

    const next = await findNextAssignedDispatch(db, {
      vehicleId, driverId, after: request?.pickup_datetime,
    });
    let reposition = { minutes: null, provenance: "unknown" };
    if (next) {
      const nextCoords = resolveCoordinates(next.pickup_location);
      if (nextCoords) {
        reposition = await resolveDeadheadMinutes(destinationCoords, nextCoords, {
          departAt: request?.pickup_datetime,
        });
      }
    }

    const verdict = evaluateRouteFeasibility({
      now,
      pickupAt: request?.pickup_datetime,
      deadheadMinutes: deadhead.minutes,
      passengerMinutes,
      nextPickupAt: next?.scheduled_departure ?? null,
      repositionMinutes: next ? reposition.minutes : null,
      safetyBufferMinutes,
    });

    return {
      verdict: verdict.verdict,
      reasons: verdict.reasons,
      deadheadMin: deadhead.minutes,
      passengerMin: passengerMinutes,
      repositionMin: next ? reposition.minutes : null,
      requiredDeparture: toIsoOrNull(verdict.requiredDeparture),
      pickupBufferMin: verdict.pickupBufferMin,
      expectedArrival: toIsoOrNull(verdict.expectedArrival),
      turnaroundMin: verdict.turnaroundMin,
      nextPickupAt: toIsoOrNull(next?.scheduled_departure),
      nextDispatchId: next?.dispatch_id ?? null,
      provenance: {
        deadhead: deadhead.provenance,
        passenger: passengerProvenance,
        reposition: next ? reposition.provenance : "unknown",
      },
    };
  } catch {
    return null;
  }
}

/**
 * Attach `feasibility` to the top pairs of a recommendation payload:
 * recommended + alternate + the first `limit` candidates (deduped, capped).
 * Scoring is untouched — this is information for the dispatcher, not a new
 * ranking input (Phase 2). Fail-open per pair; the payload is always returned.
 */
export async function attachPairFeasibility(db, {
  request,
  estimate = null,
  recommendation,
  drivers = [],
  now = new Date(),
  policy = DEFAULT_DISPATCH_POLICY,
  limit = PAIR_FEASIBILITY_LIMIT,
} = {}) {
  if (!recommendation?.pair) return recommendation;
  const pool = [
    recommendation.pair.recommended,
    recommendation.pair.alternate,
    ...(Array.isArray(recommendation.pair.candidates)
      ? recommendation.pair.candidates.slice(0, Math.max(0, Number(limit) || 0))
      : []),
  ].filter(Boolean);

  const seen = new Set();
  const targets = [];
  for (const c of pool) {
    const key = `${c.vehicle_id ?? "?"}:${c.driver_id ?? "?"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(c);
    if (targets.length >= PAIR_FEASIBILITY_CAP) break;
  }
  if (!targets.length) return recommendation;

  const byDriverId = new Map((Array.isArray(drivers) ? drivers : []).map((d) => [d?.driver_id, d]));
  const pickupCoords = resolveCoordinates(request?.pickup_location);
  const destinationCoords = resolveCoordinates(request?.dropoff_location);
  const passengerMinutes = estimate?.durationMin != null ? Math.round(Number(estimate.durationMin)) : null;
  const passengerProvenance = provenanceOfEstimate(estimate);

  // Fan-out: recommended/alternate and the candidates list hold distinct
  // objects for the same pair — every pool member with the key gets the
  // verdict, not just the first reference.
  const keyOf = (c) => `${c?.vehicle_id ?? "?"}:${c?.driver_id ?? "?"}`;
  await Promise.all(targets.map(async (c) => {
    const feasibility = await buildPairFeasibility(db, {
      request,
      passengerMinutes,
      passengerProvenance,
      driverRow: byDriverId.get(c.driver_id) || null,
      pickupCoords,
      destinationCoords,
      vehicleId: c.vehicle_id,
      driverId: c.driver_id,
      now,
      policy,
    });
    for (const member of pool) {
      if (keyOf(member) === keyOf(c)) member.feasibility = feasibility;
    }
  }));
  return recommendation;
}
