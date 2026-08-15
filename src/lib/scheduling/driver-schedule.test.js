import { describe, it, expect } from "vitest";
import {
  DAY_NAMES,
  localDayOfWeek,
  localTimeOfDay,
  hasApprovedLeave,
  scheduleBlockReason,
  driverBlockReason,
} from "@/lib/scheduling/driver-schedule";

// Local-time Date helpers. The helper reads the wall clock off the Date with
// local getters, so these constructors are what the codebase actually receives
// (pg timestamptz -> JS Date, rendered in the server's zone).
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);

describe("localDayOfWeek / localTimeOfDay", () => {
  it("reads local day-of-week (0=Sunday)", () => {
    // 2026-08-16 is a Sunday.
    expect(localDayOfWeek(at(2026, 8, 16))).toBe(0);
    expect(localDayOfWeek(at(2026, 8, 17))).toBe(1);
  });
  it("reads local wall-clock time as HH:MM:SS", () => {
    expect(localTimeOfDay(at(2026, 8, 17, 9, 5))).toBe("09:05:00");
  });
});

describe("hasApprovedLeave", () => {
  const leave = [{ start_date: "2026-08-18", end_date: "2026-08-20" }];
  it("covers an in-range calendar day", () => {
    expect(hasApprovedLeave(leave, at(2026, 8, 19, 10))).toBe(true);
  });
  it("covers the inclusive endpoints", () => {
    expect(hasApprovedLeave(leave, at(2026, 8, 18, 1))).toBe(true);
    expect(hasApprovedLeave(leave, at(2026, 8, 20, 23))).toBe(true);
  });
  it("does not cover days outside the range", () => {
    expect(hasApprovedLeave(leave, at(2026, 8, 17, 10))).toBe(false);
    expect(hasApprovedLeave(leave, at(2026, 8, 21, 10))).toBe(false);
  });
  it("accepts camelCase date fields and pg local-midnight Date values", () => {
    const camel = [{ startDate: "2026-08-18", endDate: "2026-08-20" }];
    expect(hasApprovedLeave(camel, at(2026, 8, 19))).toBe(true);
    const pgDate = [{ start_date: new Date(2026, 7, 18), end_date: new Date(2026, 7, 20) }];
    expect(hasApprovedLeave(pgDate, at(2026, 8, 19))).toBe(true);
  });
});

describe("scheduleBlockReason", () => {
  // Monday 2026-08-17, shift 08:00–17:00, break 12:00–13:00.
  const shift = {
    day_of_week: 1,
    shift_start: "08:00:00",
    shift_end: "17:00:00",
    break_start: "12:00:00",
    break_end: "13:00:00",
    is_rest_day: false,
  };

  it("blocks a driver with no schedule row (fail-closed)", () => {
    const r = scheduleBlockReason({ schedule: null, pickup: at(2026, 8, 17, 10) });
    expect(r).toEqual({ blocked: true, reason: "No work schedule on file for this day." });
  });

  it("blocks a rest-day row", () => {
    const r = scheduleBlockReason({
      schedule: { ...shift, is_rest_day: true, shift_start: "00:00:00", shift_end: "00:00:00" },
      pickup: at(2026, 8, 17, 10),
    });
    expect(r).toEqual({ blocked: true, reason: "Rest day (Monday)." });
  });

  it("allows a window fully inside the shift", () => {
    expect(scheduleBlockReason({ schedule: shift, pickup: at(2026, 8, 17, 11), returnAt: at(2026, 8, 17, 12) })).toBeNull();
  });

  it("allows a trip starting exactly at shift start", () => {
    expect(scheduleBlockReason({ schedule: shift, pickup: at(2026, 8, 17, 8), returnAt: at(2026, 8, 17, 9) })).toBeNull();
  });

  it("allows a trip ending exactly at shift end", () => {
    expect(scheduleBlockReason({ schedule: shift, pickup: at(2026, 8, 17, 16), returnAt: at(2026, 8, 17, 17) })).toBeNull();
  });

  it("blocks a window that starts before the shift", () => {
    const r = scheduleBlockReason({ schedule: shift, pickup: at(2026, 8, 17, 7, 30), returnAt: at(2026, 8, 17, 9) });
    expect(r).toMatchObject({ blocked: true });
    expect(r.reason).toContain("Outside work shift");
  });

  it("blocks a window that ends after the shift", () => {
    const r = scheduleBlockReason({ schedule: shift, pickup: at(2026, 8, 17, 16, 30), returnAt: at(2026, 8, 17, 17, 30) });
    expect(r).toMatchObject({ blocked: true });
    expect(r.reason).toContain("Outside work shift");
  });

  it("blocks a window overlapping the break", () => {
    const r = scheduleBlockReason({ schedule: shift, pickup: at(2026, 8, 17, 11, 30), returnAt: at(2026, 8, 17, 12, 30) });
    expect(r).toMatchObject({ blocked: true });
    expect(r.reason).toContain("lunch/break");
  });

  it("does not block a window that just touches the break edge (half-open)", () => {
    // Break 12:00–13:00; trip 11:00–12:00 ends exactly as the break starts.
    expect(scheduleBlockReason({ schedule: shift, pickup: at(2026, 8, 17, 11), returnAt: at(2026, 8, 17, 12) })).toBeNull();
    // Trip 13:00–14:00 starts exactly as the break ends.
    expect(scheduleBlockReason({ schedule: shift, pickup: at(2026, 8, 17, 13), returnAt: at(2026, 8, 17, 14) })).toBeNull();
  });

  it("does not block when no pickup window is known", () => {
    expect(scheduleBlockReason({ schedule: null, pickup: null })).toBeNull();
  });

  it("defaults return to pickup when only pickup is given", () => {
    expect(scheduleBlockReason({ schedule: shift, pickup: at(2026, 8, 17, 10) })).toBeNull();
  });
});

describe("driverBlockReason", () => {
  const ctx = {
    schedules: new Map([
      [1, new Map([[1, { shift_start: "08:00:00", shift_end: "17:00:00", is_rest_day: false }]])],
      [2, new Map([[1, { day_of_week: 1, is_rest_day: true }]])],
    ]),
    leave: new Map([[3, [{ start_date: "2026-08-17", end_date: "2026-08-17" }]]]),
  };

  it("returns null when no pickup is provided (no window to test)", () => {
    expect(driverBlockReason({ driverId: 1, pickup: null, ctx })).toBeNull();
  });

  it("blocks an approved-leave driver even with a valid schedule", () => {
    const r = driverBlockReason({
      driverId: 3,
      pickup: at(2026, 8, 17, 10),
      returnAt: at(2026, 8, 17, 11),
      ctx,
    });
    expect(r).toEqual({ blocked: true, reason: "Driver is on approved leave for this date." });
  });

  it("blocks a driver with no schedule for that weekday (fail-closed)", () => {
    const r = driverBlockReason({ driverId: 9, pickup: at(2026, 8, 17, 10), ctx });
    expect(r).toEqual({ blocked: true, reason: "No work schedule on file for this day." });
  });

  it("blocks a rest-day driver", () => {
    const r = driverBlockReason({ driverId: 2, pickup: at(2026, 8, 17, 10), ctx });
    expect(r).toEqual({ blocked: true, reason: "Rest day (Monday)." });
  });

  it("allows a driver inside their shift with no leave", () => {
    expect(driverBlockReason({ driverId: 1, pickup: at(2026, 8, 17, 10), returnAt: at(2026, 8, 17, 11), ctx })).toBeNull();
  });
});