import { describe, it, expect } from "vitest";
import {
  INSPECTION_TYPES, PRE_SHIFT_ITEMS, PRE_TRIP_ITEMS, CRITICAL_ITEM_IDS,
  itemsForType, isChecklistType, validateChecklist, validatePostShift,
  failedItemsFrom,
} from "./checklists";

const items = (ids, status = "PASS", remarks = "") =>
  ids.map((item_id) => ({ item_id, label: item_id, status, remarks }));

describe("checklists", () => {
  it("exposes exactly the three spec types", () => {
    expect(INSPECTION_TYPES).toEqual(["Pre-Shift", "Pre-Trip", "Post-Shift"]);
  });
  it("Pre-Shift is the full 7-point set; Pre-Trip is the 4 critical items", () => {
    expect(PRE_SHIFT_ITEMS).toEqual(["cabin", "aircon", "dashboard", "exterior", "brakes", "tires", "fuel"]);
    expect(PRE_TRIP_ITEMS).toEqual(["dashboard", "brakes", "tires", "exterior"]);
    expect(CRITICAL_ITEM_IDS).toEqual(PRE_TRIP_ITEMS);
    expect(PRE_TRIP_ITEMS.every((id) => PRE_SHIFT_ITEMS.includes(id))).toBe(true);
  });
  it("itemsForType returns null for unknown types and for Post-Shift", () => {
    expect(itemsForType("Pre-Shift")).toEqual(PRE_SHIFT_ITEMS);
    expect(itemsForType("Pre-Trip")).toEqual(PRE_TRIP_ITEMS);
    expect(itemsForType("Post-Trip")).toBeNull();
    // Post-Shift is a known type with no item set, so it also returns null —
    // which is exactly why isChecklistType exists. Null alone cannot tell the
    // two apart, and the API needs to answer "did you send the wrong thing?"
    // differently from "there is nothing to send".
    expect(itemsForType("Post-Shift")).toBeNull();
    expect(isChecklistType("Pre-Shift")).toBe(true);
    expect(isChecklistType("Pre-Trip")).toBe(true);
    expect(isChecklistType("Post-Shift")).toBe(false);
    expect(isChecklistType("Post-Trip")).toBe(false);
  });
  it("rejects unknown inspection_type", () => {
    expect(validateChecklist("Monthly", items(PRE_TRIP_ITEMS))).toEqual({
      ok: false, error: "inspection_type must be Pre-Shift, Pre-Trip or Post-Shift",
    });
  });
  it("tells a Post-Shift caller it sent the wrong shape, not the wrong count", () => {
    expect(validateChecklist("Post-Shift", items(PRE_TRIP_ITEMS))).toEqual({
      ok: false, error: "Post-Shift carries no checklist — send a report instead",
    });
    expect(validateChecklist("Post-Shift", [])).toEqual({
      ok: false, error: "Post-Shift carries no checklist — send a report instead",
    });
  });
  it("rejects empty and wrong-count item lists per type", () => {
    expect(validateChecklist("Pre-Trip", []).ok).toBe(false);
    expect(validateChecklist("Pre-Trip", items(PRE_SHIFT_ITEMS)).error)
      .toBe("exactly 4 inspection items are required for Pre-Trip");
    expect(validateChecklist("Pre-Shift", items(PRE_TRIP_ITEMS)).error)
      .toBe("exactly 7 inspection items are required for Pre-Shift");
  });
  it("rejects ids outside the type set, duplicates, and missing ids", () => {
    const withCabin = [...PRE_TRIP_ITEMS.slice(0, 3), "cabin"];
    expect(validateChecklist("Pre-Trip", items(withCabin)).ok).toBe(false);
    const dup = [...PRE_TRIP_ITEMS.slice(0, 3), PRE_TRIP_ITEMS[0]];
    expect(validateChecklist("Pre-Trip", items(dup)).ok).toBe(false);
    const missingTires = PRE_TRIP_ITEMS.filter((id) => id !== "tires").concat("cabin");
    expect(validateChecklist("Pre-Trip", items(missingTires)).ok).toBe(false);
  });
  it("requires FAIL remarks, caps length, accepts all-PASS", () => {
    const failNoRemarks = PRE_TRIP_ITEMS.map((item_id) =>
      ({ item_id, status: item_id === "brakes" ? "FAIL" : "PASS", remarks: "  " }));
    expect(validateChecklist("Pre-Trip", failNoRemarks)).toEqual({
      ok: false, error: "remarks are required for failed item 'brakes'",
    });
    const long = items(PRE_SHIFT_ITEMS, "PASS").map((i) => ({ ...i, remarks: "x".repeat(1001) }));
    expect(validateChecklist("Pre-Shift", long).error).toBe("inspection remarks must be 1000 characters or fewer");
    expect(validateChecklist("Pre-Shift", items(PRE_SHIFT_ITEMS))).toEqual({ ok: true });
    expect(validateChecklist("Pre-Trip", items(PRE_TRIP_ITEMS, "FAIL", "noise"))).toEqual({ ok: true });
  });
  it("rejects invalid statuses and non-array input", () => {
    expect(validateChecklist("Pre-Trip", items(PRE_TRIP_ITEMS).map((i, idx) =>
      idx === 0 ? { ...i, status: "MAYBE" } : i)).ok).toBe(false);
    expect(validateChecklist("Pre-Trip", null).ok).toBe(false);
  });
});

