import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

// Phase 16 & Scheduling Board — the calendar's pure operational core.
//
// Everything here is a function of its arguments: no database handle, no fetch,
// no clock except the anchor date passed in. That is deliberate. The calendar
// renders in the browser but its overlap rule has to agree with the one the
// dispatch INSERT enforces server-side (findDispatchConflicts in
// lib/scheduling/conflicts.js), so the rule lives in one testable place rather
// than being re-derived inside a component.
//
// This module imports nothing from lib/db, so it is safe for a "use client"
// component to pull in.

export const CALENDAR_VIEW = { DAY: "day", WEEK: "week", MONTH: "month" };

/** How rows are grouped. Lanes are the resource timeline "vehicle/driver lanes". */
export const LANE = { NONE: "none", VEHICLE: "vehicle", DRIVER: "driver" };

/** Calendar density modes */
export const CALENDAR_DENSITY = { COMFORTABLE: "comfortable", COMPACT: "compact" };

/**
 * What a block on the calendar represents.
 *
 * DISPATCH is a committed trip. The other four are reasons a resource is NOT
 * available, which is the whole point of showing them beside the dispatches —
 * a dispatch drawn on top of a maintenance window is the bug the calendar is
 * meant to make obvious.
 */
export const EVENT_KIND = {
  DISPATCH: "dispatch",
  MAINTENANCE: "maintenance",
  LEAVE: "leave",
  REST_DAY: "rest_day",
  DOWNTIME: "downtime",
};

export const KIND_LABEL = {
  [EVENT_KIND.DISPATCH]: "Dispatch",
  [EVENT_KIND.MAINTENANCE]: "Vehicle Maintenance",
  [EVENT_KIND.LEAVE]: "Driver Leave",
  [EVENT_KIND.REST_DAY]: "Weekly Rest Day",
  [EVENT_KIND.DOWNTIME]: "Resource Unavailable",
};

const DISPATCH_TONE = {
  Scheduled: "info",
  "In Progress": "warning",
  Completed: "success",
  Cancelled: "secondary",
};

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** Parse to a Date, or null. pg hands back Dates for timestamptz and strings for date. */
export function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a DATE column to LOCAL midnight.
 *
 * Not the same as toDate, and the difference is a day. `new Date("2026-08-05")`
 * parses as *UTC* midnight, which at a negative offset is 4 August locally — so
 * a maintenance window would render on the wrong day, and the dispatch it was
 * meant to collide with would look clear. lib/dates.js documents this trap.
 */
