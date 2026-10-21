import { describe, it, expect } from "vitest";
import {
  isExpiredOn,
  addDaysToKey,
  formatManilaDateTime,
  manilaMonthRange,
  manilaTrailingRange,
} from "@/lib/dates";

describe("formatManilaDateTime", () => {
  it("renders the Manila wall clock, not the viewer's timezone", () => {
    // 22:00 UTC on Oct 31 is 06:00 on Nov 1 in Manila. A viewer west of UTC
    // (or a UTC CI runner) must still read Nov 1 — this is the FE-16 fix.
    const formatted = formatManilaDateTime("2026-10-31T22:00:00Z");
    expect(formatted).toContain("Nov 1, 2026");
    expect(formatted).toMatch(/6:00\s?AM/);
  });

  it("returns the fallback for nullish or unparseable values", () => {
    expect(formatManilaDateTime(null)).toBe("—");
    expect(formatManilaDateTime(undefined)).toBe("—");
    expect(formatManilaDateTime("not-a-date")).toBe("—");
    expect(formatManilaDateTime("", "Unavailable")).toBe("Unavailable");
  });
});

describe("manilaMonthRange", () => {
  it("returns the whole current Manila month as inclusive keys", () => {
    expect(manilaMonthRange(0, new Date("2026-10-18T02:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("moves to the next and previous months across year boundaries", () => {
    expect(manilaMonthRange(1, new Date("2026-10-18T02:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(manilaMonthRange(-1, new Date("2026-10-18T02:00:00Z"))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(manilaMonthRange(1, new Date("2026-12-15T02:00:00Z"))).toEqual({ from: "2027-01-01", to: "2027-01-31" });
  });

  it("anchors on the Manila calendar day, not UTC", () => {
    // 17:00 UTC on Oct 31 is already Nov 1 in Manila: "this month" is November.
    const reference = new Date("2026-10-31T17:00:00Z");
    expect(manilaMonthRange(0, reference)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(manilaMonthRange(-1, reference)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("manilaTrailingRange", () => {
  it("ends today and spans the requested number of Manila days", () => {
    expect(manilaTrailingRange(30, new Date("2026-10-18T02:00:00Z"))).toEqual({ from: "2026-09-19", to: "2026-10-18" });
    expect(manilaTrailingRange(1, new Date("2026-10-18T02:00:00Z"))).toEqual({ from: "2026-10-18", to: "2026-10-18" });
  });
});

describe("addDaysToKey", () => {
  it("does timezone-free calendar arithmetic on date keys", () => {
    expect(addDaysToKey("2026-10-18", -30)).toBe("2026-09-18");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToKey("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("isExpiredOn", () => {
  it("true when the document expires on the travel date", () => {
    expect(isExpiredOn("2026-08-07", "2026-08-07")).toBe(true);
  });
  it("true when the document expires before the travel date", () => {
    expect(isExpiredOn("2026-08-06", "2026-08-07")).toBe(true);
  });
  it("false when the document expires after the travel date", () => {
    expect(isExpiredOn("2026-08-08", "2026-08-07")).toBe(false);
  });
  it("false for a null expiry", () => {
    expect(isExpiredOn(null, "2026-08-07")).toBe(false);
  });
  it("falls back to today when the reference is unparseable", () => {
    // With no reference, it uses today's rule (strictly-before-today). A past
    // date is expired; today/future is not.
    expect(isExpiredOn("2020-01-01", null)).toBe(true);
    const today = new Date();
    const future = new Date(today.getTime() + 5 * 86400000).toISOString().slice(0, 10);
    expect(isExpiredOn(future, null)).toBe(false);
  });
});
