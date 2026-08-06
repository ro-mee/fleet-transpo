import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(new Date(date));
}

export function formatDateTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
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
