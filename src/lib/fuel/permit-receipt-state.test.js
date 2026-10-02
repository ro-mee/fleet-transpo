import { describe, expect, it } from "vitest";
import { getPermitReceiptState } from "./permit-receipt-state";

describe("getPermitReceiptState", () => {
  it("identifies an approved active receipt as included in analytics", () => {
    expect(getPermitReceiptState({ active_receipt_count: 1, active_receipt_statuses: ["Approved"] })).toEqual({
      label: "Approved receipt",
      detail: "Included in Fuel Analytics.",
    });
  });

  it("explains pending and rejected receipts are excluded", () => {
    expect(getPermitReceiptState({ active_receipt_count: 1, active_receipt_statuses: ["Pending"] }).detail)
      .toContain("Not included");
    expect(getPermitReceiptState({ active_receipt_count: 1, active_receipt_statuses: ["Rejected"] }).detail)
      .toContain("Excluded");
  });

  it("keeps Completed distinct from the Approved-only analytics scope", () => {
    expect(getPermitReceiptState({ active_receipt_count: 1, active_receipt_statuses: ["Completed"] })).toEqual({
      label: "Completed receipt",
      detail: "Fuel Analytics currently counts Approved records only.",
    });
  });

  it("distinguishes archived receipts from active analytics records", () => {
    expect(getPermitReceiptState({ status: "Fulfilled", archived_receipt_count: 1 })).toEqual({
      label: "Receipt archived",
      detail: "Archived receipts are excluded from the active registry and Fuel Analytics.",
    });
  });

  it("shows archived receipts alongside an active receipt", () => {
    expect(getPermitReceiptState({
      active_receipt_count: 1,
      archived_receipt_count: 2,
      active_receipt_statuses: ["Approved"],
    })).toEqual({
      label: "Approved receipt",
      detail: "Included in Fuel Analytics. 2 archived receipts are also linked.",
    });
  });

  it("keeps multiple active receipts plural even when their status matches", () => {
    expect(getPermitReceiptState({
      active_receipt_count: 2,
      active_receipt_statuses: ["Approved"],
    })).toMatchObject({ label: "2 active receipts" });
  });

  it("surfaces a fulfilled permit with no linked receipt for reconciliation", () => {
    expect(getPermitReceiptState({ status: "Fulfilled" }).label).toBe("No active receipt found");
  });

  it("keeps an approved permit distinct from a recorded fuel transaction", () => {
    expect(getPermitReceiptState({ status: "Approved" })).toEqual({
      label: "Awaiting receipt",
      detail: "The permit is authorized; consumption is recorded after refueling.",
    });
  });
});
