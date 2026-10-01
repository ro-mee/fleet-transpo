import { describe, it, expect } from "vitest";
import { RISK } from "@/lib/ai/predictive-maintenance";
import {
  isProximityRelevant,
  estimateEfficiency,
  scoreProximity,
  scoreFuelEconomy,
  scheduleGapGain,
  maintenanceRiskGain,
  scoreReservationVehicles,
  scoreDispatchDrivers,
  workloadIndex,
  scoreWorkloadBalance,
  generateFleetInsights,
} from "@/lib/ai/rule-engine";

const NOW = new Date(2026, 7, 4, 12, 0, 0);

describe("isProximityRelevant", () => {
  it("is true when pickup is within the window", () => {
    const soon = new Date(2026, 7, 4, 13, 0, 0).toISOString();
    expect(isProximityRelevant(soon, NOW, 3)).toBe(true);
  });

  it("is false when pickup is outside the window", () => {
    const late = new Date(2026, 7, 4, 18, 0, 0).toISOString();
    expect(isProximityRelevant(late, NOW, 3)).toBe(false);
  });

  it("is false for a future-dated reservation (tomorrow)", () => {
    const tomorrow = new Date(2026, 7, 5, 9, 0, 0).toISOString();
    expect(isProximityRelevant(tomorrow, NOW, 3)).toBe(false);
  });

  it("is false when pickup is absent or unparseable", () => {
    expect(isProximityRelevant(null, NOW, 3)).toBe(false);
    expect(isProximityRelevant("not-a-date", NOW, 3)).toBe(false);
  });
});

describe("estimateEfficiency", () => {
  it("rewards smaller, diesel vehicles with higher km/L", () => {
    expect(estimateEfficiency({ seating_capacity: 4, fuel_type: "Diesel" })).toBeGreaterThan(
      estimateEfficiency({ seating_capacity: 15, fuel_type: "Gasoline" })
    );
  });
});

describe("scoreProximity", () => {
  it("ranks closest drivers highest and ignores unknown distance", () => {
    expect(scoreProximity(1.2).points).toBe(12);
    expect(scoreProximity(4).points).toBe(8);
    expect(scoreProximity(8).points).toBe(4);
    expect(scoreProximity(20).points).toBe(0);
    expect(scoreProximity(null).points).toBe(0);
    expect(scoreProximity(1.2).reason).toMatch(/km/);
  });
});

describe("scoreFuelEconomy", () => {
  it("ranks lower burn higher and is neutral without data", () => {
    expect(scoreFuelEconomy(1.5).points).toBeGreaterThan(scoreFuelEconomy(5).points);
    expect(scoreFuelEconomy(null).points).toBe(0);
  });
});

describe("scheduleGapGain", () => {
  it("prefers fewer overlapping dispatches", () => {
    expect(scheduleGapGain(0)).toBeGreaterThan(scheduleGapGain(1));
    expect(scheduleGapGain(1)).toBeGreaterThan(scheduleGapGain(2));
    expect(scheduleGapGain(5)).toBe(0);
    expect(scheduleGapGain(undefined)).toBe(0);
  });
});

describe("maintenanceRiskGain", () => {
  it("rewards low risk and penalises overdue hard", () => {
    expect(maintenanceRiskGain(RISK.LOW)).toBeGreaterThan(maintenanceRiskGain(RISK.HIGH));
    expect(maintenanceRiskGain(RISK.CRITICAL)).toBeLessThan(0);
    expect(maintenanceRiskGain(RISK.OVERDUE)).toBeLessThan(0);
    expect(maintenanceRiskGain(undefined)).toBe(0.5);
  });
});

