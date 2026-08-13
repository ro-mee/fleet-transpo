import { describe, it, expect } from "vitest";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";

describe("canTransitionTrip", () => {
  it("walks the live driver chain one hop at a time", () => {
    expect(canTransitionTrip("Assigned", "Driver Accepted").ok).toBe(true);
    expect(canTransitionTrip("Driver Accepted", "Trip Started").ok).toBe(true);
    expect(canTransitionTrip("Trip Started", "At Pickup").ok).toBe(true);
    expect(canTransitionTrip("At Pickup", "Passenger Onboard").ok).toBe(true);
    expect(canTransitionTrip("Passenger Onboard", "En Route").ok).toBe(true);
    expect(canTransitionTrip("En Route", "Drop-off").ok).toBe(true);
    expect(canTransitionTrip("Drop-off", "Completed").ok).toBe(true);
  });

  it("blocks skipping steps in the lifecycle", () => {
    expect(canTransitionTrip("Assigned", "Trip Started").ok).toBe(false);
    expect(canTransitionTrip("Assigned", "Completed").ok).toBe(false);
    expect(canTransitionTrip("Assigned", "En Route").ok).toBe(false);
    expect(canTransitionTrip("Dispatched", "Driver Accepted").ok).toBe(false);
    expect(canTransitionTrip("Trip Started", "En Route").ok).toBe(false);
    expect(canTransitionTrip("At Pickup", "En Route").ok).toBe(false);
    expect(canTransitionTrip("En Route", "Completed").ok).toBe(false);
  });

  it("normalizes legacy ingest statuses forward or to Assigned", () => {
    expect(canTransitionTrip("Pending", "Approved").ok).toBe(true);
    expect(canTransitionTrip("Approved", "Vehicle Assigned").ok).toBe(true);
    expect(canTransitionTrip("Vehicle Assigned", "Driver Assigned").ok).toBe(true);
    expect(canTransitionTrip("Driver Assigned", "Dispatched").ok).toBe(true);
    expect(canTransitionTrip("Pending", "Assigned").ok).toBe(true);
    expect(canTransitionTrip("Dispatched", "Assigned").ok).toBe(true);
  });

  it("treats Trip Started and In Progress as interoperable phases", () => {
    expect(canTransitionTrip("Trip Started", "In Progress").ok).toBe(true);
    expect(canTransitionTrip("In Progress", "At Pickup").ok).toBe(true);
    expect(canTransitionTrip("In Progress", "En Route").ok).toBe(true);
  });

  it("rejects backwards moves and unknown statuses", () => {
    expect(canTransitionTrip("Arrived", "En Route").ok).toBe(false);
    expect(canTransitionTrip("Completed", "Assigned").ok).toBe(false);
    expect(canTransitionTrip("Assigned", "Not A Status").ok).toBe(false);
  });

  it("allows Cancelled from any non-terminal state", () => {
    expect(canTransitionTrip("Assigned", "Cancelled").ok).toBe(true);
    expect(canTransitionTrip("En Route", "Cancelled").ok).toBe(true);
  });

  it("locks terminal states", () => {
    expect(canTransitionTrip("Completed", "Cancelled").ok).toBe(false);
    expect(canTransitionTrip("Cancelled", "Assigned").ok).toBe(false);
  });

  it("treats same status as a no-op and fresh trips as open", () => {
    expect(canTransitionTrip("Assigned", "Assigned").ok).toBe(true);
    expect(canTransitionTrip(null, "Pending").ok).toBe(true);
  });
});