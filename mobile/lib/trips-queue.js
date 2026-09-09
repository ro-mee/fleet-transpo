// Presentation only: the server's status groups still own lifecycle eligibility.
// The Trips list is a time-aware QUEUE, not a plain chronological sort.
// Priority (highest → lowest):
//   1. in-progress          (Trip Started ... In Progress) — the active trip
//   2. overdue              (pre-start, past its start window) — action required
//   3. ready                (pre-start, start window reached) — can START now
//   4. schedule-unconfirmed (pre-start, earliest_start unknown) — labeled
//                            apart from READY so the list never claims a
//                            verified start window the data does not back
//   5. upcoming             (pre-start, window not yet reached)
//   6. completed
//   7. cancelled
// Within each bucket, trips sort by departure time ascending.
// Kept free of react-native/theme imports so it stays vitest-runnable.

export const IN_PROGRESS = ["Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress"];
export const PRE_START = ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched", "Driver Accepted"];

export function bucketOf(trip, now) {
  const status = trip.trip_status;
  if (IN_PROGRESS.includes(status)) return "inProgress";
  if (status === "Completed") return "completed";
  if (status === "Cancelled") return "cancelled";
  if (!PRE_START.includes(status)) return "upcoming";

  const earliest = trip.earliest_start ? new Date(trip.earliest_start).getTime() : null;
  // earliest_start unknown (no schedule / no ETA) → its own bucket. The driver
  // is never blocked by absent data and the server still enforces the real
  // start gate — but the label must not claim a verified window.
  if (earliest == null || !Number.isFinite(earliest)) return "scheduleUnconfirmed";
  return now >= earliest ? "ready" : "upcoming";
}

// A pre-start trip past its scheduled departure is OVERDUE (needs action now).
export function isOverdue(trip, now) {
  if (!PRE_START.includes(trip.trip_status)) return false;
  const dep = trip.departure_time ? new Date(trip.departure_time).getTime() : null;
  return dep != null && now > dep;
}

export const BUCKET_ORDER = ["inProgress", "overdue", "ready", "scheduleUnconfirmed", "upcoming", "completed", "cancelled"];
export const BUCKET_LABEL = {
  inProgress: "IN PROGRESS",
  overdue: "OVERDUE · ACTION REQUIRED",
  ready: "READY",
  scheduleUnconfirmed: "SCHEDULE UNCONFIRMED",
  upcoming: "UPCOMING",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
};

// Semantic tone per bucket label, for statusColorForTone at render time.
// Kept here (not the theme) so the mapping is testable without react-native.
export function bucketTone(display) {
  const toneMap = {
    "IN PROGRESS": "info",
    "OVERDUE · ACTION REQUIRED": "danger",
    "READY": "success",
    "SCHEDULE UNCONFIRMED": "warning",
    "UPCOMING": "warning",
    "COMPLETED": "success",
    "CANCELLED": "neutral",
  };
  return toneMap[display] || "neutral";
}

// Buckets with a start window the driver can still act on. The list summary
// counts these as "open assignments".
export const OPEN_BUCKETS = ["inProgress", "overdue", "ready", "scheduleUnconfirmed", "upcoming"];

const depSort = (a, b) =>
  (a.departure_time ? new Date(a.departure_time).getTime() : 0) -
  (b.departure_time ? new Date(b.departure_time).getTime() : 0);

// Build the queue: bucket every trip, let "overdue" override the ready/
// upcoming/schedule-unconfirmed bucket a pre-start trip would otherwise sit
// in, sort each bucket by departure, and drop the empty ones.
export function groupTrips(trips, now) {
  const queues = BUCKET_ORDER.map(() => []);
  for (const trip of trips) {
    let b = bucketOf(trip, now);
    if (isOverdue(trip, now)) b = "overdue";
    queues[BUCKET_ORDER.indexOf(b)].push(trip);
  }
  queues.forEach((q) => q.sort(depSort));
  return BUCKET_ORDER
    .map((bucket, i) => ({ bucket, label: BUCKET_LABEL[bucket], items: queues[i] }))
    .filter((s) => s.items.length > 0);
}
