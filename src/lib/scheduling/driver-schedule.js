// Pure, DB-free helpers for the driver work-schedule + leave model
// (migration 049). Endpoints and services load `driver_work_schedules` and
// `driver_leave_requests` rows, then ask these functions whether a pickup
// window is blocked — keeping the time-window semantics in one testable place.
//
// Availability contract (see Dispatch.md "Availability by window"):
//   1. an approved leave covering the pickup date blocks the driver;
//   2. no work-schedule row for the pickup day blocks the driver (fail-closed —
//      a driver with no schedule on file cannot be assigned);
//   3. a rest-day row blocks the driver;
//   4. a pickup window must fit fully inside the shift (half-open, so a trip
//      ending exactly at shift end or starting exactly at shift start is fine);
//   5. a half-open break overlap blocks the driver.
import { toCalendarDay } from "@/lib/dates";

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Manila wall-clock day-of-week (0=Sunday..6=Saturday) of a Date or parseable value.
 *
 * Schedules store Manila wall-clock spans ("06:00:00"–"22:00:00", break
 * "12:00:00"–"13:00:00"), so the pickup instant must be read in Manila terms,
 * not the server's zone. Dev machines sit in GMT+8 so local getters happen to
 * agree; a UTC production runner reads 5 PM Manila as 9 AM and the noon break
 * as 4 AM — the 8-hour split RS-UZYD caught in Copilot prose. Asia/Manila has
 * no DST, but this still goes through Intl rather than a fixed offset so the
 * zone stays explicit at the call site.
 */
export function localDayOfWeek(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short" }).format(d);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? null;
}

/** Manila wall-clock "HH:MM:SS" of a Date or parseable value (see above). */
export function localTimeOfDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}:${get("second")}`;
}

/** "08:00:00" -> "8:00 AM" for a human-readable reason string. */
function fmtTime(value) {
  if (value == null) return "";
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(value);
  const hour = Number(m[1]);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hh = hour % 12 || 12;
  return `${hh}:${m[2]} ${ampm}`;
}

/** Manila "YYYY-MM-DD" of an instant. toCalendarDay reads a Date's server-local
 * components, which is correct for pg `date` columns (local midnight) but
 * shifts a timestamptz pickup by the server offset in the 00:00–07:59 Manila
 * window. Leave coverage is a Manila business-day question, so derive it here.
 */
function manilaDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return toCalendarDay(value);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Whether any approved-leave row covers `date` (its Manila calendar day).
 * leaveRows entries may carry either snake_case (pg `date` -> local Date or
 * "YYYY-MM-DD" string) or camelCase column names.
 */
export function hasLeaveConflict(leaveRows, pickup, returnAt, targetStatus = 'Approved') {
  const day = manilaDay(pickup);
  if (day === null) return false;

  const pTime = pickup ? localTimeOfDay(pickup) : null;
  const rTime = returnAt ? localTimeOfDay(returnAt) : pTime;

  return (leaveRows || []).filter(l => l.status === targetStatus).some((l) => {
    const s = toCalendarDay(l.start_date ?? l.startDate);
    const e = toCalendarDay(l.end_date ?? l.endDate);
    if (s === null || e === null || day < s || day > e) return false;

    if (l.start_time && l.end_time) {
      const st = String(l.start_time);
      const et = String(l.end_time);
      if (pTime && rTime) {
        return (st < rTime && et > pTime);
      }
    }
    return true; // Full day leave or exact times unknown
  });
}

/**
 * Whether a single work-schedule row blocks a pickup window.
 *
 * @param {object} params
 * @param {object|null} params.schedule the schedule row for the pickup day, or null
 * @param {Date|string} [params.pickup] pickup instant (read as Manila wall-clock)
 * @param {Date|string} [params.returnAt] return instant; defaults to pickup when absent
 * @returns {{ blocked: true, reason: string } | null} null = not blocked
 */
export function scheduleBlockReason({ schedule, pickup, returnAt }) {
  if (!pickup) return null;

  const p = localTimeOfDay(pickup);
  const r = returnAt ? localTimeOfDay(returnAt) : p;
  if (p === null || r === null) return null;

  if (!schedule) {
    return { blocked: true, reason: "No work schedule on file for this day." };
  }
  if (schedule.is_rest_day) {
    const name = DAY_NAMES[Number(schedule.day_of_week)];
    return {
      blocked: true,
      reason: name ? `Rest day (${name}).` : "Rest day.",
    };
  }

  const shiftStart = String(schedule.shift_start);
  const shiftEnd = String(schedule.shift_end);

  // The window must sit fully inside the shift, inclusive of both edges: a trip
  // starting exactly at shift start, or ending exactly at shift end, is inside
  // the shift. Anything that reaches outside it is blocked.
  if (!(p >= shiftStart && r <= shiftEnd)) {
    return {
      blocked: true,
      reason: `Outside work shift (${fmtTime(shiftStart)}–${fmtTime(shiftEnd)}).`,
    };
  }

  if (schedule.break_start && schedule.break_end) {
    const bs = String(schedule.break_start);
    const be = String(schedule.break_end);
    // Half-open overlap: the window overlaps the break when the break starts
    // before the return and ends after the pickup.
    if (bs < r && be > p) {
      return {
        blocked: true,
        reason: `During lunch/break (${fmtTime(bs)}–${fmtTime(be)}).`,
      };
    }
  }

  return null;
}

/**
 * Blocking reason for a driver over a pickup window, given loaded context.
 *
 * `ctx` shape (see loadDriverScheduleContext):
 *   ctx.schedules: Map<driver_id, Map<day_of_week, row>>
 *   ctx.leave:     Map<driver_id, Array<{start_date, end_date}>>
 *
 * When `pickup` is absent there is no window to test, so nothing blocks — the
 * fail-closed rule applies only once a concrete pickup time is known.
 *
 * @returns {{ blocked: true, reason: string } | null}
 */
export function driverBlockReason({ driverId, pickup, returnAt, ctx }) {
  if (!pickup) return null;
  // Fail-open when the caller never loaded a schedule context at all: absence of
  // the context is not evidence of absence of a schedule. The fail-closed rule
  // (no row for the weekday -> blocked) only fires once loadDriverScheduleContext
  // has actually been run and returned an empty map for the driver.
  if (!ctx?.schedules) return null;

  const day = localDayOfWeek(pickup);
  if (day === null) return null;

  const schedules = ctx.schedules.get(Number(driverId));
  const schedule = schedules ? schedules.get(day) : undefined;

  const leave = ctx.leave?.get?.(Number(driverId));
  if (hasLeaveConflict(leave, pickup, returnAt, 'Approved')) {
    return { blocked: true, reason: "Driver is on approved leave during this time." };
  }
  
  if (hasLeaveConflict(leave, pickup, returnAt, 'Pending')) {
    // Note: Pending doesn't block assignment, but can be surfaced as a warning
    return { blocked: false, warning: true, reason: "Driver has a pending leave request during this time." };
  }

  return scheduleBlockReason({ schedule, pickup, returnAt });
}