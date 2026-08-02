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
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
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
