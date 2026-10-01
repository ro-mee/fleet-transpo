import { describe, expect, it } from "vitest";
import {
  CHECKLIST_FAIL,
  CHECKLIST_PASS,
  QUICK_PASS_FAILED_ID,
  QUICK_PASS_FAIL_REMARK,
  buildQuickPassStatuses,
} from "./inspection-tour";
import { PRE_TRIP_CHECKLIST as CHECKLIST } from "./inspection-checklist";

// The tour walks the QUICK pre-trip set: the map checkpoint pushes
// /inspection?tour=1, which resolves to mode "pretrip" (4 items).
//
// This used to be a deliberate local copy of the 7-item list, kept so that "a
// change to the checklist does not silently change what these tests assert".
// That independence is traded here for the guarantee that matters more: that
// the item the tour seeds as FAIL (QUICK_PASS_FAILED_ID = tires) is still IN
// the set the tour actually walks. A local copy of the 7-point list would keep
// passing while the tour ran a set that no longer contained tires — the tests
// would be green and the tour broken. The ids themselves stay pinned literally
// in inspection-checklist.test.js, which is where "is this the right set?"
// belongs.

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
    const custom = buildQuickPassStatuses(CHECKLIST, "brakes_tires");
    expect(custom.brakes_tires).toBe(CHECKLIST_FAIL);
    expect(custom.passenger_items).toBe(CHECKLIST_PASS);
  });
});
