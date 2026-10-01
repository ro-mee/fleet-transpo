import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime } from "@/lib/utils";

// Nullable timestamps render as "—", never as a plausible-looking instant.
//
// The reported symptom was a cancelled trip showing "Jan 1, 1970" for both its
// start and end. The cause is `new Date(null)` being the epoch — and three live
// cancelled trips genuinely store NULL start_time/end_time, so this is a display
// bug over correct data, not a data bug. `0` and unparseable strings are the same
// trap by other names; a real timestamp keeps formatting exactly as before.
describe("formatDateTime / formatDate / formatTime — nullable values", () => {
  const NULLISH = [null, undefined, "", 0];

  it("renders — for every nullish value instead of the epoch", () => {
    for (const value of NULLISH) {
      expect(formatDateTime(value), `formatDateTime(${String(value)})`).toBe("—");
      expect(formatDate(value), `formatDate(${String(value)})`).toBe("—");
      expect(formatTime(value), `formatTime(${String(value)})`).toBe("—");
    }
  });

  it("never renders a 1970 date for a missing timestamp", () => {
    expect(formatDateTime(null)).not.toContain("1970");
    expect(formatDate(null)).not.toContain("1970");
    expect(formatTime(null)).not.toBe("12:00 AM");
  });

  it("renders — for an unparseable string instead of throwing", () => {
    // Intl.format(new Date(NaN)) throws "Invalid time value".
    expect(() => formatDateTime("not a date")).not.toThrow();
    expect(formatDateTime("not a date")).toBe("—");
    expect(formatDate("2026-13-45")).toBe("—");
  });

  it("still formats a real instant", () => {
    // Built from LOCAL components so the assertion holds in any test timezone.
    const at = new Date(2026, 8, 15, 8, 30);
    expect(formatDateTime(at)).toMatch(/Sep 15, 2026/);
    expect(formatDate(at)).toMatch(/Sep 15, 2026/);
    expect(formatTime(at)).toMatch(/AM|PM/);
  });

  it("accepts a Date instance", () => {
    expect(formatDate(new Date(2026, 8, 15))).toBe("Sep 15, 2026");
  });

  it("keeps the date options pass-through for formatDate", () => {
    expect(formatDate(new Date(2026, 8, 15), { month: "long" })).toBe("September 15, 2026");
  });
});
