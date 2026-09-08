import { describe, it, expect } from "vitest";
import { evaluateRouteFeasibility } from "@/lib/scheduling/route-feasibility";

const AT = "2026-09-07T08:15:00+08:00";
const PICKUP_9AM = "2026-09-07T09:00:00+08:00";
const NEXT_11AM = "2026-09-07T11:00:00+08:00";

describe("evaluateRouteFeasibility", () => {
  it("returns SAFE for the locked acceptance case (8:15 → 9:00 → 11:00)", () => {
    const out = evaluateRouteFeasibility({
      now: AT,
      pickupAt: PICKUP_9AM,
      deadheadMinutes: 19,
      passengerMinutes: 42,
      nextPickupAt: NEXT_11AM,
      repositionMinutes: 25,
      safetyBufferMinutes: 10,
    });
    expect(out.verdict).toBe("SAFE");
    // Required departure 8:31, 16 min of slack, arrival 9:42, turnaround 53.
    expect(out.requiredDeparture.toISOString()).toBe(new Date("2026-09-07T08:31:00+08:00").toISOString());
    expect(out.pickupBufferMin).toBe(16);
    expect(out.expectedArrival.toISOString()).toBe(new Date("2026-09-07T09:42:00+08:00").toISOString());
    expect(out.turnaroundMin).toBe(53);
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  it("returns INFEASIBLE when the driver needed to depart in the past", () => {
    const out = evaluateRouteFeasibility({
      now: AT,
      pickupAt: PICKUP_9AM,
      deadheadMinutes: 38,
      passengerMinutes: 42,
      safetyBufferMinutes: 10,
    });
    expect(out.verdict).toBe("INFEASIBLE");
    expect(out.pickupBufferMin).toBe(-3);
    expect(out.reasons.join(" ")).toMatch(/3 minutes? ago/);
  });

  it("returns TIGHT when slack is positive but below the safety buffer", () => {
    const out = evaluateRouteFeasibility({
      now: AT,
      pickupAt: PICKUP_9AM,
      deadheadMinutes: 30,
      passengerMinutes: 42,
      safetyBufferMinutes: 10,
    });
    // 45 - 30 - 10 = 5 min of slack: feasible, but tight.
    expect(out.verdict).toBe("TIGHT");
    expect(out.pickupBufferMin).toBe(5);
  });

  it("returns INFEASIBLE on next-trip collision", () => {
    const out = evaluateRouteFeasibility({
      now: AT,
      pickupAt: PICKUP_9AM,
      deadheadMinutes: 10,
      passengerMinutes: 100, // arrival 10:40
      nextPickupAt: "2026-09-07T10:45:00+08:00",
      repositionMinutes: 10, // 10:40 + 10 = 10:50 > 10:45
      safetyBufferMinutes: 10,
    });
    expect(out.verdict).toBe("INFEASIBLE");
    expect(out.turnaroundMin).toBe(-5);
    expect(out.reasons.join(" ")).toMatch(/next assigned pickup/);
  });

  it("returns TIGHT on thin turnaround", () => {
    const out = evaluateRouteFeasibility({
      now: AT,
      pickupAt: PICKUP_9AM,
      deadheadMinutes: 10,
      passengerMinutes: 42, // arrival 9:42
      nextPickupAt: "2026-09-07T10:10:00+08:00",
      repositionMinutes: 20, // 28 - 20 = 8 min turnaround < 10 buffer
      safetyBufferMinutes: 10,
    });
    expect(out.verdict).toBe("TIGHT");
    expect(out.turnaroundMin).toBe(8);
  });

  it("fails open to UNKNOWN when a leg ETA is missing", () => {
    const out = evaluateRouteFeasibility({
      now: AT,
      pickupAt: PICKUP_9AM,
      deadheadMinutes: null,
      passengerMinutes: 42,
      safetyBufferMinutes: 10,
    });
    expect(out.verdict).toBe("UNKNOWN");
    expect(out.requiredDeparture).toBeNull();
  });

  it("grades the pickup leg alone when there is no next dispatch", () => {
    const out = evaluateRouteFeasibility({
      now: AT,
      pickupAt: PICKUP_9AM,
      deadheadMinutes: 19,
      passengerMinutes: 42,
      nextPickupAt: null,
      safetyBufferMinutes: 10,
    });
    expect(out.verdict).toBe("SAFE");
    expect(out.turnaroundMin).toBeNull();
  });

  it("fails open to UNKNOWN when pickup or now is unknown", () => {
    expect(
      evaluateRouteFeasibility({ now: AT, pickupAt: null, deadheadMinutes: 10, passengerMinutes: 10 }).verdict
    ).toBe("UNKNOWN");
    expect(
      evaluateRouteFeasibility({ now: null, pickupAt: PICKUP_9AM, deadheadMinutes: 10, passengerMinutes: 10 }).verdict
    ).toBe("UNKNOWN");
  });
});
