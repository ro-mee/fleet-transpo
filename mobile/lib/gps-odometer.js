// GPS odometer segment rules — PURE, no React Native imports, so the vitest
// suite (which reaches mobile/lib/** only) can exercise them directly.
//
// This module is the SINGLE definition of "does this fix add distance". It
// existed as two hand-copied blocks — one in the map screen's foreground
// watcher, one in the background TaskManager task — and the two had drifted:
// the foreground copy counted a segment on `(speed > 1 || seg > 0.02)` while
// its own comment claimed segments were "only counted when the vehicle is
// actually moving", and NEITHER copy had any time-delta guard even though both
// comments assumed fixes are "≤3s apart". A driver parked with a drifting GPS
// chip therefore accumulated kilometres all afternoon, and a resume/tunnel gap
// could add a phantom segment. One module, one rule set, both consumers.

/**
 * Largest km a single fix-to-fix segment may plausibly be. Beyond this it is a
 * multipath glitch or a provider teleport, not driving.
 */
export const MAX_SEGMENT_KM = 0.4;

/**
 * Below this a segment is indistinguishable from GPS noise unless the vehicle
 * itself reports that it is moving.
 */
export const MIN_MOVING_SEGMENT_KM = 0.02;

/** Reported speed above which we have positive evidence of driving (m/s = 3.6 km/h). */
export const MOVING_SPEED_MPS = 1;

/**
 * Implied-speed ceiling. The server's own trail maths (src/lib/geo/geofence.js
 * TRAIL_MAX_KMH) uses 180 km/h; the client must not be more permissive than the
 * number it is trying to match.
 */
export const MAX_SEGMENT_SPEED_KMH = 180;

/**
 * A previous fix older than this is not a driving baseline. Without this a
 * resume/tunnel gap turned any sub-400 m drift into distance.
 */
export const MAX_SEGMENT_GAP_MS = 5 * 60 * 1000;

/**
 * When the platform reports no usable speed, a segment is only trusted across
 * a short interval. A stationary chip that drifts 25 m over three seconds is
 * still noise; the same 25 m across a two-minute gap is not a measurement we
 * can defend.
 */
export const MAX_UNSPEEDED_SEGMENT_GAP_MS = 15 * 1000;


/**
 * Why a segment was accepted or dropped. Returned (not just a boolean) so the
 * tests can assert the REASON, which is what actually regresses — a silent
 * change here inflates the odometer, which feeds vehicle service due-dates.
 *
 * @param {{segKm:number, speedMs?:number|null, dtMs?:number|null}} p
 * @returns {{ok:boolean, reason:string}}
 */
export function evaluateSegment({ segKm, speedMs = null, dtMs = null } = {}) {
  if (!Number.isFinite(segKm) || segKm <= 0) return { ok: false, reason: "empty" };
  if (segKm > MAX_SEGMENT_KM) return { ok: false, reason: "jump" };

  // Unknown interval (a fix arrived without a usable timestamp): the
  // time-derived rules cannot be evaluated, so fall through to the speed /
  // magnitude rules rather than discarding a possibly-real segment.
  if (dtMs != null) {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return { ok: false, reason: "no-interval" };
    if (dtMs > MAX_SEGMENT_GAP_MS) return { ok: false, reason: "stale-gap" };
    if ((segKm / (dtMs / 3600000)) > MAX_SEGMENT_SPEED_KMH) return { ok: false, reason: "teleport" };
  }

  // expo-location reports speed as null, -1 or 0 when it cannot measure it.
  // Those are three DIFFERENT claims and must not be collapsed:
  //
  //   speed >= 0                → the platform measured it. If that measurement
  //                                says "stopped", that is direct evidence
  //                                against distance, so it wins over magnitude:
  //                                a stationary chip that wanders 30 m from its
  //                                anchor is still parked, and letting size
  //                                override it is how a jitter wobble bills
  //                                mileage on every cycle.
  //   speed > MOVING_SPEED_MPS   → positive evidence of driving.
  //   speed == null / -1         → UNKNOWN. Magnitude is then the only evidence
  //                                available and is allowed to carry the
  //                                segment, bounded by the gap ceiling below.
  const measured = speedMs != null && Number.isFinite(speedMs) && speedMs >= 0;
  if (measured && speedMs > MOVING_SPEED_MPS) return { ok: true, reason: "moving" };
  if (measured) return { ok: false, reason: "stationary" };

  if (segKm < MIN_MOVING_SEGMENT_KM) return { ok: false, reason: "too-short-unspeeded" };
  if (dtMs != null && dtMs > MAX_UNSPEEDED_SEGMENT_GAP_MS) return { ok: false, reason: "unspeeded-drift" };
  return { ok: true, reason: "unspeeded" };
}

