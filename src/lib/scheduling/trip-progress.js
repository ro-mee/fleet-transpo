import { DISPATCH_STATUS as D } from "@/lib/constants";

// Trip progress computation, shared across the dispatch board and any consumer
// that renders a dispatch's advancement (the unified queue reuses it too).
// Pure: given a dispatch row it returns { pct, tone, label, ... } describing
// how far along the trip is. No React, no DB.

// pg returns DECIMAL as a string; formatDistance calls .toFixed on its argument.
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {object} dispatch a dispatchschedules row (with .latest_trip,
 *   .transportation_requests, .actual_departure, .scheduled_arrival)
 * @returns {{ pct: number|null, tone: string, label: string, elapsedMin?: number, plannedMin?: number, overdue?: boolean }}
 */
export function tripProgress(dispatch) {
  const status = dispatch?.status;
  const trip = dispatch?.latest_trip;
  const request = dispatch?.transportation_requests;

  if (status === D.COMPLETED) return { pct: 100, tone: "success", label: "Complete" };
  if (status === D.CANCELLED) return { pct: 0, tone: "secondary", label: "Cancelled" };

  if (status === D.SCHEDULED) {
    return {
      pct: trip ? 8 : 0,
      tone: "info",
      label: trip ? "Trip created, not started" : "Awaiting departure",
    };
  }

  // In Progress — measure elapsed against whatever plan we actually have.
  const departedAt = dispatch?.actual_departure || trip?.start_time;
  const departed = departedAt ? new Date(departedAt).getTime() : null;
  if (!departed || Number.isNaN(departed)) {
    return { pct: null, tone: "primary", label: "Underway" };
  }

  const elapsedMin = Math.max(0, Math.round((Date.now() - departed) / 60000));

  const arrival = dispatch?.scheduled_arrival
    ? new Date(dispatch.scheduled_arrival).getTime()
    : null;
  let plannedMin = null;
  if (arrival && !Number.isNaN(arrival) && arrival > departed) {
    plannedMin = Math.round((arrival - departed) / 60000);
  } else {
    plannedMin = num(dispatch?.estimated_duration) ?? num(request?.estimated_duration);
  }

  if (!plannedMin || plannedMin <= 0) {
    return { pct: null, tone: "primary", label: "Underway", elapsedMin };
  }

  const raw = Math.round((elapsedMin / plannedMin) * 100);
  const overdue = raw > 100;
  return {
    // Never 0 or 100 while underway: the trip has demonstrably started and has
    // demonstrably not finished, so neither endpoint would be true.
    pct: Math.min(97, Math.max(5, raw)),
    tone: overdue ? "danger" : "primary",
    label: overdue ? `${elapsedMin - plannedMin}m over plan` : `${elapsedMin}m of ~${plannedMin}m`,
    elapsedMin,
    plannedMin,
    overdue,
  };
}
