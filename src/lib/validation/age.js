/**
 * Minimum-age rules — the single source of truth for "is this birthdate legal?".
 *
 * Kept dependency-free on purpose: the birthdate picker
 * (`src/components/ui/date-picker.jsx`) is a client component, so importing the
 * `@/lib/validation` barrel would drag the whole rule set — security and storage
 * helpers included — into the browser bundle. Re-exported from that barrel for
 * server callers, so there is still exactly one implementation.
 */

/**
 * Youngest age a driver may be, in whole years.
 *
 * PH LTO issues a professional driver's licence from 18, and every row in this
 * registry is a licensed driver, so 18 is the floor for `drivers.birthdate`.
 */
export const LEGAL_DRIVING_AGE = 18;

/**
 * The newest date of birth that still reaches `minAge` today — the date
 * `minAge` years ago at local midnight.
 *
 * Built from calendar parts with the day clamped to the target month's length,
 * rather than by date arithmetic: on Feb 29 a naive 18-year subtraction rolls to
 * Mar 1 and would admit a birthdate one day too young.
 */
export function legalAgeCutoff(minAge, now = new Date()) {
  const year = now.getFullYear() - minAge;
  const month = now.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(now.getDate(), lastDayOfMonth));
}

/**
 * True when `value` (YYYY-MM-DD) is a birthdate that reaches `minAge` today.
 *
 * Blank/absent values pass — the field is optional, and this rule only ever
 * restricts a date the caller actually supplied. Malformed input returns false;
 * callers pair this with an `isIsoDate` check for the "valid date" message.
 */
export function isAtLeastAge(value, minAge, now = new Date()) {
  if (!value || minAge == null) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return false;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const cutoff = legalAgeCutoff(minAge, now);
  const [cutYear, cutMonth, cutDay] = [
    cutoff.getFullYear(),
    cutoff.getMonth() + 1,
    cutoff.getDate(),
  ];

  if (year !== cutYear) return year < cutYear;
  if (month !== cutMonth) return month < cutMonth;
  return day <= cutDay;
}
