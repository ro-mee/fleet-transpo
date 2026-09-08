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
 * @returns {{
 *   requiredDeparture: Date|null,
 *   pickupBufferMin: number|null,
 *   expectedArrival: Date|null,
 *   turnaroundMin: number|null,
 *   verdict: "SAFE"|"TIGHT"|"INFEASIBLE"|"UNKNOWN",
 *   reasons: string[],
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
}) {
  const reasons = [];
  const nowMs = toMs(now);
  const pickupMs = toMs(pickupAt);
  const safety = Number(safetyBufferMinutes);
  const buffer = Number.isFinite(safety) && safety > 0 ? safety : 0;

  if (nowMs == null) {
    return {
      requiredDeparture: null, pickupBufferMin: null,
      expectedArrival: null, turnaroundMin: null,
      verdict: "UNKNOWN", reasons: ["Current time is unknown; cannot assess feasibility."],
    };
  }
  if (pickupMs == null) {
    return {
      requiredDeparture: null, pickupBufferMin: null,
      expectedArrival: null, turnaroundMin: null,
      verdict: "UNKNOWN", reasons: ["Scheduled pickup time is unknown; cannot assess feasibility."],
    };
  }

  const deadhead = toNonNegativeMinutes(deadheadMinutes);
  const passenger = toNonNegativeMinutes(passengerMinutes);
  if (deadhead == null) reasons.push("Driver-to-pickup travel time is unknown; pickup readiness cannot be confirmed.");
  if (passenger == null) reasons.push("Pickup-to-destination travel time is unknown; arrival cannot be projected.");

  if (deadhead == null || passenger == null) {
    return {
      requiredDeparture: null, pickupBufferMin: null,
      expectedArrival: null, turnaroundMin: null,
      verdict: "UNKNOWN", reasons,
    };
  }

  const requiredDeparture = new Date(pickupMs - (deadhead + buffer) * 60 * 1000);
  // Slack before the latest safe departure, net of the safety buffer:
  // e.g. 45 min to pickup, 19 min deadhead, 10 min buffer → 16 min.
  const pickupBufferMin = Math.round((pickupMs - nowMs) / 60000 - deadhead - buffer);
  const expectedArrival = new Date(pickupMs + passenger * 60 * 1000);

  if (pickupBufferMin < 0) {
    const overdue = Math.abs(pickupBufferMin);
    reasons.push(
      `Driver would need to have departed ${overdue} minute${overdue === 1 ? "" : "s"} ago to reach pickup on time.`
    );
    return {
      requiredDeparture, pickupBufferMin, expectedArrival,
      turnaroundMin: null, verdict: "INFEASIBLE", reasons,
    };
  }
  if (pickupBufferMin < buffer) {
    reasons.push(
      `Only ${pickupBufferMin} minute${pickupBufferMin === 1 ? "" : "s"} of slack before the latest safe departure.`
    );
  }

  const nextMs = nextPickupAt != null && nextPickupAt !== "" ? toMs(nextPickupAt) : null;
  if (nextMs == null) {
    return {
      requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin: null,
      verdict: pickupBufferMin < buffer ? "TIGHT" : "SAFE",
      reasons: pickupBufferMin < buffer
        ? reasons
        : ["Pair can reach pickup on time; no further assigned trip constrains this assignment."],
    };
  }

  const reposition = toNonNegativeMinutes(repositionMinutes);
  if (reposition == null) {
    reasons.push("Travel time to the next assigned pickup is unknown; turnaround cannot be confirmed.");
    return {
      requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin: null,
      verdict: "UNKNOWN", reasons,
    };
  }

  const turnaroundMin = Math.round((nextMs - expectedArrival.getTime()) / 60000 - reposition);
  if (turnaroundMin < 0) {
    const late = Math.abs(turnaroundMin);
    reasons.push(
      `Projected to miss the next assigned pickup by about ${late} minute${late === 1 ? "" : "s"} after repositioning.`
    );
    return { requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin, verdict: "INFEASIBLE", reasons };
  }
  if (turnaroundMin < buffer || pickupBufferMin < buffer) {
    if (turnaroundMin < buffer) {
      reasons.push(
        `Only ${turnaroundMin} minute${turnaroundMin === 1 ? "" : "s"} of turnaround before the next assigned pickup.`
      );
    }
    return { requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin, verdict: "TIGHT", reasons };
  }

  reasons.push("Pair can reach pickup on time and still has enough repositioning time before its next assigned trip.");
  return { requiredDeparture, pickupBufferMin, expectedArrival, turnaroundMin, verdict: "SAFE", reasons };
}
