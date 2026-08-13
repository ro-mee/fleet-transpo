import { describe, it, expect } from "vitest";
import {
  earliestNextAvailable,
  travelBufferBlocked,
  haversineKm,
  etaFromDistanceKm,
  tomtomEtaMinutes,
} from "@/lib/scheduling/travel-buffer";

const PREV = "2026-08-12T10:00:00.000Z"; // previous ends 10:00

describe("earliestNextAvailable", () => {
  it("10:00 end + 12 min ETA + 5 min buffer → 10:17", () => {
    const e = earliestNextAvailable({ previousEnd: PREV, etaMinutes: 12, safetyBufferMinutes: 5, bufferFloorMinutes: 0 });
    expect(e.toISOString()).toBe("2026-08-12T10:17:00.000Z");
  });

  it("applies the floor when the configured buffer is smaller", () => {
    const e = earliestNextAvailable({ previousEnd: PREV, etaMinutes: 2, safetyBufferMinutes: 1, bufferFloorMinutes: 5 });
    expect(e.toISOString()).toBe("2026-08-12T10:07:00.000Z"); // 2 + 5
  });

  it("uses the configured safety buffer (not a fixed 30 min)", () => {
    const e = earliestNextAvailable({ previousEnd: PREV, etaMinutes: 0, safetyBufferMinutes: 20, bufferFloorMinutes: 0 });
    expect(e.toISOString()).toBe("2026-08-12T10:20:00.000Z");
  });

  it("fails open (null) when previousEnd is absent/invalid", () => {
    expect(earliestNextAvailable({ previousEnd: null, etaMinutes: 5 })).toBeNull();
    expect(earliestNextAvailable({ previousEnd: "nope", etaMinutes: 5 })).toBeNull();
  });

  it("fails open (null) when travel time is unknown", () => {
    expect(earliestNextAvailable({ previousEnd: PREV, etaMinutes: null })).toBeNull();
  });
});

describe("travelBufferBlocked", () => {
  it("blocked when pickup is before earliest_next_available", () => {
    // 10:00 + 12 + 5 = 10:17. Pickup 10:10 → blocked.
    const r = travelBufferBlocked({
      pickup: "2026-08-12T10:10:00.000Z",
      previousEnd: PREV,
      etaMinutes: 12,
      safetyBufferMinutes: 5,
      bufferFloorMinutes: 0,
    });
    expect(r.blocked).toBe(true);
  });

  it("NOT blocked when pickup is at/after earliest_next_available", () => {
    // 10:20 → ok; 10:17 boundary → ok.
    const at = travelBufferBlocked({
      pickup: "2026-08-12T10:17:00.000Z",
      previousEnd: PREV,
      etaMinutes: 12,
      safetyBufferMinutes: 5,
      bufferFloorMinutes: 0,
    });
    const after = travelBufferBlocked({
      pickup: "2026-08-12T10:20:00.000Z",
      previousEnd: PREV,
      etaMinutes: 12,
      safetyBufferMinutes: 5,
      bufferFloorMinutes: 0,
    });
    expect(at.blocked).toBe(false);
    expect(after.blocked).toBe(false);
  });

  it("never blocks when there is no previous commitment", () => {
    const r = travelBufferBlocked({
      pickup: "2026-08-12T10:10:00.000Z",
      previousEnd: null,
      etaMinutes: 12,
    });
    expect(r.blocked).toBe(false);
  });

  it("never blocks when ETA is unknown (fail open)", () => {
    const r = travelBufferBlocked({
      pickup: "2026-08-12T10:10:00.000Z",
      previousEnd: PREV,
      etaMinutes: null,
    });
    expect(r.blocked).toBe(false);
  });
});

describe("haversineKm", () => {
  it("returns ~0 for identical points", () => {
    expect(haversineKm([14.6, 121], [14.6, 121])).toBeLessThan(0.01);
  });
  it("returns null when a coordinate is missing", () => {
    expect(haversineKm(null, [14.6, 121])).toBeNull();
  });
});

describe("etaFromDistanceKm", () => {
  it("12 km → ~29 min at 25 km/h effective speed", () => {
    expect(etaFromDistanceKm(12)).toBe(29);
  });
  it("returns null when distance is unknown", () => {
    expect(etaFromDistanceKm(null)).toBeNull();
  });
});

describe("tomtomEtaMinutes", () => {
  it("reads travelTimeInSeconds from route summary and returns minutes", async () => {
    const fake = async () => ({
      ok: true,
      json: async () => ({ routes: [{ summary: { travelTimeInSeconds: 780 } }] }),
    });
    const eta = await tomtomEtaMinutes({
      origin: [14.6, 121],
      destination: [14.6, 121.05],
      fetchImpl: fake,
    });
    expect(eta).toBe(13); // 780s / 60
  });

  it("fails open (null) on a non-OK response", async () => {
    const fake = async () => ({ ok: false });
    const eta = await tomtomEtaMinutes({ origin: [1, 1], destination: [2, 2], fetchImpl: fake });
    expect(eta).toBeNull();
  });

  it("fails open (null) when coords are missing", async () => {
    const eta = await tomtomEtaMinutes({ origin: null, destination: null });
    expect(eta).toBeNull();
  });
});