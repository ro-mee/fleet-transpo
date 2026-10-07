import { describe, expect, it } from "vitest";
import { evaluateVehicleCapacity, formatCapacityBlocker } from "@/lib/scheduling/load-capacity";
import { evaluateRequestConflicts } from "@/lib/scheduling/conflicts";
import { CONFLICT_TYPE } from "@/lib/scheduling/conflict-types";

const passengerVehicle = (seats, use = "Passenger") => ({
  vehicle_id: 11,
  plate_number: "ABC 1234",
  operational_use: use,
  seating_capacity: seats,
  cargo_capacity_kg: null,
});

const cargoVehicle = (kg) => ({
  vehicle_id: 12,
  plate_number: "TRK 5678",
  operational_use: "Cargo",
  seating_capacity: null,
  cargo_capacity_kg: kg,
});

describe("evaluateVehicleCapacity", () => {
  it("passes 4/7 and fails 8/7 on passenger seats", () => {
    const pass = evaluateVehicleCapacity({ passenger_count: 4 }, passengerVehicle(7));
    expect(pass).toMatchObject({ eligible: true, code: null, required: 4, capacity: 7, unit: "passengers" });

    const fail = evaluateVehicleCapacity({ passenger_count: 8 }, passengerVehicle(7));
    expect(fail).toMatchObject({ eligible: false, code: "OVER_CAPACITY", required: 8, capacity: 7, unit: "passengers" });
  });

  it("passes 650/1000, fails 1800/1000, passes 1800/2500 on cargo payload", () => {
    expect(
      evaluateVehicleCapacity(
        { load_type: "Cargo", passenger_count: null, cargo_weight_kg: 650, cargo_description: "Vegetables" },
        cargoVehicle(1000)
      )
    ).toMatchObject({ eligible: true, code: null, required: 650, capacity: 1000, unit: "kg" });

    expect(
      evaluateVehicleCapacity(
        { load_type: "Cargo", passenger_count: null, cargo_weight_kg: 1800, cargo_description: "Rice" },
        cargoVehicle(1000)
      )
    ).toMatchObject({ eligible: false, code: "OVER_CAPACITY", required: 1800, capacity: 1000, unit: "kg" });

    expect(
      evaluateVehicleCapacity(
        { load_type: "Cargo", passenger_count: null, cargo_weight_kg: 1800, cargo_description: "Rice" },
        cargoVehicle(2500)
      ).eligible
    ).toBe(true);
  });

  it("rejects cross-kind pairs without inferring capacity", () => {
    const cargoOnPassenger = evaluateVehicleCapacity(
      { load_type: "Cargo", passenger_count: null, cargo_weight_kg: 100, cargo_description: "Spices" },
      passengerVehicle(7)
    );
    expect(cargoOnPassenger).toMatchObject({ eligible: false, code: "USE_MISMATCH" });

    const passengerOnCargo = evaluateVehicleCapacity(
      { load_type: "Passenger", passenger_count: 2 },
      cargoVehicle(1000)
    );
    expect(passengerOnCargo).toMatchObject({ eligible: false, code: "USE_MISMATCH" });
  });

  it("fails closed on unknown load, requirement, use, or capacity", () => {
    // An explicit but unrecognized load kind is unknown. A missing load_type
    // is a legacy passenger row, covered by the preservation test below.
    expect(evaluateVehicleCapacity({ load_type: "Freight" }, passengerVehicle(7)).code).toBe("LOAD_UNKNOWN");
    expect(evaluateVehicleCapacity({ load_type: "" }, passengerVehicle(7)).code).toBe("LOAD_UNKNOWN");

    // Typed passenger without a positive count.
    for (const passenger_count of [null, undefined, 0, -2, 2.5, "four"]) {
      const r = evaluateVehicleCapacity({ load_type: "Passenger", passenger_count }, passengerVehicle(7));
      expect(r).toMatchObject({ eligible: false, code: "PASSENGER_COUNT_INVALID" });
    }

    // Cargo without a positive finite weight (NaN compares > 0 in NUMERIC: reject it here).
    for (const cargo_weight_kg of [null, undefined, 0, -10, NaN, Infinity, "heavy"]) {
      const r = evaluateVehicleCapacity(
        { load_type: "Cargo", passenger_count: null, cargo_weight_kg, cargo_description: "Rice" },
        cargoVehicle(1000)
      );
      expect(r).toMatchObject({ eligible: false, code: "CARGO_WEIGHT_INVALID" });
    }

    // Typed request against an unclassified legacy vehicle.
    expect(
      evaluateVehicleCapacity(
        { load_type: "Cargo", passenger_count: null, cargo_weight_kg: 100, cargo_description: "Rice" },
        { vehicle_id: 13, seating_capacity: 7, cargo_capacity_kg: null }
      ).code
    ).toBe("USE_MISMATCH");

    // Matching use but no recorded capacity.
    expect(
      evaluateVehicleCapacity({ load_type: "Passenger", passenger_count: 2 }, passengerVehicle(null)).code
    ).toBe("CAPACITY_UNKNOWN");
    expect(
      evaluateVehicleCapacity(
        { load_type: "Cargo", passenger_count: null, cargo_weight_kg: 100, cargo_description: "Rice" },
        cargoVehicle(null)
      ).code
    ).toBe("CAPACITY_UNKNOWN");
  });

  it("preserves the legacy seats behavior for untyped requests", () => {
    // Legacy rows carry no load_type: passenger_count || 1 against seats, and a
    // vehicle with no recorded seats stays silent exactly as before.
    expect(evaluateVehicleCapacity({ passenger_count: 4 }, { seating_capacity: 7 }).eligible).toBe(true);
    expect(evaluateVehicleCapacity({ passenger_count: 8 }, { seating_capacity: 7 }).code).toBe("OVER_CAPACITY");
    expect(evaluateVehicleCapacity({ passenger_count: 8 }, { seating_capacity: null }).eligible).toBe(true);
    expect(evaluateVehicleCapacity({}, { seating_capacity: 7 })).toMatchObject({ required: 1, capacity: 7 });
  });

  it("accepts numeric strings from pg numeric columns", () => {
    const r = evaluateVehicleCapacity(
      { load_type: "Cargo", passenger_count: null, cargo_weight_kg: "650.000", cargo_description: "Rice" },
      { operational_use: "Cargo", cargo_capacity_kg: "1000.000" }
    );
    expect(r).toMatchObject({ eligible: true, required: 650, capacity: 1000 });
  });

  it("formats the same blocker every gate returns for a pair", () => {
    const over = evaluateVehicleCapacity(
      { load_type: "Cargo", passenger_count: null, cargo_weight_kg: 1400, cargo_description: "Rice" },
      cargoVehicle(1000)
    );
    expect(formatCapacityBlocker(over, "Vehicle TRK 5678")).toBe(
      "Vehicle TRK 5678 cargo capacity 1000 kg, request needs 1400 kg (over by 400 kg)."
    );

    const seats = evaluateVehicleCapacity({ passenger_count: 8 }, passengerVehicle(7));
    expect(formatCapacityBlocker(seats, "ABC 1234")).toBe("Vehicle seats 7, request needs 8.");
  });

  it("emits the same blocker from queue chips and the commit gate", () => {
    // Cargo overweight: the queue finding and validatePairAvailability's 409
    // both render through formatCapacityBlocker, so a changed weight reads
    // identically everywhere.
    const request = {
      request_id: 9,
      load_type: "Cargo",
      passenger_count: null,
      cargo_weight_kg: 1800,
      cargo_description: "Rice",
      pickup_datetime: "2026-10-08T02:00:00Z",
    };
    const vehicle = { vehicle_id: 12, plate_number: "TRK 5678", operational_use: "Cargo", cargo_capacity_kg: 1000 };
    const findings = evaluateRequestConflicts(request, { vehicle });
    const chip = findings.find((f) => f.type === CONFLICT_TYPE.CAPACITY_MISMATCH);
    expect(chip?.severity).toBe("blocking");
    expect(chip.message).toBe(
      formatCapacityBlocker(evaluateVehicleCapacity(request, vehicle), "Vehicle TRK 5678")
    );
    expect(chip.detail).toMatchObject({ capacity_code: "OVER_CAPACITY", required: 1800, capacity: 1000, unit: "kg" });

    // Typed passenger on a cargo vehicle: mismatch, not a seats comparison.
    const mismatch = evaluateRequestConflicts(
      { request_id: 10, load_type: "Passenger", passenger_count: 2, pickup_datetime: "2026-10-08T02:00:00Z" },
      { vehicle }
    );
    expect(mismatch.find((f) => f.type === CONFLICT_TYPE.CAPACITY_MISMATCH)?.detail).toMatchObject({
      capacity_code: "USE_MISMATCH",
    });

    // Legacy rows keep the exact historical wording and stay silent without seats.
    const legacy = evaluateRequestConflicts(
      { request_id: 11, passenger_count: 8, pickup_datetime: "2026-10-08T02:00:00Z" },
      { vehicle: { vehicle_id: 11, plate_number: "ABC 1234", seating_capacity: 7 } }
    );
    expect(legacy.find((f) => f.type === CONFLICT_TYPE.CAPACITY_MISMATCH)?.message).toBe(
      "Vehicle seats 7, request needs 8."
    );
    const silent = evaluateRequestConflicts(
      { request_id: 12, passenger_count: 8, pickup_datetime: "2026-10-08T02:00:00Z" },
      { vehicle: { vehicle_id: 13, plate_number: "NOPLATE", seating_capacity: null } }
    );
    expect(silent.some((f) => f.type === CONFLICT_TYPE.CAPACITY_MISMATCH)).toBe(false);
  });
});
