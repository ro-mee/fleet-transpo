import { describe, expect, it } from "vitest";
import { resolveEstimateDistance, estimateFuelCost } from "@/lib/fuel/trip-estimate";

describe("resolveEstimateDistance", () => {
  it("prefers odometer math, then validated trip distance, then the GPS trail", () => {
    expect(resolveEstimateDistance({ odometerKm: 36, tripDistanceKm: 32, gpsTrailKm: 35 }))
      .toEqual({ km: 36, provenance: "odometer" });
    expect(resolveEstimateDistance({ odometerKm: null, tripDistanceKm: 32, gpsTrailKm: 35 }))
      .toEqual({ km: 32, provenance: "trip-distance" });
    expect(resolveEstimateDistance({ odometerKm: null, tripDistanceKm: null, gpsTrailKm: 35 }))
      .toEqual({ km: 35, provenance: "gps-trail" });
  });

  it("returns null with no provenance instead of a fabricated zero", () => {
    expect(resolveEstimateDistance({ odometerKm: null, tripDistanceKm: null, gpsTrailKm: null }))
      .toEqual({ km: null, provenance: null });
    expect(resolveEstimateDistance({ odometerKm: -4, tripDistanceKm: 0, gpsTrailKm: NaN }))
      .toEqual({ km: null, provenance: null });
  });
});

describe("estimateFuelCost", () => {
  it("computes 36 km at 9 km/L and PHP 62.70/L as 4.00 L / PHP 250.80", () => {
    const r = estimateFuelCost({ distanceKm: 36, efficiencyKmpl: 9, pricePerLiter: 62.7 });
    expect(r).toMatchObject({ liters: 4, cost: 250.8, basis: "measured" });
  });

  it("reports a missing basis with reason instead of 0 or a fake actual", () => {
    expect(estimateFuelCost({ distanceKm: null, efficiencyKmpl: 9, pricePerLiter: 62.7 }).reason).toBe("no-distance");
    expect(estimateFuelCost({ distanceKm: 36, efficiencyKmpl: null, pricePerLiter: 62.7 }).reason).toBe("no-efficiency");
    expect(estimateFuelCost({ distanceKm: 36, efficiencyKmpl: 9, pricePerLiter: null }).reason).toBe("no-price");
    for (const r of [
      estimateFuelCost({ distanceKm: null, efficiencyKmpl: 9, pricePerLiter: 62.7 }),
      estimateFuelCost({ distanceKm: 36, efficiencyKmpl: null, pricePerLiter: 62.7 }),
      estimateFuelCost({ distanceKm: 36, efficiencyKmpl: 9, pricePerLiter: null }),
    ]) {
      expect(r.liters).toBeNull();
      expect(r.cost).toBeNull();
    }
  });

  it("rounds decimal-safe to 3 dp litres and 2 dp cost", () => {
    // 10/3 km per litre is a repeating decimal; the stored figure is rounded,
    // and cost derives from the ROUNDED litres so ledger math reconciles.
    const r = estimateFuelCost({ distanceKm: 10, efficiencyKmpl: 3, pricePerLiter: 62.7 });
    expect(r.liters).toBe(3.333);
    expect(r.cost).toBe(208.98);
  });
});
