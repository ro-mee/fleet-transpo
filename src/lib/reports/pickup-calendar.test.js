import { describe, expect, it } from "vitest";
import { buildPickupCalendar, requestCreatedDay } from "./pickup-calendar";

const today = "2026-10-09";
const request = (request_id, created_at, extra = {}) => ({ request_id, created_at, ...extra });
const date = (calendar, key) => calendar.days.find((day) => day.dateStr === key);

describe("pickup intake calendar", () => {
  it("keeps every request behind its matching daily count and sorts newest first", () => {
    const rows = [request(1, "2026-10-02T01:00:00Z"), request(2, "2026-10-02T02:00:00Z"), request(3, "2026-10-03T01:00:00Z")];
    const calendar = buildPickupCalendar(rows, today);
    expect(date(calendar, "2026-10-02").requests.map((row) => row.request_id)).toEqual([2, 1]);
    expect(date(calendar, "2026-10-02").count).toBe(2);
    expect(date(calendar, "2026-10-03").count).toBe(1);
    expect(calendar.totalMonthlyRequests).toBe(3);
    expect(calendar.maxCount).toBe(2);
    expect(calendar.peakDayNum).toBe(2);
    expect(calendar.avgDaily).toBe("0.1");
    expect(calendar.days.filter((day) => !day.isPadding).every((day) => day.count === day.requests.length)).toBe(true);
    expect(rows.map((row) => row.request_id)).toEqual([1, 2, 3]);
  });

  it("groups intake by Manila creation date, separately from scheduled pickup", () => {
    const calendar = buildPickupCalendar([
      request(1, "2026-09-30T16:00:00Z", { pickup_datetime: "2026-10-20T02:00:00Z" }),
      request(2, "2026-10-01T15:59:59Z"),
      request(3, "2026-10-01T16:00:00Z"),
      request(4, "2026-10-31T16:00:00Z"),
    ], today);
    expect(date(calendar, "2026-10-01").count).toBe(2);
    expect(date(calendar, "2026-10-02").requests.map((row) => row.request_id)).toEqual([3]);
    expect(date(calendar, "2026-10-20").count).toBe(0);
    expect(calendar.totalMonthlyRequests).toBe(3);
  });

  it("does not invent creation dates from missing/invalid values or pickup time", () => {
    const calendar = buildPickupCalendar([
      request(1, null, { pickup_datetime: "2026-10-02T01:00:00Z" }),
      request(2, "not a date"), request(3, "2026-02-31"), request(4, "2026-10-02"),
    ], today);
    expect(calendar.undatedRequests).toBe(3);
    expect(calendar.totalMonthlyRequests).toBe(1);
    expect(date(calendar, "2026-10-02").requests.map((row) => row.request_id)).toEqual([4]);
    expect(requestCreatedDay({ pickup_datetime: "2026-10-02" })).toBeNull();
  });

  it("builds complete weeks and marks today without making padding into request days", () => {
    const calendar = buildPickupCalendar([], today);
    expect(calendar.monthName).toBe("October 2026");
    expect(calendar.days).toHaveLength(35);
    expect(calendar.days.slice(0, 4).map((day) => day.dayNumber)).toEqual([27, 28, 29, 30]);
    expect(calendar.days.filter((day) => day.isToday).map((day) => day.dateStr)).toEqual([today]);
    expect(calendar.maxCount).toBe(0);
    expect(calendar.peakDayNum).toBeNull();
    expect(calendar.avgDaily).toBe("0.0");
    expect(calendar.days.filter((day) => day.isPadding).every((day) => day.requests === undefined)).toBe(true);
  });

  it("handles leap days, trailing padding and a month that starts on Sunday", () => {
    expect(buildPickupCalendar([], "2028-02-29").days.filter((day) => !day.isPadding)).toHaveLength(29);
    const sunday = buildPickupCalendar([], "2026-11-01");
    expect(sunday.days[0].dateStr).toBe("2026-11-01");
    expect(sunday.days).toHaveLength(35);
    expect(sunday.days.at(-1)).toMatchObject({ dayNumber: 5, isPadding: true });
  });
});
