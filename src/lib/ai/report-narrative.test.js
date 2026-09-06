import { describe, it, expect } from "vitest";
import {
  isDemoPayload,
  isValidReportPayload,
  isNarrativeForReport,
  buildReportSnapshot,
  deterministicNarrative,
  parseNarrativeJson,
  FLAG,
} from "./report-narrative";

describe("report-narrative: demo guard", () => {
  it("flags missing/empty payloads as demo", () => {
    expect(isDemoPayload(null)).toBe(true);
    expect(isDemoPayload({})).toBe(true);
    expect(isDemoPayload({ demo: true })).toBe(true);
  });

  it("does not flag real payloads", () => {
    expect(isDemoPayload({ utilization: 82 })).toBe(false);
    expect(isDemoPayload({ demo: false })).toBe(false);
  });
});

describe("report-narrative: payload validity gate", () => {
  it("rejects missing/empty/demo payloads so the query stays disabled", () => {
    expect(isValidReportPayload("drivers", null)).toBe(false);
    expect(isValidReportPayload("drivers", {})).toBe(false);
    expect(isValidReportPayload("fleet", { demo: true, utilization: 80 })).toBe(false);
    expect(isValidReportPayload("fleet", [])).toBe(false);
  });

  it("accepts real payloads per report type, including honest zeros", () => {
    expect(isValidReportPayload("fleet", { utilization: 0, totalTrips: 0, totalDistance: 0, byVehicle: [] })).toBe(true);
    expect(isValidReportPayload("drivers", { totalDrivers: 12, avgScore: 88, topDrivers: [] })).toBe(true);
    expect(isValidReportPayload("fuel", { totalLiters: 0, totalCost: 0 })).toBe(true);
  });

  it("rejects payloads carrying none of the report's fields", () => {
    expect(isValidReportPayload("drivers", { utilization: 55 })).toBe(false);
  });
});

describe("report-narrative: per-tab identity guard", () => {
  const fleetNarrative = { report: "fleet", narrative: "Fleet utilization is at 4%.", actions: [], flag: "watch" };

  it("accepts a narrative whose report matches the selected tab", () => {
    expect(isNarrativeForReport(fleetNarrative, "fleet")).toBe(true);
  });

  it("rejects a stale narrative from another tab (Fleet → Drivers switch)", () => {
    expect(isNarrativeForReport(fleetNarrative, "drivers")).toBe(false);
    expect(isNarrativeForReport(fleetNarrative, "fuel")).toBe(false);
    expect(isNarrativeForReport(fleetNarrative, "maintenance")).toBe(false);
    expect(isNarrativeForReport(fleetNarrative, "financial")).toBe(false);
  });

  it("rejects missing/empty narratives", () => {
    expect(isNarrativeForReport(null, "drivers")).toBe(false);
    expect(isNarrativeForReport({ report: "drivers", narrative: "" }, "drivers")).toBe(false);
    expect(isNarrativeForReport({ report: "drivers", narrative: null }, "drivers")).toBe(false);
  });
});

