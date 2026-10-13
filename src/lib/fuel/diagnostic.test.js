import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FUEL_DIAGNOSTIC_MARKER,
  buildFuelDiagnosticPayload,
  isFuelDiagnosticPayload,
  nextCalendarDay,
} from "./diagnostic";

const base = {
  vehicleId: 12,
  plate: "ABC 1234",
  estimatedKmpl: 6.42,
  baselineKmpl: 8.5,
  variancePercent: -24.5,
  from: "2026-09-01",
  to: "2026-09-30",
  trips: 18,
  km: 1240.5,
  liters: 193.2,
};

afterEach(() => vi.useRealTimers());

describe("buildFuelDiagnosticPayload", () => {
  it("files an Inspection at Normal priority with zero cost, always Scheduled", () => {
    const p = buildFuelDiagnosticPayload(base);
    expect(p.maintenance_type).toBe("Inspection");
    expect(p.priority).toBe("Normal");
    expect(p.cost).toBe(0);
    // The server forces Scheduled regardless, but the payload states it too —
    // a diagnostic is triage, never an in-progress grounding.
    expect(p.status).toBe("Scheduled");
  });

  it("dates the order tomorrow in Manila even when the host is on the previous day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T16:00:00Z"));
    expect(buildFuelDiagnosticPayload(base).maintenance_date).toBe("2027-01-02");
    expect(nextCalendarDay()).toBe("2027-01-02");
  });

  it("names the plate, the estimate-vs-baseline numbers, and the report window", () => {
    const p = buildFuelDiagnosticPayload(base);
    expect(p.description).toContain("ABC 1234");
    expect(p.description).toContain("6.42 km/L");
    expect(p.description).toContain("8.50 km/L");
    expect(p.description).toContain("-24.50%");
    expect(p.description).toContain("2026-09-01");
    expect(p.description).toContain("2026-09-30");
    expect(p.description).toContain("18 trips");
    expect(p.description).toContain("Review before dispatch action.");
  });

  it("carries a machine-readable fuel reference plus the honesty line in remarks", () => {
    const p = buildFuelDiagnosticPayload(base);
    expect(p.remarks).toContain(FUEL_DIAGNOSTIC_MARKER);
    expect(p.remarks).toContain("fuel-consumption report");
    expect(p.remarks).toContain("vehicle_id=12");
    expect(p.remarks).toContain("estimated_kmpl=6.42");
    // Below-baseline is a period aggregate, never evidence about one fill.
    expect(p.remarks).toMatch(/period-aggregate/i);
    expect(p.remarks).toMatch(/do not infer pilferage/i);
  });

  it("falls back to the vehicle id when no plate is known", () => {
    expect(buildFuelDiagnosticPayload({ ...base, plate: null }).description).toContain("vehicle #12");
  });

  it("fits the POST validation bounds (1000-char description/remarks)", () => {
    const p = buildFuelDiagnosticPayload(base);
    expect(p.description.length).toBeLessThanOrEqual(1000);
    expect(p.remarks.length).toBeLessThanOrEqual(1000);
  });
});

describe("isFuelDiagnosticPayload", () => {
  it("arms only for marker-bearing Inspection orders", () => {
    expect(isFuelDiagnosticPayload(buildFuelDiagnosticPayload(base))).toBe(true);
    expect(isFuelDiagnosticPayload({ ...buildFuelDiagnosticPayload(base), remarks: "plain triage note" })).toBe(false);
    expect(isFuelDiagnosticPayload({ maintenance_type: "Repair", remarks: `${FUEL_DIAGNOSTIC_MARKER} copy` })).toBe(false);
    expect(isFuelDiagnosticPayload(null)).toBe(false);
  });
});

it.each([
  ["2026-10-08T16:00:00Z", "2026-10-10"],
  ["2026-10-31T16:00:00Z", "2026-11-02"],
  ["2026-12-31T16:00:00Z", "2027-01-02"],
])("uses Manila tomorrow at %s", (instant, expected) => {
  expect(nextCalendarDay(new Date(instant))).toBe(expected);
});