export function toLocalDay(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : startOfDay(value);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

/**
 * The visible window for a view, plus the days it spans.
 *
 * Month is padded out to whole weeks so the grid is rectangular; the extra days
 * are flagged via isSameMonth at render time rather than being dropped.
 */
export function rangeFor(view, anchor) {
  const base = toDate(anchor) || new Date();

  let start;
  let end;
  if (view === CALENDAR_VIEW.DAY) {
    start = startOfDay(base);
    end = endOfDay(base);
  } else if (view === CALENDAR_VIEW.MONTH) {
    start = startOfWeek(startOfMonth(base), { weekStartsOn: 1 });
    end = endOfWeek(endOfMonth(base), { weekStartsOn: 1 });
  } else {
    start = startOfWeek(base, { weekStartsOn: 1 });
    end = endOfWeek(base, { weekStartsOn: 1 });
  }

  return { start, end, days: eachDayOfInterval({ start, end }) };
}

/** Step one view-width forward (dir 1) or back (dir -1). */
export function shiftAnchor(view, anchor, dir) {
  const base = toDate(anchor) || new Date();
  if (view === CALENDAR_VIEW.DAY) return addDays(base, dir);
  if (view === CALENDAR_VIEW.MONTH) return addMonths(base, dir);
  return addWeeks(base, dir);
}

// ---------------------------------------------------------------------------
// Normalization: four different row shapes become one comparable event.
// ---------------------------------------------------------------------------

/** Helper to extract driver name from driver object */
export function formatDriverName(driver) {
  if (!driver) return null;
  const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ").trim();
  return name || `Driver #${driver.driver_id}`;
}

/**
 * A dispatch becomes a timed block.
 * Enriched with joined vehicle and driver data for operational clarity.
 */
export function dispatchToEvent(d, lookups = {}) {
  const start = toDate(d.scheduled_departure);
  if (!start) return null;
  const end = toDate(d.scheduled_arrival) || new Date(start.getTime() + 60 * MINUTE_MS);
  const request = d.transportation_requests || null;
  const route = d.routes || null;

  const vehicleObj = lookups.vehiclesById?.get(d.vehicle_id) || null;
  const driverObj = lookups.driversById?.get(d.driver_id) || null;

  const driverDisplayName = driverObj ? formatDriverName(driverObj) : d.driver_id ? `Driver #${d.driver_id}` : null;
  const vehicleDisplayName = vehicleObj?.plate_number || (d.vehicle_id ? `Vehicle #${d.vehicle_id}` : null);
  const vehicleModel = vehicleObj ? [vehicleObj.make, vehicleObj.model].filter(Boolean).join(" ") : null;

  const pickupLocation = request?.pickup_location || null;
  const dropoffLocation = request?.dropoff_location || null;
  const guestName = request?.guest_name || null;
  const passengerCount = request?.passenger_count ?? null;

  const unassignedDriver = !d.driver_id;
  const unassignedVehicle = !d.vehicle_id;
  const unassigned = unassignedDriver || unassignedVehicle;

  const now = Date.now();
  const timeToStart = start.getTime() - now;
  const isStartingSoon = d.status === "Scheduled" && timeToStart > 0 && timeToStart <= 30 * MINUTE_MS;

  return {
    id: `dispatch-${d.dispatch_id}`,
    dispatchId: d.dispatch_id,
    kind: EVENT_KIND.DISPATCH,
    start,
    end,
    actualDeparture: toDate(d.actual_departure),
    actualArrival: toDate(d.actual_arrival),
    holdsResource: d.status !== "Cancelled",
    tone: DISPATCH_TONE[d.status] || "secondary",
    title: d.dispatch_number || `DSP-${d.dispatch_id}`,
    subtitle: guestName || route?.route_name || null,
    guestName,
    passengerCount,
    reservationNumber: request?.reservation_number || null,
    status: d.status,
    priority: d.priority || request?.priority || "Normal",
    vip: Boolean(request?.is_vip),
    vehicleId: d.vehicle_id ?? null,
    driverId: d.driver_id ?? null,
    vehicle: vehicleObj,
    driver: driverObj,
    driverDisplayName,
    vehicleDisplayName,
    vehicleModel,
    route,
    pickupLocation,
    dropoffLocation,
    unassignedDriver,
    unassignedVehicle,
    unassigned,
    isStartingSoon,
    href: `/dispatch/${d.dispatch_id}`,
    raw: d,
  };
}

/**
 * A maintenance record becomes an all-day span.
 */
export function maintenanceToEvent(m, lookups = {}) {
  const from = toLocalDay(m.maintenance_date);
  if (!from) return null;
  const to = toLocalDay(m.completed_date) || from;
  const vehicleObj = lookups.vehiclesById?.get(m.vehicle_id) || null;

  return {
    id: `maintenance-${m.maintenance_id}`,
    maintenanceId: m.maintenance_id,
    kind: EVENT_KIND.MAINTENANCE,
    start: startOfDay(from),
    end: endOfDay(to),
    allDay: true,
    holdsResource: true,
    tone: "danger",
    title: m.maintenance_type || "Maintenance",
    subtitle: m.description || m.status || null,
    status: m.status,
    priority: m.priority || "Normal",
    vehicleId: m.vehicle_id ?? null,
    vehicle: vehicleObj,
    vehicleDisplayName: vehicleObj?.plate_number || (m.vehicle_id ? `Vehicle #${m.vehicle_id}` : null),
    driverId: null,
    raw: m,
  };
}

/** A driver leave row marked Approved becomes an all-day span. */
export function leaveToEvent(a, lookups = {}) {
  const day = toLocalDay(a.date);
  if (!day) return null;
  const driverObj = lookups.driversById?.get(a.driver_id) || null;
  const driverDisplayName = driverObj ? formatDriverName(driverObj) : a.driver_id ? `Driver #${a.driver_id}` : null;

  return {
    id: `leave-${a.attendance_id}-${format(day, "yyyyMMdd")}`,
    attendanceId: a.attendance_id,
    kind: EVENT_KIND.LEAVE,
    start: startOfDay(day),
    end: endOfDay(day),
    allDay: true,
    holdsResource: true,
    tone: "warning",
    title: `${a.status || "On Leave"} (${driverDisplayName || "Driver"})`,
    leaveType: a.status || "Leave",
    subtitle: a.remarks || "Approved leave",
    driverId: a.driver_id ?? null,
    driver: driverObj,
    driverDisplayName,
    vehicleId: null,
    raw: a,
  };
}

/**
 * Standing unavailability from the resource's own status column.
 */
export function downtimeToEvent({ kind, id, label, detail, start, end, raw }) {
  return {
    id: `downtime-${kind}-${id}`,
    kind: EVENT_KIND.DOWNTIME,
    start: startOfDay(start),
    end: endOfDay(end),
    allDay: true,
    holdsResource: true,
    tone: "secondary",
    title: label,
    subtitle: detail || "Resource unavailable",
    vehicleId: kind === "vehicle" ? id : null,
    driverId: kind === "driver" ? id : null,
    raw: { kind, id, label, ...raw },
  };
}

// ---------------------------------------------------------------------------
// Overlap detection.
// ---------------------------------------------------------------------------

/**
 * Half-open overlap: [aStart, aEnd) intersects [bStart, bEnd).
 */
export function overlaps(a, b) {
  return a.start < b.end && a.end > b.start;
}

/** True when the event intersects the given day. */
export function onDay(event, day) {
  return event.start < endOfDay(day) && event.end > startOfDay(day);
}

/**
 * Flag every event that collides with another on the same resource.
 *
 * Returns a Map of event id -> array of the conflicts it participates in,
 * with explicit diagnostics.
 */
export function findOverlaps(events) {
  const conflicts = new Map();
  const add = (a, b, reason, detail) => {
    if (!conflicts.has(a.id)) conflicts.set(a.id, []);
    conflicts.get(a.id).push({ with: b, reason, detail });
  };

  const groups = new Map();
  for (const e of events) {
    if (!e.holdsResource) continue;
    if (e.vehicleId) {
      const key = `v-${e.vehicleId}`;
      if (!groups.has(key)) groups.set(key, { scope: "vehicle", id: e.vehicleId, items: [] });
      groups.get(key).items.push(e);
    }
    if (e.driverId) {
      const key = `d-${e.driverId}`;
      if (!groups.has(key)) groups.set(key, { scope: "driver", id: e.driverId, items: [] });
      groups.get(key).items.push(e);
    }
  }

  for (const { scope, items } of groups.values()) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!overlaps(a, b)) continue;

        const bothDispatches = a.kind === EVENT_KIND.DISPATCH && b.kind === EVENT_KIND.DISPATCH;
        let reason;
        let detail;

        if (bothDispatches) {
          reason = `Double-booked ${scope}`;
          detail = `Overlaps with ${b.title} (${b.subtitle || "trip"})`;
        } else if (scope === "vehicle") {
          reason = "Vehicle unavailable";
          detail = b.kind === EVENT_KIND.MAINTENANCE ? `Vehicle scheduled for ${b.title}` : `Vehicle is out of service`;
        } else {
          reason = "Driver unavailable";
          detail = b.kind === EVENT_KIND.LEAVE ? `Driver on ${b.leaveType || "Leave"}` : `Driver has weekly rest day`;
        }

        add(a, b, reason, detail);
        add(b, a, reason, detail);
      }
    }
  }

  return conflicts;
}