describe("report-narrative: cross-report contamination", () => {
  const FLEET_PHRASES = ["Fleet utilization", "busiest unit", "idle assets", "idle units"];
  const DRIVER_PHRASES = ["safety performance score", "top performer", "drivers are on the roster"];
  const FUEL_PHRASES = ["of fuel were consumed", "average of PHP"];
  const MAINT_PHRASES = ["work orders", "due for service"];
  const FINANCIAL_PHRASES = ["Total operational cost", "cost-per-km", "PHP 15 threshold", "/km run"];

  const driversPayload = {
    totalDrivers: 12,
    avgScore: 88,
    topDrivers: [{ name: "Juan Dela Cruz", score: 94, trips: 8 }],
  };

  it("drivers narrative never reads as fleet/fuel/maintenance/financial copy", () => {
    const out = deterministicNarrative("drivers", driversPayload);
    const text = `${out.narrative} ${out.actions.join(" ")}`;
    for (const phrase of [...FLEET_PHRASES, ...FUEL_PHRASES, ...MAINT_PHRASES, ...FINANCIAL_PHRASES]) {
      expect(text).not.toContain(phrase);
    }
    expect(out.narrative).toContain("88/100");
    expect(out.narrative).toContain("Juan Dela Cruz");
  });

  it("fleet narrative never reads as driver/fuel/maintenance/financial copy", () => {
    const out = deterministicNarrative("fleet", {
      utilization: 4,
      totalTrips: 1,
      totalDistance: 0,
      byVehicle: [{ plate: "ABC-1234", trips: 1, distance: 0 }],
    });
    const text = `${out.narrative} ${out.actions.join(" ")}`;
    for (const phrase of [...DRIVER_PHRASES, ...FUEL_PHRASES, ...MAINT_PHRASES, ...FINANCIAL_PHRASES]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("fuel/maintenance/financial narratives stay in their own vocabulary", () => {
    const fuel = deterministicNarrative("fuel", { totalLiters: 100, totalCost: 6000, avgCost: 60, byCategory: [] });
    expect(`${fuel.narrative} ${fuel.actions.join(" ")}`).not.toContain("Fleet utilization");
    expect(`${fuel.narrative} ${fuel.actions.join(" ")}`).not.toContain("busiest unit");

    const maint = deterministicNarrative("maintenance", { totalCost: 5000, totalRecords: 2, vehiclesDue: 1, byType: [] });
    expect(maint.narrative).not.toContain("Fleet utilization");
    expect(maint.narrative).not.toContain("safety performance score");

    const fin = deterministicNarrative("financial", { totalCost: 11000, tripCost: 2000, fuelCost: 6000, maintCost: 3000, costPerKm: 12 });
    expect(fin.narrative).not.toContain("busiest unit");
    expect(fin.narrative).not.toContain("safety performance score");
  });
});

describe("report-narrative: snapshot builder", () => {
  it("flattens fleet numbers", () => {
    const s = buildReportSnapshot("fleet", {
      utilization: 82,
      totalTrips: 142,
      totalDistance: 10450,
      byVehicle: [{ plate: "ABC-1", trips: 24, distance: 640 }],
    });
    expect(s.utilization_pct).toBe(82);
    expect(s.total_trips).toBe(142);
    expect(s.total_distance_km).toBe(10450);
    expect(s.top_vehicles).toHaveLength(1);
  });

  it("handles unknown reports gracefully", () => {
    const s = buildReportSnapshot("nope", { a: 1 });
    expect(s.report).toBe("nope");
    expect(s.data).toEqual({ a: 1 });
  });
});

describe("report-narrative: deterministic fallback", () => {
  it("produces a risk flag when vehicles are due for maintenance", () => {
    const out = deterministicNarrative("maintenance", {
      totalCost: 123000,
      totalRecords: 18,
      vehiclesDue: 3,
      byType: [{ type: "Brake Pad Repair", count: 4, cost: 12500 }],
    });
    expect(out.flag).toBe(FLAG.RISK);
    expect(out.narrative).toContain("due for service");
    expect(out.actions.length).toBeGreaterThan(0);
  });

  it("flags low fleet utilization as a watch item", () => {
    const out = deterministicNarrative("fleet", {
      utilization: 45,
      totalTrips: 10,
      totalDistance: 500,
      byVehicle: [{ plate: "A", trips: 10, distance: 500 }],
    });
    expect(out.flag).toBe(FLAG.WATCH);
    expect(out.narrative).toContain("45%");
  });

  it("flags above-target fuel price as a watch item", () => {
    const out = deterministicNarrative("fuel", {
      totalLiters: 2550,
      totalCost: 165750,
      avgCost: 78,
      byCategory: [{ category: "Airport", liters: 650, cost: 50000 }],
    });
    expect(out.flag).toBe(FLAG.WATCH);
  });

  it("returns an empty-safe fallback for unknown reports", () => {
    const out = deterministicNarrative("??", {});
    expect(out.narrative).toBeTruthy();
    expect(out.actions).toEqual([]);
  });
});

describe("report-narrative: LLM JSON parser", () => {
  it("parses a plain object", () => {
    const out = parseNarrativeJson(JSON.stringify({
      narrative: "Costs are up.",
      actions: ["Reduce fuel", "Audit maintenance"],
      flag: "watch",
    }));
    expect(out.narrative).toBe("Costs are up.");
    expect(out.actions).toEqual(["Reduce fuel", "Audit maintenance"]);
    expect(out.flag).toBe(FLAG.WATCH);
  });

  it("parses JSON embedded in a markdown fence", () => {
    const out = parseNarrativeJson('```json\n{"narrative":"OK","actions":["A"],"flag":"risk"}\n```');
    expect(out.narrative).toBe("OK");
    expect(out.flag).toBe(FLAG.RISK);
  });

  it("caps actions at 3 and normalizes a bad flag", () => {
    const out = parseNarrativeJson({
      ...JSON.parse('{"narrative":"X"}'),
      actions: "not-an-array",
    });
    expect(out).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(parseNarrativeJson("garbage")).toBeNull();
    expect(parseNarrativeJson('{"narrative":""}')).toBeNull();
  });
});