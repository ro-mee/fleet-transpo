// Tests for the pure off-route engine (src/lib/geo/off-route.js).
//
// The contract being pinned:
// - deviation claims need TWO consecutive valid observations > 250 m;
// - an invalid observation (poor accuracy, stale fix) breaks the streak;
// - a confirmed off-route state persists until TWO consecutive valid fixes
//   are back within ~150 m (hysteresis, previousState fed from the durable
//   alert row — serverless-safe, the DB breadcrumbs are the streak source);
// - no route geometry → unknown, never guessed.
import { describe, it, expect } from "vitest";
import {
  distanceToPolylineM,
  evaluateOffRoute,
  OFF_ROUTE_CONFIRM_M,
  OFF_ROUTE_RESUME_M,
} from "@/lib/geo/off-route";

// A straight due-north route (axis-aligned so a pure longitude offset is
// exactly perpendicular): lng 121.0, lat 14.50 → 14.52.
// 0.0001° of lng here ≈ 10.8 m.
const ROUTE = [
  [14.5, 121.0],
  [14.51, 121.0],
  [14.52, 121.0],
];

const NOW = Date.now();
// ~334 m due east of the route (0.0031° of longitude).
const FAR_OFF = { lat: 14.51, lng: 121.0031 };
// ~45 m from the route.
const NEAR = { lat: 14.51, lng: 121.0004 };

describe("distanceToPolylineM", () => {
  it("measures the perpendicular distance to a segment, not to a vertex", () => {
    // Mid-segment point, ~334 m off laterally. Distance to the NEAREST VERTEX
    // would be ~570 m (half a segment ≈ 0.005° lat); the segment distance
    // must be ~334.
    const d = distanceToPolylineM({ lat: 14.505, lng: 121.0031 }, ROUTE);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(370);
  });

  it("returns ~0 for a point on the line", () => {
    const d = distanceToPolylineM({ lat: 14.51, lng: 121.0 }, ROUTE);
    expect(d).toBeLessThanOrEqual(5);
  });

  it("returns null for missing/short geometry", () => {
    expect(distanceToPolylineM(NEAR, [])).toBeNull();
    expect(distanceToPolylineM(NEAR, [[14.5, 120.99]])).toBeNull();
    expect(distanceToPolylineM(null, ROUTE)).toBeNull();
  });
});

describe("evaluateOffRoute", () => {
  it("a single valid off-route observation does NOT confirm", () => {
    const result = evaluateOffRoute({
      position: FAR_OFF,
      accuracyM: 20,
      gpsFresh: true,
      routePoints: ROUTE,
      recentPings: [],
      now: NOW,
    });
    expect(result.state).toBe("on_route");
    expect(result.offStreak).toBe(1);
    expect(result.distanceM).toBeGreaterThan(OFF_ROUTE_CONFIRM_M);
  });

  it("two consecutive valid off-route observations confirm off_route", () => {
    // The previous ping (a DB breadcrumb) was also beyond the threshold —
    // the serverless shape: instance B learns about ping #1 from the table.
    const result = evaluateOffRoute({
      position: FAR_OFF,
      accuracyM: 20,
      gpsFresh: true,
      routePoints: ROUTE,
      recentPings: [
        { latitude: FAR_OFF.lat, longitude: FAR_OFF.lng, accuracyM: 20, recordedAtMs: NOW - 30_000, fresh: true },
      ],
      now: NOW,
    });
    expect(result.state).toBe("off_route");
    expect(result.offStreak).toBe(2);
  });

  it("an invalid previous ping (poor accuracy) breaks the streak", () => {
    const result = evaluateOffRoute({
      position: FAR_OFF,
      accuracyM: 20,
      gpsFresh: true,
      routePoints: ROUTE,
      recentPings: [
        { latitude: FAR_OFF.lat, longitude: FAR_OFF.lng, accuracyM: 400, recordedAtMs: NOW - 30_000, fresh: true },
      ],
      now: NOW,
    });
    expect(result.state).toBe("on_route");
    expect(result.offStreak).toBe(1);
  });

  it("a stale previous ping breaks the streak", () => {
    const result = evaluateOffRoute({
      position: FAR_OFF,
      accuracyM: 20,
      gpsFresh: true,
      routePoints: ROUTE,
      recentPings: [
        { latitude: FAR_OFF.lat, longitude: FAR_OFF.lng, accuracyM: 20, recordedAtMs: NOW - 10 * 60_000, fresh: true },
      ],
      now: NOW,
    });
    expect(result.state).toBe("on_route");
    expect(result.offStreak).toBe(1);
  });

  it("an invalid CURRENT fix never creates a deviation claim", () => {
    const result = evaluateOffRoute({
      position: FAR_OFF,
      accuracyM: 500, // worse than the 150 m limit
      gpsFresh: true,
      routePoints: ROUTE,
      recentPings: [
        { latitude: FAR_OFF.lat, longitude: FAR_OFF.lng, accuracyM: 20, recordedAtMs: NOW - 30_000, fresh: true },
      ],
      now: NOW,
    });
    expect(result.state).toBe("on_route");
    expect(result.offStreak).toBe(0);
  });

  it("a confirmed off-route state persists through a single recovery ping", () => {
    // previousState comes from the durable alert row.
    const result = evaluateOffRoute({
      position: NEAR, // back within ~45 m — first recovery ping
      accuracyM: 20,
      gpsFresh: true,
      routePoints: ROUTE,
      recentPings: [],
      previousState: "off_route",
      now: NOW,
    });
    expect(result.state).toBe("off_route");
    expect(result.onStreak).toBe(1);
  });

  it("two consecutive recovery pings resolve to on_route", () => {
    const result = evaluateOffRoute({
      position: NEAR,
      accuracyM: 20,
      gpsFresh: true,
      routePoints: ROUTE,
      recentPings: [
        { latitude: NEAR.lat, longitude: NEAR.lng, accuracyM: 20, recordedAtMs: NOW - 30_000, fresh: true },
      ],
      previousState: "off_route",
      now: NOW,
    });
    expect(result.state).toBe("on_route");
    expect(result.onStreak).toBe(2);
    expect(result.distanceM).toBeLessThanOrEqual(OFF_ROUTE_RESUME_M);
  });

  it("without geometry the state is unknown", () => {
    const result = evaluateOffRoute({
      position: FAR_OFF,
      accuracyM: 20,
      gpsFresh: true,
      routePoints: null,
      recentPings: [],
      now: NOW,
    });
    expect(result.state).toBe("unknown");
    expect(result.distanceM).toBeNull();
  });

  it("a point between the resume and confirm thresholds neither confirms nor recovers", () => {
    // ~200 m from the route: beyond resume (150), below confirm (250).
    const mid = { lat: 14.51, lng: 121.00185 };
    const result = evaluateOffRoute({
      position: mid,
      accuracyM: 20,
      gpsFresh: true,
      routePoints: ROUTE,
      recentPings: [
        { latitude: mid.lat, longitude: mid.lng, accuracyM: 20, recordedAtMs: NOW - 30_000, fresh: true },
      ],
      previousState: "off_route",
      now: NOW,
    });
    // Not back within resume → the confirmed deviation persists.
    expect(result.state).toBe("off_route");
    expect(result.onStreak).toBe(0);
    expect(result.offStreak).toBe(0);
  });
});
