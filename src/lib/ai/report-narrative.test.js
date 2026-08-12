import { describe, it, expect } from "vitest";
import {
  isDemoPayload,
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