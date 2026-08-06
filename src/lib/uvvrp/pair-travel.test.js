import { describe, it, expect } from "vitest";
import { vehicleCanTravel, driverCanTravel } from "@/lib/uvvrp/uvvrp.service";

const baseCtx = {
  policy: { enabled: false, response: "block", weekdayRestrictions: {} },
  exemptVehicleIds: new Set(),
  pairings: [],
  driverById: new Map(),
  vehicleById: new Map(),
  date: new Date("2026-08-10"),
};

describe("vehicleCanTravel", () => {
  it("travels when its own docs and (no) driver are valid", () => {
    expect(vehicleCanTravel({ vehicle_id: 1, plate_number: "ABC 1234", registration_expiry: "2026-12-31", insurance_expiry: "2026-12-31" }, baseCtx)).toBe(true);
  });
  it("does not travel when its registration expires on the travel date", () => {
    expect(vehicleCanTravel({ vehicle_id: 1, plate_number: "ABC 1234", registration_expiry: "2026-08-10", insurance_expiry: "2026-12-31" }, baseCtx)).toBe(false);
  });
  it("does not travel when paired driver's license is invalid", () => {
    const ctx = {
      ...baseCtx,
      pairings: [{ vehicle_id: 1, driver_id: 5 }],
      driverById: new Map([[5, { driver_id: 5, license_expiry: "2026-08-10", driver_status: "Available" }]]),
    };
    expect(vehicleCanTravel({ vehicle_id: 1, plate_number: "ABC 1234", registration_expiry: "2026-12-31", insurance_expiry: "2026-12-31" }, ctx)).toBe(false);
  });
  it("does not travel when paired driver is off duty", () => {
    const ctx = {
      ...baseCtx,
      pairings: [{ vehicle_id: 1, driver_id: 5 }],
      driverById: new Map([[5, { driver_id: 5, license_expiry: "2026-12-31", driver_status: "Off Duty" }]]),
    };
    expect(vehicleCanTravel({ vehicle_id: 1, plate_number: "ABC 1234", registration_expiry: "2026-12-31", insurance_expiry: "2026-12-31" }, ctx)).toBe(false);
  });
  it("does not travel when its plate is coding-restricted on the date", () => {
    const ctx = {
      ...baseCtx,
      policy: { enabled: true, response: "block", weekdayRestrictions: { Monday: [4] } },
    };
    // 2026-08-10 is a Monday; plate ends 4 -> restricted.
    expect(vehicleCanTravel({ vehicle_id: 1, plate_number: "ABC 1234", registration_expiry: "2026-12-31", insurance_expiry: "2026-12-31" }, ctx)).toBe(false);
  });
});

describe("driverCanTravel", () => {
  it("travels when its license and (no) paired vehicle are valid", () => {
    expect(driverCanTravel({ driver_id: 5, license_expiry: "2026-12-31", driver_status: "Available" }, baseCtx)).toBe(true);
  });
  it("does not travel when its license expires on the travel date", () => {
    expect(driverCanTravel({ driver_id: 5, license_expiry: "2026-08-10", driver_status: "Available" }, baseCtx)).toBe(false);
  });
  it("does not travel when paired vehicle's registration is invalid", () => {
    const ctx = {
      ...baseCtx,
      pairings: [{ vehicle_id: 1, driver_id: 5 }],
      vehicleById: new Map([[1, { vehicle_id: 1, plate_number: "ABC 1234", registration_expiry: "2026-08-10", insurance_expiry: "2026-12-31" }]]),
    };
    expect(driverCanTravel({ driver_id: 5, license_expiry: "2026-12-31", driver_status: "Available" }, ctx)).toBe(false);
  });
  it("does not travel when paired vehicle is coding-restricted on the date", () => {
    const ctx = {
      ...baseCtx,
      policy: { enabled: true, response: "block", weekdayRestrictions: { Monday: [4] } },
      pairings: [{ vehicle_id: 1, driver_id: 5 }],
      vehicleById: new Map([[1, { vehicle_id: 1, plate_number: "ABC 1234", registration_expiry: "2026-12-31", insurance_expiry: "2026-12-31" }]]),
    };
    expect(driverCanTravel({ driver_id: 5, license_expiry: "2026-12-31", driver_status: "Available" }, ctx)).toBe(false);
  });
});
