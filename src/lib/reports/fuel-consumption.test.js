import { describe, expect, it } from "vitest";
import { buildFuelConsumptionReport, validateFuelReportRange } from "./fuel-consumption";

const vehicle = (id, plate, baseline) => ({
  vehicle_id: id,
  vehicle_name: `Vehicle ${id}`,
  plate_number: plate,
  category_name: "Sedan",
  baseline_efficiency: baseline,
});

describe("fuel consumption report", () => {
  it("uses reviewed actual fuel, completed distance, and the 50 km rule", () => {
    const report = buildFuelConsumptionReport([
      { ...vehicle(1, "ABC-123", 6), fuel_record_id: 1, fuel_date: "2026-08-01", liters: 80, amount: 4800, status: "Approved" },
      { ...vehicle(2, "XYZ-789", 4), fuel_record_id: 2, fuel_date: "2026-08-02", liters: 10, amount: 620, status: "Completed" },
      { ...vehicle(1, "ABC-123", 6), fuel_record_id: 3, fuel_date: "2026-08-03", liters: 999, amount: 99999, status: "Pending" },
      { ...vehicle(1, "ABC-123", 6), fuel_record_id: 4, fuel_date: "2026-08-04", liters: 999, amount: 99999, status: "Approved", deleted_at: new Date() },
    ], [
      { ...vehicle(1, "ABC-123", 6), trip_id: 1, end_time: "2026-08-04T10:00:00+08:00", distance: 400, trip_status: "Completed" },
      { ...vehicle(2, "XYZ-789", 4), trip_id: 2, end_time: "2026-08-05T10:00:00+08:00", distance: 40, trip_status: "Completed" },
      { ...vehicle(1, "ABC-123", 6), trip_id: 3, end_time: "2026-08-06T10:00:00+08:00", distance: 500, trip_status: "Cancelled" },
    ]);

    expect(report.totalLiters).toBe(90);
    expect(report.totalCost).toBe(5420);
    expect(report.totalDistance).toBe(440);
    expect(report.estimatedEfficiency).toBe(4.89);
    expect(report.fuelTransactionCount).toBe(2);
    expect(report.completedTrips).toBe(2);
    expect(report.byVehicle.find((row) => row.vehicle_id === 1)).toMatchObject({ estimated_kmpl: 5, status: "Below baseline" });
    expect(report.byVehicle.find((row) => row.vehicle_id === 2)).toMatchObject({ estimated_kmpl: null, status: "Insufficient data" });
    expect(report.methodology).toContain("Approved fuel requests are allocations only and are excluded");
  });

  it("rejects invalid or reversed date ranges", () => {
    expect(validateFuelReportRange("2026-08-01", "2026-08-31")).toBeNull();
    expect(validateFuelReportRange("08/01/2026", "2026-08-31")).toMatch(/YYYY-MM-DD/);
    expect(validateFuelReportRange("2026-09-01", "2026-08-31")).toMatch(/on or before/);
  });
});
