const RANK = { Scheduled: 0, "In Progress": 1, Completed: 100 };
const TERMINAL = new Set(["Completed", "Cancelled"]);
// An interrupt, not a ladder position: the live CHECK constraint allows it, the
// incident path drops into it (from Scheduled or In Progress) when a vehicle
// becomes unavailable, and the dispatch edit path moves it back to Scheduled
// once resources are reassigned. No RANK value could describe both directions
// of that move — going in is forward progress, coming out is a reassignment —
// so, like Cancelled, it gets explicit rules rather than a rank.
const INTERRUPT = new Set(["Pending Reassignment"]);

export function isValidDispatchStatus(status) {
  return status === "Cancelled" || INTERRUPT.has(status) || RANK[status] !== undefined;
}

export function canTransitionDispatch(from, to) {
  if (!isValidDispatchStatus(to)) {
    return { ok: false, reason: `"${to}" is not a valid dispatch status.` };
  }
  if (!from) return { ok: true };
  if (TERMINAL.has(from)) {
    return { ok: false, reason: `Dispatch is ${from} and can no longer change status.` };
  }
  if (to === "Cancelled") return { ok: true };
  if (INTERRUPT.has(to)) {
    // Available from any non-terminal ladder position (incident interrupt).
    if (RANK[from] === undefined) {
      return { ok: false, reason: `Cannot move a dispatch from "${from}" to "${to}".` };
    }
    return { ok: true };
  }
  if (INTERRUPT.has(from)) {
    // The only way out of the interrupt is a resource reassignment back to
    // Scheduled; dispatch/[id]/route.js does that with a raw UPDATE that never
    // passes through here. Anything else would wrongly look like a normal
    // ladder move.
    return { ok: false, reason: `Dispatch is ${from}; reassign resources to move it back to Scheduled.` };
  }
  if (RANK[to] < RANK[from]) {
    return { ok: false, reason: `Cannot move a dispatch from "${from}" back to "${to}".` };
  }
  return { ok: true };
}
