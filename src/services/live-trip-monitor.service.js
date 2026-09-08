// I/O boundary for live trip monitoring (PR #4).
//
// Mirrors route-feasibility-context.service.js: this module gathers the
// outside-world inputs (trip row, GPS breadcrumbs from gpstracking, TomTom
// routing through the short-TTL cache, the next ASSIGNED dispatch, open
// incidents) and shapes the plain object the PURE engine in
// src/lib/monitoring/live-trip-monitor.js consumes. Every rule about risk
// lives in the engine; every rule about WHERE a signal comes from lives here.
//
// Two evaluation modes (locked, review correction #4):
//   • FULL  — evaluateLiveTripMonitor(db, { tripId }): the selected trip gets
//     expensive precision — a fresh traffic-aware ETA leg, passenger minutes,
//     next-trip reposition routing, open incidents — under a per-trip snapshot
//     policy so an open drawer does not re-fetch every poll.
//   • CHEAP — summarizeFleet(db, { now }): the fleet overview gets cheap
//     triage from ALREADY-CACHED signals only. No fresh TomTom, no reposition
//     routing. Durable trip_monitor_alerts rows carry the last full
//     evaluation's verdicts into the summary (that is what they are for).
//
// The same split governs the ingest-side evaluation (evaluatePingMonitor):
// the corridor geometry may be fetched at most once per trip per
// MONITOR_CORRIDOR_REFRESH_MS — off-route detection needs a pinned polyline —
// but the delay leg is served from cache only, never a fresh call per ping.
//
// Corridor vs ETA anchoring (why two snapshots, not one): the ETA leg is
// vehicle-anchored (route from wherever the vehicle is → target), so it
// refreshes on movement. The corridor is intent-anchored: it is the polyline
// the vehicle is SUPPOSED to follow, pinned at the position where it was
// computed. Re-anchoring the corridor on every ping would launder any
// deviation into "on route" (a route from the wrong road always contains the
// wrong road), so the corridor refreshes only on phase/target change, on
// expiry while the vehicle is ON route, or never while a deviation is
// confirmed — the DB alert row is the hysteresis anchor across instances.
//
// Fail-open everywhere: a missing signal becomes null with a provenance tag
// and the engine turns it into UNKNOWN, never a fabricated conclusion.

import { LIVE_TRIP_STATUSES, ROLES } from "@/lib/constants";
import { getGpsHealth } from "@/lib/gps";
import { resolveTripPhase } from "@/lib/trip-phase";
import {
  // Aliased so it cannot collide with THIS module's I/O full-mode function
  // of the same name (an import binding + local declaration sharing a name
  // is a hard ESM syntax error — Turbopack rejected the module).
  evaluateLiveTripMonitor as evaluateMonitorEngine,
  fleetSortRank,
  RISK_LEVELS,
  WATCH_DELAY_MIN,
  ATTENTION_DELAY_MIN,
  ACTION_DELAY_MIN,
  TURNAROUND_SAFETY_MIN,
} from "@/lib/monitoring/live-trip-monitor";
import { evaluateOffRoute } from "@/lib/geo/off-route";
import { fetchTomTomRoute } from "@/lib/tomtom";
import { getCachedRoute, setCachedRoute } from "@/lib/routing/route-cache";
import { etaFromDistanceKm, haversineKm } from "@/lib/scheduling/travel-buffer";
import { resolveCoordinates } from "@/lib/geo/distance";
import { cachedTargets } from "@/services/trip-geofence.service";
import {
  findNextAssignedDispatch,
  resolveDeadheadMinutes,
  resolvePassengerMinutes,
} from "@/services/route-feasibility-context.service";
import { resolveNotificationRecipients } from "@/lib/notifications/recipients";
import { sendPush } from "@/services/push.service";

/** Full mode: refresh the ETA leg at most this often per trip. */
export const MONITOR_ETA_TTL_MS = 75 * 1000;
/** Full mode: refresh the ETA leg early when the vehicle moved this far. */
export const MONITOR_ETA_MOVE_M = 300;
/** How long a corridor polyline stays pinned (only while ON route). */
export const MONITOR_CORRIDOR_REFRESH_MS = 10 * 60 * 1000;
/** Cheap/ingest modes: a cached ETA snapshot older than this is not "live". */
export const MONITOR_SNAPSHOT_FRESH_MS = 2 * 60 * 1000;
/** Breadcrumb window read per evaluation (current ping + 2 predecessors). */
export const MONITOR_PING_WINDOW = 3;

/** Rank for severity-jump comparisons. UNKNOWN ranks below WATCH: a previous
 * "can't tell" is not a healthy claim, so UNKNOWN→ACTION still notifies. */
const SEVERITY_RANK = {
  NORMAL: 0,
  UNKNOWN: 1,
  WATCH: 2,
  ATTENTION: 3,
  ACTION: 4,
};

const SIGNAL_KEYS = {
  PICKUP_DELAY: "pickup_delay",
  DESTINATION_DELAY: "destination_delay",
  OFF_ROUTE: "off_route",
  GPS_UNAVAILABLE: "gps_unavailable",
  NEXT_TRIP_RISK: "next_trip_risk",
};

