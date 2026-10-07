import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import {
  getTripPerformanceReport,
  getFleetUtilizationReport,
} from "./operational-reports";

const tripRow = (overrides = {}) => ({
  trip_id: 1,
  trip_status: "Completed",
  start_time: "2026-10-03T08:00:00+08:00",
  distance: 36,
  planned_distance_km: 32,
  actual_distance_km: 36,
  estimated_fuel_l: 4,
  estimated_fuel_cost: 250.8,
  fuel_reference_price: 62.7,
  fuel_price_snapshot_id: 4,
  fuel_region: "NCR",
  transportation_requests: { service_code: "GUEST_TRANSPORT" },
  vehicles: { plate_number: "ABC 1234", vehicle_name: "HiAce" },
  drivers: { first_name: "Juan", last_name: "Cruz" },
  routes: { route_name: "Hotel run" },
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("trip performance service filter", () => {
  it("accepts each of the five canonical codes and filters server-side", async () => {
    for (const code of [
      "GUEST_TRANSPORT",
      "VIP_GUEST_TRANSPORT",
      "RESTAURANT_SUPPLY_PICKUP",
      "RESTAURANT_FOOD_DELIVERY",
      "HOTEL_SUPPLY_TRANSFER",
    ]) {
      query.mockResolvedValueOnce({ rows: [] });
      const report = await getTripPerformanceReport("2026-10-01", "2026-10-07", { serviceCode: code });
      expect(report.serviceCode).toBe(code);
      const [sql, params] = query.mock.calls.at(-1);
      expect(sql).toContain("st.service_code = $");
      expect(params).toContain(code);
    }
  });

  it("rejects unknown codes instead of silently returning every service", async () => {
    await expect(getTripPerformanceReport("2026-10-01", "2026-10-07", { serviceCode: "SHUTTLE" })).rejects.toThrow(
      /Unknown service code/
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("leaves the register unfiltered when no service is chosen", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const report = await getTripPerformanceReport("2026-10-01", "2026-10-07", {});
    expect(report.serviceCode).toBeNull();
    expect(String(query.mock.calls[0][0])).not.toContain("st.service_code = $");
  });
});

describe("trip fuel estimate labels", () => {
  it("labels planned, actual, delta, fuel, cost and price source explicitly", async () => {
    query.mockResolvedValueOnce({ rows: [tripRow()] });
    const report = await getTripPerformanceReport("2026-10-01", "2026-10-07", {});
    expect(report.trips[0].fuel_estimate).toEqual({
      planned_distance_km: 32,
      actual_distance_km: 36,
      distance_delta_km: 4,
      estimated_fuel_l: 4,
      estimated_fuel_cost_php: 250.8,
      reference_price_php_per_l: 62.7,
      price_source: { snapshot_id: 4, region: "NCR" },
      basis: "estimated-actual",
    });
    expect(report.fuelEstimates).toMatchObject({ estimatedTrips: 1, totalEstimatedLiters: 4, totalEstimatedCostPhp: 250.8, unavailableTrips: 0 });
    expect(report.methodology).toMatch(/estimate/);
  });

  it("marks trips without a basis unavailable, never zero", async () => {
    query.mockResolvedValueOnce({
      rows: [tripRow({ estimated_fuel_l: null, estimated_fuel_cost: null, fuel_reference_price: null, fuel_price_snapshot_id: null })],
    });
    const report = await getTripPerformanceReport("2026-10-01", "2026-10-07", {});
    expect(report.trips[0].fuel_estimate.basis).toBe("unavailable");
    expect(report.trips[0].fuel_estimate.estimated_fuel_l).toBeNull();
    expect(report.fuelEstimates).toMatchObject({ estimatedTrips: 0, unavailableTrips: 1 });
  });
});

describe("fleet cargo utilization", () => {
  const vehicles = [{ vehicle_id: 12, plate_number: "TRK 9", vehicle_status: "Available" }];

  function mockUtilization(tripRows) {
    query.mockImplementation(async (sql) => {
      if (sql.includes("row_to_json(v.*)")) return { rows: tripRows };
      return { rows: vehicles };
    });
  }

  it("reports 650/1000 as 65% and omits unknown capacity", async () => {
    mockUtilization([
      { trip_id: 1, trip_status: "Completed", start_time: "2026-10-03T08:00:00+08:00", distance: 36, vehicle_id: 12, load_type: "Cargo", cargo_weight_kg: 650, cargo_capacity_kg: 1000, vehicles: { plate_number: "TRK 9" } },
      { trip_id: 2, trip_status: "Completed", start_time: "2026-10-03T09:00:00+08:00", distance: 20, vehicle_id: 12, load_type: "Cargo", cargo_weight_kg: 400, cargo_capacity_kg: null, vehicles: { plate_number: "TRK 9" } },
      { trip_id: 3, trip_status: "In Progress", start_time: "2026-10-03T10:00:00+08:00", distance: 5, vehicle_id: 12, load_type: "Cargo", cargo_weight_kg: 900, cargo_capacity_kg: 1000, vehicles: { plate_number: "TRK 9" } },
      { trip_id: 4, trip_status: "Completed", start_time: "2026-10-03T11:00:00+08:00", distance: 12, vehicle_id: 13, load_type: "Passenger", passenger_count: 4, vehicles: { plate_number: "ABC 1" } },
    ]);
    const report = await getFleetUtilizationReport("2026-10-01", "2026-10-07");
    expect(report.cargoUtilization.trips).toBe(1);
    expect(report.cargoUtilization.average_pct).toBe(65);
    expect(report.cargoUtilization.byTrip).toEqual([
      { trip_id: 1, vehicle_id: 12, plate: "TRK 9", weight_kg: 650, capacity_kg: 1000, utilization_pct: 65 },
    ]);
    expect(report.methodology).toMatch(/omitted, never zero-filled/);
  });

  it("reports null average when no measurable cargo trip exists", async () => {
    mockUtilization([]);
    const report = await getFleetUtilizationReport("2026-10-01", "2026-10-07");
    expect(report.cargoUtilization).toEqual({ trips: 0, average_pct: null, byTrip: [] });
  });
});
