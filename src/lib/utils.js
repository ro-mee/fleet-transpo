import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatDate(date, options = {}) {
  const parsed = toDateOrNull(date);
  if (!parsed) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(parsed);
}

/**
 * Nullable timestamp → Date, or null.
 *
 * `new Date(null)` is the EPOCH, not "no value", and `Intl.format(new Date(NaN))`
 * throws "Invalid time value". Every formatter below goes through this, so a
 * nullable column (a cancelled trip that never started has NULL start_time and
 * end_time — the live data has three) renders as "—" instead of "Jan 1, 1970,
 * 8:00 AM", which is a plausible-looking timestamp for something that never
 * happened. `0` is rejected too: it is the same epoch by another name.
 */
function toDateOrNull(value) {
  // `0` is rejected alongside the nullish values: it is the epoch by another
  // name, and no caller in this app has a legitimate timestamp of 0.
  if (value === null || value === undefined || value === "" || value === 0) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTime(date) {
  const parsed = toDateOrNull(date);
  if (!parsed) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function formatTime(date) {
  const parsed = toDateOrNull(date);
  if (!parsed) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function formatCurrency(amount, currency = "PHP") {
  const num = Number(amount);
  const valid = isNaN(num) || num == null ? 0 : num;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
  }).format(valid);
}

export function formatNumber(number) {
  const num = Number(number);
  const valid = isNaN(num) || num == null ? 0 : num;
  return new Intl.NumberFormat("en-US").format(valid);
}

export function formatDistance(km) {
  const num = Number(km);
  const valid = isNaN(num) || num == null ? 0 : num;
  if (valid < 1) return `${Math.round(valid * 1000)} m`;
  return `${valid.toFixed(1)} km`;
}

export function formatDuration(minutes) {
  const num = Number(minutes);
  const valid = isNaN(num) || num == null ? 0 : num;
  const hours = Math.floor(valid / 60);
  const mins = Math.round(valid % 60);
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function getInitials(name) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncate(str, length = 50) {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

export function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural || singular + "s";
}
