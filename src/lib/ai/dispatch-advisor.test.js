import { describe, it, expect } from "vitest";
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
