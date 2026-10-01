import { describe, it, expect } from "vitest";
import {
  PRE_SHIFT_CHECKLIST, PRE_TRIP_CHECKLIST, checklistForMode, inspectionTypeForMode,
} from "./inspection-checklist";
import { QUICK_PASS_FAILED_ID } from "./inspection-tour";

describe("inspection-checklist", () => {
  it("Pre-Shift has the 5 vehicle baseline items with the spec labels", () => {
    expect(PRE_SHIFT_CHECKLIST.map((i) => i.id))
      .toEqual(["sounds", "lights", "dashboard", "steering", "brakes_tires"]);
    expect(PRE_SHIFT_CHECKLIST.find((i) => i.id === "dashboard"))
      .toMatchObject({ passLabel: "NONE", failLabel: "WARNING LIGHT PRESENT" });
    expect(PRE_SHIFT_CHECKLIST.find((i) => i.id === "sounds"))
      .toMatchObject({ passLabel: "NO UNUSUAL SOUND", failLabel: "UNUSUAL SOUND HEARD" });
  });

  it("Pre-Trip has the 3 items: brakes/tires, passenger items, and cabin ready acknowledgment", () => {
    expect(PRE_TRIP_CHECKLIST.map((i) => i.id)).toEqual(["brakes_tires", "passenger_items", "cabin_ready"]);
  });

  it("keeps the tutorial failed item in the quick set", () => {
    expect(PRE_TRIP_CHECKLIST.map((i) => i.id)).toContain(QUICK_PASS_FAILED_ID);
  });

  it("every item has a label and question or reminders", () => {
    PRE_SHIFT_CHECKLIST.forEach((i) => {
      expect(i.label).toBeTruthy();
      expect(i.question).toBeTruthy();
    });
    PRE_TRIP_CHECKLIST.forEach((i) => {
      expect(i.label).toBeTruthy();
    });
  });

  it("every item has UI/UX metadata: icon, shortTitle, and findingTone", () => {
    [...PRE_SHIFT_CHECKLIST, ...PRE_TRIP_CHECKLIST].forEach((i) => {
      expect(i.icon).toBeTruthy();
      expect(i.shortTitle).toBeTruthy();
      expect(["safety", "service", "readiness"]).toContain(i.findingTone);
    });
    expect(PRE_TRIP_CHECKLIST.find((i) => i.id === "passenger_items")?.findingTone).toBe("service");
    expect(PRE_SHIFT_CHECKLIST.find((i) => i.id === "brakes_tires")?.findingTone).toBe("safety");
  });

  it("maps modes to checklists and API types", () => {
    expect(checklistForMode("pretrip")).toBe(PRE_TRIP_CHECKLIST);
    expect(checklistForMode("preshift")).toBe(PRE_SHIFT_CHECKLIST);
    expect(checklistForMode(undefined)).toBe(PRE_SHIFT_CHECKLIST);
    expect(inspectionTypeForMode("pretrip")).toBe("Pre-Trip");
    expect(inspectionTypeForMode("preshift")).toBe("Pre-Shift");
  });
});
