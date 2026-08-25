import { describe, expect, it } from "vitest";
import {
  calculateFuelRecommendation,
  assessFuelVariance,
  minimumSafeFromSnapshot,
  evaluateFuelPolicy,
  fuelTankCapacityError,
  fuelTypeMismatch,
  fuelAllocationError,
  fuelFulfillmentError,
} from "./request-policy";

describe("fuel request fulfillment", () => {
  it("requires approval and enforces the allocated liters", () => {
    expect(fuelFulfillmentError({ status: "Pending", approved_liters: 40 }, 30)).toMatch(/approved/i);
    expect(fuelFulfillmentError({ status: "Approved", approved_liters: 40 }, 41)).toMatch(/exceeds/i);
    expect(fuelFulfillmentError({ status: "Approved", approved_liters: 40 }, 40)).toBeNull();
    expect(fuelAllocationError(10, 11)).toMatch(/exceeds/i);
  });

  it("separates the minimum safe refill from the preferred refill target", () => {
    const result = calculateFuelRecommendation({
      tankCapacityL: 60,
      currentFuelLevelPercent: 25,
      fuelEfficiencyKmpl: 8,
      oneWayDistanceKm: 80,
    });
    expect(result).toMatchObject({
      current_liters: 15,
      forecast_distance_km: 160,
      forecast_consumption_liters: 20,
      reserve_liters: 6,
      minimum_safe_liters: 11,
      target_liters: 54,
      recommended_liters: 39,
      needs_refuel: true,
    });
    expect(result.minimum_safe_liters).toBeLessThan(result.recommended_liters);
  });

  it("reports no minimum when the tank already covers consumption plus reserve", () => {
    const result = calculateFuelRecommendation({
      tankCapacityL: 60,
      currentFuelLevelPercent: 50,
      fuelEfficiencyKmpl: 8,
      oneWayDistanceKm: 80,
    });
    expect(result.minimum_safe_liters).toBe(0);
    expect(result.needs_refuel).toBe(false);
  });

  it("caps the preferred target at the physical tank size", () => {
    const result = calculateFuelRecommendation({
      tankCapacityL: 60,
      currentFuelLevelPercent: 5,
      fuelEfficiencyKmpl: 3,
      oneWayDistanceKm: 100,
    });
    expect(result.target_liters).toBe(60);
    expect(result.range_warning).toBe(true);
  });
});

describe("minimumSafeFromSnapshot", () => {
  it("reads the stored value", () => {
    expect(minimumSafeFromSnapshot({ minimum_safe_liters: 11 })).toBe(11);
  });

  it("derives the value from legacy snapshots", () => {
    expect(
      minimumSafeFromSnapshot({ forecast_consumption_liters: 20, reserve_liters: 6, current_liters: 15 })
    ).toBe(11);
  });

  it("returns null when the snapshot carries nothing usable", () => {
    expect(minimumSafeFromSnapshot({})).toBeNull();
    expect(minimumSafeFromSnapshot(null)).toBeNull();
  });
});

describe("evaluateFuelPolicy", () => {
  const healthy = {
    calculation: { recommended_liters: 39, minimum_safe_liters: 11, range_warning: false },
    variance: { variance_detected: false },
    monthlyRemainingLiters: 80,
  };

  it("auto-authorizes a normal request", () => {
    expect(evaluateFuelPolicy(healthy)).toEqual({ within_policy: true, policy_reasons: [] });
  });

  it("blocks on each exception independently", () => {
    expect(evaluateFuelPolicy({
      ...healthy,
      variance: { variance_detected: true },
    }).policy_reasons).toEqual(["Fuel variance was detected in the reported level"]);
    expect(evaluateFuelPolicy({ ...healthy, monthlyRemainingLiters: 38 }).within_policy).toBe(false);
    expect(evaluateFuelPolicy({
      ...healthy,
      calculation: { ...healthy.calculation, range_warning: true },
    }).within_policy).toBe(false);
    expect(evaluateFuelPolicy({
      ...healthy,
      calculation: { ...healthy.calculation, recommended_liters: 0 },
    }).within_policy).toBe(false);
    expect(evaluateFuelPolicy({
      ...healthy,
      monthlyRemainingLiters: null,
    }).within_policy).toBe(false);
  });

  it("blocks when the minimum exceeds the recommendation", () => {
    const result = evaluateFuelPolicy({
      ...healthy,
      calculation: { ...healthy.calculation, minimum_safe_liters: 50 },
    });
    expect(result.policy_reasons).toContain("The minimum safe refill exceeds the recommendation");
  });
});