function toIso(value) {
  if (value == null || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function toNumberOrNull(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toLatLngArray(value) {
  const lat = toNumberOrNull(value?.lat ?? value?.[0] ?? value?.latitude);
  const lng = toNumberOrNull(value?.lng ?? value?.[1] ?? value?.longitude);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return [lat, lng];
}

// ─── Per-trip route snapshots (results cache, never correctness state) ──────
// The durable source of truth for cross-request state (off-route hysteresis,
// alert history) is the DB. This Map only avoids re-paying TomTom within a
// window, exactly like route-cache.js / the geofence target cache.
const snapshots = new Map(); // trip_id → { eta?, corridor? }

export function clearMonitorSnapshots() {
  snapshots.clear();
}

function getSnapshot(tripId, kind) {
  return snapshots.get(Number(tripId))?.[kind] || null;
}

function setSnapshot(tripId, kind, value) {
  const key = Number(tripId);
  const entry = snapshots.get(key) || {};
  entry[kind] = value;
  snapshots.set(key, entry);
}

function targetKeyOf(target) {
  const p = toLatLngArray(target);
  return p ? `${p[0].toFixed(4)},${p[1].toFixed(4)}` : null;
}

/**
 * One routed leg through the shared short-TTL cache: cached → live TomTom →
 * haversine fallback. Keeps trafficDelayMin AND geometry, which
 * resolveDeadheadMinutes (minutes only) intentionally drops.
 */
async function resolveLegRoute(origin, destination, { departAt } = {}) {
  const o = toLatLngArray(origin);
  const d = toLatLngArray(destination);
  if (!o || !d) return { minutes: null, trafficDelayMin: null, coordinates: null, provenance: "unknown" };
  const cacheOpts = { departAt, maxAlternatives: 0 };
  try {
    const cached = getCachedRoute(o, d, cacheOpts);
    if (cached?.durationMin != null) {
      return {
        minutes: cached.durationMin,
        trafficDelayMin: cached.trafficDelayMin ?? null,
        coordinates: Array.isArray(cached.coordinates) ? cached.coordinates : null,
        provenance: "cached",
      };
    }
    const live = await fetchTomTomRoute(o, d, { departAt, maxAlternatives: 0 });
    if (live?.durationMin != null) {
      setCachedRoute(o, d, live, cacheOpts);
      return {
        minutes: live.durationMin,
        trafficDelayMin: live.trafficDelayMin ?? null,
        coordinates: Array.isArray(live.coordinates) ? live.coordinates : null,
        provenance: "live",
      };
    }
  } catch {
    // fall through to the heuristic
  }
  const km = haversineKm(o, d);
  const minutes = etaFromDistanceKm(km);
  return { minutes, trafficDelayMin: null, coordinates: null, provenance: minutes != null ? "fallback" : "unknown" };
}

/**
 * Vehicle-anchored ETA leg (position → active target), refreshed on TTL,
 * movement, or phase/target change. Full mode only — cheap/ingest modes read
 * the snapshot without refreshing it.
 */
async function etaSnapshotFor(tripId, { position, target, phase, nowMs }) {
  const targetKey = targetKeyOf(target);
  if (!position || !targetKey) {
    return { minutes: null, trafficDelayMin: null, provenance: "unknown" };
  }
  const snap = getSnapshot(tripId, "eta");
  let refresh = !snap
    || snap.phase !== phase
    || snap.targetKey !== targetKey
    || nowMs - snap.fetchedAt > MONITOR_ETA_TTL_MS;
  if (!refresh && snap.origin) {
    const movedM = (haversineKm(snap.origin, position) || 0) * 1000;
    if (movedM > MONITOR_ETA_MOVE_M) refresh = true;
  }
  if (!refresh) return snap;

  const route = await resolveLegRoute(position, target, { departAt: new Date(nowMs) });
  const next = {
    phase,
    targetKey,
    origin: position,
    fetchedAt: nowMs,
    minutes: route.minutes,
    trafficDelayMin: route.trafficDelayMin,
    provenance: route.provenance,
  };
  setSnapshot(tripId, "eta", next);
  return next;
}

/**
 * Intent-anchored corridor polyline (the route the vehicle should follow),
 * pinned at its computed position. See the module header: refreshing this on
 * movement would re-baseline the deviation away, so it refreshes only on
 * phase/target change or expiry — and NEVER while a deviation is confirmed.
 */
async function corridorSnapshotFor(tripId, { position, target, phase, previousState, nowMs, allowFetch = true }) {
  const targetKey = targetKeyOf(target);
  if (!position || !targetKey) return { points: null };
  const current = getSnapshot(tripId, "corridor");
  let refresh = !current
    || current.phase !== phase
    || current.targetKey !== targetKey;
  if (!refresh && previousState !== "off_route") {
    refresh = nowMs - current.fetchedAt > MONITOR_CORRIDOR_REFRESH_MS;
  }
  if (!refresh) return current;
  if (!allowFetch) return current || { points: null };

  const route = await resolveLegRoute(position, target, { departAt: new Date(nowMs) });
  const next = {
    phase,
    targetKey,
    fetchedAt: nowMs,
    points: Array.isArray(route.coordinates) && route.coordinates.length >= 2
      ? route.coordinates
      : null,
  };
  setSnapshot(tripId, "corridor", next);
  return next;
}

// ─── DB reads ───────────────────────────────────────────────────────────────

/**
 * Live trips (or one trip) with everything the monitor needs: schedule
 * baselines, request locations, vehicle/driver labels, and the breadcrumb
 * window — one row per trip, pings aggregated by LATERAL.
 */
// NOTE: no t.origin/t.destination here — trips has no such columns (migration
// 007 dropped them; see src/lib/api/trips-query.js). The monitor's targets come
// from getTripGeofenceTargets, never from trips directly.
const MONITOR_TRIP_SELECT = `
  t.trip_id, t.trip_status, t.vehicle_id, t.driver_id, t.dispatch_id, t.route_id,
  t.start_time,
  v.plate_number, v.vehicle_name,
  de.first_name AS driver_first_name, de.last_name AS driver_last_name,
  ds.dispatch_number, ds.scheduled_departure, ds.scheduled_arrival,
  tr.request_id, tr.pickup_datetime, tr.pickup_location, tr.dropoff_location,
  gp.pings AS gps_pings
`;

const MONITOR_TRIP_JOINS = `
  FROM trips t
  LEFT JOIN vehicles v   ON t.vehicle_id = v.vehicle_id
  LEFT JOIN employees de ON t.driver_id = de.employee_id
  LEFT JOIN dispatchschedules ds ON t.dispatch_id = ds.dispatch_id
  LEFT JOIN transportation_requests tr
    ON ds.request_id = tr.request_id AND tr.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT json_agg(p ORDER BY p.recorded_at DESC, p.tracking_id DESC) AS pings
      FROM (
        SELECT tracking_id, latitude, longitude, accuracy, recorded_at
          FROM gpstracking
         WHERE trip_id = t.trip_id
         ORDER BY recorded_at DESC NULLS LAST, tracking_id DESC
         LIMIT ${MONITOR_PING_WINDOW}
      ) p
  ) gp ON TRUE
`;

async function loadMonitorTrips(db, { tripId = null, liveOnly = false } = {}) {
  const conditions = ["t.deleted_at IS NULL"];
  const params = [];
  if (tripId != null) {
    params.push(tripId);
    conditions.push(`t.trip_id = $${params.length}`);
  }
  if (liveOnly) {
    params.push(LIVE_TRIP_STATUSES);
    conditions.push(`t.trip_status = ANY($${params.length})`);
  }
  const { rows } = await db.query(
    `SELECT ${MONITOR_TRIP_SELECT}
       ${MONITOR_TRIP_JOINS}
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.start_time DESC NULLS LAST, t.trip_id DESC`,
    params
  );
  return rows || [];
}

/** Normalize a gpstracking breadcrumb row for the off-route engine. */
function pingToObservation(ping, nowMs) {
  if (!ping) return null;
  const lat = toNumberOrNull(ping.latitude);
  const lng = toNumberOrNull(ping.longitude);
  if (lat == null || lng == null) return null;
  return {
    latitude: lat,
    longitude: lng,
    accuracyM: toNumberOrNull(ping.accuracy),
    recordedAtMs: toIso(ping.recorded_at) != null ? new Date(ping.recorded_at).getTime() : null,
    fresh: true, // the off-route engine re-validates age (≤5 min) itself
    _nowMs: nowMs,
  };
}

async function readActiveAlerts(db, tripIds) {
  if (!tripIds?.length) return new Map();
  const { rows } = await db.query(
    `SELECT trip_id, signal_key, severity, first_detected_at, last_detected_at, metadata
       FROM trip_monitor_alerts
      WHERE active AND trip_id = ANY($1)`,
    [tripIds]
  );
  const byTrip = new Map();
  for (const row of rows || []) {
    const list = byTrip.get(row.trip_id) || [];
    list.push(row);
    byTrip.set(row.trip_id, list);
  }
  return byTrip;
}

async function readOpenIncidents(db, tripIds) {
  if (!tripIds?.length) return new Map();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (trip_id) trip_id, incident_id, severity, incident_type
       FROM driverincidents
      WHERE deleted_at IS NULL
        AND status = 'Open'
        AND trip_id = ANY($1)
      ORDER BY trip_id,
               (severity = 'Critical') DESC,
               (severity = 'Major') DESC,
               incident_id DESC`,
    [tripIds]
  );
  const byTrip = new Map();
  for (const row of rows || []) {
    byTrip.set(row.trip_id, {
      severity: row.severity,
      incident_type: row.incident_type,
      incident_id: row.incident_id,
    });
  }
  return byTrip;
}

// ─── Shared evaluation (both modes) ─────────────────────────────────────────

/**
 * Evaluate one loaded trip row through the pure engine.
 *
 * mode "full": fresh ETA leg (snapshot policy), passenger minutes, next
 * ASSIGNED dispatch + reposition, open incident — one trip gets precision.
 * mode "cheap": cached signals only — no fresh TomTom anywhere; off-route
 * from the pinned corridor + latest ping + durable previous state; next-trip
 * impact carried by the active alert rows, not recomputed.
 */
async function evaluateTripRow(db, trip, {
  mode = "full",
  now = new Date(),
  alertsByTrip = null,
  incidentsByTrip = null,
} = {}) {
  const nowMs = new Date(now).getTime();
  const full = mode === "full";
  const { phase } = resolveTripPhase(trip.trip_status);

  const pings = Array.isArray(trip.gps_pings) ? trip.gps_pings : [];
  const latest = pings[0] || null;
  const gpsHealth = latest ? getGpsHealth(latest.recorded_at, now).key : "no-signal";
  const position = latest
    ? (() => {
      const lat = toNumberOrNull(latest.latitude);
      const lng = toNumberOrNull(latest.longitude);
      return lat != null && lng != null ? [lat, lng] : null;
    })()
    : null;

  const targets = await cachedTargets(db, trip);
  const target = phase === "to_pickup" ? targets.pickup
    : phase === "to_destination" ? targets.destination
    : null;

  // ── ETA leg ──
  let eta = { minutes: null, trafficDelayMin: null, provenance: "unknown" };
  if (position && target) {
    if (full) {
      eta = await etaSnapshotFor(trip.trip_id, { position, target, phase, nowMs });
    } else {
      const snap = getSnapshot(trip.trip_id, "eta");
      if (snap && nowMs - snap.fetchedAt <= MONITOR_SNAPSHOT_FRESH_MS
        && snap.phase === phase && snap.targetKey === targetKeyOf(target)) {
        eta = snap;
      }
    }
  }

  // ── Off-route ──
  const tripAlerts = alertsByTrip?.get(trip.trip_id) || [];
  const activeOffRoute = tripAlerts.some((a) => a.signal_key === SIGNAL_KEYS.OFF_ROUTE);
  let offRouteEval = { state: "unknown", distanceM: null, offStreak: 0, onStreak: 0 };
  if (position && target && phase) {
    // Full and ping modes may fetch a (rate-bounded) corridor; the cheap pass
    // only ever reads the pinned one.
    const corridor = await corridorSnapshotFor(trip.trip_id, {
      position, target, phase,
      previousState: activeOffRoute ? "off_route" : null,
      nowMs,
      allowFetch: full || mode === "ping",
    });
    if (corridor?.points) {
      offRouteEval = evaluateOffRoute({
        position: { lat: position[0], lng: position[1] },
        accuracyM: toNumberOrNull(latest?.accuracy),
        gpsFresh: gpsHealth === "fresh" || gpsHealth === "delayed",
        routePoints: corridor.points,
        recentPings: pings.slice(1)
          .map((p) => pingToObservation(p, nowMs))
          .filter(Boolean),
        previousState: activeOffRoute ? "off_route" : null,
        now,
      });
    }
  }

  // ── Schedule baselines (truthful only — never invented) ──
  const scheduledPickupAt = toIso(trip.pickup_datetime);
  const scheduledArrivalAt = toIso(trip.scheduled_arrival);

  // ── Passenger leg (full only — resolveRequestEstimate may hit TomTom) ──
  let plannedPassengerMinutes = null;
  let passengerProvenance = "unknown";
  if (full && trip.pickup_location) {
    const passenger = await resolvePassengerMinutes({
      pickup_location: trip.pickup_location,
      dropoff_location: trip.dropoff_location,
      request_id: trip.request_id ?? null,
    }, db);
    plannedPassengerMinutes = passenger.minutes;
    passengerProvenance = passenger.provenance;
  }

  // ── Next ASSIGNED dispatch (full only — reposition routing is TomTom) ──
  let nextDispatch = null;
  let repositionMinutes = null;
  let repositionProvenance = "unknown";
  if (full && (trip.vehicle_id != null || trip.driver_id != null)) {
    const next = await findNextAssignedDispatch(db, {
      vehicleId: trip.vehicle_id,
      driverId: trip.driver_id,
      after: now,
      excludeDispatchId: trip.dispatch_id ?? null,
    });
    if (next) {
      nextDispatch = {
        dispatchId: next.dispatch_id,
        pickupAt: toIso(next.scheduled_departure),
        pickupLocation: next.pickup_location ?? null,
      };
      const nextCoords = next.pickup_location ? resolveCoordinates(next.pickup_location) : null;
      const destCoords = targets.destination
        ? [targets.destination.lat, targets.destination.lng]
        : null;
      if (nextCoords && destCoords) {
        const reposition = await resolveDeadheadMinutes(destCoords, nextCoords, {
          departAt: next.scheduled_departure,
        });
        repositionMinutes = reposition.minutes;
        repositionProvenance = reposition.provenance;
      }
    }
  }

  // ── Open incident ──
  const openIncident = incidentsByTrip?.get(trip.trip_id) || null;

  const evaluation = evaluateMonitorEngine({
    now,
    tripPhase: phase,
    gpsHealth,
    gpsAccuracyM: toNumberOrNull(latest?.accuracy),
    scheduledPickupAt,
    scheduledArrivalAt,
    liveTargetMinutes: eta.minutes,
    trafficDelayMinutes: eta.trafficDelayMin,
    plannedPassengerMinutes,
    offRouteState: offRouteEval.state,
    offRouteDistanceM: offRouteEval.distanceM,
    nextAssignedPickupAt: nextDispatch?.pickupAt ?? null,
    repositionMinutes,
    openIncident,
  });

  return {
    ...evaluation,
    phase,
    tripStatus: trip.trip_status,
    scheduledPickupAt,
    scheduledArrivalAt,
    position: position
      ? {
        lat: position[0],
        lng: position[1],
        accuracyM: toNumberOrNull(latest?.accuracy),
        recordedAt: toIso(latest?.recorded_at),
      }
      : null,
    target: target
      ? { label: target.label ?? null, lat: target.lat, lng: target.lng, source: target.source ?? null }
      : null,
    nextDispatch,
    provenance: {
      eta: eta.provenance,
      passenger: passengerProvenance,
      reposition: nextDispatch ? repositionProvenance : "unknown",
    },
  };
}

// ─── Alert persistence ──────────────────────────────────────────────────────

/** Signal-level severity for a known delay in minutes. */
function delaySeverityFor(delayMin) {
  if (delayMin == null) return null;
  if (delayMin >= ACTION_DELAY_MIN) return RISK_LEVELS.ACTION;
  if (delayMin >= ATTENTION_DELAY_MIN) return RISK_LEVELS.ATTENTION;
  if (delayMin >= WATCH_DELAY_MIN) return RISK_LEVELS.WATCH;
  return null; // known-good: below every threshold
}

function tripLabel(trip) {
  return trip?.plate_number
    || (trip?.driver_first_name ? `${trip.driver_first_name} ${trip.driver_last_name || ""}`.trim() : null)
    || `Trip #${trip?.trip_id ?? "?"}`;
}

/**
 * Derive the signal-level alert intents from one evaluation.
 * severity null = "resolve this signal"; omitted key = "no claim either way"
 * (an unknown signal never resolves an active alert — hysteresis).
 */
function signalsFromEvaluation(evaluation, trip) {
  const signals = [];
  const label = tripLabel(trip);

  const delayKey = evaluation.activeTarget === "destination"
    ? SIGNAL_KEYS.DESTINATION_DELAY
    : SIGNAL_KEYS.PICKUP_DELAY;
  if (evaluation.targetDelayMin != null) {
    const severity = delaySeverityFor(evaluation.targetDelayMin);
    if (severity) {
      const what = evaluation.activeTarget === "destination" ? "scheduled arrival" : "scheduled pickup";
      signals.push({
        key: delayKey,
        severity,
        message: `${label} is running about ${Math.round(evaluation.targetDelayMin)} min behind the ${what}.`,
        metadata: { delayMin: evaluation.targetDelayMin, liveEta: evaluation.liveEta },
      });
    } else {
      signals.push({ key: delayKey, severity: null });
    }
  }

  if (evaluation.offRoute.state === "off_route") {
    signals.push({
      key: SIGNAL_KEYS.OFF_ROUTE,
      severity: RISK_LEVELS.ATTENTION,
      message: evaluation.offRoute.distanceM != null
        ? `${label} is about ${evaluation.offRoute.distanceM} m off the expected route.`
        : `${label} is off the expected route.`,
      metadata: { distanceM: evaluation.offRoute.distanceM },
    });
  } else if (evaluation.offRoute.state === "on_route") {
    signals.push({ key: SIGNAL_KEYS.OFF_ROUTE, severity: null });
  }

  const gps = evaluation.gps.health;
  if (gps === "stale" || gps === "no-signal") {
    signals.push({
      key: SIGNAL_KEYS.GPS_UNAVAILABLE,
      severity: RISK_LEVELS.ATTENTION,
      message: `GPS signal for ${label} is ${gps === "stale" ? "offline" : "absent"} — no live tracking.`,
      metadata: { health: gps },
    });
  } else if (gps === "delayed") {
    signals.push({
      key: SIGNAL_KEYS.GPS_UNAVAILABLE,
      severity: RISK_LEVELS.WATCH,
      message: `GPS updates for ${label} are delayed.`,
      metadata: { health: gps },
    });
  } else if (gps === "fresh") {
    signals.push({ key: SIGNAL_KEYS.GPS_UNAVAILABLE, severity: null });
  }

  if (evaluation.nextTrip.slackMin != null) {
    if (evaluation.nextTrip.slackMin < 0) {
      signals.push({
        key: SIGNAL_KEYS.NEXT_TRIP_RISK,
        severity: RISK_LEVELS.ACTION,
        message: `${label} is projected to MISS the next assigned pickup (about ${Math.abs(evaluation.nextTrip.slackMin)} min late).`,
        metadata: { slackMin: evaluation.nextTrip.slackMin, nextPickupAt: evaluation.nextTrip.nextPickupAt },
      });
    } else if (evaluation.nextTrip.atRisk) {
      signals.push({
        key: SIGNAL_KEYS.NEXT_TRIP_RISK,
        severity: RISK_LEVELS.WATCH,
        message: `${label} has only ${evaluation.nextTrip.slackMin} min of turnaround slack before the next assigned pickup.`,
        metadata: { slackMin: evaluation.nextTrip.slackMin, nextPickupAt: evaluation.nextTrip.nextPickupAt },
      });
    } else {
      signals.push({ key: SIGNAL_KEYS.NEXT_TRIP_RISK, severity: null });
    }
  }

  return signals;
}

/**
 * Apply one signal intent to its durable row. Returns a change record only
 * when something actually happened (appear / severity change / resolve) —
 * same-severity repeats are a last_detected_at touch, never a notification.
 */
async function applyMonitorSignal(db, { tripId, signal, nowIso }) {
  const { rows } = await db.query(
    `SELECT alert_id, severity, active
       FROM trip_monitor_alerts
      WHERE trip_id = $1 AND signal_key = $2
      LIMIT 1`,
    [tripId, signal.key]
  );
  const existing = rows?.[0] || null;
  const metadata = signal.metadata ?? null;

  // Resolve: only when there IS an active alert to resolve.
  if (signal.severity == null) {
    if (!existing?.active) return null;
    await db.query(
      `UPDATE trip_monitor_alerts
          SET active = false, resolved_at = $2, updated_at = $2
        WHERE alert_id = $1`,
      [existing.alert_id, nowIso]
    );
    return { key: signal.key, from: existing.severity, to: null, resolved: true, message: null };
  }

  if (!existing) {
    await db.query(
      `INSERT INTO trip_monitor_alerts
         (trip_id, signal_key, severity, active, first_detected_at, last_detected_at, metadata)
       VALUES ($1, $2, $3, true, $4, $4, $5)`,
      [tripId, signal.key, signal.severity, nowIso, metadata]
    );
    return { key: signal.key, from: null, to: signal.severity, resolved: false, message: signal.message };
  }

  if (!existing.active) {
    // Resurrect the resolved row (unique trip_id+signal_key) as a new episode.
    await db.query(
      `UPDATE trip_monitor_alerts
          SET active = true, severity = $2, first_detected_at = $3,
              last_detected_at = $3, resolved_at = NULL,
              last_notified_at = NULL, metadata = $4, updated_at = $3
        WHERE alert_id = $1`,
      [existing.alert_id, signal.severity, nowIso, metadata]
    );
    return { key: signal.key, from: null, to: signal.severity, resolved: false, message: signal.message };
  }

  if (existing.severity !== signal.severity) {
    await db.query(
      `UPDATE trip_monitor_alerts
          SET severity = $2, last_detected_at = $3, metadata = $4, updated_at = $3
        WHERE alert_id = $1`,
      [existing.alert_id, signal.severity, nowIso, metadata]
    );
    return { key: signal.key, from: existing.severity, to: signal.severity, resolved: false, message: signal.message };
  }

  // Same severity: touch recency only — this is the dedupe contract.
  await db.query(
    `UPDATE trip_monitor_alerts
        SET last_detected_at = $2, updated_at = $2
      WHERE alert_id = $1`,
    [existing.alert_id, nowIso]
  );
  return null;
}

/**
 * ★ Review correction #3 — threshold-entry notifications, not adjacent-step.
 * A jump straight to ACTION from NORMAL/WATCH/UNKNOWN (or ATTENTION) fires
 * exactly once: entering ACTION notifies dispatcher + fleet_manager (push-tier
 * Alert); entering ATTENTION (and not ACTION) notifies the dispatcher. The
 * stronger entry wins when both conditions hold on one change.
 */
function notificationFor(change) {
  if (!change || change.resolved || change.to == null) return null;
  const toRank = SEVERITY_RANK[change.to] ?? -1;
  const fromRank = change.from != null ? (SEVERITY_RANK[change.from] ?? 0) : -1;
  if (toRank >= SEVERITY_RANK.ACTION && fromRank < SEVERITY_RANK.ACTION) {
    return {
      type: "Alert",
      roles: [ROLES.DISPATCHER, ROLES.FLEET_MANAGER],
      push: true,
    };
  }
  if (toRank >= SEVERITY_RANK.ATTENTION && fromRank < SEVERITY_RANK.ATTENTION) {
    return { type: "Warning", roles: [ROLES.DISPATCHER], push: false };
  }
  return null;
}

async function dispatchAlertNotifications(db, { tripId, changes }) {
  const notifications = [];
  for (const change of changes) {
    const spec = notificationFor(change);
    if (!spec || !change.message) continue;
    try {
      const recipients = await resolveNotificationRecipients({ roles: spec.roles });
      if (!recipients.length) continue;
      const title = `Live Operations — ${change.key.replace(/_/g, " ")}`;
      for (const employeeId of recipients) {
        await db.query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, 'trip', $5)`,
          [employeeId, title, change.message, spec.type, tripId]
        );
      }
      if (spec.push) {
        try {
          await sendPush({
            employeeIds: recipients,
            title,
            body: change.message,
            data: { reference_type: "trip", reference_id: tripId },
          });
        } catch (e) {
          console.warn("monitor alert push failed:", e?.message || e);
        }
      }
      notifications.push({ key: change.key, to: change.to, type: spec.type, recipients: recipients.length });
    } catch (e) {
      console.warn("monitor alert notification failed:", e?.message || e);
    }
  }
  return notifications;
}

/**
 * Persist alert transitions for one evaluation: appear / severity-change /
 * resolve only — never per-ping spam. Unknown signals are omitted entirely so
 * they never resolve an active alert (hysteresis across instances).
 */
export async function syncMonitorAlerts(db, { tripId, evaluation, trip = null, now = new Date() }) {
  if (!db || tripId == null || !evaluation) return { changes: [], notifications: [] };
  const nowIso = new Date(now).toISOString();
  const signals = signalsFromEvaluation(evaluation, trip);
  const changes = [];
  for (const signal of signals) {
    try {
      const change = await applyMonitorSignal(db, { tripId, signal, nowIso });
      if (change) changes.push(change);
    } catch (e) {
      console.warn("monitor signal sync failed:", signal.key, e?.message || e);
    }
  }
  const notifications = changes.length
    ? await dispatchAlertNotifications(db, { tripId, changes })
    : [];
  return { changes, notifications };
}

/**
 * ★ Review correction #5 — lifecycle-owned resolution. Called inside
 * completeTrip/cancelTrip transactions: a trip leaving the live lifecycle
 * resolves ALL its active monitor alerts, whether or not anyone ever opens
 * Live Operations again.
 */
export async function resolveMonitorAlerts(db, tripId, reason = "trip_lifecycle", now = new Date()) {
  if (!db || tripId == null) return 0;
  const nowIso = new Date(now).toISOString();
  const { rows } = await db.query(
    `UPDATE trip_monitor_alerts
        SET active = false, resolved_at = $2, updated_at = $2,
            metadata = COALESCE(metadata, '{}'::jsonb)
                     || jsonb_build_object('resolution', $3::text)
      WHERE trip_id = $1 AND active
      RETURNING alert_id`,
    [tripId, nowIso, reason]
  );
  return rows?.length || 0;
}

/**
 * Defensive backstop for the fleet endpoint ONLY (the lifecycle transitions
 * are the authoritative resolver): resolve alerts for trips that are no longer
 * in a live status.
 */
export async function sweepStaleMonitorAlerts(db, now = new Date()) {
  if (!db) return 0;
  const nowIso = new Date(now).toISOString();
  const { rows } = await db.query(
    `UPDATE trip_monitor_alerts a
        SET active = false, resolved_at = $2, updated_at = $2,
            metadata = COALESCE(a.metadata, '{}'::jsonb)
                     || jsonb_build_object('resolution', 'stale_sweep'::text)
      WHERE a.active
        AND NOT EXISTS (
          SELECT 1
            FROM trips t
           WHERE t.trip_id = a.trip_id
             AND t.trip_status = ANY($1)
             AND t.deleted_at IS NULL
        )
      RETURNING a.alert_id`,
    [LIVE_TRIP_STATUSES, nowIso]
  );
  return rows?.length || 0;
}

// ─── Public evaluation entry points ─────────────────────────────────────────

/**
 * FULL evaluation for the selected trip (detail drawer / driver's own trip).
 * Fresh routing under the snapshot policy, next-trip impact, open incidents;
 * persists alert transitions. Returns null when the trip does not exist.
 */
export async function evaluateLiveTripMonitor(db, { tripId, now = new Date(), persist = true } = {}) {
  if (!db || tripId == null) return null;
  const rows = await loadMonitorTrips(db, { tripId });
  const trip = rows[0] || null;
  if (!trip) return null;
  if (!resolveTripPhase(trip.trip_status).phase) {
    return { tripId: trip.trip_id, live: false, tripStatus: trip.trip_status };
  }
  // The durable alert rows are the off-route hysteresis anchor — the FULL
  // evaluation needs them too (a cold instance must not forget a confirmed
  // deviation just because nobody looked recently).
  const [alertsByTrip, incidentsByTrip] = await Promise.all([
    readActiveAlerts(db, [trip.trip_id]).catch(() => new Map()),
    readOpenIncidents(db, [trip.trip_id]).catch(() => new Map()),
  ]);
  const evaluation = await evaluateTripRow(db, trip, { mode: "full", now, alertsByTrip, incidentsByTrip });
  let alerts = { changes: [], notifications: [] };
  if (persist) {
    alerts = await syncMonitorAlerts(db, {
      tripId: trip.trip_id,
      evaluation,
      trip,
      now,
    });
  }
  return {
    tripId: trip.trip_id,
    live: true,
    vehicle: {
      plateNumber: trip.plate_number ?? null,
      vehicleName: trip.vehicle_name ?? null,
    },
    driver: trip.driver_first_name
      ? `${trip.driver_first_name} ${trip.driver_last_name || ""}`.trim()
      : null,
    dispatchNumber: trip.dispatch_number ?? null,
    ...evaluation,
    alerts,
  };
}

/**
 * CHEAP triage for the fleet overview: one summary per live trip from cached
 * signals only — no fresh TomTom, no reposition routing. Durable alert rows
 * carry prior full-evaluation verdicts (next-trip risk especially) into the
 * summary; worst active alert severity elevates the row's risk so a confirmed
 * problem never reads as NORMAL just because the cheap pass can't recompute
 * it. Sorted worst-first.
 */
export async function summarizeFleet(db, { now = new Date(), sweep = true } = {}) {
  if (!db) return { trips: [] };
  if (sweep) {
    try { await sweepStaleMonitorAlerts(db, now); } catch { /* backstop only */ }
  }
  const trips = await loadMonitorTrips(db, { liveOnly: true });
  if (!trips.length) return { trips: [] };
  const tripIds = trips.map((t) => t.trip_id);
  const [alertsByTrip, incidentsByTrip] = await Promise.all([
    readActiveAlerts(db, tripIds).catch(() => new Map()),
    readOpenIncidents(db, tripIds).catch(() => new Map()),
  ]);

  const summaries = [];
  for (const trip of trips) {
    const evaluation = await evaluateTripRow(db, trip, {
      mode: "cheap",
      now,
      alertsByTrip,
      incidentsByTrip,
    });

    // Durable elevation: the worst ACTIVE alert severity (written by the last
    // full/ingest evaluation) must not be lost by a cheap pass that cannot
    // recompute the underlying signal.
    const tripAlerts = alertsByTrip.get(trip.trip_id) || [];
    let elevated = null;
    for (const alert of tripAlerts) {
      if ((SEVERITY_RANK[alert.severity] ?? 0) > (SEVERITY_RANK[elevated] ?? -1)) {
        elevated = alert.severity;
      }
    }
    if (elevated && (SEVERITY_RANK[elevated] ?? -1) > (SEVERITY_RANK[evaluation.risk] ?? -1)) {
      evaluation.reasons.push(`Active alert from the last full evaluation: ${elevated}.`);
      evaluation.risk = elevated;
    }

    summaries.push({
      tripId: trip.trip_id,
      vehicle: {
        plateNumber: trip.plate_number ?? null,
        vehicleName: trip.vehicle_name ?? null,
      },
      driver: trip.driver_first_name
        ? `${trip.driver_first_name} ${trip.driver_last_name || ""}`.trim()
        : null,
      dispatchNumber: trip.dispatch_number ?? null,
      activeAlerts: tripAlerts.map((a) => ({
        key: a.signal_key,
        severity: a.severity,
        firstDetectedAt: toIso(a.first_detected_at),
        lastDetectedAt: toIso(a.last_detected_at),
      })),
      ...evaluation,
    });
  }

  summaries.sort((a, b) => {
    const rankDiff = fleetSortRank(a.risk) - fleetSortRank(b.risk);
    if (rankDiff !== 0) return rankDiff;
    const aPickup = new Date(a.scheduledPickupAt || 0).getTime() || Infinity;
    const bPickup = new Date(b.scheduledPickupAt || 0).getTime() || Infinity;
    if (aPickup !== bPickup) return aPickup - bPickup;
    return (b.targetDelayMin ?? -Infinity) - (a.targetDelayMin ?? -Infinity);
  });

  return { trips: summaries };
}

/**
 * INGEST-side lightweight evaluation, called by the GPS POST routes after a
 * ping is stored. Gives the driver's mobile app its contextual banner payload
 * and keeps off-route / GPS alerts advancing between dispatcher views:
 *   - corridor geometry MAY be fetched (bounded: once per trip per
 *     MONITOR_CORRIDOR_REFRESH_MS) — off-route detection is core to ingest;
 *   - the delay leg is served from the snapshot cache only, never a fresh
 *     TomTom call per ping.
 */
export async function evaluatePingMonitor(db, { tripId, now = new Date() } = {}) {
  if (!db || tripId == null) return null;
  const rows = await loadMonitorTrips(db, { tripId });
  const trip = rows[0] || null;
  if (!trip) return null;
  if (!resolveTripPhase(trip.trip_status).phase) {
    return { tripId, live: false };
  }
  const alertsByTrip = await readActiveAlerts(db, [trip.trip_id]).catch(() => new Map());
  const evaluation = await evaluateTripRow(db, trip, {
    mode: "ping",
    now,
    alertsByTrip,
    incidentsByTrip: new Map(),
  });
  await syncMonitorAlerts(db, { tripId: trip.trip_id, evaluation, trip, now });
  // Compact, banner-sized payload — the driver surface is minimal by design.
  return {
    tripId,
    live: true,
    risk: evaluation.risk,
    gpsHealth: evaluation.gps.health,
    trafficDelayMin: evaluation.trafficDelayMin,
    offRoute: evaluation.offRoute,
    reasons: evaluation.reasons,
  };
}