/** Distance in km between two lat/lng pairs (haversine). */
export function haversineKm(latA, lonA, latB, lonB) {
  const R = 6371;
  const p1 = (latA * Math.PI) / 180;
  const p2 = (latB * Math.PI) / 180;
  const dp = ((latB - latA) * Math.PI) / 180;
  const dl = ((lonB - lonA) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** A fresh accumulator. Distance belongs to exactly one trip. */
export function createAccumulator() {
  return { leg1: 0, leg2: 0, prev: null, pending: null, leg: null };
}

/**
 * Fold one fix into a per-leg accumulator.
 *
 * `acc` is mutated in place (it lives in a ref on the map screen and in the
 * AsyncStorage context on the background task — both want the same object back)
 * and is returned for call-site convenience.
 *
 * MEASURE FROM AN ANCHOR, NOT FROM THE PREVIOUS FIX. This is the part that
 * actually defeats parked jitter. A stationary chip does not sit still: it
 * wanders, so measuring each hop from the last fix means a ±30 m wobble bills
 * a 60 m segment every cycle. Measuring from a stable ANCHOR that only resets
 * once distance is actually banked means the wobble can never get further than
 * the jitter radius from home, and a real trip keeps pushing that radius out
 * until it crosses the commit threshold and banks.
 *
 * @param {{leg1:number, leg2:number, prev:object|null, pending:object|null, leg:string|null}} acc
 * @param {{lat:number, lng:number, speedMs?:number|null, atMs?:number|null, leg:string|null}} fix
 * @returns {{acc:object, addedKm:number, reason:string}}
 */
export function accumulateFix(acc, { lat, lng, speedMs = null, atMs = null, leg = null } = {}) {
  if (
    !acc ||
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180
  ) {
    return { acc, addedKm: 0, reason: "invalid" };
  }
  if (atMs != null && !Number.isFinite(atMs)) {
    return { acc, addedKm: 0, reason: "no-interval" };
  }

  // Leg change (pickup reached, or the trip id changed underneath us): drop
  // the anchor so the gap across the transition is never banked.
  if (acc.leg && leg && acc.leg !== leg) {
    acc.prev = null;
    acc.pending = null;
  }
  if (leg) acc.leg = leg;

  const currentFix = { lat, lng, atMs };

  // A stale-gap fix cannot be trusted immediately as the new anchor: it may
  // itself be a multipath outlier. Require a second time-ordered, plausible
  // observation at that location. This also works for a parked vehicle (zero
  // displacement is valid confirmation) and prevents the old anchor from
  // freezing the odometer indefinitely.
  if (acc.pending) {
    const candidateDtMs = acc.pending.atMs != null && atMs != null
      ? atMs - acc.pending.atMs
      : null;
    if (candidateDtMs == null || candidateDtMs <= 0) {
      return { acc, addedKm: 0, reason: "no-interval" };
    }
    if (candidateDtMs > MAX_SEGMENT_GAP_MS) {
      acc.pending = currentFix;
      return { acc, addedKm: 0, reason: "gap-recovery-candidate" };
    }

    const candidateDistanceKm = haversineKm(acc.pending.lat, acc.pending.lng, lat, lng);
    const candidateSpeedKmh = candidateDistanceKm / (candidateDtMs / 3600000);
    if (candidateDistanceKm <= MAX_SEGMENT_KM && candidateSpeedKmh <= MAX_SEGMENT_SPEED_KMH) {
      acc.prev = currentFix;
      acc.pending = null;
      return { acc, addedKm: 0, reason: "gap-recovered" };
    }

    // The candidate was not corroborated (for example, a far-away glitch).
    // Start confirmation from this newer fix without banking the displacement.
    acc.pending = currentFix;
    return { acc, addedKm: 0, reason: "gap-recovery-candidate" };
  }

  if (!acc.prev) {
    acc.prev = currentFix;
    return { acc, addedKm: 0, reason: "first-fix" };
  }

  const fromAnchor = haversineKm(acc.prev.lat, acc.prev.lng, lat, lng);
  const dtMs = acc.prev.atMs != null && atMs != null ? atMs - acc.prev.atMs : null;

  // Check staleness before displacement. A vehicle may travel far while the
  // app is suspended; that unobserved distance is dropped, then the next fixes
  // establish a fresh baseline without fabricating mileage.
  if (dtMs != null && dtMs > MAX_SEGMENT_GAP_MS) {
    acc.prev = null;
    acc.pending = currentFix;
    return { acc, addedKm: 0, reason: "stale-gap" };
  }

  const verdict = evaluateSegment({ segKm: fromAnchor, speedMs, dtMs });

  // A rejected short-interval fix does NOT reset the anchor. A teleport must
  // not become the baseline, and parked jitter must not re-arm on every cycle.
  if (!verdict.ok) return { acc, addedKm: 0, reason: verdict.reason };

  // No leg context = no trip context (idle, or a trip the driver has not
  // accepted). Banking here would silently route the kilometres into leg2,
  // because the leg selector below defaults to leg2 for anything that is not
  // leg1. Distance belongs to a trip leg or to nothing.
  if (!acc.leg) return { acc, addedKm: 0, reason: "no-leg" };

  const key = acc.leg === "leg1" ? "leg1" : "leg2";
  acc[key] += fromAnchor;
  acc.prev = currentFix;
  return { acc, addedKm: fromAnchor, reason: verdict.reason };
}