describe("workloadIndex (AI Fair Workload Distribution)", () => {
  it("weights recent activity heavier than older activity", () => {
    const recent = workloadIndex({ trips7d: 2, trips30d: 0 });
    const older = workloadIndex({ trips7d: 0, trips30d: 4 });
    expect(recent).toBeGreaterThan(older);
    expect(recent).toBe(2);
    expect(older).toBeCloseTo(1.6);
  });

  it("folds distance and drive time onto the trip-count scale", () => {
    const tripsOnly = workloadIndex({ trips7d: 4 });
    const withKm = workloadIndex({ trips7d: 4, km7d: 40, hours7d: 1.5 });
    expect(withKm).toBeGreaterThan(tripsOnly);
  });

  it("returns 0 (neutral) when there is no recorded history", () => {
    expect(workloadIndex({})).toBe(0);
    expect(workloadIndex({ trips7d: 0, trips30d: 0 })).toBe(0);
    expect(workloadIndex(null)).toBe(0);
  });
});

describe("scoreWorkloadBalance (AI Fair Workload Distribution)", () => {
  it("scores the lightest driver 1.0 and the heaviest 0.0 (pool-relative)", () => {
    expect(scoreWorkloadBalance(0, 10)).toBe(1);
    expect(scoreWorkloadBalance(10, 10)).toBe(0);
    expect(scoreWorkloadBalance(5, 10)).toBe(0.5);
  });

  it("is neutral (0.5) when the pool has no workload data", () => {
    expect(scoreWorkloadBalance(0, 0)).toBe(0.5);
    expect(scoreWorkloadBalance(3, undefined)).toBe(0.5);
    expect(scoreWorkloadBalance(null, null)).toBe(0.5);
  });

  it("clamps to 0..1", () => {
    expect(scoreWorkloadBalance(30, 10)).toBe(0);
    expect(scoreWorkloadBalance(-5, 10)).toBe(1);
  });
});

