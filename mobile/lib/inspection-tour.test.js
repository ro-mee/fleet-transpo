import { describe, expect, it } from "vitest";
import {
  CHECKLIST_FAIL,
  CHECKLIST_PASS,
  QUICK_PASS_FAILED_ID,
  QUICK_PASS_FAIL_REMARK,
  buildQuickPassStatuses,
} from "./inspection-tour";

// Mirrors the checklist in app/(app)/inspection.js. Kept as a local copy so a
// change to the checklist does not silently change what these tests assert.
const CHECKLIST = [
  { id: "cabin" },
  { id: "aircon" },
  { id: "dashboard" },
  { id: "exterior" },
  { id: "brakes" },
  { id: "tires" },
  { id: "fuel" },
];

describe("Quick Pass All statuses", () => {
  const statuses = buildQuickPassStatuses(CHECKLIST);

  it("keys every checklist item", () => {
    expect(Object.keys(statuses).sort()).toEqual(CHECKLIST.map((i) => i.id).sort());
  });

  it("fails exactly one item, so the remarks tip has a target to anchor to", () => {
    const failed = Object.entries(statuses).filter(([, v]) => v === CHECKLIST_FAIL);
    expect(failed).toHaveLength(1);
    expect(failed[0][0]).toBe(QUICK_PASS_FAILED_ID);
  });

  it("passes every other item", () => {
    const passed = Object.entries(statuses).filter(([, v]) => v === CHECKLIST_PASS);
    expect(passed).toHaveLength(CHECKLIST.length - 1);
  });

  it("fails an item that is actually in the checklist", () => {
    expect(CHECKLIST.map((i) => i.id)).toContain(QUICK_PASS_FAILED_ID);
  });

  it("ships a remark for the failed item, which handleSubmit requires", () => {
    expect(QUICK_PASS_FAIL_REMARK.trim().length).toBeGreaterThan(0);
  });

  it("emits only the two status strings the checklist buttons write", () => {
    for (const value of Object.values(statuses)) {
      expect([CHECKLIST_PASS, CHECKLIST_FAIL]).toContain(value);
    }
  });

  it("tolerates an empty checklist", () => {
    expect(buildQuickPassStatuses([])).toEqual({});
  });

  it("fails the requested item when told which one", () => {
    const custom = buildQuickPassStatuses(CHECKLIST, "brakes");
    expect(custom.brakes).toBe(CHECKLIST_FAIL);
    expect(custom.tires).toBe(CHECKLIST_PASS);
  });
});
