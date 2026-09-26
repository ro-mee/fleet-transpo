import { describe, it, expect } from "vitest";
import { endDutyWindow, END_DUTY_LEAD_MINUTES } from "./end-duty";

// A fixed reference day so every case is stated as an offset from the same
// clock, not from whenever the suite happens to run.
const at = (h, m = 0, s = 0) => new Date(2026, 8, 23, h, m, s);

describe("endDutyWindow", () => {
  it("defaults the lead to 30 minutes", () => {
    expect(END_DUTY_LEAD_MINUTES).toBe(30);
  });

  it("is not due well before the window opens", () => {
    expect(endDutyWindow({ now: at(8), shiftEnd: "22:00:00" })).toEqual({
      due: false,
      minsToEnd: 840,
    });
  });

  // The boundary, both sides, stated to the minute.
  it("is due exactly at the lead time", () => {
    expect(endDutyWindow({ now: at(21, 30), shiftEnd: "22:00:00" }).due).toBe(true);
  });

  it("is not due one minute earlier", () => {
    expect(endDutyWindow({ now: at(21, 29), shiftEnd: "22:00:00" }).due).toBe(false);
  });

  // The predicate is exact to the millisecond, pinned from both sides of the
  // instant the window opens (21:30:00.000).
  it("is not due one millisecond before the window opens", () => {
    const now = new Date(at(21, 30).getTime() - 1);
    expect(endDutyWindow({ now, shiftEnd: "22:00:00" }).due).toBe(false);
  });

  it("is due one millisecond after the window opens", () => {
    const now = new Date(at(21, 30).getTime() + 1);
    expect(endDutyWindow({ now, shiftEnd: "22:00:00" }).due).toBe(true);
  });

  it("is due at the shift end", () => {
    expect(endDutyWindow({ now: at(22), shiftEnd: "22:00:00" })).toEqual({
      due: true,
      minsToEnd: 0,
    });
  });

  // The reason the window does not close: a late driver still owes a report, and
  // this is the only route that ends duty.
  it("stays due after the shift end, reporting a negative remainder", () => {
    expect(endDutyWindow({ now: at(23, 15), shiftEnd: "22:00:00" })).toEqual({
      due: true,
      minsToEnd: -75,
    });
  });

  it("accepts HH:MM as well as the TIME column's HH:MM:SS", () => {
    expect(endDutyWindow({ now: at(21, 40), shiftEnd: "22:00" }).due).toBe(true);
  });

  it("honours a caller-supplied lead", () => {
    expect(endDutyWindow({ now: at(21), shiftEnd: "22:00:00", leadMinutes: 60 }).due).toBe(true);
    expect(endDutyWindow({ now: at(21), shiftEnd: "22:00:00", leadMinutes: 10 }).due).toBe(false);
  });

  // Unknown must never render as a deadline: with no usable shift end there is
  // no basis for telling a driver a report is owed.
  it.each([
    ["a missing shift end", undefined],
    ["a null shift end", null],
    ["an empty string", ""],
    ["prose", "not a time"],
    ["an out-of-range hour", "24:00:00"],
    ["an out-of-range minute", "22:60:00"],
  ])("fails quiet on %s", (_label, shiftEnd) => {
    expect(endDutyWindow({ now: at(21, 45), shiftEnd })).toEqual({ due: false, minsToEnd: null });
  });

  it("fails quiet on an unusable now", () => {
    expect(endDutyWindow({ now: new Date("nope"), shiftEnd: "22:00:00" })).toEqual({
      due: false,
      minsToEnd: null,
    });
  });

  it("accepts an epoch-millisecond now", () => {
    expect(endDutyWindow({ now: at(21, 45).getTime(), shiftEnd: "22:00:00" }).due).toBe(true);
  });
});
