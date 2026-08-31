import { describe, expect, it } from "vitest";
import { GPS_DELAYED_MS, GPS_FRESH_MS, formatGpsAge, getGpsHealth, isValidCoordinate, speedKmhFromMps } from "@/lib/gps";

describe("GPS data helpers", () => {
  const now = Date.parse("2026-08-31T00:00:00.000Z");

  it("classifies fresh, delayed, stale, and missing fixes", () => {
    expect(getGpsHealth(new Date(now - GPS_FRESH_MS).toISOString(), now).key).toBe("fresh");
    expect(getGpsHealth(new Date(now - GPS_DELAYED_MS).toISOString(), now).key).toBe("delayed");
    expect(getGpsHealth(new Date(now - GPS_DELAYED_MS - 1).toISOString(), now).key).toBe("stale");
    expect(getGpsHealth(null, now).key).toBe("no-signal");
    expect(formatGpsAge(new Date(now - 120_000).toISOString(), now)).toBe("2 min ago");
  });

  it("converts Expo meters-per-second speed to km/h", () => {
    expect(speedKmhFromMps(10)).toBe(36);
    expect(speedKmhFromMps(null)).toBe(null);
    expect(speedKmhFromMps("")).toBe(null);
  });

  it("rejects invalid coordinates", () => {
    expect(isValidCoordinate(14.6, 121)).toBe(true);
    expect(isValidCoordinate("bad", 121)).toBe(false);
    expect(isValidCoordinate(null, 121)).toBe(false);
    expect(isValidCoordinate("", 121)).toBe(false);
    expect(isValidCoordinate(91, 121)).toBe(false);
  });
});
