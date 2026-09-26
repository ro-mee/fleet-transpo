import { describe, it, expect } from "vitest";
import {
  crossedEndDutyThreshold,
  minutesPastShiftEnd,
  dutyDayKey,
  END_DUTY_GRACE_MINUTES,
  END_DUTY_OVERDUE_MINUTES,
} from "./end-duty-thresholds";

/** A Manila instant, written as UTC so the test does not depend on the runner's zone. */
const manila = (day, hhmm) => new Date(`${day}T${hhmm}:00+08:00`);

describe("minutesPastShiftEnd", () => {
  it("measures from the duty's own shift end, not from midnight", () => {
    // Shift ended 17:00 on the 24th; it is now 18:30 on the 24th.
    expect(minutesPastShiftEnd({
      dutyDate: "2026-09-24",
      shiftEnd: "17:00:00",
      now: manila("2026-09-24", "18:30"),
    })).toBe(90);
  });

  it("goes negative before the shift ends — the caller's null comes from the threshold, not from here", () => {
    expect(minutesPastShiftEnd({
      dutyDate: "2026-09-24",
      shiftEnd: "17:00:00",
      now: manila("2026-09-24", "16:00"),
    })).toBe(-60);
  });

  it("carries across midnight, so a late shift is still measured from its own day", () => {
    // Shift ended 23:00 on the 24th; it is 00:15 on the 25th. This is the case a
    // minutes-since-midnight implementation gets wrong, and the reason the duty
    // date is an argument rather than inferred from `now`.
    expect(minutesPastShiftEnd({
      dutyDate: "2026-09-24",
      shiftEnd: "23:00:00",
      now: manila("2026-09-25", "00:15"),
    })).toBe(75);
  });

  it("returns null for an unusable roster time rather than inventing a deadline", () => {
    for (const shiftEnd of [null, "", "not-a-time", "25:00", "17:70"]) {
      expect(minutesPastShiftEnd({
        dutyDate: "2026-09-24", shiftEnd, now: manila("2026-09-24", "18:00"),
      })).toBeNull();
    }
  });

  it("returns null for an unusable duty date", () => {
    expect(minutesPastShiftEnd({
      dutyDate: "nonsense", shiftEnd: "17:00:00", now: manila("2026-09-24", "18:00"),
    })).toBeNull();
  });
});

describe("crossedEndDutyThreshold", () => {
  const args = (hhmm) => ({
    dutyDate: "2026-09-24", shiftEnd: "17:00:00", now: manila("2026-09-24", hhmm),
  });

  it("says nothing while the shift is still running — including exactly at the end", () => {
    expect(crossedEndDutyThreshold(args("16:59"))).toBeNull();
    expect(crossedEndDutyThreshold(args("17:00"))).toBeNull();
  });

  it("stays quiet through the grace period — a driver still driving home has not forgotten", () => {
    expect(crossedEndDutyThreshold(args("17:29"))).toBeNull();
  });

  it("fires the quiet stage exactly at the grace boundary", () => {
    expect(END_DUTY_GRACE_MINUTES).toBe(30);
    expect(crossedEndDutyThreshold(args("17:30"))).toBe("reminder");
  });

  it("fires the loud stage exactly at the overdue boundary", () => {
    expect(END_DUTY_OVERDUE_MINUTES).toBe(120);
    expect(crossedEndDutyThreshold(args("19:00"))).toBe("overdue");
  });

  it("jumps straight to overdue — a scan that slept through the grace mark never sends it late", () => {
    expect(crossedEndDutyThreshold(args("21:45"))).toBe("overdue");
  });

  it("treats the two boundaries as distinct events, not as one already-passed state", () => {
    const quiet = crossedEndDutyThreshold(args("18:00"));
    const loud = crossedEndDutyThreshold(args("19:30"));
    expect(quiet).toBe("reminder");
    expect(loud).toBe("overdue");
  });

  it("fails quiet on an unusable roster time", () => {
    expect(crossedEndDutyThreshold({
      dutyDate: "2026-09-24", shiftEnd: null, now: manila("2026-09-24", "20:00"),
    })).toBeNull();
  });
});

describe("dutyDayKey", () => {
  it("is the duty date as YYYYMMDD — the per-day half of the dedupe key", () => {
    expect(dutyDayKey("2026-09-24")).toBe(20260924);
  });

  it("gives consecutive days different keys", () => {
    // The whole reason reference_id is not a constant: a stable reference_id
    // would dedupe every day after the first into silence.
    expect(dutyDayKey("2026-09-24")).not.toBe(dutyDayKey("2026-09-25"));
  });

  it("reads a Date in Manila terms, not the runner's zone", () => {
    expect(dutyDayKey(new Date("2026-09-24T16:00:00Z"))).toBe(20260925); // 00:00 on the 25th in Manila
  });
});
