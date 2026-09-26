import { describe, it, expect } from "vitest";
import {
  PRE_SHIFT_CHECKLIST, PRE_TRIP_CHECKLIST, checklistForMode, inspectionTypeForMode,
} from "./inspection-checklist";
import { QUICK_PASS_FAILED_ID } from "./inspection-tour";

describe("inspection-checklist", () => {
  it("Pre-Shift has the full 7 items with the original labels", () => {
    expect(PRE_SHIFT_CHECKLIST.map((i) => i.id))
      .toEqual(["cabin", "aircon", "dashboard", "exterior", "brakes", "tires", "fuel"]);
    expect(PRE_SHIFT_CHECKLIST.find((i) => i.id === "dashboard"))
      .toMatchObject({ passLabel: "NO LIGHTS", failLabel: "WARNING" });
  });
  it("Pre-Trip has exactly the 4 critical items, a subset of Pre-Shift", () => {
    expect(PRE_TRIP_CHECKLIST.map((i) => i.id)).toEqual(["dashboard", "brakes", "tires", "exterior"]);
    const fullIds = PRE_SHIFT_CHECKLIST.map((i) => i.id);
    expect(PRE_TRIP_CHECKLIST.every((i) => fullIds.includes(i.id))).toBe(true);
  });
  it("keeps tires in the quick set — the tour's seeded FAIL depends on it", () => {
    expect(PRE_TRIP_CHECKLIST.map((i) => i.id)).toContain(QUICK_PASS_FAILED_ID);
  });
  it("every item has a label", () => {
    [...PRE_SHIFT_CHECKLIST, ...PRE_TRIP_CHECKLIST].forEach((i) => expect(i.label).toBeTruthy());
  });
  it("maps modes to checklists and API types", () => {
    expect(checklistForMode("pretrip")).toBe(PRE_TRIP_CHECKLIST);
    expect(checklistForMode("preshift")).toBe(PRE_SHIFT_CHECKLIST);
    expect(checklistForMode(undefined)).toBe(PRE_SHIFT_CHECKLIST);
    expect(inspectionTypeForMode("pretrip")).toBe("Pre-Trip");
    expect(inspectionTypeForMode("preshift")).toBe("Pre-Shift");
  });
});