describe("fuelTankCapacityError", () => {
  it("accepts a refill that fits and rejects one that overflows", () => {
    expect(fuelTankCapacityError({ tankCapacityL: 70, estimatedCurrentLiters: 17.5, liters: 32.6 })).toBeNull();
    expect(fuelTankCapacityError({ tankCapacityL: 70, estimatedCurrentLiters: 17.5, liters: 60 }))
      .toMatch(/Impossible fuel quantity/);
  });

  it("stays silent without a usable tank profile", () => {
    expect(fuelTankCapacityError({ tankCapacityL: null, estimatedCurrentLiters: 10, liters: 60 })).toBeNull();
    expect(fuelTankCapacityError({ tankCapacityL: 70, estimatedCurrentLiters: NaN, liters: 60 })).toBeNull();
  });
});

describe("fuelTypeMismatch", () => {
  it("flags different fuel types", () => {
    expect(fuelTypeMismatch("Diesel", "Gasoline")).toBe(true);
    expect(fuelTypeMismatch("diesel", "  GASOLINE ")).toBe(true);
  });

  it("tolerates synonyms and missing values", () => {
    expect(fuelTypeMismatch("Gasoline", "Petrol")).toBe(false);
    expect(fuelTypeMismatch("gas", "Gasoline")).toBe(false);
    expect(fuelTypeMismatch("Diesel", null)).toBe(false);
    expect(fuelTypeMismatch(null, "Diesel")).toBe(false);
    expect(fuelTypeMismatch("Unspecified", "Gasoline")).toBe(false);
  });
});

describe("assessFuelVariance", () => {
  const base = { tankCapacityL: 60, efficiencyKmpl: 8 };

  it("flags reported fuel far below the expected remaining level", () => {
    const result = assessFuelVariance({
      ...base,
      lastReportedPercent: 83.33,
      distanceSinceLastReportKm: 80,
      reportedPercent: 25,
    });
    expect(result.expected_liters).toBe(40);
    expect(result.variance_liters).toBe(25);
    expect(result.variance_detected).toBe(true);
  });

  it("accepts normal drift within the gauge tolerance", () => {
    const result = assessFuelVariance({
      ...base,
      lastReportedPercent: 83.33,
      distanceSinceLastReportKm: 80,
      reportedPercent: 55,
    });
    expect(result.expected_liters).toBe(40);
    expect(result.variance_detected).toBe(false);
  });

  it("never reports a positive variance when the driver over-reports", () => {
    const result = assessFuelVariance({
      ...base,
      lastReportedPercent: 50,
      distanceSinceLastReportKm: 0,
      reportedPercent: 90,
    });
    expect(result.variance_liters).toBe(0);
    expect(result.variance_detected).toBe(false);
  });

  it("stays silent without a previous report or vehicle profile", () => {
    expect(assessFuelVariance({ ...base, lastReportedPercent: null, distanceSinceLastReportKm: 10, reportedPercent: 25 }).variance_detected).toBe(false);
    expect(assessFuelVariance({ ...base, efficiencyKmpl: null, lastReportedPercent: 50, distanceSinceLastReportKm: 10, reportedPercent: 25 }).variance_detected).toBe(false);
    expect(assessFuelVariance({ ...base, lastReportedPercent: 50, distanceSinceLastReportKm: 10, reportedPercent: null }).expected_liters).toBeNull();
  });
});
