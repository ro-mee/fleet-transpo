import { describe, it, expect } from "vitest";
import { evaluateRequestConflicts } from "@/lib/scheduling/conflicts";
import { CONFLICT_TYPE } from "@/lib/scheduling/conflict-types";

const REQ = {
  request_id: 1,
  passenger_count: 2,
  pickup_datetime: "2026-08-12T10:10:00.000Z", // 10:10 pickup
};

// Rule (§4.8.3): previous commitment ends 10:00, ETA 12 min, buffer 5 → earliest
// next available 10:17. Pickup 10:10 → BLOCKING.
const DRIVER = {
  driver_id: 5,
  first_name: "Juan",
  last_name: "Dela Cruz",
  _previous_busy_end: "2026-08-12T10:00:00.000Z",
  _eta_to_pickup_min: 12,
};

describe("evaluateRequestConflicts — travel buffer (§4.8.3)", () => {
  it("blocks a pickup that is too soon after the previous trip", () => {
    const findings = evaluateRequestConflicts(REQ, {
      driver: DRIVER,
      safetyBufferMinutes: 5,
      bufferFloorMinutes: 0,
      travelBufferEnabled: true,
    });
    expect(findings.some((f) => f.type === CONFLICT_TYPE.TRAVEL_BUFFER && f.severity === "blocking")).toBe(true);
  });

  it("does NOT block when the pickup clears the buffer", () => {
    const findings = evaluateRequestConflicts(
      { ...REQ, pickup_datetime: "2026-08-12T10:20:00.000Z" },
      { driver: DRIVER, safetyBufferMinutes: 5, bufferFloorMinutes: 0, travelBufferEnabled: true }
    );
    expect(findings.some((f) => f.type === CONFLICT_TYPE.TRAVEL_BUFFER)).toBe(false);
  });

  it("fails open when no previous commitment is known", () => {
    const findings = evaluateRequestConflicts(REQ, {
      driver: { ...DRIVER, _previous_busy_end: null },
      safetyBufferMinutes: 5,
      bufferFloorMinutes: 0,
      travelBufferEnabled: true,
    });
    expect(findings.some((f) => f.type === CONFLICT_TYPE.TRAVEL_BUFFER)).toBe(false);
  });

  it("fails open when ETA is unknown", () => {
    const findings = evaluateRequestConflicts(REQ, {
      driver: { ...DRIVER, _eta_to_pickup_min: null },
      safetyBufferMinutes: 5,
      bufferFloorMinutes: 0,
      travelBufferEnabled: true,
    });
    expect(findings.some((f) => f.type === CONFLICT_TYPE.TRAVEL_BUFFER)).toBe(false);
  });

  it("skips the rule when travelBufferEnabled is false", () => {
    const findings = evaluateRequestConflicts(REQ, {
      driver: DRIVER,
      safetyBufferMinutes: 5,
      bufferFloorMinutes: 0,
      travelBufferEnabled: false,
    });
    expect(findings.some((f) => f.type === CONFLICT_TYPE.TRAVEL_BUFFER)).toBe(false);
  });
});