// GPS odometer segment rules — the single shared implementation behind both
// the map screen's foreground watcher and the background TaskManager task.
//
// What each test protects, and why it is a test rather than a comment:
//
//  • The odometer feeds vehicles.mileage, which drives maintenance due-dates.
//    A rule that silently admits junk inflates the fleet's service burn rate,
//    so the REJECTION reasons are asserted, not just the totals.
//  • Trip A → Trip B leakage: distance belongs to one trip. A new trip must
//    start from zero with no inherited anchor, or Trip A's kilometres are
//    reported against Trip B and Trip B's odometer delta is nonsense.
import { describe, expect, it } from "vitest";
import {
  MAX_SEGMENT_KM,
  MAX_SEGMENT_GAP_MS,
  MAX_UNSPEEDED_SEGMENT_GAP_MS,
  accumulateFix,
  createAccumulator,
  evaluateSegment,
  haversineKm,
} from "./gps-odometer";

describe("evaluateSegment", () => {
  it("rejects an unrealistic GPS jump even at a plausible short interval", () => {
    // The task's own scenario: 14.60,121.00 -> 14.90,121.40 in 2 s.
    const km = haversineKm(14.6, 121.0, 14.9, 121.4);
    expect(km).toBeGreaterThan(MAX_SEGMENT_KM * 10);
    expect(evaluateSegment({ segKm: km, speedMs: 12, dtMs: 2000 })).toEqual({
      ok: false,
      reason: "jump",
    });
  });

  it("rejects a sub-400 m teleport that only the implied speed catches", () => {
    // 350 m in 2 s is ~630 km/h. Under MAX_SEGMENT_KM, so the distance cap
    // alone would have counted it as real driving.
    const segKm = 0.35;
    expect(segKm).toBeLessThan(MAX_SEGMENT_KM);
    expect(evaluateSegment({ segKm, speedMs: null, dtMs: 2000 })).toEqual({
      ok: false,
      reason: "teleport",
    });
  });

  it("rejects parked jitter instead of counting it as mileage", () => {
    // The regression: the old rule was `(speed > 1 || seg > 0.02)`, an OR, so a
    // stationary vehicle with a 25 m drift counted on every 3 s fix.
    const segKm = 0.025;
    expect(segKm).toBeGreaterThan(0.02);
    expect(evaluateSegment({ segKm, speedMs: 0, dtMs: 3000 })).toEqual({
      ok: false,
      reason: "stationary",
    });
  });

  it("counts a short segment when the vehicle reports it is moving", () => {
    expect(evaluateSegment({ segKm: 0.005, speedMs: 11, dtMs: 3000 })).toEqual({
      ok: true,
      reason: "moving",
    });
  });

  it("treats expo's -1 / null speed as unknown, not as stationary", () => {
    // -1 means "could not measure". Reading it as 0 would drop every segment
    // from a device that never reports speed.
    expect(evaluateSegment({ segKm: 0.05, speedMs: -1, dtMs: 3000 }).ok).toBe(true);
    expect(evaluateSegment({ segKm: 0.05, speedMs: null, dtMs: 3000 }).ok).toBe(true);
  });

  it("rejects a segment measured across a stale gap", () => {
    expect(evaluateSegment({ segKm: 0.05, speedMs: 5, dtMs: MAX_SEGMENT_GAP_MS + 1000 }))
      .toEqual({ ok: false, reason: "stale-gap" });
  });


describe("accumulateFix — leg handling", () => {
  it("never carries Trip A's distance into Trip B", () => {
    const acc = createAccumulator();
    acc.leg1 = 12.5;
    acc.prev = { lat: 14.6, lng: 121.0, atMs: 1000 };
    // Trip B starts from a FRESH accumulator (that is what map.js does on a
    // trip-id change), so the anchor and the totals are both gone.
    const tripB = createAccumulator();
    accumulateFix(tripB, { lat: 14.7, lng: 121.1, speedMs: 10, atMs: 2000, leg: "leg1" });
    expect(tripB.leg1).toBe(0);
    expect(acc.leg1).toBe(12.5);
  });

  it("drops the straddling fix when the leg flips at the pickup", () => {
    const acc = createAccumulator();
    accumulateFix(acc, { lat: 14.6, lng: 121.0, speedMs: 12, atMs: 1000, leg: "leg1" });
    // 1 km later, status flips to leg2. That gap is the walk from the vehicle
    // to the passenger — not driving.
    const r = accumulateFix(acc, { lat: 14.609, lng: 121.0, speedMs: 12, atMs: 4000, leg: "leg2" });
    expect(r.addedKm).toBe(0);
    expect(r.reason).toBe("first-fix");
    expect(acc.leg1).toBe(0);
    expect(acc.leg2).toBe(0);
    expect(acc.leg).toBe("leg2");
  });

  it("routes distance to the leg named by legForStatus's vocabulary", () => {
    const expected = haversineKm(14.6, 121.0, 14.6005, 121.0);
    const acc = createAccumulator();
    accumulateFix(acc, { lat: 14.6, lng: 121.0, speedMs: 12, atMs: 1000, leg: "leg1" });
    accumulateFix(acc, { lat: 14.6005, lng: 121.0, speedMs: 12, atMs: 4000, leg: "leg1" });
    expect(acc.leg1).toBeCloseTo(expected, 6);
    expect(acc.leg2).toBe(0);
  });

  it("keeps its stable anchor after a short-interval teleport", () => {
    const acc = createAccumulator();
    accumulateFix(acc, { lat: 14.6, lng: 121.0, speedMs: 12, atMs: 1000, leg: "leg1" });
    accumulateFix(acc, { lat: 14.9, lng: 121.4, speedMs: 12, atMs: 4000, leg: "leg1" });
    expect(acc.leg1).toBe(0);
    expect(acc.prev).toEqual({ lat: 14.6, lng: 121.0, atMs: 1000 });
    const r = accumulateFix(acc, { lat: 14.6002, lng: 121.0, speedMs: 12, atMs: 7000, leg: "leg1" });
    expect(r.addedKm).toBeGreaterThan(0);
    expect(acc.leg1).toBeGreaterThan(0);
  });

  it("confirms a fresh anchor after a long gap, then resumes counting", () => {
    const acc = createAccumulator();
    accumulateFix(acc, { lat: 14.6, lng: 121.0, speedMs: 12, atMs: 1000, leg: "leg1" });

    const recovery = accumulateFix(acc, {
      lat: 14.61,
      lng: 121.0,
      speedMs: 12,
      atMs: 1000 + MAX_SEGMENT_GAP_MS + 1,
      leg: "leg1",
    });
    expect(recovery.reason).toBe("stale-gap");
    expect(recovery.addedKm).toBe(0);
    expect(acc.leg1).toBe(0);
    expect(acc.prev).toBeNull();
    expect(acc.pending).toEqual({ lat: 14.61, lng: 121.0, atMs: 1000 + MAX_SEGMENT_GAP_MS + 1 });

    const confirmationAt = 1000 + MAX_SEGMENT_GAP_MS + 3001;
    const confirmed = accumulateFix(acc, { lat: 14.61, lng: 121.0, speedMs: 0, atMs: confirmationAt, leg: "leg1" });
    expect(confirmed.reason).toBe("gap-recovered");
    expect(confirmed.addedKm).toBe(0);
    expect(acc.prev).toEqual({ lat: 14.61, lng: 121.0, atMs: confirmationAt });
    expect(acc.pending).toBeNull();

    const next = accumulateFix(acc, { lat: 14.6105, lng: 121.0, speedMs: 12, atMs: confirmationAt + 3000, leg: "leg1" });
    expect(next.addedKm).toBeGreaterThan(0);
    expect(acc.leg1).toBeCloseTo(next.addedKm, 8);
  });

  it("replaces a far stale-gap outlier before confirming the real location", () => {
    const acc = createAccumulator();
    accumulateFix(acc, { lat: 14.6, lng: 121.0, speedMs: 12, atMs: 1000, leg: "leg1" });
    const staleAt = 1000 + MAX_SEGMENT_GAP_MS + 1;
    accumulateFix(acc, { lat: 14.9, lng: 121.4, speedMs: 12, atMs: staleAt, leg: "leg1" });

    const returned = accumulateFix(acc, { lat: 14.6001, lng: 121.0, speedMs: 12, atMs: staleAt + 3000, leg: "leg1" });
    expect(returned.reason).toBe("gap-recovery-candidate");
    expect(acc.leg1).toBe(0);
    expect(acc.pending).toEqual({ lat: 14.6001, lng: 121.0, atMs: staleAt + 3000 });

    const confirmedAt = staleAt + 6000;
    expect(accumulateFix(acc, { lat: 14.6001, lng: 121.0, speedMs: 0, atMs: confirmedAt, leg: "leg1" }).reason)
      .toBe("gap-recovered");
    const next = accumulateFix(acc, { lat: 14.6006, lng: 121.0, speedMs: 12, atMs: confirmedAt + 3000, leg: "leg1" });
    expect(next.addedKm).toBeGreaterThan(0);
    expect(acc.prev.lat).toBe(14.6006);
  });

  it("does not accumulate anything without a leg context", () => {
    const acc = createAccumulator();
    accumulateFix(acc, { lat: 14.6, lng: 121.0, speedMs: 12, atMs: 1000, leg: null });
    accumulateFix(acc, { lat: 14.6005, lng: 121.0, speedMs: 12, atMs: 4000, leg: null });
    expect(acc.leg1).toBe(0);
    expect(acc.leg2).toBe(0);
  });

  it("ignores a fix with non-finite coordinates", () => {
    const acc = createAccumulator();
    const r = accumulateFix(acc, { lat: NaN, lng: 121.0, speedMs: 12, leg: "leg1" });
    expect(r.reason).toBe("invalid");
    expect(acc.leg1).toBe(0);
  });

  it("rejects out-of-range coordinates and invalid timestamps without moving the anchor", () => {
    const acc = createAccumulator();
    accumulateFix(acc, { lat: 14.6, lng: 121.0, speedMs: 12, atMs: 1000, leg: "leg1" });
    const original = { ...acc.prev };

    expect(accumulateFix(acc, { lat: 91, lng: 121.0, speedMs: 12, atMs: 2000, leg: "leg1" }).reason)
      .toBe("invalid");
    expect(accumulateFix(acc, { lat: 14.6, lng: 121.0, speedMs: 12, atMs: NaN, leg: "leg1" }).reason)
      .toBe("no-interval");
    expect(accumulateFix(acc, { lat: 14.6005, lng: 121.0, speedMs: 12, atMs: 900, leg: "leg1" }).reason)
      .toBe("no-interval");
    expect(acc.prev).toEqual(original);
    expect(acc.leg1).toBe(0);
  });
});

// A parked van on a rooftop with a drifting chip: 5 minutes of "movement",
// all of it noise. The old OR rule banked ~0.02 km per fix here.
describe("accumulateFix — parked vehicle endurance", () => {
  it("banks no distance across a five-minute stationary drift", () => {
    const acc = createAccumulator();
    let t = 0;
    accumulateFix(acc, { lat: 14.6, lng: 121.0, speedMs: 0, atMs: t, leg: "leg1" });
    for (let i = 1; i <= 60; i++) {
      // ±30 m of wander, alternating, speed pinned at 0.
      const lat = 14.6 + (i % 2 ? 0.00027 : -0.00027);
      t += 5000;
      accumulateFix(acc, { lat, lng: 121.0, speedMs: 0, atMs: t, leg: "leg1" });
    }
    expect(acc.leg1).toBe(0);
  });
});

  it("rejects a long low-speed drift when speed was never measured", () => {
    expect(evaluateSegment({ segKm: 0.05, speedMs: null, dtMs: MAX_UNSPEEDED_SEGMENT_GAP_MS + 1000 }))
      .toEqual({ ok: false, reason: "unspeeded-drift" });
  });

  it("rejects a non-positive or non-finite segment", () => {
    expect(evaluateSegment({ segKm: 0 }).reason).toBe("empty");
    expect(evaluateSegment({ segKm: NaN }).reason).toBe("empty");
  });
});
