import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";

// Transportation-request (Fleet Reservation Queue) state machine.
//
// A request arrives from Booking, Fleet reviews it, approves or rejects, then
// it flows through dispatch → trip → completion. This module is the single
// authority on which fleet_status transitions are legal. The set of statuses
// mirrors the chk_transport_fleet_status CHECK in migration 016.
//
// STRICT LINEAR CHAIN (no parallel assignment branches):
//   Pending → Under Review → Approved|Rejected → Scheduled → Assigned
//          → In Progress → Completed
// Cancellation is allowed from any non-terminal state and is handled separately
// so it doesn't have to be repeated in every entry.

// Allowed forward transitions. The chain is linear: each state has exactly one
// or two outward edges (review branches to approve|reject; the rest are single).
const NEXT = {
  [L.PENDING]: [L.UNDER_REVIEW],
  [L.UNDER_REVIEW]: [L.APPROVED, L.REJECTED],
  [L.APPROVED]: [L.SCHEDULED],
  [L.SCHEDULED]: [L.ASSIGNED],
  [L.ASSIGNED]: [L.IN_PROGRESS],
  [L.IN_PROGRESS]: [L.COMPLETED],
  // Terminal states — no outgoing transitions.
  [L.REJECTED]: [],
  [L.COMPLETED]: [],
  [L.CANCELLED]: [],
};

const TERMINAL = new Set([L.REJECTED, L.COMPLETED, L.CANCELLED]);
const ALL = new Set(Object.values(L));

export function isValidReservationStatus(status) {
  return ALL.has(status);
}

export function isTerminalReservationStatus(status) {
  return TERMINAL.has(status);
}

/**
 * Decide whether a request may move from `from` to `to`.
 * Rules:
 *   - `to` must be a known status.
 *   - No prior status → allow setting any valid status (fresh ingest).
 *   - Terminal statuses are locked.
 *   - Cancelling is allowed from any non-terminal status.
 *   - Otherwise the move must be in the adjacency map. Same-status is a no-op OK.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canTransitionReservation(from, to) {
  if (!isValidReservationStatus(to)) {
    return { ok: false, reason: `"${to}" is not a valid reservation status.` };
  }
  if (!from) return { ok: true };
  if (from === to) return { ok: true };

  if (TERMINAL.has(from)) {
    return { ok: false, reason: `Request is ${from} and can no longer change status.` };
  }
  if (to === L.CANCELLED) return { ok: true };

  const allowed = NEXT[from] || [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Cannot move a request from "${from}" to "${to}".` };
  }
  return { ok: true };
}

/**
 * Return the next status(es) reachable from `from` in a single hop.
 * Used by multi-step server actions (e.g. dispatch with vehicle+driver =
 * Approved→Scheduled→Assigned) to execute each transition individually rather
 * than jumping. Cancellation is always reachable from non-terminal states.
 *
 * @returns {string[]} array of allowed next statuses (empty for terminal)
 */
export function nextStatuses(from) {
  if (!from || TERMINAL.has(from)) return [];
  return [...(NEXT[from] || []), L.CANCELLED];
}

/**
 * Compute the full path from `from` to `to` following the linear chain.
 * Returns the sequence of hops, including `from` and `to`. If no valid path
 * exists (e.g. trying to reach Completed from Rejected, or jumping backward),
 * returns null. Used to validate and log multi-hop transitions.
 *
 * @returns {string[] | null} path array or null if unreachable
 */
export function transitionPath(from, to) {
  if (!isValidReservationStatus(from) || !isValidReservationStatus(to)) return null;
  if (from === to) return [from];

  // Cancellation is reachable from any non-terminal state in one hop.
  if (to === L.CANCELLED && !TERMINAL.has(from)) return [from, to];

  // Terminal states are locked — no path out.
  if (TERMINAL.has(from)) return null;

  // BFS to find the shortest path through the NEXT graph.
  const queue = [[from]];
  const visited = new Set([from]);
  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const neighbors = NEXT[current] || [];
    for (const next of neighbors) {
      if (next === to) return [...path, next];
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null; // No valid path exists.
}
