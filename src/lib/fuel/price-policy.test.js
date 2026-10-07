import { describe, expect, it } from "vitest";
import { priceAt, validateSnapshotInput } from "@/lib/fuel/price-policy";

const ROW = {
  snapshot_id: 1,
  fuel_product: "Diesel",
  region: "NCR",
  currency: "PHP",
  unit: "L",
  reference_price: "62.70",
  prior_price: "61.90",
  announced_at: "2026-09-28T09:00:00+08:00",
  effective_at: "2026-10-01T00:00:00+08:00",
  fetched_at: "2026-09-28T09:05:00+08:00",
  source_url: "https://example.ph/doe/diesel",
  verification_method: "Manual",
  lifecycle: "Active",
  source_hash: "abc",
  verified_by: 3,
};

const row = (overrides = {}) => ({ ...ROW, ...overrides });

describe("priceAt", () => {
  it("returns the verified applicable snapshot for product, region and instant", () => {
    const r = priceAt([row()], { fuelType: "Diesel", region: "NCR", at: "2026-10-05T12:00:00+08:00" });
    expect(r?.snapshot_id).toBe(1);
  });

  it("lets the later effective price win at the cutoff", () => {
    const rows = [
      row({ snapshot_id: 1, reference_price: "61.90", effective_at: "2026-09-01T00:00:00+08:00" }),
      row({ snapshot_id: 2, reference_price: "62.70", effective_at: "2026-10-01T00:00:00+08:00" }),
    ];
    expect(priceAt(rows, { fuelType: "Diesel", region: "NCR", at: "2026-10-01T00:00:00+08:00" })?.snapshot_id).toBe(2);
    expect(priceAt(rows, { fuelType: "Diesel", region: "NCR", at: "2026-09-30T23:59:59+08:00" })?.snapshot_id).toBe(1);
  });

  it("keeps future announcements pending and never reprices history", () => {
    const rows = [
      row({ snapshot_id: 1, reference_price: "61.90", effective_at: "2026-09-01T00:00:00+08:00" }),
      row({ snapshot_id: 2, reference_price: "62.70", effective_at: "2026-11-01T00:00:00+08:00", lifecycle: "Pending" }),
    ];
    // Before November the future row is invisible even though it exists.
    expect(priceAt(rows, { fuelType: "Diesel", region: "NCR", at: "2026-10-05T00:00:00+08:00" })?.snapshot_id).toBe(1);
    // A late correction is a new row: a September instant still resolves to
    // the September price after the correction lands.
    const corrected = [...rows, row({ snapshot_id: 3, reference_price: "63.00", effective_at: "2026-10-01T00:00:00+08:00" })];
    expect(priceAt(corrected, { fuelType: "Diesel", region: "NCR", at: "2026-09-15T00:00:00+08:00" })?.reference_price).toBe("61.90");
  });

  it("ignores duplicates deterministically and skips invalid rows", () => {
    const rows = [
      row({ snapshot_id: 1, reference_price: "61.90" }),
      row({ snapshot_id: 2, reference_price: "61.90" }),
    ];
    // Same key twice cannot happen past the unique index; if it ever does,
    // the later record wins deterministically instead of flickering.
    expect(priceAt(rows, { fuelType: "Diesel", region: "NCR", at: "2026-10-05T00:00:00+08:00" })?.snapshot_id).toBe(2);

    const invalid = [
      row({ snapshot_id: 3, reference_price: "NaN" }),
      row({ snapshot_id: 4, reference_price: "-5" }),
      row({ snapshot_id: 5, reference_price: null }),
      row({ snapshot_id: 6, effective_at: "not-a-date" }),
      row({ snapshot_id: 7, fuel_product: "  " }),
      row({ snapshot_id: 8, region: "" }),
      row({ snapshot_id: 9, currency: "USD" }),
      row({ snapshot_id: 10, unit: "gal" }),
    ];
    expect(priceAt(invalid, { fuelType: "Diesel", region: "NCR", at: "2026-10-05T00:00:00+08:00" })).toBeNull();
  });

  it("returns null — unavailable, never zero — when nothing applies", () => {
    expect(priceAt([], { fuelType: "Diesel", region: "NCR", at: "2026-10-05T00:00:00+08:00" })).toBeNull();
    expect(priceAt([row()], { fuelType: "Gasoline", region: "NCR", at: "2026-10-05T00:00:00+08:00" })).toBeNull();
    expect(priceAt([row()], { fuelType: "Diesel", region: "Cebu", at: "2026-10-05T00:00:00+08:00" })).toBeNull();
    expect(priceAt([row()], { fuelType: "Diesel", region: "NCR", at: "not-a-date" })).toBeNull();
    expect(priceAt([row()], { fuelType: "", region: "NCR", at: "2026-10-05T00:00:00+08:00" })).toBeNull();
  });

  it("compares timezone-aware instants exactly", () => {
    // Effective midnight Manila == 16:00Z previous day: an instant one second
    // before that is still the old price.
    const rows = [row({ snapshot_id: 1, reference_price: "61.90", effective_at: "2026-10-01T00:00:00+08:00" })];
    expect(priceAt(rows, { fuelType: "Diesel", region: "NCR", at: "2026-09-30T15:59:59Z" })?.snapshot_id).toBeUndefined();
    expect(priceAt(rows, { fuelType: "Diesel", region: "NCR", at: "2026-09-30T15:59:59Z" })).toBeNull();
    expect(priceAt(rows, { fuelType: "Diesel", region: "NCR", at: "2026-09-30T16:00:00Z" })?.snapshot_id).toBe(1);
  });
});

describe("validateSnapshotInput", () => {
  const input = () => ({
    fuel_product: "Diesel",
    region: "NCR",
    reference_price: 62.7,
    effective_at: "2026-10-01T00:00:00+08:00",
    source_url: "https://example.ph/doe/diesel",
    verification_method: "Manual",
    verified_by: 3,
  });

  it("accepts a complete manual snapshot", () => {
    expect(validateSnapshotInput(input()).ok).toBe(true);
  });

  it("rejects duplicates, implausible changes and unverifiable provenance", () => {
    expect(validateSnapshotInput({ ...input(), fuel_product: "" }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), region: "  " }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), reference_price: 0 }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), reference_price: NaN }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), reference_price: 620 }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), effective_at: "yesterday-ish" }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), source_url: "not a url" }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), verification_method: "Guess" }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), verified_by: null }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), verification_method: "Automatic", verified_by: null }).ok).toBe(false);
    expect(validateSnapshotInput({ ...input(), verification_method: "Automatic", verified_by: null, source_hash: "evt-9" }).ok).toBe(true);
  });
});
