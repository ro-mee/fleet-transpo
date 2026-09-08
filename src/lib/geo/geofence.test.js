import { describe, it, expect } from "vitest";
import {
  evaluateGeofence,
  evaluateTripGeofences,
  resolveGeofenceRadius,
  trailDistanceKm,
  DEFAULT_GEOFENCE_RADIUS_M,
  GEOFENCE_ACCURACY_LIMIT_M,
} from "@/lib/geo/geofence";

const PICKUP = { lat: 14.5159, lng: 120.9953 }; // hotel driveway

describe("resolveGeofenceRadius", () => {
  it("accepts configured radii and sanitizes junk to the default", () => {
    expect(resolveGeofenceRadius(60)).toBe(60);
    expect(resolveGeofenceRadius(150)).toBe(150);
    expect(resolveGeofenceRadius(null)).toBe(DEFAULT_GEOFENCE_RADIUS_M);
    expect(resolveGeofenceRadius(0)).toBe(DEFAULT_GEOFENCE_RADIUS_M);
    expect(resolveGeofenceRadius(-5)).toBe(DEFAULT_GEOFENCE_RADIUS_M);
    expect(resolveGeofenceRadius(5000)).toBe(DEFAULT_GEOFENCE_RADIUS_M);
    expect(resolveGeofenceRadius("abc")).toBe(DEFAULT_GEOFENCE_RADIUS_M);
  });
});

describe("evaluateGeofence", () => {
  it("detects inside the hotel driveway geofence (60 m)", () => {
    const out = evaluateGeofence({
      position: { lat: 14.5161, lng: 120.9955 }, // ~30 m away
      target: PICKUP,
      radiusM: 60,
      accuracyM: 12,
    });
    expect(out.state).toBe("inside");
    expect(out.distanceM).toBeLessThanOrEqual(60);
  });

  it("detects outside (180 m, nothing fires)", () => {
    const out = evaluateGeofence({
      position: { lat: 14.5175, lng: 120.9953 }, // ~180 m away
      target: PICKUP,
      radiusM: 60,
      accuracyM: 12,
    });
    expect(out.state).toBe("outside");
    expect(out.distanceM).toBeGreaterThan(100);
  });

  it("refuses arrival on poor accuracy (480 m) even at the exact point", () => {
    const out = evaluateGeofence({
      position: { ...PICKUP },
      target: PICKUP,
      radiusM: 150,
      accuracyM: 480,
    });
    expect(out.state).toBe("unknown");
    expect(out.reason).toMatch(/accuracy insufficient/i);
    expect(out.distanceM).toBe(0);
  });

  it("treats the accuracy limit as usable and the limit + 1 as unknown", () => {
    expect(
      evaluateGeofence({ position: PICKUP, target: PICKUP, radiusM: 100, accuracyM: GEOFENCE_ACCURACY_LIMIT_M }).state
    ).toBe("inside");
    expect(
      evaluateGeofence({ position: PICKUP, target: PICKUP, radiusM: 100, accuracyM: GEOFENCE_ACCURACY_LIMIT_M + 1 }).state
    ).toBe("unknown");
  });

  it("proceeds when accuracy is unreported and stays unknown on bad coords", () => {
    expect(
      evaluateGeofence({ position: PICKUP, target: PICKUP, radiusM: 100, accuracyM: null }).state
    ).toBe("inside");
    expect(evaluateGeofence({ position: null, target: PICKUP, radiusM: 100 }).state).toBe("unknown");
    expect(evaluateGeofence({ position: PICKUP, target: null, radiusM: 100 }).state).toBe("unknown");
  });
});

describe("evaluateTripGeofences", () => {
  const DEST = { lat: 14.52048, lng: 121.01445, radiusM: 150 }; // T3 arrivals

  it("flags near_pickup at 92 m inside a 100 m fence, destination far", () => {
    const out = evaluateTripGeofences({
      position: { lat: 14.5167, lng: 120.9953 }, // ~90 m north of hotel
      accuracyM: 20,
      pickup: { ...PICKUP, radiusM: 100 },
      destination: DEST,
    });
    expect(out.near_pickup).toBe(true);
    expect(out.near_destination).toBe(false);
    expect(out.geofence_state).toBe("known");
  });

  it("marks the pair unknown when accuracy is insufficient", () => {
    const out = evaluateTripGeofences({
      position: { ...PICKUP },
      accuracyM: 480,
      pickup: { ...PICKUP, radiusM: 100 },
      destination: DEST,
    });
    expect(out.near_pickup).toBe(false);
    expect(out.geofence_state).toBe("unknown");
  });

  it("stays unknown for unresolved targets instead of guessing", () => {
    const out = evaluateTripGeofences({ position: { ...PICKUP }, accuracyM: 10 });
    expect(out.near_pickup).toBe(false);
    expect(out.near_destination).toBe(false);
    expect(out.distance_to_pickup_m).toBeNull();
  });
});

describe("trailDistanceKm", () => {
  // ~1.1 km apart, 5 minutes apart ≈ 13 km/h — normal city driving.
  const trail = [
    { latitude: 14.5159, longitude: 120.9953, recorded_at: "2026-09-07T09:00:00+08:00" },
    { latitude: 14.5200, longitude: 121.0020, recorded_at: "2026-09-07T09:05:00+08:00" },
    { latitude: 14.5240, longitude: 121.0090, recorded_at: "2026-09-07T09:10:00+08:00" },
  ];

  it("sums consecutive segments", () => {
    const km = trailDistanceKm(trail);
    expect(km).toBeGreaterThan(1);
    expect(km).toBeLessThan(5);
  });

  it("skips teleport segments but keeps the rest", () => {
    const jumpy = [
      ...trail,
      // Manila → ~300 km in 1 minute: a bad fix, not driving.
      { latitude: 16.5, longitude: 121.5, recorded_at: "2026-09-07T09:11:00+08:00" },
    ];
    expect(trailDistanceKm(jumpy)).toBe(trailDistanceKm(trail));
  });

  it("returns null when nothing usable exists", () => {
    expect(trailDistanceKm([])).toBeNull();
    expect(trailDistanceKm([trail[0]])).toBeNull();
    expect(
      trailDistanceKm([
        { latitude: 0, longitude: 0, recorded_at: "2026-09-07T09:00:00+08:00" },
        { latitude: 14.5, longitude: 121.0, recorded_at: "2026-09-07T09:05:00+08:00" },
      ])
    ).toBeNull(); // (0,0) is rejected as unset, so no usable segment
  });
});