describe("scoreReservationVehicles", () => {
  it("ranks a low-burn, low-load, healthy vehicle above a heavy one", () => {
    const good = {
      vehicle_id: 1,
      seating_capacity: 4,
      vehicle_status: "Available",
      fuel_level: 80,
      _est_fuel_liters: 1.5,
      _schedule_load: 0,
      _maintenance: { risk: RISK.LOW, basis: "time", effectiveDays: 60 },
    };
    const heavy = {
      vehicle_id: 2,
      seating_capacity: 8,
      vehicle_status: "Available",
      fuel_level: 80,
      _est_fuel_liters: 8,
      _schedule_load: 3,
      _maintenance: { risk: RISK.OVERDUE, basis: "time", effectiveDays: -10 },
    };
    const [a, b] = scoreReservationVehicles([heavy, good], 2);
    expect(a.vehicle.vehicle_id).toBe(good.vehicle_id);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("keeps scores inside 0..100", () => {
    const rows = [
      { vehicle_id: 1, seating_capacity: 4, vehicle_status: "Available", fuel_level: 100,
        _est_fuel_liters: 1, _schedule_load: 0,
        _maintenance: { risk: RISK.LOW, basis: "time", effectiveDays: 90 } },
      { vehicle_id: 2, seating_capacity: 4, vehicle_status: "Available", fuel_level: 100,
        _est_fuel_liters: 20, _schedule_load: 9,
        _maintenance: { risk: RISK.OVERDUE, basis: "time", effectiveDays: -40 } },
    ];
    for (const s of scoreReservationVehicles(rows, 2)) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });

  it("does not reward an unscheduled vehicle as maintenance-healthy", () => {
    const unscheduled = {
      vehicle_id: 1, seating_capacity: 4, vehicle_status: "Available", fuel_level: 80,
      _est_fuel_liters: 1.5, _schedule_load: 0,
      _maintenance: { risk: RISK.LOW, basis: null, effectiveDays: null },
    };
    const [s] = scoreReservationVehicles([unscheduled], 2);
    expect(s.reasons.some((r) => /Service risk/.test(r))).toBe(false);
  });
});

describe("scoreDispatchDrivers", () => {
  it("ranks a near, low-load driver above a far, busy one when proximity applies", () => {
    const near = {
      driver_id: 1, driver_status: "Available", license_expiry: "2035-01-01",
      _pickup_distance_km: 1, _proximity_relevant: true, _schedule_load: 0,
    };
    const far = {
      driver_id: 2, driver_status: "Available", license_expiry: "2035-01-01",
      _pickup_distance_km: 25, _proximity_relevant: true, _schedule_load: 4,
    };
    const [a, b] = scoreDispatchDrivers([far, near]);
    expect(a.driver.driver_id).toBe(near.driver_id);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("does not apply proximity when the pickup is future-dated", () => {
    const near = {
      driver_id: 1, driver_status: "Available", license_expiry: "2035-01-01",
      _pickup_distance_km: 1, _proximity_relevant: false, _schedule_load: 0,
    };
    const far = {
      driver_id: 2, driver_status: "Available", license_expiry: "2035-01-01",
      _pickup_distance_km: 25, _proximity_relevant: false, _schedule_load: 0,
    };
    const [a, b] = scoreDispatchDrivers([near, far]);
    // Identical except proximity: scores must be equal when proximity is gated off.
    expect(a.score).toBe(b.score);
    expect(a.reasons.some((r) => /pickup/i.test(r))).toBe(false);
  });

  it("uses punctuality as a small tie-breaker, never a large swing", () => {
    const base = {
      driver_status: "Available", license_expiry: "2035-01-01",
      _proximity_relevant: false, _schedule_load: 0, total_completed_trips: 20,
    };
    const star = { ...base, driver_id: 1, punct_measured: 25, punct_on_time: 25, punct_rate: 100 };
    const late = { ...base, driver_id: 2, punct_measured: 25, punct_on_time: 10, punct_rate: 40 };
    const [a, b] = scoreDispatchDrivers([late, star]);
    expect(a.driver.driver_id).toBe(star.driver_id);
    // Tie-breaker only: the gap stays small so feasibility still dominates.
    expect(a.score - b.score).toBeLessThanOrEqual(6);
    expect(a.reasons.some((r) => /punctual/i.test(r))).toBe(true);
  });

  it("ignores guest-rating fields entirely (dead signal)", () => {
    const base = {
      driver_status: "Available", license_expiry: "2035-01-01",
      _proximity_relevant: false, _schedule_load: 0, total_completed_trips: 20,
      punct_measured: 10, punct_on_time: 9, punct_rate: 90,
    };
    const [a] = scoreDispatchDrivers([{ ...base, driver_id: 1, avg_guest_rating: 5, avg_driving_score: 99 }]);
    const [b] = scoreDispatchDrivers([{ ...base, driver_id: 1, avg_guest_rating: 1, avg_driving_score: 10 }]);
    expect(a.score).toBe(b.score);
    expect(a.reasons.some((r) => /guest rating|driving score/i.test(r))).toBe(false);
  });
});

describe("generateFleetInsights — the fleet-availability wording", () => {
  // Live, this card said "20 of 21 vehicles ready for guest dispatch" while the
  // real Today pair endpoint returned 1 dispatchable pair. Both numbers were
  // right for their own question; the label was the lie. It must now name the
  // status count it actually measures and point at the surface that answers
  // dispatchability.
  const fleet = (statuses) => statuses.map((vehicle_status, i) => ({ vehicle_id: i + 1, plate_number: `PLT ${i}`, vehicle_status }));

  const availability = (statuses) =>
    generateFleetInsights(fleet(statuses), [], []).find((i) => i.title === "Fleet Availability");

  it("counts vehicle_status only, and says so", () => {
    const insight = availability(["Available", "Available", "Under Maintenance"]);
    expect(insight.summary).toContain("2 of 3");
    expect(insight.summary).toContain("Available on");
  });

  it("never claims dispatch readiness from a status count", () => {
    const insight = availability(["Available", "Available", "Under Maintenance"]);
    expect(insight.summary).not.toMatch(/ready for guest dispatch/i);
    expect(insight.summary).toMatch(/Resource Availability/);
  });

  it("still raises the separate maintenance-grounding card", () => {
    const insights = generateFleetInsights(fleet(["Available", "Under Maintenance"]), [], []);
    expect(insights.find((i) => i.title === "Maintenance Grounding Alert")?.summary).toContain("1 vehicle(s)");
  });

  it("emits no availability card for an empty fleet, and never divides by zero", () => {
    expect(generateFleetInsights([], [], []).find((i) => i.title === "Fleet Availability")).toBeUndefined();
  });
});
