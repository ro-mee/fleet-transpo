import { describe, expect, it } from "vitest";
import {
  calculateFuelRecommendation,
  assessFuelVariance,
  planForecastDistance,
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
      forecastDistanceKm: 160,
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
      forecastDistanceKm: 160,
    });
    expect(result.minimum_safe_liters).toBe(0);
    expect(result.needs_refuel).toBe(false);
  });

  it("caps the preferred target at the physical tank size", () => {
    const result = calculateFuelRecommendation({
      tankCapacityL: 60,
      currentFuelLevelPercent: 5,
      fuelEfficiencyKmpl: 3,
      forecastDistanceKm: 200,
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

describe("planForecastDistance", () => {
  it("counts a paired out-and-back schedule once", () => {
    const plan = planForecastDistance([
      { distanceKm: 100, origin: "Manila", destination: "Batangas" },
      { distanceKm: 100, origin: "Batangas", destination: "Manila" },
    ]);
    expect(plan).toMatchObject({
      forecast_distance_km: 200,
      assumed_return_km: 0,
      paired_legs: 1,
      legs: 2,
      round_trip_assumed: false,
    });
  });

  it("mirrors a lone scheduled leg as an assumed return", () => {
    const plan = planForecastDistance([{ distanceKm: 100, origin: "Manila", destination: "Batangas" }]);
    expect(plan).toMatchObject({
      forecast_distance_km: 200,
      assumed_return_km: 100,
      paired_legs: 0,
      round_trip_assumed: true,
    });
  });

  it("matches endpoints case-insensitively and ignores whitespace", () => {
    const plan = planForecastDistance([
      { distanceKm: 60, origin: " Manila ", destination: "BATANGAS" },
      { distanceKm: 60, origin: "batangas", destination: "manila" },
    ]);
    expect(plan.paired_legs).toBe(1);
    expect(plan.forecast_distance_km).toBe(120);
  });

  it("pairs one-to-one and mirrors only the unpaired leg", () => {
    const plan = planForecastDistance([
      { distanceKm: 100, origin: "Manila", destination: "Batangas" },
      { distanceKm: 100, origin: "Batangas", destination: "Manila" },
      { distanceKm: 50, origin: "Manila", destination: "Clark" },
    ]);
    expect(plan).toMatchObject({ forecast_distance_km: 300, assumed_return_km: 50, paired_legs: 1, legs: 3 });
  });

  it("mirrors legs with no route endpoints because no pairing is known", () => {
    const plan = planForecastDistance([{ distanceKm: 40 }]);
    expect(plan).toMatchObject({ forecast_distance_km: 80, assumed_return_km: 40, round_trip_assumed: true });
  });

  it("returns a zero plan for an empty schedule", () => {
    expect(planForecastDistance([])).toMatchObject({
      forecast_distance_km: 0,
      assumed_return_km: 0,
      paired_legs: 0,
      legs: 0,
      round_trip_assumed: false,
    });
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

  it("adds verified refills between reports to the expected level", () => {
    const result = assessFuelVariance({
      ...base,
      lastReportedPercent: 50,
      distanceSinceLastReportKm: 80,
      refilledLiters: 20,
      reportedPercent: 25,
    });
    // Expected = 30 L (last) − 10 L (driven) + 20 L (refilled) = 40 L;
    // the reported 15 L leaves the 25 L gap that the refill would otherwise hide.
    expect(result).toMatchObject({ expected_liters: 40, refilled_liters: 20, variance_liters: 25, variance_detected: true });
  });

  it("treats unknown distance as no verdict instead of zero consumption", () => {
    const result = assessFuelVariance({
      ...base,
      lastReportedPercent: 80,
      distanceSinceLastReportKm: null,
      reportedPercent: 20,
    });
    // A no-verdict snapshot still carries every key the verdict path carries,
    // so a consumer can read the object shape uniformly.
    expect(result).toEqual({ expected_liters: null, variance_liters: null, refilled_liters: null, variance_detected: false });
  });
});

describe("fuel policy overrides integration", () => {
  it("honors custom reserve and target fill thresholds", () => {
    const result = calculateFuelRecommendation({
      tankCapacityL: 100,
      currentFuelLevelPercent: 20,
      fuelEfficiencyKmpl: 10,
      forecastDistanceKm: 100,
      policy: {
        reserveBufferPercent: 15,
        preferredTargetPercent: 80,
      },
    });
    // current: 20 L, consumption: 100km / 10 = 10 L
    // reserve: 15 L. Needs refuel: 20 - 10 = 10 < 15 -> true
    // target: max(80 L, 10 + 15) = 80 L
    // recommended: 80 - 20 = 60 L
    expect(result.reserve_liters).toBe(15);
    expect(result.target_liters).toBe(80);
    expect(result.recommended_liters).toBe(60);
  });

  it("respects variance alerts disabled policy", () => {
    const result = assessFuelVariance({
      tankCapacityL: 60,
      efficiencyKmpl: 8,
      lastReportedPercent: 80,
      distanceSinceLastReportKm: 0,
      reportedPercent: 20, // 60% gap -> 36L variance
      policy: {
        enableVarianceAlerts: false,
      },
    });
    expect(result.variance_liters).toBe(36);
    expect(result.variance_detected).toBe(false);
  });

  it("blocks auto-approval when policy disables autoApprovalEnabled or recommendation exceeds cap", () => {
    const healthy = {
      calculation: { recommended_liters: 50, minimum_safe_liters: 10, range_warning: false },
      variance: { variance_detected: false },
      monthlyRemainingLiters: 100,
    };

    const disabledPolicy = evaluateFuelPolicy({
      ...healthy,
      policy: { autoApprovalEnabled: false },
    });
    expect(disabledPolicy.within_policy).toBe(false);
    expect(disabledPolicy.policy_reasons).toContain("Automatic fuel request approval is disabled by fleet policy");

    const cappedPolicy = evaluateFuelPolicy({
      ...healthy,
      policy: { autoApprovalMaxLiters: 40 },
    });
    expect(cappedPolicy.within_policy).toBe(false);
    expect(cappedPolicy.policy_reasons[0]).toMatch(/exceeds the policy auto-approval limit/i);
  });
});
