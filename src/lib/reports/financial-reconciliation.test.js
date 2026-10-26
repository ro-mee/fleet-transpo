import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { getFinancialSummary, getFleetCostReport } from "./operational-reports";
import { buildFinancialWorkbook, buildFleetCostWorkbook, buildExecutiveWorkbook } from "./remaining-workbooks";

const range = { from: "2026-10-01", to: "2026-10-31" };
const fuel = [
  { fuel_record_id: 1, vehicle_id: 10, fuel_date: "2026-10-02", amount: "100", liters: 2, status: "Approved" },
  { fuel_record_id: 2, vehicle_id: 10, fuel_date: "2026-10-02", amount: "50", liters: 1, status: "Completed" },
  { fuel_record_id: 3, vehicle_id: 10, fuel_date: "2026-10-02", amount: "900", status: "Pending" },
  { fuel_record_id: 4, vehicle_id: 10, fuel_date: "2026-10-02", amount: "800", status: "Rejected" },
];
const expenses = [
  { id: 1, vehicle_id: 10, category: "Toll", amount: "25.10", currency: "PHP", expense_date: "2026-10-03T08:00:00+08:00", status: "Approved" },
  { id: 2, vehicle_id: null, category: "Parking", amount: "14.90", currency: "PHP", expense_date: "2026-10-04T08:00:00+08:00", status: "Approved" },
  { id: 3, vehicle_id: 10, category: "Meals", amount: "500", currency: "PHP", expense_date: "2026-10-04T08:00:00+08:00", status: "Pending" },
  { id: 4, vehicle_id: 10, category: "Other", amount: "10", currency: "USD", expense_date: "2026-10-04T08:00:00+08:00", status: "Approved" },
];

beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation(async (sql) => {
    if (sql.includes("FROM fuelrecords")) return { rows: sql.includes("status IN ('Approved', 'Completed')") ? fuel.slice(0, 2) : fuel };
    if (sql.includes("FROM expense_records")) return { rows: sql.includes("status = 'Approved'") ? expenses.filter(row => row.status === "Approved") : expenses };
    if (sql.includes("FROM vehiclemaintenance")) return { rows: [{ maintenance_id: 1, vehicle_id: 10, maintenance_date: "2026-10-03", cost: "60", status: "Scheduled", maintenance_type: "Inspection" }] };
    if (sql.includes("FROM trips")) return { rows: [{ trip_id: 1, vehicle_id: 10, start_time: "2026-10-03", distance: "100", total_cost: "9999", trip_status: "Completed" }] };
    if (sql.includes("FROM vehicles")) return { rows: [{ vehicle_id: 10, plate_number: "TEST 10", vehicle_name: "Van" }] };
    throw new Error(`Unexpected report query: ${sql}`);
  });
});

describe("financial reconciliation", () => {
  it("groups an expense instant by the Philippine month across the UTC boundary", async () => {
    const original = query.getMockImplementation();
    query.mockImplementation(sql => sql.includes("FROM expense_records")
      ? Promise.resolve({ rows: [{ ...expenses[0], expense_date: "2026-09-30T16:30:00Z" }] })
      : original(sql));
    const report = await getFinancialSummary(range.from, range.to);
    expect(report.monthlyData.map(row => row.month)).toEqual(["2026-10"]);
    expect(report.monthlyData[0].expenseCost).toBe(25.1);
  });

  it("totals eligible fuel, recorded maintenance and approved PHP expenses once", async () => {
    const report = await getFinancialSummary(range.from, range.to);
    expect(report).toMatchObject({ fuelCost: 150, maintCost: 60, expenseCost: 40, totalCost: 250, totalDistance: 100, costPerKm: 2.5 });
    expect(report.expensesByCategory).toEqual([{ category: "Toll", cost: 25.1, count: 1 }, { category: "Parking", cost: 14.9, count: 1 }]);
    expect(report.monthlyData).toEqual([{ month: "2026-10", fuelCost: 150, maintenanceCost: 60, expenseCost: 40, distance: 100 }]);
    expect(report.expenseRecords.map(row => row.id)).toEqual([1, 2]);
    expect(report.excludedExpenseCurrencies).toEqual([{ currency: "USD", count: 1, amount: 10 }]);
    for (const [sql, params] of query.mock.calls) {
      expect(params).toEqual([range.from, range.to]);
      if (sql.includes("FROM expense_records")) {
        expect(sql).toContain("status = 'Approved'");
        expect(sql).toContain("expense_date");
        expect(sql).not.toContain("ocr_snapshot");
        expect(sql).not.toContain("receipt_storage_key");
      }
    }
  });

  it("reconciles vehicle totals including expenses without a current vehicle", async () => {
    const report = await getFleetCostReport(range.from, range.to);
    expect(report.totals).toMatchObject({ fuel_cost: 150, maintenance_cost: 60, expense_cost: 40, total_cost: 250, distance: 100, cost_per_km: 2.5 });
    expect(report.details.find(row => row.vehicle_id === 10)).toMatchObject({ total_cost: 235.1, expense_cost: 25.1 });
    expect(report.details.find(row => row.vehicle_id === null)).toMatchObject({ total_cost: 14.9, expense_cost: 14.9 });
  });

  it("exports all three sources and matching monthly formulas with approval evidence", async () => {
    const report = await getFinancialSummary(range.from, range.to);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildFinancialWorkbook(report, range));
    expect(book.getWorksheet("Summary").getCell("A6").value).toBe(250);
    expect(book.getWorksheet("Analysis").getCell("A8").value).toBe("Approved driver expenses");
    expect(book.getWorksheet("Analysis").getCell("B8").value).toBe(40);
    expect(book.getWorksheet("Trends").getCell("E5").value).toEqual({ formula: "B5+C5+D5", result: 250 });
    expect(book.getWorksheet("Expense Details").rowCount).toBe(3);
    expect(book.getWorksheet("Expense Categories").getCell("B2").value).toBe(25.1);
    expect(book.getWorksheet("Excluded Currencies").getCell("A2").value).toBe("USD");
  });

  it("keeps the fleet workbook total and expense source rows reconciled", async () => {
    const report = await getFleetCostReport(range.from, range.to);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildFleetCostWorkbook(report, range));
    expect(book.getWorksheet("Summary").getCell("A6").value).toBe(250);
    expect(book.getWorksheet("Expense Details").rowCount).toBe(3);
    expect(book.getWorksheet("Vehicle Costs").getCell("F2").value).toBe(25.1);
  });

  it("includes approved expenses in the analytics workbook composition and monthly cost", async () => {
    const financial = await getFinancialSummary(range.from, range.to);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildExecutiveWorkbook({ fleet: {}, fuel: {}, financial, drivers: {} }, range));
    expect(book.getWorksheet("Summary").getCell("B23").value).toMatchObject({ result: 40 });
    expect(book.getWorksheet("Trends").getCell("E5").value).toEqual({ formula: "C5+D5+H5", result: 250 });
  });
});
