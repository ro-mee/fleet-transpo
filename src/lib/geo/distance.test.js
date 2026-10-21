import { describe, expect, it } from "vitest";
import { estimateFuel } from "./distance";

describe("estimateFuel", () => {
  it("assumes one return leg for a lone scheduled leg by default", () => {
    expect(estimateFuel(50, 10)).toEqual({
      liters: 10,
      percentOfTank: null,
      efficiencyKmpl: 10,
      efficiencyDefaulted: false,
    });
  });

  it("counts only the scheduled leg when the caller knows the return is covered", () => {
    expect(estimateFuel(50, 10, null, { assumeReturn: false })).toEqual({
      liters: 5,
      percentOfTank: null,
      efficiencyKmpl: 10,
      efficiencyDefaulted: false,
    });
  });

  it("reports the share of the tank when capacity is known", () => {
    expect(estimateFuel(30, 8, 60).percentOfTank).toBe(12.5);
  });

  it("surfaces the 8 km/L fallback instead of applying it silently", () => {
    expect(estimateFuel(50)).toEqual({
      liters: 12.5,
      percentOfTank: null,
      efficiencyKmpl: 8,
      efficiencyDefaulted: true,
    });
    expect(estimateFuel(50, 0)).toMatchObject({ efficiencyKmpl: 8, efficiencyDefaulted: true, liters: 12.5 });
    expect(estimateFuel(50, null)).toMatchObject({ efficiencyKmpl: 8, efficiencyDefaulted: true });
    expect(estimateFuel(50, "not-a-number")).toMatchObject({ efficiencyKmpl: 8, efficiencyDefaulted: true });
  });

  it("returns no verdict rather than zero litres when the distance is unknown", () => {
    expect(estimateFuel(null, 10)).toEqual({
      liters: null,
      percentOfTank: null,
      efficiencyKmpl: 10,
      efficiencyDefaulted: false,
    });
    expect(estimateFuel(Number.NaN, 10).liters).toBeNull();
    expect(estimateFuel(-5, 10)).toMatchObject({ liters: null, percentOfTank: null });
    expect(estimateFuel(0, 10)).toMatchObject({ liters: 0, percentOfTank: null });
  });
});
