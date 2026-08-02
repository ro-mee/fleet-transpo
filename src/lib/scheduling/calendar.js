import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

// Phase 16 — the calendar's pure core.
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

/** How rows are grouped. Lanes are the Phase 16 "vehicle/driver lanes". */
export const LANE = { NONE: "none", VEHICLE: "vehicle", DRIVER: "driver" };

/**
 * What a block on the calendar represents.
 *
 * DISPATCH is a committed trip. The other three are reasons a resource is NOT
 * available, which is the whole point of showing them beside the dispatches —
 * a dispatch drawn on top of a maintenance window is the bug the calendar is
 * meant to make obvious.
 */
export const EVENT_KIND = {
  DISPATCH: "dispatch",
  MAINTENANCE: "maintenance",
  LEAVE: "leave",
  DOWNTIME: "downtime",
};

export const KIND_LABEL = {
  [EVENT_KIND.DISPATCH]: "Dispatch",
  [EVENT_KIND.MAINTENANCE]: "Maintenance",
  [EVENT_KIND.LEAVE]: "Driver leave",
  [EVENT_KIND.DOWNTIME]: "Vehicle downtime",
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
 * meant to collide with would look clear. lib/dates.js documents this trap;
 * `pg` may hand back either a Date pinned to local midnight or a bare string
 * depending on the type parser, so both shapes are handled here.
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
 * are flagged via isSameMonth at render time rather than being dropped, because
 * a trip on the 1st is worth seeing while you are looking at the previous month.
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

/**
 * A dispatch becomes a timed block.
 *
 * A dispatch with no scheduled_arrival still occupies its departure instant, so
 * it is given a nominal 60-minute body — a zero-width block would be invisible
 * and, worse, would never overlap anything, hiding exactly the double-booking
 * the calendar exists to surface.
 */
export function dispatchToEvent(d) {
  const start = toDate(d.scheduled_departure);
  if (!start) return null;
  const end = toDate(d.scheduled_arrival) || new Date(start.getTime() + 60 * MINUTE_MS);
  const request = d.transportation_requests || null;

  return {
    id: `dispatch-${d.dispatch_id}`,
    kind: EVENT_KIND.DISPATCH,
    start,
    end,
    // A cancelled dispatch has released its resources, so it must not count as
    // an overlap — but it stays visible, greyed, because "why is nothing
    // scheduled here" is answered by seeing it.
    holdsResource: d.status !== "Cancelled",
    tone: DISPATCH_TONE[d.status] || "secondary",
    title: d.dispatch_number || `DSP-${d.dispatch_id}`,
    subtitle: request?.guest_name || d.routes?.route_name || null,
    status: d.status,
    priority: d.priority || request?.priority || null,
    vehicleId: d.vehicle_id ?? null,
    driverId: d.driver_id ?? null,
    href: `/dispatch/${d.dispatch_id}`,
    raw: d,
  };
}

/**
 * A maintenance record becomes an all-day span.
 *
 * maintenance_date and completed_date are DATE columns, so this is calendar-day
 * arithmetic — mirroring maintenanceCoversDay() in conflicts.js. An open record
 * with no completed_date covers its own day only, matching the SQL there.
 */
export function maintenanceToEvent(m) {
  const from = toLocalDay(m.maintenance_date);
  if (!from) return null;
  const to = toLocalDay(m.completed_date) || from;

  return {
    id: `maintenance-${m.maintenance_id}`,
    kind: EVENT_KIND.MAINTENANCE,
    start: startOfDay(from),
    end: endOfDay(to),
    allDay: true,
    holdsResource: true,
    tone: "danger",
    title: m.maintenance_type || "Maintenance",
    subtitle: m.status || null,
    vehicleId: m.vehicle_id ?? null,
    driverId: null,
    raw: m,
  };
}

/** A driverattendance row marked On Leave / Absent becomes an all-day span. */
export function leaveToEvent(a) {
  const day = toLocalDay(a.date);
  if (!day) return null;

  return {
    id: `leave-${a.attendance_id}`,
    kind: EVENT_KIND.LEAVE,
    start: startOfDay(day),
    end: endOfDay(day),
    allDay: true,
    holdsResource: true,
    tone: "warning",
    title: a.status || "On Leave",
    subtitle: a.remarks || null,
    vehicleId: null,
    driverId: a.driver_id ?? null,
    raw: a,
  };
}

/**
 * Standing unavailability from the resource's own status column.
 *
 * Unlike the other three this has no dates of its own — a vehicle that is
 * Under Maintenance is unavailable *now*, indefinitely. It is stamped across the
 * whole visible window so the lane reads as blocked, which is the honest
 * rendering: we know it is out, we do not know until when.
 */
export function downtimeToEvent({ kind, id, label, detail, start, end }) {
  return {
    id: `downtime-${kind}-${id}`,
    kind: EVENT_KIND.DOWNTIME,
    start: startOfDay(start),
    end: endOfDay(end),
    allDay: true,
    holdsResource: true,
    tone: "secondary",
    title: label,
    subtitle: detail || null,
    vehicleId: kind === "vehicle" ? id : null,
    driverId: kind === "driver" ? id : null,
    raw: { kind, id, label },
  };
}

// ---------------------------------------------------------------------------
// Overlap detection.
// ---------------------------------------------------------------------------

/**
 * Half-open overlap: [aStart, aEnd) intersects [bStart, bEnd).
 *
 * Same rule as the SQL in findDispatchConflicts (`depart < $2 AND arrival > $1`)
 * and as overlapsWindow() in conflicts.js. Half-open is what makes back-to-back
 * trips legal: a 09:00–10:00 and a 10:00–11:00 do not conflict.
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
 * Returns a Map of event id -> array of the conflicts it participates in, so a
 * block can be outlined and can explain itself on hover. Both sides of a
 * collision are flagged: a dispatch laid over a maintenance window is a problem
 * whichever one you happen to be looking at.
 *
 * Only events that actually hold a resource participate. A cancelled dispatch
 * is drawn but does not collide, because it has released its vehicle and driver.
 *
 * O(n²) within a resource group. The window is at most a month of one fleet's
 * dispatches, so the constant matters more than the exponent here.
 */
export function findOverlaps(events) {
  const conflicts = new Map();
  const add = (a, b, reason) => {
    if (!conflicts.has(a.id)) conflicts.set(a.id, []);
    conflicts.get(a.id).push({ with: b, reason });
  };

  const groups = new Map();
  for (const e of events) {
    if (!e.holdsResource) continue;
    if (e.vehicleId) {
      const key = `v-${e.vehicleId}`;
      if (!groups.has(key)) groups.set(key, { scope: "vehicle", items: [] });
      groups.get(key).items.push(e);
    }
    if (e.driverId) {
      const key = `d-${e.driverId}`;
      if (!groups.has(key)) groups.set(key, { scope: "driver", items: [] });
      groups.get(key).items.push(e);
    }
  }

  for (const { scope, items } of groups.values()) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!overlaps(a, b)) continue;

        // Two dispatches on one resource is the classic double-booking; a
        // dispatch over maintenance/leave/downtime is a resource that was
        // committed while it was unavailable. Both are worth flagging, and the
        // wording distinguishes them because the fix differs.
        const bothDispatches =
          a.kind === EVENT_KIND.DISPATCH && b.kind === EVENT_KIND.DISPATCH;
        const reason = bothDispatches
          ? `Double-booked ${scope}`
          : `${scope === "vehicle" ? "Vehicle" : "Driver"} unavailable`;

        add(a, b, reason);
        add(b, a, reason);
      }
    }
  }

  return conflicts;
}

