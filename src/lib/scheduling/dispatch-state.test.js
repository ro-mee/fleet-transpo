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
  it("treats Pending Reassignment as a first-class state", () => {
    expect(canTransitionDispatch("Scheduled", "Pending Reassignment").ok).toBe(true);
    expect(canTransitionDispatch("In Progress", "Pending Reassignment").ok).toBe(true);
    expect(canTransitionDispatch("Pending Reassignment", "Scheduled").ok).toBe(true);
    expect(canTransitionDispatch("Pending Reassignment", "Cancelled").ok).toBe(true);
    expect(canTransitionDispatch("Pending Reassignment", "In Progress").ok).toBe(false);
    expect(canTransitionDispatch("Completed", "Pending Reassignment").ok).toBe(false);
  });
});
