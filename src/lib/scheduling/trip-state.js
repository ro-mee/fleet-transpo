import { TRIP_STATUS } from "@/lib/constants";

// Trip status state machine.
//
// The set of legal statuses mirrors the DB CHECK constraint added in
// supabase/migrations/012_status_constraints.sql. The machine is a directed
// graph of allowed single-hop transitions: a trip moves FORWARD one edge at a
// time, or cancels. No skipping, no backward moves, no exit from a terminal
// state.
//
// Two vocabularies coexist:
//   - Legacy ingest chain (trips created before dispatch automation walked
//     Pending → Approved → Vehicle Assigned → Driver Assigned → Dispatched as
//     vehicle/driver were assigned). Those statuses still exist on historical
//     rows. The ingest cluster is loose — any forward hop — and every entry
//     point can normalize straight to Assigned.
//   - Live driver chain: Assigned → Driver Accepted → Trip Started ⇄ In
//     Progress → En Route → Arrived → Completed. This cluster is strict: each
//     step is exactly one allowed hop, so a driver cannot skip the acceptance
//     step. Assigned is the only bridge into the live chain.
//
// Cancellation is allowed from any non-terminal state. Completed and Cancelled
// are locked. Same-status transitions are a no-op.
const TRIP_STATES = new Set([
  TRIP_STATUS.PENDING,
  TRIP_STATUS.APPROVED,
  TRIP_STATUS.VEHICLE_ASSIGNED,
  TRIP_STATUS.DRIVER_ASSIGNED,
  TRIP_STATUS.DISPATCHED,
  TRIP_STATUS.ASSIGNED,
  TRIP_STATUS.DRIVER_ACCEPTED,
  TRIP_STATUS.TRIP_STARTED,
  TRIP_STATUS.AT_PICKUP,
  TRIP_STATUS.PASSENGER_ONBOARD,
  TRIP_STATUS.EN_ROUTE,
  TRIP_STATUS.DROP_OFF,
  TRIP_STATUS.ARRIVED,
  TRIP_STATUS.IN_PROGRESS,
  TRIP_STATUS.COMPLETED,
  TRIP_STATUS.CANCELLED,
]);

// Allowed single-hop forward transitions.
const NEXT = {
  // Legacy ingest cluster — loose forward, any entry normalize to Assigned.
  [TRIP_STATUS.PENDING]: [TRIP_STATUS.APPROVED, TRIP_STATUS.ASSIGNED],
  [TRIP_STATUS.APPROVED]: [TRIP_STATUS.VEHICLE_ASSIGNED, TRIP_STATUS.ASSIGNED],
  [TRIP_STATUS.VEHICLE_ASSIGNED]: [TRIP_STATUS.DRIVER_ASSIGNED, TRIP_STATUS.ASSIGNED],
  [TRIP_STATUS.DRIVER_ASSIGNED]: [TRIP_STATUS.DISPATCHED, TRIP_STATUS.ASSIGNED],
  [TRIP_STATUS.DISPATCHED]: [TRIP_STATUS.ASSIGNED],
  // Live driver chain — strict, one hop at a time. Assigned is the only bridge in.
  // Real pickup lifecycle: Trip Started → At Pickup → Passenger Onboard →
  // En Route → Drop-off → Completed.
  [TRIP_STATUS.ASSIGNED]: [TRIP_STATUS.DRIVER_ACCEPTED],
  [TRIP_STATUS.DRIVER_ACCEPTED]: [TRIP_STATUS.TRIP_STARTED],
  [TRIP_STATUS.TRIP_STARTED]: [TRIP_STATUS.AT_PICKUP, TRIP_STATUS.IN_PROGRESS],
  [TRIP_STATUS.AT_PICKUP]: [TRIP_STATUS.PASSENGER_ONBOARD, TRIP_STATUS.IN_PROGRESS],
  [TRIP_STATUS.PASSENGER_ONBOARD]: [TRIP_STATUS.EN_ROUTE, TRIP_STATUS.IN_PROGRESS],
  [TRIP_STATUS.EN_ROUTE]: [TRIP_STATUS.DROP_OFF, TRIP_STATUS.ARRIVED],
  [TRIP_STATUS.DROP_OFF]: [TRIP_STATUS.COMPLETED],
  [TRIP_STATUS.ARRIVED]: [TRIP_STATUS.DROP_OFF, TRIP_STATUS.COMPLETED],
  [TRIP_STATUS.IN_PROGRESS]: [TRIP_STATUS.AT_PICKUP, TRIP_STATUS.PASSENGER_ONBOARD, TRIP_STATUS.EN_ROUTE, TRIP_STATUS.DROP_OFF, TRIP_STATUS.ARRIVED],
};

const TERMINAL = new Set([TRIP_STATUS.COMPLETED, TRIP_STATUS.CANCELLED]);

export function isValidTripStatus(status) {
  return TRIP_STATES.has(status);
}

/**
 * Decide whether a trip may move from `from` to `to`.
 * Rules:
 *   - `to` must be a known status.
 *   - No prior status → allow setting any valid status (fresh ingest).
 *   - Same status is a no-op.
 *   - A terminal status (Completed / Cancelled) is locked — no transitions out.
 *   - Cancelling is allowed from any non-terminal status.
 *   - Otherwise `from → to` must be a single allowed hop in NEXT.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canTransitionTrip(from, to) {
  if (!isValidTripStatus(to)) {
    return { ok: false, reason: `"${to}" is not a valid trip status.` };
  }
  // No prior status (freshly created / unknown) — allow setting anything valid.
  if (!from) return { ok: true };

  if (from === to) return { ok: true };

  if (TERMINAL.has(from)) {
    return { ok: false, reason: `Trip is ${from} and can no longer change status.` };
  }
  if (to === TRIP_STATUS.CANCELLED) return { ok: true };

  const allowed = NEXT[from] || [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Cannot move a trip from "${from}" to "${to}".` };
  }
  return { ok: true };
}