/**
 * Vertical placement for a timed block in a day column, as percentages.
 *
 * Events are clipped to the day, so a trip crossing midnight renders as a block
 * running to the bottom of one column and from the top of the next rather than
 * overflowing its container.
 */
export function dayPosition(event, day) {
  const dayStart = startOfDay(day);
  const from = Math.max(event.start.getTime(), dayStart.getTime());
  const to = Math.min(event.end.getTime(), endOfDay(day).getTime());

  const topMin = (from - dayStart.getTime()) / MINUTE_MS;
  const heightMin = Math.max(20, (to - from) / MINUTE_MS);

  return {
    top: (topMin / DAY_MINUTES) * 100,
    height: Math.min(100 - (topMin / DAY_MINUTES) * 100, (heightMin / DAY_MINUTES) * 100),
    continuesBefore: event.start < dayStart,
    continuesAfter: event.end > endOfDay(day),
  };
}

/**
 * Lay out overlapping blocks side by side within a day column.
 *
 * Without this, two concurrent trips render exactly on top of each other and the
 * one underneath is unreachable. Columns are assigned greedily by start time:
 * each event takes the first column whose last occupant has already ended.
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
    widthPct: 100 / total,
    leftPct: (col / total) * 100,
  }));
}

/** Group events by the day they fall on, for month/week grids. */
export function groupByDay(events, days) {
  return days.map((day) => ({
    day,
    isToday: isSameDay(day, new Date()),
    events: events.filter((e) => onDay(e, day)),
  }));
}