describe("validatePostShift", () => {
  it("accepts a clean report and reports it as not-reported", () => {
    expect(validatePostShift({ nothing_unusual: true }))
      .toEqual({ ok: true, reported: false, findings: null });
  });

  it("accepts an observation and returns it trimmed", () => {
    expect(validatePostShift({ findings: "  may kalansing sa preno  " }))
      .toEqual({ ok: true, reported: true, findings: "may kalansing sa preno" });
  });

  it("treats empty or whitespace findings as no answer at all", () => {
    expect(validatePostShift({ findings: "   " }).ok).toBe(false);
    expect(validatePostShift({}).ok).toBe(false);
    expect(validatePostShift().ok).toBe(false);
    expect(validatePostShift({ nothing_unusual: false }).ok).toBe(false);
  });

  it("rejects both answers at once", () => {
    expect(validatePostShift({ nothing_unusual: true, findings: "may usok" }).error)
      .toBe("report either nothing_unusual or findings, not both");
  });

  it("reads a stringified false as NOT clean, never as 'nothing unusual'", () => {
    // The trap: "false" is a truthy string. A truthiness test here would mark a
    // reported fault as all-clear and skip the maintenance work order, leaving
    // the vehicle on the road.
    expect(validatePostShift({ nothing_unusual: "false" }).ok).toBe(false);
    expect(validatePostShift({ nothing_unusual: "true" }).ok).toBe(false);
    expect(validatePostShift({ nothing_unusual: 1 }).ok).toBe(false);
  });

  it("caps the findings length, matching the per-item remarks cap", () => {
    expect(validatePostShift({ findings: "x".repeat(1000) }).ok).toBe(true);
    expect(validatePostShift({ findings: "x".repeat(1001) }).error)
      .toBe("findings must be 1000 characters or fewer");
  });
});

describe("failedItemsFrom", () => {
  it("keeps only the FAIL items, with the driver's remark trimmed", () => {
    expect(failedItemsFrom([
      { item_id: "cabin", label: "Cabin", status: "PASS", remarks: "" },
      { item_id: "brakes", label: "Brakes", status: "FAIL", remarks: "  malambot ang preno  " },
      { item_id: "tires", label: "Tires", status: "FAIL", remarks: "kupas ang gulong" },
    ])).toEqual([
      { label: "Brakes", remarks: "malambot ang preno" },
      { label: "Tires", remarks: "kupas ang gulong" },
    ]);
  });

  it("falls back to item_id when a stored item carries no label", () => {
    expect(failedItemsFrom([{ item_id: "dashboard", status: "FAIL", remarks: "warning light" }]))
      .toEqual([{ label: "dashboard", remarks: "warning light" }]);
  });

  it("returns an empty list for null, a non-array, or a remark-less item", () => {
    // Post-Shift stores checklist as NULL by construction, so this is the
    // ordinary case for one of the three types, not an edge case.
    expect(failedItemsFrom(null)).toEqual([]);
    expect(failedItemsFrom("oops")).toEqual([]);
    expect(failedItemsFrom([{ item_id: "brakes", label: "Brakes", status: "FAIL" }]))
      .toEqual([{ label: "Brakes", remarks: "" }]);
  });
});
