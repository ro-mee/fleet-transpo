// Off-route detection — PURE evaluation, no DB, no network.
//
// Answers "how far is this position from the expected route, and is the
// vehicle confirmed off-route?" for a GPS fix measured against the active
// leg's polyline. Mirrors the geofence philosophy: this DESCRIBES a
// deviation; it never transitions trip status, and the driver is never
// auto-corrected.
//
// Confirmation requires evidence, not a single bad fix:
//   - a VALID observation needs accuracy ≤ OFF_ROUTE_ACCURACY_LIMIT_M and a
//     fresh fix (a poor fix is stored telemetry, never a deviation claim);
//   - off-route is confirmed only after OFF_ROUTE_CONFIRM_M exceeded for
//     OFF_ROUTE_CONFIRM_PINGS consecutive valid observations;
//   - once confirmed, it resolves only after the vehicle is back within
//     OFF_ROUTE_RESUME_M for OFF_ROUTE_CONFIRM_PINGS consecutive valid
//     observations (hysteresis — a brief re-entry must not flicker the
//     alert away while the vehicle is still lost).
//
// Serverless-safe by construction: the caller passes `recentPings` — the new
// ping plus the previous 1–2 stored pings read from gpstracking — so
// "consecutive" is judged over the database breadcrumbs, never process
// memory. A cold instance that only sees ping #2 still knows about ping #1
// because it is in the table. Stored pings are re-validated here against the
// same accuracy/freshness rules; an invalid stored ping breaks the streak.
//
// No route geometry → unknown, never guessed.

/** Fixes worse than this cannot support a deviation claim (mirrors geofence). */
export const OFF_ROUTE_ACCURACY_LIMIT_M = 150;
/** Distance from the route polyline beyond which a valid observation counts as off. */
export const OFF_ROUTE_CONFIRM_M = 250;
/** Back within this distance (for the same consecutive count) resolves. */
export const OFF_ROUTE_RESUME_M = 150;
/** Consecutive valid observations required in either direction. */
export const OFF_ROUTE_CONFIRM_PINGS = 2;

function toPoint(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Perpendicular distance (metres) from a point to a polyline.
 *
 * Point-to-SEGMENT via a local equirectangular projection (metres per degree
 * scaled by cos(lat)) — accurate at city scale and far cheaper than haversine
 * per segment; naive point-to-vertex distance would over-report on long
 * straight segments (a mid-highway vehicle would look kilometres off-route).
 *
 * @param {{lat:number,lng:number}} position
 * @param {Array<[number,number]>} points  [[lat, lng], ...] route polyline
 * @returns {number|null} metres, rounded; null when inputs are unusable
 */
export function distanceToPolylineM(position, points) {
  const p = toPoint(position);
  if (!p || !Array.isArray(points) || points.length < 2) return null;

  const latRad = (p.lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);

  const px = p.lng * mPerDegLng;
  const py = p.lat * mPerDegLat;

  let min = null;
  let usableSegments = 0;
  for (let i = 1; i < points.length; i++) {
    const aLat = Number(points[i - 1][0]);
    const aLng = Number(points[i - 1][1]);
    const bLat = Number(points[i][0]);
    const bLng = Number(points[i][1]);
    if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) continue;
    if ((aLat === 0 && aLng === 0) || (bLat === 0 && bLng === 0)) continue;

    const ax = aLng * mPerDegLng;
    const ay = aLat * mPerDegLat;
    const bx = bLng * mPerDegLng;
    const by = bLat * mPerDegLat;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (min == null || dist < min) min = dist;
    usableSegments++;
  }
  if (min == null || !usableSegments) return null;
  return Math.round(min);
}

/**
 * Whether one ping is a VALID observation for deviation math: finite
 * coordinates, reported accuracy within the limit (null accuracy proceeds —
 * no evidence of a bad fix), fresh GPS.
 */
function validObservation(ping, now) {
  const pos = toPoint(ping);
  if (!pos) return false;
  if (ping.accuracyM != null) {
    const acc = Number(ping.accuracyM);
    if (Number.isFinite(acc) && acc > OFF_ROUTE_ACCURACY_LIMIT_M) return false;
  }
  if (ping.fresh === false) return false;
  if (ping.recordedAtMs != null) {
    const age = new Date(now).getTime() - Number(ping.recordedAtMs);
    if (Number.isFinite(age) && age > 5 * 60 * 1000) return false;
  }
  return true;
}

