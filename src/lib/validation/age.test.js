import { describe, expect, it } from "vitest";
import { LEGAL_DRIVING_AGE, isAtLeastAge, legalAgeCutoff } from "./age";

// Fixed reference date so the boundary assertions can't drift with the clock.
const NOW = new Date(2026, 8, 23); // 2026-09-23

describe("legalAgeCutoff", () => {
  it("returns the date minAge years before now", () => {
    const cutoff = legalAgeCutoff(18, NOW);
    expect([cutoff.getFullYear(), cutoff.getMonth() + 1, cutoff.getDate()]).toEqual([2008, 9, 23]);
  });

  it("clamps to the target month's length instead of rolling forward", () => {
    // 2028-02-29 minus 18 years is 2010-02-29, which does not exist. A naive
    // date subtraction would roll to 2010-03-01 and admit a day too young.
    const cutoff = legalAgeCutoff(18, new Date(2028, 1, 29));
    expect([cutoff.getFullYear(), cutoff.getMonth() + 1, cutoff.getDate()]).toEqual([2010, 2, 28]);

    // A non-rolling date is left exactly as it is.
    const exact = legalAgeCutoff(18, new Date(2025, 1, 28));
    expect([exact.getFullYear(), exact.getMonth() + 1, exact.getDate()]).toEqual([2007, 2, 28]);
  });
});

describe("isAtLeastAge", () => {
  it("treats blank and absent values as passing — the field is optional", () => {
    expect(isAtLeastAge("", 18, NOW)).toBe(true);
    expect(isAtLeastAge(null, 18, NOW)).toBe(true);
    expect(isAtLeastAge(undefined, 18, NOW)).toBe(true);
  });

  it("passes when minAge is not supplied", () => {
    expect(isAtLeastAge("2020-01-01", null, NOW)).toBe(true);
  });

  it("accepts the boundary date itself (a birthday today counts)", () => {
    expect(isAtLeastAge("2008-09-23", LEGAL_DRIVING_AGE, NOW)).toBe(true);
  });

  it("rejects a birthdate one day past the boundary", () => {
    expect(isAtLeastAge("2008-09-24", LEGAL_DRIVING_AGE, NOW)).toBe(false);
  });

  it("rejects a year that is too recent, and accepts one that is comfortably older", () => {
    expect(isAtLeastAge("2026-01-01", LEGAL_DRIVING_AGE, NOW)).toBe(false);
    expect(isAtLeastAge("1990-01-01", LEGAL_DRIVING_AGE, NOW)).toBe(true);
  });

  it("compares by year, then month, then day", () => {
    // Same year as the cutoff: month decides.
    expect(isAtLeastAge("2008-08-31", LEGAL_DRIVING_AGE, NOW)).toBe(true);
    expect(isAtLeastAge("2008-10-01", LEGAL_DRIVING_AGE, NOW)).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isAtLeastAge("not-a-date", LEGAL_DRIVING_AGE, NOW)).toBe(false);
    expect(isAtLeastAge("1990", LEGAL_DRIVING_AGE, NOW)).toBe(false);
  });

  it("ignores a trailing time component", () => {
    expect(isAtLeastAge("2008-09-23T00:00:00.000Z", LEGAL_DRIVING_AGE, NOW)).toBe(true);
  });
});