/**
 * Vertical placement for a timed block in a day column, as percentages.
 */
export function dayPosition(event, day) {
  const dayStart = startOfDay(day);
  const from = Math.max(event.start.getTime(), dayStart.getTime());
  const to = Math.min(event.end.getTime(), endOfDay(day).getTime());

  const topMin = (from - dayStart.getTime()) / MINUTE_MS;
  const heightMin = Math.max(50, (to - from) / MINUTE_MS);

  return {
    top: (topMin / DAY_MINUTES) * 100,
    height: Math.min(100 - (topMin / DAY_MINUTES) * 100, (heightMin / DAY_MINUTES) * 100),
    continuesBefore: event.start < dayStart,
    continuesAfter: event.end > endOfDay(day),
  };
}

/**
 * Lay out overlapping blocks side by side within a day column.
 */
export function packColumns(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end);
  const columnEnds = [];
  const placed = [];

  for (const event of sorted) {
    let col = columnEnds.findIndex((end) => end <= event.start);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(event.end);
    } else {
      columnEnds[col] = event.end;
    }
    placed.push({ event, col });
  }

  const total = Math.max(1, columnEnds.length);
  return placed.map(({ event, col }) => ({
    event,
    col,
    widthPct: 100 / total,
    leftPct: (col / total) * 100,
  }));
}

/**
 * Cluster overlapping events for a clean, zero-collision day schedule.
 * If 1 event is in a slot -> returns a single-event item.
 * If 2+ events overlap in time -> groups them into a cluster with primary event + total count.
 */
export function clusterDayEvents(events, day) {
  const dayEvents = events.filter((e) => !e.allDay && onDay(e, day));
  const sorted = [...dayEvents].sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters = [];
  let currentCluster = null;

  for (const event of sorted) {
    if (!currentCluster) {
      currentCluster = {
        id: `cluster-${event.id}`,
        start: event.start,
        end: event.end,
        events: [event],
      };
    } else {
      // If event starts before current cluster ends (overlapping window), merge into cluster
      if (event.start < currentCluster.end) {
        currentCluster.events.push(event);
        if (event.end > currentCluster.end) {
          currentCluster.end = event.end;
        }
      } else {
        clusters.push(currentCluster);
        currentCluster = {
          id: `cluster-${event.id}`,
          start: event.start,
          end: event.end,
          events: [event],
        };
      }
    }
  }

  if (currentCluster) {
    clusters.push(currentCluster);
  }

  return clusters.map((c) => {
    const isMulti = c.events.length > 1;
    // Primary event: VIP or Urgent priority first, then first scheduled
    const primaryEvent = c.events.find((e) => e.vip || e.priority === "Urgent") || c.events[0];
    return {
      id: c.id,
      isCluster: isMulti,
      count: c.events.length,
      primaryEvent,
      events: c.events,
      start: c.start,
      end: c.end,
      tone: primaryEvent.tone,
    };
  });
}

/** Group events by the day they fall on, for month/week grids. */
export function groupByDay(events, days) {
  return days.map((day) => ({
    day,
    isToday: isSameDay(day, new Date()),
    events: events.filter((e) => onDay(e, day)),
  }));
}