/**
 * Evaluate off-route state from the recent ping window.
 *
 * Hysteresis across evaluations: `previousState` is the last CONFIRMED state
 * (the caller reads it from the durable trip_monitor_alerts row — not process
 * memory). Once confirmed off-route, the state stays off-route until
 * OFF_ROUTE_CONFIRM_PINGS consecutive valid fixes are back within
 * OFF_ROUTE_RESUME_M; a single re-entry ping must not flicker the alert away.
 *
 * @param {object} p
 * @param {{lat:number,lng:number}} p.position     the newest fix
 * @param {number|null} [p.accuracyM]              its reported accuracy (metres)
 * @param {boolean} [p.gpsFresh]                   whether the fix is fresh (≤ GPS_FRESH_MS)
 * @param {Array<[number,number]>|null} [p.routePoints] active-leg polyline, or null
 * @param {Array<{latitude:number,longitude:number,accuracyM?:number,recordedAtMs?:number,fresh?:boolean}>} [p.recentPings]
 *   newest-first pings INCLUDING the current one (DB breadcrumbs); each is
 *   re-validated here — invalid or stale rows never count toward a streak.
 * @param {"on_route"|"off_route"|"unknown"|null} [p.previousState]
 * @param {Date|string|number} [p.now]
 * @returns {{ state: "on_route"|"off_route"|"unknown", distanceM: number|null, offStreak: number, onStreak: number, reason: string }}
 *   `offStreak`/`onStreak` count consecutive valid observations beyond /
 *   within their thresholds, newest-first.
 */
export function evaluateOffRoute({
  position,
  accuracyM = null,
  gpsFresh = true,
  routePoints = null,
  recentPings = [],
  previousState = null,
  now = Date.now(),
} = {}) {
  const pos = toPoint(position);
  if (!pos) {
    return { state: "unknown", distanceM: null, offStreak: 0, onStreak: 0, reason: "Position is missing or invalid." };
  }
  if (!Array.isArray(routePoints) || routePoints.length < 2) {
    return { state: "unknown", distanceM: null, offStreak: 0, onStreak: 0, reason: "No route geometry for the active leg." };
  }

  const distanceM = distanceToPolylineM(pos, routePoints);
  if (distanceM == null) {
    return { state: "unknown", distanceM: null, offStreak: 0, onStreak: 0, reason: "Route geometry is unusable." };
  }

  // An invalid CURRENT observation can still carry an already-confirmed state
  // forward (below), but a poor current fix alone must never CREATE a
  // deviation claim.
  const currentValid = validObservation({ ...pos, accuracyM, fresh: gpsFresh, recordedAtMs: null }, now);

  // Walk the breadcrumb window newest-first, keeping only valid observations,
  // and stop at the first invalid one — an invalid ping breaks "consecutive".
  const observations = [];
  const candidates = [
    { ...pos, accuracyM, fresh: gpsFresh },
    ...(Array.isArray(recentPings) ? recentPings : []),
  ];
  for (const ping of candidates) {
    if (!validObservation(ping, now)) break;
    const d = distanceToPolylineM(ping, routePoints);
    if (d == null) break;
    observations.push(d);
  }

  // Off-side streak: consecutive newest observations beyond the confirm threshold.
  let offStreak = 0;
  for (const d of observations) {
    if (d > OFF_ROUTE_CONFIRM_M) offStreak++;
    else break;
  }
  // On-side streak: consecutive newest observations back within the resume threshold.
  let onStreak = 0;
  for (const d of observations) {
    if (d <= OFF_ROUTE_RESUME_M) onStreak++;
    else break;
  }

  if (currentValid && offStreak >= OFF_ROUTE_CONFIRM_PINGS) {
    return {
      state: "off_route",
      distanceM,
      offStreak,
      onStreak,
      reason: `${offStreak} consecutive valid fixes > ${OFF_ROUTE_CONFIRM_M} m from the route (currently ${distanceM} m).`,
    };
  }

  if (currentValid && onStreak >= OFF_ROUTE_CONFIRM_PINGS) {
    return {
      state: "on_route",
      distanceM,
      offStreak,
      onStreak,
      reason: `Back within ${OFF_ROUTE_RESUME_M} m for ${onStreak} consecutive valid fixes (currently ${distanceM} m).`,
    };
  }

  // Not enough evidence for a NEW confirmation. A previously confirmed
  // off-route state persists until the recovery streak completes — that is
  // the hysteresis contract (durable previous state, not this call's opinion).
  if (previousState === "off_route") {
    return {
      state: "off_route",
      distanceM,
      offStreak,
      onStreak,
      reason: onStreak > 0
        ? `Recovery not confirmed — ${onStreak} of ${OFF_ROUTE_CONFIRM_PINGS} fixes back within ${OFF_ROUTE_RESUME_M} m (currently ${distanceM} m).`
        : `Confirmed deviation persists (${distanceM} m from the route).`,
    };
  }

  // Unconfirmed and previously fine/on-route: the first >250 m fix waits for
  // a second; brief excursions never raise anything.
  return {
    state: "on_route",
    distanceM,
    offStreak,
    onStreak,
    reason: offStreak > 0
      ? `First valid fix beyond ${OFF_ROUTE_CONFIRM_M} m — waiting for ${OFF_ROUTE_CONFIRM_PINGS - offStreak} more to confirm.`
      : `Within the route corridor (currently ${distanceM} m).`,
  };
}
