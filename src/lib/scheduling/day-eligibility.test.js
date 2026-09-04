import { describe, it, expect } from "vitest";
import { driverDayEligibility } from "@/lib/scheduling/day-eligibility";

// Local-time Date helpers (same convention as driver-schedule.test.js).
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);

// Monday 2026-08-17.
const shift = {
  day_of_week: 1,
  shift_start: "08:00:00",
  shift_end: "17:00:00",
  break_start: "12:00:00",
  break_end: "13:00:00",
  is_rest_day: false,
};

const ctxWith = ({ schedules = new Map(), leave = new Map() } = {}) => ({
  schedules,
  leave,
});

const schedCtx = (driverId, row) => {
  const dayMap = new Map();
  if (row) dayMap.set(1, row);
  return ctxWith({ schedules: new Map([[driverId, dayMap]]) });
};

describe("driverDayEligibility", () => {
  it("blocks a driver with no schedule row, without testing containment", () => {
    const r = driverDayEligibility({ driverId: 7, date: at(2026, 8, 17), ctx: schedCtx(7, null) });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("No work schedule configured.");
    expect(r.duty).toBeNull();
  });

  it("blocks a rest-day row", () => {
    const r = driverDayEligibility({
      driverId: 7,
      date: at(2026, 8, 17),
      ctx: schedCtx(7, { ...shift, is_rest_day: true }),
    });
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain("rest day");
  });

  it("blocks approved full-day leave touching the date", () => {
    const ctx = schedCtx(7, shift);
    ctx.leave.set(7, [{ status: "Approved", start_date: "2026-08-16", end_date: "2026-08-18" }]);
    const r = driverDayEligibility({ driverId: 7, date: at(2026, 8, 17), ctx });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("Driver is on approved leave.");
  });

  it("blocks approved TIMED leave touching the date (no silent partial availability)", () => {
    const ctx = schedCtx(7, shift);
    ctx.leave.set(7, [{
      status: "Approved",
      start_date: "2026-08-17",
      end_date: "2026-08-17",
      start_time: "12:00:00",
      end_time: "13:00:00",
    }]);
    const r = driverDayEligibility({ driverId: 7, date: at(2026, 8, 17), ctx });
    expect(r.blocked).toBe(true);
  });

  it("does not block pending leave", () => {
    const ctx = schedCtx(7, shift);
    ctx.leave.set(7, [{ status: "Pending", start_date: "2026-08-17", end_date: "2026-08-17" }]);
    const r = driverDayEligibility({ driverId: 7, date: at(2026, 8, 17), ctx });
    expect(r.blocked).toBe(false);
  });

  it("passes a normal shift day WITHOUT containment and returns the duty window", () => {
    // A full-day review that containment would reject must pass here.
    const r = driverDayEligibility({ driverId: 7, date: at(2026, 8, 17), ctx: schedCtx(7, shift) });
    expect(r.blocked).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.duty).toEqual({ start: "08:00:00", end: "17:00:00" });
  });

  it("fails open when no schedule context was ever loaded", () => {
    const r = driverDayEligibility({ driverId: 7, date: at(2026, 8, 17), ctx: null });
    expect(r.blocked).toBe(false);
  });

  it("ignores other drivers' rows and leave", () => {
    const ctx = schedCtx(8, shift);
    ctx.leave.set(8, [{ status: "Approved", start_date: "2026-08-17", end_date: "2026-08-17" }]);
    const r = driverDayEligibility({ driverId: 7, date: at(2026, 8, 17), ctx });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("No work schedule configured.");
  });
});
