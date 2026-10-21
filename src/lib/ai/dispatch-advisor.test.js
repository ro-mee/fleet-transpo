import { describe, it, expect } from "vitest";
import { estimateEfficiency } from "@/lib/ai/rule-engine";
import { estimateFuel } from "@/lib/geo/distance";
import { buildDispatchRecommendation } from "./dispatch-advisor";

const REQUEST = {
  request_id: 502,
  passenger_count: 1,
  pickup_datetime: "2026-09-15T05:39:00.000Z",
  pickup_location: "Hotel",
  dropoff_location: "Airport",
};

describe("buildDispatchRecommendation prefiltered merge", () => {
  it("appends pre-filtered vehicles to none_reasons with their flag", () => {
    const rec = buildDispatchRecommendation({
      request: REQUEST,
      vehicles: [],
      drivers: [],
      activePairs: [],
      activeSubstitutes: [],
      prefiltered: [
        {
          vehicle_id: 1,
          plate: "XYZ 5678",
          reason: "Vehicle status is Under Maintenance.",
          prefiltered: true,
        },
      ],
    });
    expect(rec.pair.recommended).toBeNull();
    expect(rec.pair.none_reasons).toEqual([
      {
        vehicle_id: 1,
        plate: "XYZ 5678",
        reason: "Vehicle status is Under Maintenance.",
        prefiltered: true,
      },
    ]);
  });

  it("dedupes a vehicle the engine already skipped, keeping the engine entry", () => {
    const tinyCar = {
      vehicle_id: 9,
      plate_number: "SMALL 1",
      vehicle_status: "Available",
      seating_capacity: 2,
      _schedule_load: 0,
    };
    const rec = buildDispatchRecommendation({
      request: { ...REQUEST, passenger_count: 4 },
      vehicles: [tinyCar],
      drivers: [],
      activePairs: [],
      activeSubstitutes: [],
      prefiltered: [
        {
          vehicle_id: 9,
          plate: "SMALL 1",
          reason: "Vehicle status is Available.",
          prefiltered: true,
        },
      ],
    });
    expect(rec.pair.none_reasons).toHaveLength(1);
    expect(rec.pair.none_reasons[0].reason).toMatch(/too small/);
    expect(rec.pair.none_reasons[0].prefiltered).toBeUndefined();
  });

  it("leaves none_reasons empty when nothing was skipped or pre-filtered", () => {
    const rec = buildDispatchRecommendation({
      request: REQUEST,
      vehicles: [],
      drivers: [],
      activePairs: [],
      activeSubstitutes: [],
    });
    expect(rec.pair.none_reasons).toEqual([]);
  });
});

describe("vehicle fuel estimate caliber (FE-08)", () => {
  const base = {
    vehicle_id: 7,
    plate_number: "ABC 1234",
    vehicle_status: "Available",
    seating_capacity: 4,
    fuel_type: "Gasoline",
    tank_capacity: 50,
    _schedule_load: 0,
  };
  // Stored estimate → estimateForRequest() resolves 36 km deterministically.
  const RESOLVED_REQUEST = { ...REQUEST, estimated_distance: 36, estimated_duration: 60 };

  it("uses the configured profile first and labels the basis", () => {
    const rec = buildDispatchRecommendation({
      request: RESOLVED_REQUEST,
      vehicles: [{ ...base, fuel_efficiency_kmpl: 7.5 }],
      drivers: [],
      activePairs: [],
      activeSubstitutes: [],
    });
    const v = rec.vehicle.recommended;
    const fuel = estimateFuel(36, 7.5, 50);
    expect(v.estimated_fuel_basis).toBe("profile");
    expect(v.estimated_fuel_efficiency_kmpl).toBe(7.5);
    expect(v.estimated_fuel_liters).toBe(fuel.liters);
    expect(v.estimated_fuel_percent_of_tank).toBe(fuel.percentOfTank);
  });

  it("labels the seat/fuel-type heuristic as the fallback when no profile exists", () => {
    const rec = buildDispatchRecommendation({
      request: RESOLVED_REQUEST,
      vehicles: [base],
      drivers: [],
      activePairs: [],
      activeSubstitutes: [],
    });
    const v = rec.vehicle.recommended;
    const heuristic = estimateEfficiency(base);
    expect(v.estimated_fuel_basis).toBe("heuristic");
    expect(v.estimated_fuel_efficiency_kmpl).toBe(heuristic);
    expect(v.estimated_fuel_liters).toBe(estimateFuel(36, heuristic, 50).liters);
  });
});
