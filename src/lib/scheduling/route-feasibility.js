// Three-leg route feasibility — PURE calculation, no DB, no fetch().
//
// The I/O (TomTom / canonical snapshot / GPS / next-dispatch lookup) lives in
// src/services/route-feasibility-context.service.js, which builds the plain
// input object this engine consumes. This file only does arithmetic, so Vitest
// stays deterministic: `now` is passed in, never read from the clock.
//
// Legs:
//   deadhead   driver position → pickup        (live routing matters most)
//   passenger  pickup → destination            (canonical snapshot first)
//   reposition destination → next ASSIGNED pickup (hard constraint only —
//              a pending queue request is NEVER a "next booking"; that
//              scarcity/lookahead reasoning belongs to Phase 2)
//
// Verdicts:
//   SAFE       buffers hold with slack
//   TIGHT      feasible, but pickup or turnaround buffer is below the safety bar
//   INFEASIBLE cannot reach pickup in time, or cannot make the next booking
//   UNKNOWN    a required leg ETA is missing — fail open, never invent
//
// Fail-open: null/unknown leg ETAs produce UNKNOWN (plus reasons), never a
// fabricated block. Mirrors travel-buffer.js / departure-window.js.
//
// Materiality: the deadhead leg (driver position → pickup) is only required
// evidence when the caller knows where the journey starts (a preceding trip
// destination or live position). For a far-future booking with no preceding
// commitment there is no start location to route from, so callers pass
// deadheadRequired:false and the verdict is judged on the knowable static
// legs (passenger + reposition) instead of warning about an unknowable ETA.

export const FEASIBILITY_VERDICTS = ["SAFE", "TIGHT", "INFEASIBLE", "UNKNOWN"];

