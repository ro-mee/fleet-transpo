import { describe, it, expect } from "vitest";
import { canTransitionDispatch } from "@/lib/scheduling/dispatch-state";

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
});
