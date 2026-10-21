import { BUCKET_LABEL, IN_PROGRESS, bucketOf, groupTrips, isOverdue } from "./trips-queue";

export const TRIP_TABS = [
  { id: "today", label: "Today", empty: "No trips scheduled today", body: "Your assignments for today will appear here." },
  { id: "upcoming", label: "Upcoming", empty: "No upcoming trips", body: "Trips for tomorrow and later will appear here." },
  { id: "history", label: "History", empty: "No trip history yet", body: "Your completed and cancelled trips will appear here." },
];

const DATE_OPTIONS = { timeZone: "Asia/Manila" };

export function scheduleDay(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { ...DATE_OPTIONS, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name) => parts.find((p) => p.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function tripDisplay(trip, now) {
  if (!["Completed", "Cancelled"].includes(trip.trip_status) && !IN_PROGRESS.includes(trip.trip_status) && !scheduleDay(trip.departure_time)) return BUCKET_LABEL.scheduleUnconfirmed;
  return BUCKET_LABEL[isOverdue(trip, now) ? "overdue" : bucketOf(trip, now)];
}

// Reclassify saved rows too: yesterday's upcoming snapshot is not today's scope.
export function scheduleSections(trips, tab, now) {
  const today = scheduleDay(now);
  const visible = trips.filter((trip) => {
    const terminal = ["Completed", "Cancelled"].includes(trip.trip_status);
    if (tab === "history") return terminal;
    if (terminal) return false;
    const date = scheduleDay(trip.departure_time);
    const underway = IN_PROGRESS.includes(trip.trip_status);
    return tab === "today" ? underway || !date || date <= today : !underway && date > today;
  });
  if (tab === "today") {
    const undated = visible.filter((trip) => !scheduleDay(trip.departure_time) && !IN_PROGRESS.includes(trip.trip_status));
    const sections = groupTrips(visible.filter((trip) => !undated.includes(trip)), now).map((section) => ({
      ...section,
      label: ({ inProgress: "In progress", overdue: "Needs attention", ready: "Departure window open", scheduleUnconfirmed: "Schedule to confirm", upcoming: "Later today" })[section.bucket] || section.label,
    }));
    if (undated.length) sections.push({ bucket: "undated", label: "Date to confirm", items: undated });
    return sections;
  }
  if (tab === "history") {
    const time = (trip) => new Date((trip.trip_status === "Cancelled" ? trip.updated_at : trip.end_time) || trip.departure_time || trip.start_time || trip.created_at || 0).getTime() || 0;
    return visible.length ? [{ bucket: "history", label: "Recent trips", items: [...visible].sort((a, b) => time(b) - time(a) || b.trip_id - a.trip_id) }] : [];
  }
  const tomorrow = scheduleDay(now + 86400000);
  const groups = new Map();
  [...visible].sort((a, b) => new Date(a.departure_time) - new Date(b.departure_time) || a.trip_id - b.trip_id).forEach((trip) => {
    const day = scheduleDay(trip.departure_time);
    if (!groups.has(day)) groups.set(day, {
      bucket: day,
      label: day === tomorrow ? "Tomorrow" : new Date(trip.departure_time).toLocaleDateString("en-US", { ...DATE_OPTIONS, weekday: "short", month: "short", day: "numeric", ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) }),
      items: [],
    });
    groups.get(day).items.push(trip);
  });
  return [...groups.values()];
}
