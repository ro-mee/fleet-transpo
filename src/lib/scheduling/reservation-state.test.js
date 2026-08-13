import { describe, it, expect } from "vitest";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import {
  canTransitionReservation,
  isTerminalReservationStatus,
  isValidReservationStatus,
  nextStatuses,
  transitionPath,
} from "@/lib/scheduling/reservation-state";

describe("reservation state machine — linear chain", () => {
  it("isValidReservationStatus accepts the new status set only", () => {
    for (const st of [L.PENDING, L.SCHEDULED, L.ASSIGNED, L.IN_PROGRESS, L.COMPLETED, L.CANCELLED]) {
      expect(isValidReservationStatus(st)).toBe(true);
    }
    expect(isValidReservationStatus("Under Review")).toBe(false);
    expect(isValidReservationStatus("Approved")).toBe(false);
    expect(isValidReservationStatus("Rejected")).toBe(false);
  });

  it("marks Completed and Cancelled as terminal", () => {
    expect(isTerminalReservationStatus(L.COMPLETED)).toBe(true);
    expect(isTerminalReservationStatus(L.CANCELLED)).toBe(true);
    expect(isTerminalReservationStatus(L.PENDING)).toBe(false);
    expect(isTerminalReservationStatus(L.ASSIGNED)).toBe(false);
  });
});

describe("canTransitionReservation", () => {
  it("walks the chain forward one hop at a time", () => {
    expect(canTransitionReservation(L.PENDING, L.SCHEDULED).ok).toBe(true);
    expect(canTransitionReservation(L.SCHEDULED, L.ASSIGNED).ok).toBe(true);
    expect(canTransitionReservation(L.ASSIGNED, L.IN_PROGRESS).ok).toBe(true);
    expect(canTransitionReservation(L.IN_PROGRESS, L.COMPLETED).ok).toBe(true);
  });

  it("rejects skips (Pending -> Assigned)", () => {
    expect(canTransitionReservation(L.PENDING, L.ASSIGNED).ok).toBe(false);
  });

  it("allows cancellation from any non-terminal state", () => {
    for (const st of [L.PENDING, L.SCHEDULED, L.ASSIGNED, L.IN_PROGRESS]) {
      expect(canTransitionReservation(st, L.CANCELLED).ok).toBe(true);
    }
  });

  it("locks terminal states", () => {
    expect(canTransitionReservation(L.COMPLETED, L.CANCELLED).ok).toBe(false);
    expect(canTransitionReservation(L.CANCELLED, L.PENDING).ok).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(canTransitionReservation(L.PENDING, "Approved").ok).toBe(false);
  });
});

describe("transitionPath", () => {
  it("computes the path through the chain", () => {
    expect(transitionPath(L.PENDING, L.SCHEDULED)).toEqual([L.PENDING, L.SCHEDULED]);
    expect(transitionPath(L.PENDING, L.IN_PROGRESS)).toEqual([
      L.PENDING,
      L.SCHEDULED,
      L.ASSIGNED,
      L.IN_PROGRESS,
    ]);
    expect(transitionPath(L.PENDING, L.COMPLETED)).toEqual([
      L.PENDING,
      L.SCHEDULED,
      L.ASSIGNED,
      L.IN_PROGRESS,
      L.COMPLETED,
    ]);
  });

  it("returns null for unreachable targets", () => {
    expect(transitionPath(L.IN_PROGRESS, L.SCHEDULED)).toBeNull();
    expect(transitionPath(L.COMPLETED, L.CANCELLED)).toBeNull();
  });
});

describe("nextStatuses", () => {
  it("exposes the single forward hop plus Cancelled for non-terminal states", () => {
    expect(nextStatuses(L.PENDING)).toEqual([L.SCHEDULED, L.CANCELLED]);
    expect(nextStatuses(L.ASSIGNED)).toEqual([L.IN_PROGRESS, L.CANCELLED]);
    expect(nextStatuses(L.IN_PROGRESS)).toEqual([L.COMPLETED, L.CANCELLED]);
  });

  it("returns none for terminal states", () => {
    expect(nextStatuses(L.COMPLETED)).toEqual([]);
    expect(nextStatuses(L.CANCELLED)).toEqual([]);
  });
});