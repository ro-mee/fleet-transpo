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

/** Local day-of-week (0=Sunday..6=Saturday) of a Date or parseable value. */
export function localDayOfWeek(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getDay();
}

/** Local wall-clock "HH:MM:SS" of a Date or parseable value. */
export function localTimeOfDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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

/**
 * Whether any approved-leave row covers `date` (its calendar day, local).
 * leaveRows entries may carry either snake_case (pg `date` -> local Date or
 * "YYYY-MM-DD" string) or camelCase column names.
 */
export function hasApprovedLeave(leaveRows, date) {
  const day = toCalendarDay(date);
  if (day === null) return false;
  return (leaveRows || []).some((l) => {
    const s = toCalendarDay(l.start_date ?? l.startDate);
    const e = toCalendarDay(l.end_date ?? l.endDate);
    return s !== null && e !== null && day >= s && day <= e;
  });
}

/**
 * Whether a single work-schedule row blocks a pickup window.
 *
 * @param {object} params
 * @param {object|null} params.schedule the schedule row for the pickup day, or null
 * @param {Date|string} [params.pickup] pickup instant (local getters read the wall clock)
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
  if (hasApprovedLeave(leave, pickup)) {
    return { blocked: true, reason: "Driver is on approved leave for this date." };
  }

  return scheduleBlockReason({ schedule, pickup, returnAt });
}