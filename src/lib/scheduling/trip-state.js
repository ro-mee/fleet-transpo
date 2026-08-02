import { TRIP_STATUS } from "@/lib/constants";

// Trip status state machine.
//
// The set of legal statuses mirrors the DB CHECK constraint added in
// supabase/migrations/012_status_constraints.sql. The mobile app and dispatch
// flow move a trip forward through phases; this module enforces that a status
// change only ever moves FORWARD (or cancels), never backward, and never out of
// a terminal state.
//
// Phase ranks — higher = later in the lifecycle. "In Progress" is treated as
// equivalent to "Trip Started" (both mean the trip is underway); same-rank
// moves are allowed so the two vocabularies interoperate.
const RANK = {
  [TRIP_STATUS.ASSIGNED]: 0,
  [TRIP_STATUS.PENDING]: 1,
  [TRIP_STATUS.APPROVED]: 2,
  [TRIP_STATUS.VEHICLE_ASSIGNED]: 3,
  [TRIP_STATUS.DRIVER_ASSIGNED]: 4,
  [TRIP_STATUS.DISPATCHED]: 5,
  [TRIP_STATUS.DRIVER_ACCEPTED]: 6,
  [TRIP_STATUS.TRIP_STARTED]: 7,
  [TRIP_STATUS.IN_PROGRESS]: 7,
  [TRIP_STATUS.EN_ROUTE]: 8,
  [TRIP_STATUS.ARRIVED]: 9,
  [TRIP_STATUS.COMPLETED]: 100,
};

const TERMINAL = new Set([TRIP_STATUS.COMPLETED, TRIP_STATUS.CANCELLED]);

export function isValidTripStatus(status) {
  return status === TRIP_STATUS.CANCELLED || RANK[status] !== undefined;
}

/**
 * Decide whether a trip may move from `from` to `to`.
 * Rules:
 *   - `to` must be a known status.
 *   - A terminal status (Completed / Cancelled) is locked — no transitions out.
 *   - Cancelling is allowed from any non-terminal status.
 *   - Otherwise the move must be forward or same-phase (rank(to) >= rank(from)).
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canTransitionTrip(from, to) {
  if (!isValidTripStatus(to)) {
    return { ok: false, reason: `"${to}" is not a valid trip status.` };
  }
  // No prior status (freshly created / unknown) — allow setting anything valid.
  if (!from) return { ok: true };

  if (TERMINAL.has(from)) {
    return { ok: false, reason: `Trip is ${from} and can no longer change status.` };
  }
  if (to === TRIP_STATUS.CANCELLED) return { ok: true };

  const fromRank = RANK[from];
  const toRank = RANK[to];
  // Unknown current status in DB — don't block forward progress.
  if (fromRank === undefined) return { ok: true };

  if (toRank < fromRank) {
    return { ok: false, reason: `Cannot move a trip from "${from}" back to "${to}".` };
  }
  return { ok: true };
}
