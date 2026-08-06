const RANK = { Scheduled: 0, "In Progress": 1, Completed: 100 };
const TERMINAL = new Set(["Completed", "Cancelled"]);

export function isValidDispatchStatus(status) {
  return status === "Cancelled" || RANK[status] !== undefined;
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
  if (RANK[to] < RANK[from]) {
    return { ok: false, reason: `Cannot move a dispatch from "${from}" back to "${to}".` };
  }
  return { ok: true };
}
