// Tests for the shared trip-phase resolver (src/lib/trip-phase.js).
//
// This is the single interpretation of trip_status → phase. Two contracts:
// 1. Every LIVE_TRIP_STATUSES value resolves to a non-null phase — a status
//    added to the live window without a phase mapping must fail here, not
//    silently read as "no target" in the monitor.
// 2. The exact mappings the live map's mapTargetFor previously hardcoded
//    (PICKUP_ROUTE_STATUSES / PICKUP_CONTEXT_STATUSES / DESTINATION_ROUTE /
//    DESTINATION_CONTEXT) — pins the refactor to identical behavior.
import { describe, it, expect } from "vitest";
import { resolveTripPhase, phaseCapableStatuses } from "@/lib/trip-phase";
import { LIVE_TRIP_STATUSES } from "@/lib/constants";

describe("resolveTripPhase", () => {
  it("resolves every LIVE_TRIP_STATUSES value to a phase", () => {
    for (const status of LIVE_TRIP_STATUSES) {
      const { phase } = resolveTripPhase(status);
      expect(
        ["to_pickup", "to_destination"],
        `LIVE status "${status}" has no phase`
      ).toContain(phase);
    }
  });

  it("maps every phase-capable status into the live window (no extra statuses)", () => {
    const capable = new Set(phaseCapableStatuses());
    const live = new Set(LIVE_TRIP_STATUSES);
    expect([...capable].every((s) => live.has(s))).toBe(true);
  });

  it("preserves the live map's pickup mappings", () => {
    // Route-drawing pickup phase (was PICKUP_ROUTE_STATUSES).
    expect(resolveTripPhase("Trip Started")).toEqual({ phase: "to_pickup", drawRoute: true });
    // Context-only pickup phase (was PICKUP_CONTEXT_STATUSES).
    expect(resolveTripPhase("At Pickup")).toEqual({ phase: "to_pickup", drawRoute: false });
    // Pre-trip statuses: pickup phase, but no route line yet.
    expect(resolveTripPhase("Dispatched")).toEqual({ phase: "to_pickup", drawRoute: false });
    expect(resolveTripPhase("Driver Accepted")).toEqual({ phase: "to_pickup", drawRoute: false });
  });

  it("preserves the live map's destination mappings", () => {
    // Route-drawing destination phase (was DESTINATION_ROUTE_STATUSES).
    expect(resolveTripPhase("Passenger Onboard")).toEqual({ phase: "to_destination", drawRoute: true });
    expect(resolveTripPhase("En Route")).toEqual({ phase: "to_destination", drawRoute: true });
    expect(resolveTripPhase("In Progress")).toEqual({ phase: "to_destination", drawRoute: true });
    // Context-only destination phase (was DESTINATION_CONTEXT_STATUSES).
    expect(resolveTripPhase("Drop-off")).toEqual({ phase: "to_destination", drawRoute: false });
    expect(resolveTripPhase("Arrived")).toEqual({ phase: "to_destination", drawRoute: false });
  });

  it("resolves non-live statuses to a null phase", () => {
    for (const status of ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Completed", "Cancelled", "", null, undefined]) {
      expect(resolveTripPhase(status)).toEqual({ phase: null, drawRoute: false });
    }
  });
});
