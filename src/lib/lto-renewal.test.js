import { describe, it, expect } from "vitest";
import { calculateLtoRenewalSchedule, resolveRenewalExpiry } from "@/lib/lto-renewal";

describe("resolveRenewalExpiry", () => {
  it("snaps ABC-1234 to the April week-1 window end", () => {
    // Digits 1234: last 4 → April, second-last 3 → 1st–7th.
    expect(resolveRenewalExpiry("ABC-1234", new Date("2026-09-15T00:00:00+08:00"))).toBe("2027-04-07");
  });
  it("uses the current-year window when it has not passed yet", () => {
    expect(resolveRenewalExpiry("ABC-1234", new Date("2026-01-10T00:00:00+08:00"))).toBe("2026-04-07");
  });
  it("maps digit 0 to October and week 4 to month end", () => {
    // Digits 90: last 0 → October, second-last 9 → 22nd–last day.
    expect(resolveRenewalExpiry("XYZ-9990", new Date("2026-09-15T00:00:00+08:00"))).toBe("2026-10-31");
  });
  it("maps week-2 plates to the 14th", () => {
    // Digits 45: last 5 → May, second-last 4 → 8th–14th.
    expect(resolveRenewalExpiry("AAA-0045", new Date("2026-09-15T00:00:00+08:00"))).toBe("2027-05-14");
  });
  it("returns null for plates without digits", () => {
    expect(resolveRenewalExpiry("ABC-DEF")).toBe(null);
    expect(resolveRenewalExpiry(null)).toBe(null);
    expect(resolveRenewalExpiry("")).toBe(null);
  });
  it("stays consistent with calculateLtoRenewalSchedule", () => {
    const ref = new Date("2026-09-15T00:00:00+08:00");
    const sched = calculateLtoRenewalSchedule("ABC-1234", ref);
    expect(sched.success).toBe(true);
    expect(resolveRenewalExpiry("ABC-1234", ref)).toBe(sched.renewal_end_date);
  });
});
