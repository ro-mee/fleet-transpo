import { describe, it, expect } from "vitest";
import { canTransitionDispatch, isValidDispatchStatus } from "@/lib/scheduling/dispatch-state";

describe("canTransitionDispatch", () => {
  it("moves forward Scheduled -> In Progress -> Completed", () => {
    expect(canTransitionDispatch("Scheduled", "In Progress").ok).toBe(true);
    expect(canTransitionDispatch("In Progress", "Completed").ok).toBe(true);
  });
  it("rejects backwards moves", () => {
    expect(canTransitionDispatch("Completed", "Scheduled").ok).toBe(false);
    expect(canTransitionDispatch("In Progress", "Scheduled").ok).toBe(false);
  });
  it("allows Cancelled from any non-terminal state", () => {
    expect(canTransitionDispatch("Scheduled", "Cancelled").ok).toBe(true);
    expect(canTransitionDispatch("In Progress", "Cancelled").ok).toBe(true);
  });
  it("locks terminal states", () => {
    expect(canTransitionDispatch("Completed", "Cancelled").ok).toBe(false);
    expect(canTransitionDispatch("Cancelled", "Scheduled").ok).toBe(false);
  });

  // 'Pending Reassignment' is in the live chk_dispatch_status constraint and in
  // DISPATCH_STATUS, and the incident path sets it on a real dispatch. The
  // validator used to reject it outright, so the one status it could never
  // describe was one the database already stored.
  describe("Pending Reassignment", () => {
    it("is a valid status", () => {
      expect(isValidDispatchStatus("Pending Reassignment")).toBe(true);
    });
    it("accepts the incident interrupt from either active state", () => {
      expect(canTransitionDispatch("Scheduled", "Pending Reassignment").ok).toBe(true);
      expect(canTransitionDispatch("In Progress", "Pending Reassignment").ok).toBe(true);
    });
    it("can still be cancelled while stranded", () => {
      expect(canTransitionDispatch("Pending Reassignment", "Cancelled").ok).toBe(true);
    });
    it("refuses a bare status flip back to Scheduled", () => {
      // Reassigning vehicle/driver via PUT /api/dispatch/[id] is what clears
      // this state. Allowing the flip on its own would mark a dispatch
      // Scheduled with vehicle_id and driver_id still NULL.
      expect(canTransitionDispatch("Pending Reassignment", "Scheduled").ok).toBe(false);
    });
    it("is not reachable from a terminal state", () => {
      expect(canTransitionDispatch("Completed", "Pending Reassignment").ok).toBe(false);
      expect(canTransitionDispatch("Cancelled", "Pending Reassignment").ok).toBe(false);
    });
  });
});
