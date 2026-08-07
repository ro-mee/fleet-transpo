import { DERIVED_PRIORITY, DERIVED_PRIORITY_RANK, RESERVATION_LIFECYCLE as L } from "@/lib/constants";

// Smart Priority Engine — automatic priority for the Transportation Queue.
//
// PURE and DETERMINISTIC. Priority is never chosen by a dispatcher; it is
// derived from time-to-pickup plus VIP/emergency/overdue signals and the
// configurable dispatch_policy thresholds. The same inputs always produce the
// same level, which is what makes the queue ordering testable.
//
// Ordering contract (Overdue at top):
//   Overdue → Critical → High → Medium → Normal → Future
//
// Future is only meaningful under the Upcoming tab; VIP never lifts a Future
// request into the active queue.

/** Default thresholds (minutes) when dispatch_policy is unset. */
export const DEFAULT_THRESHOLDS = {
  criticalMinutes: 15,
  highMinutes: 30,
  mediumMinutes: 120,
};

/** Rank a derived priority level for sorting (1 = top). */
export function priorityRank(level) {
  return DERIVED_PRIORITY_RANK[level] ?? 6;
}

/** A request is "not yet started" when it can still become overdue in the queue. */
const ACTIVE_NOT_STARTED = new Set([
  L.PENDING,
  L.UNDER_REVIEW,
  L.APPROVED,
  L.SCHEDULED,
  L.ASSIGNED,
]);

function minutesUntil(pickupDatetime, now) {
  const t = new Date(pickupDatetime).getTime();
  const n = new Date(now).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  return (t - n) / 60000;
}

function sameCalendarDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// VIP raises a request one band toward the top, but never into Critical/Overdue
// and never lifts a Future request out of the Upcoming tab.
function applyVipBoost(level, isVip) {
  if (!isVip) return level;
  switch (level) {
    case DERIVED_PRIORITY.NORMAL:
      return DERIVED_PRIORITY.MEDIUM;
    case DERIVED_PRIORITY.MEDIUM:
      return DERIVED_PRIORITY.HIGH;
    default:
      return level; // High/Critical/Overdue/Future unchanged.
  }
}

/**
 * Derive the queue priority for one request.
 *
 * @param {object} params
 * @param {string|Date} params.pickupDatetime
 * @param {string} [params.fleetStatus]   request fleet_status
 * @param {boolean} [params.isVip]
 * @param {boolean} [params.isEmergency]
 * @param {Date} [params.now]             fixed clock for tests
 * @param {object} [params.thresholds]    {criticalMinutes, highMinutes, mediumMinutes}
 * @returns {string|null} one of DERIVED_PRIORITY, or null for terminal requests.
 */
export function derivePriority({
  pickupDatetime,
  fleetStatus = null,
  isVip = false,
  isEmergency = false,
  now = new Date(),
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  if (fleetStatus && [L.COMPLETED, L.CANCELLED, L.REJECTED].includes(fleetStatus)) {
    return null;
  }

  const minutes = minutesUntil(pickupDatetime, now);
  if (minutes === null) return DERIVED_PRIORITY.FUTURE;

  const t = thresholds || DEFAULT_THRESHOLDS;
  const critical = Number.isFinite(Number(t.criticalMinutes)) ? Number(t.criticalMinutes) : 15;
  const high = Number.isFinite(Number(t.highMinutes)) ? Number(t.highMinutes) : 30;
  const medium = Number.isFinite(Number(t.mediumMinutes)) ? Number(t.mediumMinutes) : 120;

  // Pickup has passed and the trip has not started → Overdue (top of the queue).
  if (minutes < 0 && (!fleetStatus || ACTIVE_NOT_STARTED.has(fleetStatus))) {
    return DERIVED_PRIORITY.OVERDUE;
  }

  if (minutes <= critical) {
    return DERIVED_PRIORITY.CRITICAL;
  }
  if (minutes <= high) {
    return isEmergency ? DERIVED_PRIORITY.CRITICAL : applyVipBoost(DERIVED_PRIORITY.HIGH, isVip);
  }
  if (minutes <= medium) {
    return isEmergency
      ? DERIVED_PRIORITY.CRITICAL
      : applyVipBoost(DERIVED_PRIORITY.MEDIUM, isVip);
  }
  if (sameCalendarDay(pickupDatetime, now)) {
    return applyVipBoost(DERIVED_PRIORITY.NORMAL, isVip);
  }
  return DERIVED_PRIORITY.FUTURE;
}
