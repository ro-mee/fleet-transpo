import { describe, it, expect } from "vitest";
import {
  INSPECTION_TYPES, PRE_SHIFT_ITEMS, PRE_TRIP_ITEMS, PRE_TRIP_CARGO_ITEMS, CRITICAL_ITEM_IDS,
  itemsForType, isChecklistType, validateChecklist, validatePostShift,
  failedItemsFrom, preTripItemsForLoad, blockingItemIdsForType,
} from "./checklists";

const items = (ids, status = "PASS", remarks = "") =>
  ids.map((item_id) => ({ item_id, label: item_id, status, remarks }));

describe("checklists", () => {
  it("exposes exactly the three spec types", () => {
    expect(INSPECTION_TYPES).toEqual(["Pre-Shift", "Pre-Trip", "Post-Shift"]);
  });
  it("Pre-Shift is the 5-point baseline; Pre-Trip is 3 items", () => {
    expect(PRE_SHIFT_ITEMS).toEqual(["sounds", "lights", "dashboard", "steering", "brakes_tires"]);
    expect(PRE_TRIP_ITEMS).toEqual(["brakes_tires", "passenger_items", "cabin_ready"]);
    expect(CRITICAL_ITEM_IDS).toEqual(PRE_SHIFT_ITEMS);
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
      .toBe("exactly 3 inspection items are required for Pre-Trip");
    expect(validateChecklist("Pre-Shift", items(PRE_TRIP_ITEMS)).error)
      .toBe("exactly 5 inspection items are required for Pre-Shift");
  });
  it("rejects ids outside the type set, duplicates, and missing ids", () => {
    const withWrong = ["brakes_tires", "passenger_items", "random_item"];
    expect(validateChecklist("Pre-Trip", items(withWrong)).ok).toBe(false);
    const dup = ["brakes_tires", "passenger_items", "brakes_tires"];
    expect(validateChecklist("Pre-Trip", items(dup)).ok).toBe(false);
    const missing = ["brakes_tires", "cabin_ready"];
    expect(validateChecklist("Pre-Trip", items(missing)).ok).toBe(false);
  });
  it("requires cabin_ready acknowledgment in Pre-Trip", () => {
    const unacknowledged = [
      { item_id: "brakes_tires", label: "Brakes & Tires", status: "PASS", remarks: "" },
      { item_id: "passenger_items", label: "Passenger Check", status: "PASS", remarks: "" },
      { item_id: "cabin_ready", label: "Cabin Ready", status: "FAIL", remarks: "" },
    ];
    expect(validateChecklist("Pre-Trip", unacknowledged)).toEqual({
      ok: false, error: "cabin_ready must be acknowledged before completing Pre-Trip",
    });
  });
  it("requires FAIL remarks, caps length, accepts all-PASS", () => {
    const failNoRemarks = [
      { item_id: "brakes_tires", label: "Brakes & Tires", status: "FAIL", remarks: "  " },
      { item_id: "passenger_items", label: "Passenger Check", status: "PASS", remarks: "" },
      { item_id: "cabin_ready", label: "Cabin Ready", status: "PASS", remarks: "" },
    ];
    expect(validateChecklist("Pre-Trip", failNoRemarks)).toEqual({
      ok: false, error: "remarks are required for failed item 'brakes_tires'",
    });
    const failPassengerNoRemarks = [
      { item_id: "brakes_tires", label: "Brakes & Tires", status: "PASS", remarks: "" },
      { item_id: "passenger_items", label: "Passenger Check", status: "FAIL", remarks: "  " },
      { item_id: "cabin_ready", label: "Cabin Ready", status: "PASS", remarks: "" },
    ];
    expect(validateChecklist("Pre-Trip", failPassengerNoRemarks)).toEqual({
      ok: false, error: "remarks are required for failed item 'passenger_items'",
    });
    const long = items(PRE_SHIFT_ITEMS, "PASS").map((i) => ({ ...i, remarks: "x".repeat(1001) }));
    expect(validateChecklist("Pre-Shift", long).error).toBe("inspection remarks must be 1000 characters or fewer");
    expect(validateChecklist("Pre-Shift", items(PRE_SHIFT_ITEMS))).toEqual({ ok: true });
    expect(validateChecklist("Pre-Trip", [
      { item_id: "brakes_tires", label: "Brakes & Tires", status: "FAIL", remarks: "low tire" },
      { item_id: "passenger_items", label: "Passenger Check", status: "FAIL", remarks: "found umbrella" },
      { item_id: "cabin_ready", label: "Cabin Ready", status: "PASS", remarks: "" },
    ])).toEqual({ ok: true });
  });
  it("rejects invalid statuses and non-array input", () => {
    expect(validateChecklist("Pre-Trip", items(PRE_TRIP_ITEMS).map((i, idx) =>
      idx === 0 ? { ...i, status: "MAYBE" } : i)).ok).toBe(false);
    expect(validateChecklist("Pre-Trip", null).ok).toBe(false);
  });
});

