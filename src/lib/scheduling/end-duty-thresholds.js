// When a driver owes an End Duty report and when to say so — pure, so the
// boundaries are testable without a database or a clock.
//
// This is the server half of a pair that mobile/lib/end-duty.js starts. That
// module answers "may the driver end duty yet?" and opens its window 30 minutes
// BEFORE the shift ends. This one answers a different question — "when do we
// stop waiting quietly and tell them?" — and its grace starts AFTER the shift
// ends. The two 30s are different numbers that happen to be equal; they are
// named constants here so that stays visible.
//
// Same clock discipline as mobile/lib/end-duty.js: an unusable roster time is
// null, not a guess. With no shift end there is no basis for telling a driver
// they are late, so this fails quiet rather than inventing a deadline.

const MINUTE_MS = 60_000;

// Asia/Manila has no DST — a fixed offset, not a zone. Pinned as a constant so
// the arithmetic below is exact rather than dependent on the runner's ICU data.
const MANILA_OFFSET = "+08:00";

/** After the shift ends, wait this long before the first reminder. */
export const END_DUTY_GRACE_MINUTES = 30;

/** After the shift ends, by this point the report is genuinely late. */
export const END_DUTY_OVERDUE_MINUTES = 120;

/** "HH:MM" / "HH:MM:SS" → minutes since midnight; null when it is not a clock time. */
function clockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** "YYYY-MM-DD" for a `date` column value or a Date, in Manila terms. */
function manilaDateString(value) {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(value);
  }
  return String(value ?? "").slice(0, 10);
}

/**
 * Minutes elapsed since the duty's own shift end.
 *
 * Takes the duty date rather than inferring it from `now`: a shift ending at
 * 23:00 is measured from its own calendar day, and inferring the day from the
 * current time would report a driver 90 minutes past a shift that ended
 * yesterday evening as 23 hours * before* it.
 *
 * @returns {number|null} null when the roster time or the duty date is unusable.
 */
export function minutesPastShiftEnd({ dutyDate, shiftEnd, now = new Date() } = {}) {
  const end = clockMinutes(shiftEnd);
  if (end == null) return null;

  const day = manilaDateString(dutyDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const hh = String(Math.floor(end / 60)).padStart(2, "0");
  const mm = String(end % 60).padStart(2, "0");
  const endAt = new Date(`${day}T${hh}:${mm}:00${MANILA_OFFSET}`);
  if (Number.isNaN(endAt.getTime())) return null;

  return Math.floor((now.getTime() - endAt.getTime()) / MINUTE_MS);
}

/**
 * Which reminder stage this duty has reached, if any.
 *
 * Catch-up is structural rather than a ladder walk: `overdue` is tested first
 * and returned on its own, so a scan that slept through the grace boundary
 * jumps straight to the loud stage and never sends the quiet one late. Same
 * rule as crossedStartWindowThreshold, by ordering rather than iteration.
 *
 * @returns {"reminder"|"overdue"|null}
 */
export function crossedEndDutyThreshold({ dutyDate, shiftEnd, now = new Date() } = {}) {
  const elapsed = minutesPastShiftEnd({ dutyDate, shiftEnd, now });
  if (elapsed == null) return null;
  if (elapsed >= END_DUTY_OVERDUE_MINUTES) return "overdue";
  if (elapsed >= END_DUTY_GRACE_MINUTES) return "reminder";
  return null;
}

/**
 * The per-day half of the reminder's dedupe key: the duty date as YYYYMMDD.
 *
 * This exists because titles are stable event names and the title IS the dedupe
 * key (copy.js rule), so nothing varying may enter the title. Per-day
 * uniqueness therefore has to live in `reference_id`. A constant there would
 * notify a driver once ever and silently suppress every later day.
 */
export function dutyDayKey(dutyDate) {
  const day = manilaDateString(dutyDate);
  const digits = day.replace(/-/g, "");
  const value = Number(digits);
  return Number.isInteger(value) && digits.length === 8 ? value : null;
}