function toMs(value) {
  if (value == null || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toNonNegativeMinutes(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * @param {object} p
 * @param {Date|string|number} p.now
 * @param {Date|string|number} p.pickupAt
 * @param {number|null} p.deadheadMinutes    driver → pickup
 * @param {number|null} p.passengerMinutes   pickup → destination
 * @param {Date|string|number|null} [p.nextPickupAt]  next ASSIGNED dispatch pickup
 * @param {number|null} [p.repositionMinutes] destination → next pickup
 * @param {number} [p.safetyBufferMinutes=10] mirrors dispatch-policy.js default
 * @param {boolean} [p.deadheadRequired=true] when false, an unknown deadhead
 *   leg is excluded from the verdict (no preceding trip or live position to
 *   route from). Pickup-buffer gating is skipped; the verdict is judged on
 *   the passenger leg plus next-commitment turnaround only.
 * @returns {{
 *   requiredDeparture: Date|null,
 *   pickupBufferMin: number|null,
 *   expectedArrival: Date|null,
 *   turnaroundMin: number|null,
 *   verdict: "SAFE"|"TIGHT"|"INFEASIBLE"|"UNKNOWN",
 *   reasons: string[],
 *   unknownLegs: Array<"deadhead"|"passenger"|"reposition">,
 * }}
 */
export function evaluateRouteFeasibility({
  now,
  pickupAt,
  deadheadMinutes,
  passengerMinutes,
  nextPickupAt = null,
  repositionMinutes = null,
  safetyBufferMinutes = 10,
  deadheadRequired = true,
}) {
  const reasons = [];
  const unknownLegs = [];
  const nowMs = toMs(now);
  const pickupMs = toMs(pickupAt);
  const safety = Number(safetyBufferMinutes);
  const buffer = Number.isFinite(safety) && safety > 0 ? safety : 0;

  if (nowMs == null) {
    return {
      requiredDeparture: null, pickupBufferMin: null,
      expectedArrival: null, turnaroundMin: null,
      verdict: "UNKNOWN", reasons: ["Current time is unknown; cannot assess feasibility."], unknownLegs,
    };
  }
  if (pickupMs == null) {
    return {
      requiredDeparture: null, pickupBufferMin: null,
      expectedArrival: null, turnaroundMin: null,
      verdict: "UNKNOWN", reasons: ["Scheduled pickup time is unknown; cannot assess feasibility."], unknownLegs,
    };
  }

  const deadhead = toNonNegativeMinutes(deadheadMinutes);
  const passenger = toNonNegativeMinutes(passengerMinutes);
  const deadheadMissing = deadheadRequired && deadhead == null;
  if (deadheadMissing) {
    reasons.push("Driver-to-pickup travel time is unknown; pickup readiness cannot be confirmed.");
    unknownLegs.push("deadhead");
  }
  if (passenger == null) {
    reasons.push("Pickup-to-destination travel time is unknown; arrival cannot be projected.");
    unknownLegs.push("passenger");
  }

  if (deadheadMissing || passenger == null) {
    return {
      requiredDeparture: null, pickupBufferMin: null,
      expectedArrival: null, turnaroundMin: null,
      verdict: "UNKNOWN", reasons, unknownLegs,
    };
  }

  // Without a required deadhead there is no start location to depart from, so
  // pickup-buffer gating is skipped — the verdict below is judged on the
  // knowable static legs only.
  const requiredDeparture = deadhead != null ? new Date(pickupMs - (deadhead + buffer) * 60 * 1000) : null;
  // Slack before the latest safe departure, net of the safety buffer:
  // e.g. 45 min to pickup, 19 min deadhead, 10 min buffer → 16 min.
  const pickupBufferMin = deadhead != null ? Math.round((pickupMs - nowMs) / 60000 - deadhead - buffer) : null;
  const expectedArrival = new Date(pickupMs + passenger * 60 * 1000);

  if (pickupBufferMin != null && pickupBufferMin < 0) {
    const overdue = Math.abs(pickupBufferMin);
    reasons.push(
      `Driver would need to have departed ${overdue} minute${overdue === 1 ? "" : "s"} ago to reach pickup on time.`
    );
    return {
      requiredDeparture, pickupBufferMin, expectedArrival,
      turnaroundMin: null, verdict: "INFEASIBLE", reasons, unknownLegs,
    };
  }
  const tightPickup = pickupBufferMin != null && pickupBufferMin < buffer;
  if (tightPickup) {
    reasons.push(
      `Only ${pickupBufferMin} minute${pickupBufferMin === 1 ? "" : "s"} of slack before the latest safe departure.`
    );
  }

  const nextMs = nextPickupAt != null && nextPickupAt !== "" ? toMs(nextPickupAt) : null;
  if (nextMs == null) {
    return {
      requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin: null,
      verdict: tightPickup ? "TIGHT" : "SAFE",
      reasons: tightPickup ? reasons : deadhead != null
        ? ["Pair can reach pickup on time; no further assigned trip constrains this assignment."]
        : ["No adjacent trips constrain this assignment; static trip plan verified."],
      unknownLegs,
    };
  }

  const reposition = toNonNegativeMinutes(repositionMinutes);
  if (reposition == null) {
    reasons.push("Travel time to the next assigned pickup is unknown; turnaround cannot be confirmed.");
    unknownLegs.push("reposition");
    return {
      requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin: null,
      verdict: "UNKNOWN", reasons, unknownLegs,
    };
  }

  const turnaroundMin = Math.round((nextMs - expectedArrival.getTime()) / 60000 - reposition);
  if (turnaroundMin < 0) {
    const late = Math.abs(turnaroundMin);
    reasons.push(
      `Projected to miss the next assigned pickup by about ${late} minute${late === 1 ? "" : "s"} after repositioning.`
    );
    return { requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin, verdict: "INFEASIBLE", reasons, unknownLegs };
  }
  if (turnaroundMin < buffer || tightPickup) {
    if (turnaroundMin < buffer) {
      reasons.push(
        `Only ${turnaroundMin} minute${turnaroundMin === 1 ? "" : "s"} of turnaround before the next assigned pickup.`
      );
    }
    return { requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin, verdict: "TIGHT", reasons, unknownLegs };
  }

  reasons.push("Pair can reach pickup on time and still has enough repositioning time before its next assigned trip.");
  return { requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin, verdict: "SAFE", reasons, unknownLegs };
}
