export function toDateInput(value, fallback = "") {
  if (!value) return fallback;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

/**
 * Normalize a value to a local "YYYY-MM-DD" calendar day.
 *
 * Needed because `pg` hands back `date` columns as JS Date objects pinned to
 * *local* midnight. Two traps follow from that, and both have bitten this
 * codebase:
 *
 *   1. `someDate < "2026-08-01"` numerically coerces the string to NaN, so the
 *      comparison is always false and the guard silently never fires.
 *   2. `.toISOString()` re-reads that local midnight in UTC, shifting the day
 *      backward at positive offsets — a 2026-07-31 date becomes "2026-07-30"
 *      at UTC+8.
 *
 * So: read local components off Date objects, and slice strings (which the
 * driver may return instead depending on the type parser).
 *
 * @returns {string|null} "YYYY-MM-DD", or null when unparseable
 */
export function toCalendarDay(value) {
  if (!value) return null;
  let d = value;
  // If it's a string with a 'T', it's an ISO timestamp (e.g. from the DB or frontend).
  // Parse it as a Date so we can extract the local day, not the UTC day.
  if (typeof value === "string" && value.includes("T")) {
    d = new Date(value);
  }
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * True when `value` is a calendar day strictly before today (local time).
 *
 * A document expiring *today* is still valid today, which is why this is a
 * strict comparison — it preserves the intent of the `< todayStr` checks it
 * replaces.
 */
export function isExpired(value) {
  const day = toCalendarDay(value);
  if (day === null) return false;
  return day < toCalendarDay(new Date());
}

/**
 * True when `value` is on or before the reference day (e.g. a dispatch's travel
 * date). Used to block a future trip when a document (registration, insurance,
 * license) will no longer be valid on the day of travel — the same projection
 * number coding applies via `pickup_at`. When the reference is unparseable,
 * falls back to today's rule (strictly-before-today).
 */
export function isExpiredOn(value, reference) {
  const day = toCalendarDay(value);
  if (day === null) return false;
  const ref = toCalendarDay(reference);
  if (ref === null) return isExpired(value);
  return day <= ref;
}

/**
 * Renders a bare "YYYY-MM-DD" calendar day for display, without a timezone
 * round-trip.
 *
 * formatDate in @/lib/utils does `new Date(value)`, and for a ten-character
 * string that is parsed as UTC midnight per the ECMAScript date-time string
 * format. Intl then renders it in the *local* zone. At UTC+8 that lands at
 * 08:00 the same day and reads correctly, which is why the existing pairing
 * works today — but at any negative offset it lands the previous evening and
 * the day printed is one behind the day stored. A calendar day carries no
 * instant, so it must never be routed through one.
 *
 * The components are split out and handed to a local Date, which pins the value
 * to the day it names in whatever zone the browser is in.
 *
 * @returns {string} the formatted day, or "—" when the value is not a day
 */
export function formatCalendarDate(value, options = {}) {
  const day = toCalendarDay(value);
  if (day === null) return "—";
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(new Date(y, m - 1, d));
}
