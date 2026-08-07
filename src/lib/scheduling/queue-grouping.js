import { DERIVED_PRIORITY, DERIVED_PRIORITY_RANK, RESERVATION_LIFECYCLE as L } from "@/lib/constants";

// Pure queue bucketing + ordering for the unified Transportation Queue.
//
// The five tabs map to WHERE a request sits in its lifecycle, not its status
// string alone:
//   Today      – active, pickup later today or overdue (the dispatcher's now)
//   Upcoming   – active, pickup another day (VIP never pulled here by design)
//   In Progress– a trip is running
//   Completed  – finished
//   Cancelled  – stood down
//
// Within Today/Upcoming the auto-sort is by derived_priority (Overdue first,
// Future last) then soonest pickup — the priority engine decides, never a human.

export const QUEUE_TABS = ["today", "upcoming", "inProgress", "completed", "cancelled"];

const IN_PROGRESS = new Set([L.IN_PROGRESS]);
const TERMINAL = new Set([L.COMPLETED, L.CANCELLED, L.REJECTED]);

function isToday(d, now) {
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Bucket a request into one of the five queue tabs. */
export function bucketRequest(request, now = new Date()) {
  const status = request?.fleet_status;

  if (IN_PROGRESS.has(status)) return "inProgress";
  if (status === L.COMPLETED) return "completed";
  if (status === L.CANCELLED) return "cancelled";

  // Any other non-terminal request still awaiting dispatch/action.
  const pickup = new Date(request?.pickup_datetime);
  const valid = !Number.isNaN(pickup.getTime());
  if (valid && !isToday(pickup, now)) return "upcoming";
  return "today";
}

/** Compare two requests for the auto-sort: priority rank, then pickup time. */
export function compareByPriority(a, b) {
  const rankA = a.derived_priority ? (DERIVED_PRIORITY_RANK[a.derived_priority] ?? 6) : 7;
  const rankB = b.derived_priority ? (DERIVED_PRIORITY_RANK[b.derived_priority] ?? 6) : 7;
  if (rankA !== rankB) return rankA - rankB;

  const ta = new Date(a.pickup_datetime).getTime() || Infinity;
  const tb = new Date(b.pickup_datetime).getTime() || Infinity;
  return ta - tb;
}

/**
 * Group a list of requests into the five tab buckets, each auto-sorted.
 * Requests with no derived_priority are sorted by pickup time as a fallback.
 *
 * @returns {{ today: object[], upcoming: object[], inProgress: object[], completed: object[], cancelled: object[] }}
 */
export function groupQueue(requests, now = new Date()) {
  const buckets = { today: [], upcoming: [], inProgress: [], completed: [], cancelled: [] };
  for (const r of requests || []) {
    const bucket = bucketRequest(r, now);
    if (buckets[bucket]) buckets[bucket].push(r);
  }
  for (const key of QUEUE_TABS) buckets[key].sort(compareByPriority);
  return buckets;
}
