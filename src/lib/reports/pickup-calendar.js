import { manilaDateKey } from "@/lib/dates";

/** Intake uses creation time, never the scheduled pickup as a substitute. */
export function requestCreatedDay(request) {
  const value = request.created_at;
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
  }
  return manilaDateKey(value);
}

export function buildPickupCalendar(requests, today = manilaDateKey()) {
  const [year, monthNumber] = today.split("-").map(Number);
  const month = monthNumber - 1;
  const monthKey = today.slice(0, 7);
  const firstDay = new Date(Date.UTC(year, month, 1));
  const totalDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const previousDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const requestsByDay = new Map();
  let undatedRequests = 0;

  for (const request of requests) {
    const key = requestCreatedDay(request);
    if (!key) {
      undatedRequests += 1;
      continue;
    }
    if (!key.startsWith(`${monthKey}-`)) continue;
    if (!requestsByDay.has(key)) requestsByDay.set(key, []);
    requestsByDay.get(key).push(request);
  }
  for (const rows of requestsByDay.values()) {
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || Number(a.request_id) - Number(b.request_id));
  }

  const days = [];
  for (let offset = firstDay.getUTCDay() - 1; offset >= 0; offset--) {
    days.push({ id: `prev-${offset}`, dayNumber: previousDays - offset, isPadding: true });
  }
  let maxCount = 0;
  let peakDayNum = null;
  let totalMonthlyRequests = 0;
  for (let dayNumber = 1; dayNumber <= totalDays; dayNumber++) {
    const dateStr = `${monthKey}-${String(dayNumber).padStart(2, "0")}`;
    const rows = requestsByDay.get(dateStr) || [];
    totalMonthlyRequests += rows.length;
    if (rows.length > maxCount) {
      maxCount = rows.length;
      peakDayNum = dayNumber;
    }
    days.push({ id: dateStr, dateStr, dayNumber, requests: rows, count: rows.length, isToday: dateStr === today });
  }
  const remaining = (7 - (days.length % 7)) % 7;
  for (let dayNumber = 1; dayNumber <= remaining; dayNumber++) {
    days.push({ id: `next-${dayNumber}`, dayNumber, isPadding: true });
  }
  return {
    days,
    monthKey,
    monthName: firstDay.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" }),
    totalMonthlyRequests,
    maxCount,
    peakDayNum,
    avgDaily: (totalMonthlyRequests / totalDays).toFixed(1),
    undatedRequests,
  };
}
