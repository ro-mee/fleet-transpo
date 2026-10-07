import { describe, expect, it } from "vitest";
import { priceAt, validateSnapshotInput } from "./price-policy";
import { fetchReferencePrice } from "./providers/official-reference";

const row = { snapshot_id: 1, fuel_product: "Diesel", region: "NCR", currency: "PHP", unit: "L", reference_price: "62.70", effective_at: "2026-09-01T00:00:00+08:00", lifecycle: "Historical", verification_method: "Manual", verified_by: 3, source_url: "https://official.example/prices" };
describe("fuel review regressions", () => {
  it("resolves verified historical intervals and refuses invented verification", () => {
    expect(priceAt([row], { fuelType: "Diesel", region: "NCR", at: "2026-09-10T00:00:00+08:00" })).toEqual(row);
    expect(priceAt([{ ...row, lifecycle: "Active", verified_by: null }], { fuelType: "Diesel", region: "NCR", at: "2026-09-10T00:00:00+08:00" })).toBeNull();
    expect(priceAt([{ ...row, verification_method: "Automatic", source_hash: null }], { fuelType: "Diesel", region: "NCR", at: "2026-09-10T00:00:00+08:00" })).toBeNull();
  });
  it("requires an explicit timezone and a real calendar day", () => {
    for (const effective_at of ["2026-10-01T00:00:00", "2026-02-30T00:00:00+08:00", true, 123]) {
      expect(validateSnapshotInput({ ...row, effective_at }).ok).toBe(false);
    }
    expect(validateSnapshotInput({ ...row, prior_price: "garbage" }).ok).toBe(false);
    for (const reference_price of [true, [], [62.7], "62.705"]) expect(validateSnapshotInput({ ...row, reference_price }).ok).toBe(false);
    expect(validateSnapshotInput({ ...row, currency: "USD" }).ok).toBe(false);
    expect(validateSnapshotInput({ ...row, unit: "gal" }).ok).toBe(false);
    expect(validateSnapshotInput({ ...row, source_url: "https://" }).ok).toBe(false);
  });
  it("rejects redirected off-origin data even when JSON claims an approved source", async () => {
    const result = await fetchReferencePrice({ sourceUrl: "https://official.example/feed", fetchImpl: async () => ({ ok: true, redirected: true, url: "https://evil.example/prices", json: async () => row }) });
    expect(result.ok).toBe(false);
  });
});
