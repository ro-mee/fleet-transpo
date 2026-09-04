import { describe, it, expect } from "vitest";
import {
  computeResponderState,
  nextResponderStatus,
  ARRIVED_RADIUS_M,
} from "@/lib/incidents/responder-tracking";

// Two points ~3.4 km apart in Metro Manila (Ayala → MOA-ish straight line).
const RESPONDER = { latitude: 14.5547, longitude: 121.0244 };
const DRIVER = { latitude: 14.5378, longitude: 120.9822 };
const AT_DRIVER = { latitude: DRIVER.latitude + 0.0005, longitude: DRIVER.longitude }; // ~55 m north

describe("computeResponderState", () => {
  it("computes distance in meters and a heuristic ETA when no routing ETA is given", () => {
    const r = computeResponderState({ responderPos: RESPONDER, driverPos: DRIVER });
    expect(r.distanceM).toBeGreaterThan(3000);
    expect(r.distanceM).toBeLessThan(5000);
    // haversine fallback: ~4.4 km at 25 km/h ≈ 10–11 minutes, min 1
    expect(r.etaMinutes).toBeGreaterThanOrEqual(1);
    expect(r.etaMinutes).toBeLessThanOrEqual(20);
  });

  it("prefers the routing ETA when provided", () => {
    const r = computeResponderState({ responderPos: RESPONDER, driverPos: DRIVER, etaMinutes: 17 });
    expect(r.etaMinutes).toBe(17);
  });

  it("returns nulls when either position is missing", () => {
    expect(computeResponderState({ responderPos: null, driverPos: DRIVER })).toEqual({
      distanceM: null,
      etaMinutes: null,
    });
    expect(computeResponderState({ responderPos: RESPONDER, driverPos: null })).toEqual({
      distanceM: null,
      etaMinutes: null,
    });
  });

  it("clamps a zero routing ETA up to 1 minute", () => {
    const r = computeResponderState({ responderPos: AT_DRIVER, driverPos: DRIVER, etaMinutes: 0 });
    expect(r.etaMinutes).toBe(1);
  });
});

describe("nextResponderStatus", () => {
  it("arrives within the radius regardless of current status", () => {
    expect(
      nextResponderStatus({ currentStatus: "Dispatched", distanceM: 150, responderPostedAfterAssignment: false })
    ).toBe("Arrived");
    expect(
      nextResponderStatus({ currentStatus: "En Route", distanceM: ARRIVED_RADIUS_M, responderPostedAfterAssignment: true })
    ).toBe("Arrived");
  });

  it("leaves Dispatched for En Route once the responder has posted since assignment", () => {
    expect(
      nextResponderStatus({ currentStatus: "Dispatched", distanceM: 4000, responderPostedAfterAssignment: true })
    ).toBe("En Route");
  });

  it("stays put while Dispatched and the responder has not posted yet", () => {
    expect(
      nextResponderStatus({ currentStatus: "Dispatched", distanceM: 4000, responderPostedAfterAssignment: false })
    ).toBeNull();
  });

  it("never moves backwards or past Arrived", () => {
    expect(
      nextResponderStatus({ currentStatus: "En Route", distanceM: 4000, responderPostedAfterAssignment: true })
    ).toBeNull();
    expect(
      nextResponderStatus({ currentStatus: "Arrived", distanceM: 9000, responderPostedAfterAssignment: true })
    ).toBeNull();
  });

  it("treats a NULL status as Dispatched", () => {
    expect(
      nextResponderStatus({ currentStatus: null, distanceM: 4000, responderPostedAfterAssignment: true })
    ).toBe("En Route");
  });

  it("ignores a missing distance", () => {
    expect(
      nextResponderStatus({ currentStatus: "Dispatched", distanceM: null, responderPostedAfterAssignment: true })
    ).toBe("En Route");
  });
});
