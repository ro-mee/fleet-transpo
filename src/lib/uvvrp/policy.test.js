import { describe, it, expect } from "vitest";
import {
  plateLastDigit,
  weekdayFor,
  restrictedDigitsFor,
  isRestricted,
  isExemptionActive,
  mergePolicy,
  DEFAULT_POLICY,
} from "@/lib/uvvrp/policy";

describe("plateLastDigit", () => {
  it("extracts the last numeric digit", () => {
    expect(plateLastDigit("ABC-1234")).toBe(4);
    expect(plateLastDigit("123")).toBe(3);
    expect(plateLastDigit("NMC 777")).toBe(7);
  });
  it("returns null when no digit", () => {
    expect(plateLastDigit("ABC-DEF")).toBe(null);
    expect(plateLastDigit(null)).toBe(null);
    expect(plateLastDigit("")).toBe(null);
  });
});

describe("weekdayFor", () => {
  it("maps a Date to the weekday name", () => {
    // 2026-08-06 is a Thursday.
    expect(weekdayFor("2026-08-06")).toBe("Thursday");
  });
  it("returns null for invalid dates", () => {
    expect(weekdayFor("nonsense")).toBe(null);
  });
});

describe("restrictedDigitsFor", () => {
  const policy = { weekdayRestrictions: { Thursday: [7, 8] } };
  it("returns the day's restricted digits", () => {
    expect(restrictedDigitsFor(policy, "2026-08-06")).toEqual([7, 8]);
  });
  it("returns [] on a day with no restrictions", () => {
    expect(restrictedDigitsFor(policy, "2026-08-08")).toEqual([]); // Saturday
  });
});

describe("isRestricted", () => {
  const policy = { enabled: true, weekdayRestrictions: { Thursday: [7, 8] } };
  it("true when the plate's last digit is restricted that day", () => {
    expect(isRestricted("ABC-1237", policy, "2026-08-06")).toBe(true);
  });
  it("false when disabled", () => {
    expect(isRestricted("ABC-1237", { ...policy, enabled: false }, "2026-08-06")).toBe(false);
  });
  it("false when the digit is not restricted", () => {
    expect(isRestricted("ABC-1234", policy, "2026-08-06")).toBe(false);
  });
  it("false for a plate with no digit", () => {
    expect(isRestricted("ABC-ABC", policy, "2026-08-06")).toBe(false);
  });
});

describe("isExemptionActive", () => {
  it("true for an active exemption with no expiry", () => {
    expect(isExemptionActive({ active: true, expires_on: null }, "2026-08-06")).toBe(true);
  });
  it("false when not active", () => {
    expect(isExemptionActive({ active: false, expires_on: null }, "2026-08-06")).toBe(false);
  });
  it("false when past the expiry", () => {
    expect(isExemptionActive({ active: true, expires_on: "2026-01-01" }, "2026-08-06")).toBe(false);
  });
  it("true when expiry is in the future", () => {
    expect(isExemptionActive({ active: true, expires_on: "2026-12-31" }, "2026-08-06")).toBe(true);
  });
  it("false for null", () => {
    expect(isExemptionActive(null, "2026-08-06")).toBe(false);
  });
});

describe("mergePolicy", () => {
  it("fills defaults and preserves weekdayRestrictions", () => {
    const merged = mergePolicy({ enabled: true, weekdayRestrictions: { Thursday: [9] } });
    expect(merged.enabled).toBe(true);
    expect(merged.weekdayRestrictions.Thursday).toEqual([9]);
    expect(merged.weekdayRestrictions.Monday).toEqual(DEFAULT_POLICY.weekdayRestrictions.Monday);
    expect(Array.isArray(merged.exemptionCategories)).toBe(true);
  });
  it("returns defaults when stored is empty", () => {
    expect(mergePolicy(null)).toEqual(DEFAULT_POLICY);
  });
});
