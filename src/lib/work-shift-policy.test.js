import { describe, it, expect } from "vitest";
import {
  DEFAULT_WORK_SHIFT_POLICY,
  DEFAULT_BREAK_SLOTS,
  normalizeTime,
  validateWorkShiftPolicy,
  mergeWorkShiftPolicy,
  buildDriverWeeklySchedule,
} from "./work-shift-policy";

describe("work-shift-policy", () => {
  describe("normalizeTime", () => {
    it("handles standard 24h times", () => {
      expect(normalizeTime("06:00")).toBe("06:00");
      expect(normalizeTime("22:00")).toBe("22:00");
      expect(normalizeTime("6:00")).toBe("06:00");
      expect(normalizeTime("06:00:00")).toBe("06:00");
    });

    it("returns fallback for invalid times", () => {
      expect(normalizeTime("25:00", "00:00")).toBe("00:00");
      expect(normalizeTime("not-a-time", "default")).toBe("default");
      expect(normalizeTime(null, "fallback")).toBe("fallback");
    });
  });

  describe("validateWorkShiftPolicy", () => {
    it("accepts default policy", () => {
      expect(validateWorkShiftPolicy(DEFAULT_WORK_SHIFT_POLICY)).toEqual({ ok: true });
    });

    it("accepts valid custom shift and break times", () => {
      expect(
        validateWorkShiftPolicy({
          shiftStart: "08:00",
          shiftEnd: "17:00",
          breakStart: "12:00",
          breakEnd: "13:00",
          workingDays: [1, 2, 3, 4, 5],
        })
      ).toEqual({ ok: true });
    });

    it("accepts shift without break times", () => {
      expect(
        validateWorkShiftPolicy({
          shiftStart: "08:00",
          shiftEnd: "17:00",
          breakStart: null,
          breakEnd: null,
          workingDays: [1, 2, 3],
        })
      ).toEqual({ ok: true });
    });

    it("rejects non-object", () => {
      expect(validateWorkShiftPolicy(null).ok).toBe(false);
      expect(validateWorkShiftPolicy("string").ok).toBe(false);
    });

    it("rejects shiftEnd <= shiftStart", () => {
      const res = validateWorkShiftPolicy({ shiftStart: "18:00", shiftEnd: "08:00" });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Shift end time must be after shift start time");
    });

    it("rejects lone breakStart or lone breakEnd", () => {
      const res = validateWorkShiftPolicy({
        shiftStart: "08:00",
        shiftEnd: "17:00",
        breakStart: "12:00",
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Provide both break start and break end");
    });

    it("rejects break outside shift boundaries", () => {
      const res = validateWorkShiftPolicy({
        shiftStart: "08:00",
        shiftEnd: "17:00",
        breakStart: "18:00",
        breakEnd: "19:00",
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Break period must sit within the shift hours");
    });

    it("rejects empty workingDays array", () => {
      const res = validateWorkShiftPolicy({
        shiftStart: "08:00",
        shiftEnd: "17:00",
        workingDays: [],
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Select at least one active working day");
    });
  });

  describe("mergeWorkShiftPolicy", () => {
    it("returns defaults when input is empty or null", () => {
      expect(mergeWorkShiftPolicy(null)).toEqual(DEFAULT_WORK_SHIFT_POLICY);
      expect(mergeWorkShiftPolicy({})).toEqual(DEFAULT_WORK_SHIFT_POLICY);
    });

    it("overrides fields cleanly and normalizes weekdays", () => {
      const merged = mergeWorkShiftPolicy({
        shiftStart: "07:30",
        shiftEnd: "19:30",
        breakStart: "12:30",
        breakEnd: "13:30",
        workingDays: [5, 1, 2, 3, 4],
        label: "Daylight Operations",
      });
      expect(merged).toEqual({
        shiftStart: "07:30",
        shiftEnd: "19:30",
        breakStart: "12:30",
        breakEnd: "13:30",
        workingDays: [1, 2, 3, 4, 5],
        staggerBreaks: true,
        staggerRestDays: true,
        breakSlots: DEFAULT_BREAK_SLOTS,
        label: "Daylight Operations",
      });
    });

    it("resets invalid break times safely", () => {
      const merged = mergeWorkShiftPolicy({
        shiftStart: "06:00",
        shiftEnd: "22:00",
        breakStart: "23:00",
        breakEnd: "23:30",
      });
      expect(merged.breakStart).toBe("12:00");
      expect(merged.breakEnd).toBe("13:00");
    });
  });

  describe("buildDriverWeeklySchedule", () => {
    it("staggers lunch breaks in round-robin across drivers", () => {
      // Test with staggerRestDays: false so all drivers share the same working days
      const s0 = buildDriverWeeklySchedule(DEFAULT_WORK_SHIFT_POLICY, 0, { staggerBreaks: true, staggerRestDays: false });
      const s1 = buildDriverWeeklySchedule(DEFAULT_WORK_SHIFT_POLICY, 1, { staggerBreaks: true, staggerRestDays: false });
      const s2 = buildDriverWeeklySchedule(DEFAULT_WORK_SHIFT_POLICY, 2, { staggerBreaks: true, staggerRestDays: false });
      const s3 = buildDriverWeeklySchedule(DEFAULT_WORK_SHIFT_POLICY, 3, { staggerBreaks: true, staggerRestDays: false });
      const s4 = buildDriverWeeklySchedule(DEFAULT_WORK_SHIFT_POLICY, 4, { staggerBreaks: true, staggerRestDays: false });

      // Find an active working day (e.g. Wednesday = 3)
      expect(s0.find((d) => d.day_of_week === 3).break_start).toBe("11:30:00");
      expect(s1.find((d) => d.day_of_week === 3).break_start).toBe("12:00:00");
      expect(s2.find((d) => d.day_of_week === 3).break_start).toBe("12:30:00");
      expect(s3.find((d) => d.day_of_week === 3).break_start).toBe("13:00:00");
      // Wraps around to first slot
      expect(s4.find((d) => d.day_of_week === 3).break_start).toBe("11:30:00");
    });

    it("staggers rest days across the 7 weekdays so every day has active drivers", () => {
      const s0 = buildDriverWeeklySchedule(DEFAULT_WORK_SHIFT_POLICY, 0, { staggerRestDays: true });
      const s1 = buildDriverWeeklySchedule(DEFAULT_WORK_SHIFT_POLICY, 1, { staggerRestDays: true });
      const s2 = buildDriverWeeklySchedule(DEFAULT_WORK_SHIFT_POLICY, 2, { staggerRestDays: true });

      // Driver 0 rests Sunday (0)
      expect(s0.find((d) => d.day_of_week === 0).is_rest_day).toBe(true);
      expect(s0.find((d) => d.day_of_week === 1).is_rest_day).toBe(false);

      // Driver 1 rests Monday (1)
      expect(s1.find((d) => d.day_of_week === 0).is_rest_day).toBe(false);
      expect(s1.find((d) => d.day_of_week === 1).is_rest_day).toBe(true);

      // Driver 2 rests Tuesday (2)
      expect(s2.find((d) => d.day_of_week === 1).is_rest_day).toBe(false);
      expect(s2.find((d) => d.day_of_week === 2).is_rest_day).toBe(true);
    });

    it("uses uniform schedule when staggering is disabled", () => {
      const schedule = buildDriverWeeklySchedule(DEFAULT_WORK_SHIFT_POLICY, 2, {
        staggerBreaks: false,
        staggerRestDays: false,
      });

      // Break should be default 12:00 - 13:00
      expect(schedule.find((d) => d.day_of_week === 3).break_start).toBe("12:00:00");
      // Sunday (0) is rest day per policy.workingDays [1, 2, 3, 4, 5, 6]
      expect(schedule.find((d) => d.day_of_week === 0).is_rest_day).toBe(true);
      expect(schedule.find((d) => d.day_of_week === 2).is_rest_day).toBe(false);
    });

    it("does not place a lunch break outside a shortened shift", () => {
      const schedule = buildDriverWeeklySchedule({
        ...DEFAULT_WORK_SHIFT_POLICY,
        shiftStart: "06:00",
        shiftEnd: "10:00",
        breakStart: null,
        breakEnd: null,
      }, 0);
      expect(schedule.find((d) => !d.is_rest_day).break_start).toBeNull();
      expect(schedule.find((d) => !d.is_rest_day).break_end).toBeNull();
    });
  });
});