describe("cargo Pre-Trip", () => {
  const cargoItems = (status = "PASS", remarks = "") =>
    PRE_TRIP_CARGO_ITEMS.map((item_id) => ({ item_id, label: item_id, status, remarks }));

  it("demands cargo_secure and never the passenger-items question", () => {
    expect(PRE_TRIP_CARGO_ITEMS).toEqual(["brakes_tires", "cargo_secure", "cabin_ready"]);
    expect(preTripItemsForLoad("Cargo")).toEqual(PRE_TRIP_CARGO_ITEMS);
    expect(preTripItemsForLoad("Passenger")).toEqual(PRE_TRIP_ITEMS);
    expect(preTripItemsForLoad(null)).toEqual(PRE_TRIP_ITEMS);
    expect(itemsForType("Pre-Trip", "Cargo")).toEqual(PRE_TRIP_CARGO_ITEMS);
    expect(itemsForType("Pre-Trip")).toEqual(PRE_TRIP_ITEMS);
    expect(blockingItemIdsForType("Pre-Trip", "Cargo")).toEqual(["brakes_tires", "cargo_secure"]);
    expect(blockingItemIdsForType("Pre-Trip")).toEqual(["brakes_tires"]);
  });

  it("accepts a complete cargo checklist and rejects the passenger set for cargo", () => {
    expect(validateChecklist("Pre-Trip", cargoItems(), { loadType: "Cargo" })).toEqual({ ok: true });
    expect(validateChecklist("Pre-Trip", items(PRE_TRIP_ITEMS), { loadType: "Cargo" }).ok).toBe(false);
    expect(validateChecklist("Pre-Trip", items(PRE_TRIP_ITEMS), { loadType: "Cargo" }).error)
      .toMatch(/passenger_items does not apply to cargo/);
  });

  it("blocks server start on a cargo-secure failure with remarks enforced", () => {
    const failed = cargoItems().map((i) =>
      i.item_id === "cargo_secure" ? { ...i, status: "FAIL", remarks: "" } : i
    );
    expect(validateChecklist("Pre-Trip", failed, { loadType: "Cargo" }).ok).toBe(false);
    const remarked = cargoItems().map((i) =>
      i.item_id === "cargo_secure" ? { ...i, status: "FAIL", remarks: "strap loose" } : i
    );
    expect(validateChecklist("Pre-Trip", remarked, { loadType: "Cargo" })).toEqual({ ok: true });
  });

  it("keeps passenger Pre-Trip, Pre-Shift and Post-Shift unchanged", () => {
    expect(validateChecklist("Pre-Trip", items(PRE_TRIP_ITEMS), { loadType: "Passenger" })).toEqual({ ok: true });
    expect(validateChecklist("Pre-Trip", items(PRE_TRIP_ITEMS))).toEqual({ ok: true });
    expect(validateChecklist("Pre-Shift", items(PRE_SHIFT_ITEMS), { loadType: "Cargo" })).toEqual({ ok: true });
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
