import { DISPATCH_STATUS as D } from "@/lib/constants";

// Dispatch status state machine.
//
// Mirrors the chk_dispatch_status CHECK (migration 012) plus the explicit
// `Pending Reassignment` state. Unlike the old rank scale, transitions are a
// directed graph of allowed single hops — no skipping, no backward moves, no
// exit from a terminal state.
//
// Edges:
//   Scheduled ⇄ Pending Reassignment → Cancelled
//   Scheduled → In Progress
//   In Progress → Completed / Pending Reassignment / Cancelled
//   Completed / Cancelled are terminal (locked).
//
// `Pending Reassignment` is a first-class state: a resource that was committed
// and then released (incident, stand-down, driver/vehicle swap) sits here until
// a dispatcher reassigns (→ Scheduled) or cancels the dispatch (→ Cancelled).

const DISPATCH_STATES = new Set([
  D.SCHEDULED,
  D.IN_PROGRESS,
  D.PENDING_REASSIGNMENT,
  D.COMPLETED,
  D.CANCELLED,
]);

const NEXT = {
  [D.SCHEDULED]: [D.IN_PROGRESS, D.PENDING_REASSIGNMENT, D.CANCELLED],
  [D.PENDING_REASSIGNMENT]: [D.SCHEDULED, D.CANCELLED],
  [D.IN_PROGRESS]: [D.COMPLETED, D.PENDING_REASSIGNMENT, D.CANCELLED],
};

const TERMINAL = new Set([D.COMPLETED, D.CANCELLED]);

export function isValidDispatchStatus(status) {
  return DISPATCH_STATES.has(status);
}

export function canTransitionDispatch(from, to) {
  if (!isValidDispatchStatus(to)) {
    return { ok: false, reason: `"${to}" is not a valid dispatch status.` };
  }
  // No prior status (freshly created / unknown) — allow setting anything valid.
  if (!from) return { ok: true };

  if (from === to) return { ok: true };

  if (TERMINAL.has(from)) {
    return { ok: false, reason: `Dispatch is ${from} and can no longer change status.` };
  }
  const allowed = NEXT[from] || [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Cannot move a dispatch from "${from}" to "${to}".` };
  }
  return { ok: true };
}
