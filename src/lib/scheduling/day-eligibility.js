// Day-scoped driver eligibility for the Today overview mode of the Resource
// Availability board (GET /api/dispatch/availability-pairs?mode=today).
//
// Answers "does this driver have a valid working day?" — NOT "can a 24-hour
// pseudo-trip fit their schedule?". Tested: approved leave touching the date,
// schedule-row existence (fail-closed, mirroring driverBlockReason), rest day.
// Deliberately NOT tested: shift containment, break overlap, schedule load —
// those are exact-trip-window semantics owned by driver-schedule.js and stay
// authoritative in exact mode. Zero edits to driver-schedule.js; the shared
// primitives below are imported, not duplicated.
import {
  DAY_NAMES,
  hasLeaveConflict,
  localDayOfWeek,
} from "@/lib/scheduling/driver-schedule";

function startOfDay(value) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(value) {
  const d = value instanceof Date ? new Date(value) : new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Day-level schedule eligibility, given a loaded schedule context
 * (see loadDriverScheduleContext: ctx.schedules + ctx.leave).
 *
 * @param {object} params
 * @param {number|string} params.driverId
 * @param {Date|string} params.date  the calendar day under review
 * @param {object} params.ctx        schedule/leave context
 * @returns {{ blocked:boolean, reason:string|null, duty:{start:string,end:string}|null }}
 *   duty carries the shift span for display ("Duty: 6:00 AM–10:00 PM").
 */
export function driverDayEligibility({ driverId, date, ctx }) {
  if (!date) return { blocked: false, reason: null, duty: null };
  // Fail-open mirrors driverBlockReason: a never-loaded context is not
  // evidence of anything. The fail-closed rule fires once the context exists.
  if (!ctx?.schedules) return { blocked: false, reason: null, duty: null };

  const day = localDayOfWeek(date);
  if (day === null) return { blocked: false, reason: null, duty: null };

  // Any approved leave touching this calendar day blocks the overview — full
  // or timed. "Available outside the leave window" is a future enhancement,
  // not silently introduced here.
  const leave = ctx.leave?.get?.(Number(driverId));
  if (hasLeaveConflict(leave, startOfDay(date), endOfDay(date), "Approved")) {
    return { blocked: true, reason: "Driver is on approved leave.", duty: null };
  }

  const schedules = ctx.schedules.get(Number(driverId));
  const schedule = schedules ? schedules.get(day) : undefined;
  if (!schedule) {
    return { blocked: true, reason: "No work schedule configured.", duty: null };
  }
  if (schedule.is_rest_day) {
    const name = DAY_NAMES[Number(schedule.day_of_week)];
    return {
      blocked: true,
      reason: name ? `Driver is on a rest day (${name}).` : "Driver is on a rest day.",
      duty: null,
    };
  }

  return {
    blocked: false,
    reason: null,
    duty: { start: String(schedule.shift_start), end: String(schedule.shift_end) },
  };
}
