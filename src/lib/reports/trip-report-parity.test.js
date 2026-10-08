import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { getTripPerformanceReport, getFleetUtilizationReport } from "./operational-reports";
import { buildTripPerformanceWorkbook, buildFleetUtilizationWorkbook } from "./remaining-workbooks";

const trip = { trip_id: 701, trip_status: "Completed", start_time: "2026-10-03T08:00:00+08:00", distance: 36,
  planned_distance_km: 32, actual_distance_km: 36, estimated_fuel_l: 4, estimated_fuel_cost: 250.8,
  planned_estimated_fuel_l: 3.56, planned_estimated_fuel_cost: 223.21, fuel_reference_price: 62.7,
  fuel_price_snapshot_id: 4, fuel_region: "NCR", fuel_price_source_url: "https://example.gov/price", fuel_price_effective_at: "2026-10-01T00:00:00Z",
  vehicles: { plate_number: "DEMO-701" }, transportation_requests: { service_code: "RESTAURANT_SUPPLY_PICKUP" } };
beforeEach(() => vi.clearAllMocks());
async function decode(bytes) { const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes); return book; }
describe("real selector to workbook parity", () => {
  it("keeps every service, distance, planned/actual estimate and source cell", async () => {
    query.mockResolvedValue({ rows: [trip] });
    const report = await getTripPerformanceReport(null, null, { serviceCode: "RESTAURANT_SUPPLY_PICKUP", status: "Completed", search: "DEMO" });
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("t.trip_status ="); expect(sql).toContain("ILIKE"); expect(values).toContain("Completed"); expect(values).toContain("%DEMO%");
    const sheet = (await decode(await buildTripPerformanceWorkbook(report, {}))).getWorksheet("Details");
    const headers = sheet.getRow(1).values;
    const value = name => sheet.getRow(2).getCell(headers.indexOf(name)).value;
    expect(value("Service")).toBe(report.trips[0].transportation_requests.service_code);
    expect(value("Planned km")).toBe(32); expect(value("Actual km")).toBe(36);
    expect(value("Planned estimated fuel (L)")).toBe(3.56);
    expect(value("Actual estimated fuel (L)")).toBe(4);
    expect(value("Actual estimated cost (PHP)")).toBe(250.8);
    expect(value("Price source")).toContain("https://example.gov/price");
    expect(value("Price effective at")).toBeInstanceOf(Date);
    expect(sheet.autoFilter).toMatch(/^A1:A[A-Z]2$/);
  });
  it("exports measurable cargo utilization and omits unknown capacity", async () => {
    query.mockImplementation(async sql => ({ rows: sql.includes("row_to_json(v.*)") ? [
      { ...trip, vehicle_id: 7, load_type: "Cargo", cargo_weight_kg: 650, cargo_capacity_kg: 1000 },
      { ...trip, trip_id: 702, vehicle_id: 7, load_type: "Cargo", cargo_weight_kg: 650, cargo_capacity_kg: null },
    ] : [] }));
    const report = await getFleetUtilizationReport("2026-10-01", "2026-10-07");
    const sheet = (await decode(await buildFleetUtilizationWorkbook(report, {}))).getWorksheet("Cargo Utilization");
    expect(sheet).toBeDefined(); expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell("A2").value).toBe(701); expect(sheet.getCell("F2").value).toBe(0.65);
  });
  it("retains typed request cargo in fleet activity and its payload worksheet while excluding independent supply dispatches", async () => {
    query.mockImplementation(async sql => {
      if (!sql.includes("row_to_json(v.*)")) return { rows: [] };
      const rows = [
        { ...trip, trip_id: 1, service_type: "PASSENGER", load_type: "Passenger", distance: 12 },
        { ...trip, trip_id: 2, service_type: null, distance: 8 },
        { ...trip, trip_id: 3, service_type: "PASSENGER", load_type: "Cargo", cargo_weight_kg: 650, cargo_capacity_kg: 1000, distance: 36 },
        { ...trip, trip_id: 4, service_type: "SUPPLY_DELIVERY", load_type: null, distance: 40 },
      ];
      // Model main's independent supply-dispatch SQL boundary. Request-backed
      // typed cargo retains PASSENGER here; load_type drives its cargo measure.
      return { rows: sql.includes("COALESCE(ds.service_type, 'PASSENGER') = 'PASSENGER'") ? rows.slice(0, 3) : rows };
    });
    const report = await getFleetUtilizationReport("2026-10-01", "2026-10-07");
    expect(report.totalTrips).toBe(3); expect(report.totalDistance).toBe(56);
    expect(report.trips.map(row => row.trip_id)).toEqual([1, 2, 3]);
    expect(report.cargoUtilization.byTrip.map(row => row.trip_id)).toEqual([3]);
    const book = await decode(await buildFleetUtilizationWorkbook(report, {}));
    expect(book.getWorksheet("Trip Details").rowCount).toBe(4);
    expect(book.getWorksheet("Cargo Utilization").getCell("A2").value).toBe(3);
    expect(book.getWorksheet("Cargo Utilization").getCell("F2").value).toBe(0.65);
  });
});
