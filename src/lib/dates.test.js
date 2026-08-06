import { describe, it, expect } from "vitest";
import { isExpiredOn } from "@/lib/dates";

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
