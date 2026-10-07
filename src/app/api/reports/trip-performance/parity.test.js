import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(async () => ({})), parseBody: vi.fn(),
  ok: data => Response.json(data), err: (error, status) => Response.json({ error }, { status }),
  handleError: error => Response.json({ error: error.message }, { status: error.status || 500 }),
}));
import { query } from "@/lib/db";
import { SERVICE_CODES } from "@/lib/integration/contracts";
import { GET as jsonGet } from "./route";
import { GET as excelGet } from "./excel/route";
import { GET as listGet } from "../../trips/route";

beforeEach(() => vi.clearAllMocks());
const request = (path, params) => new Request(`http://localhost${path}?${new URLSearchParams(params)}`);
describe("real report and workbook endpoint parity", () => {
  it.each(SERVICE_CODES)("preserves the %s filter, status and search through JSON, register and actual XLSX", async service => {
    const trip = { trip_id: 72, trip_status: "Completed", start_time: "2026-10-03T00:00:00Z", distance: 36, transportation_requests: { service_code: service }, vehicles: { plate_number: "DEMO-72" } };
    query.mockImplementation(async sql => ({ rows: sql.includes("count(*)") ? [{ total: 1 }] : [trip] }));
    const params = { service, status: "Completed", search: "DEMO" };
    const json = await jsonGet(request("/api/reports/trip-performance", params));
    expect(json.status).toBe(200);
    const report = await json.json(); expect(report.serviceCode).toBe(service);
    const excel = await excelGet(request("/api/reports/trip-performance/excel", params));
    expect(excel.status).toBe(200);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await excel.arrayBuffer());
    const details = book.getWorksheet("Details");
    expect(details.getCell("A2").value).toBe(report.trips[0].trip_id);
    expect(details.getCell("Q2").value).toBe(report.trips[0].transportation_requests.service_code);
    expect(details.rowCount).toBe(report.trips.length + 1);
    const list = await listGet(request("/api/trips", params)); expect(list.status).toBe(200);
    for (const [sql, values] of query.mock.calls.filter(([sql]) => sql.includes("ILIKE"))) {
      expect(sql).toContain("st.service_code ="); expect(sql).toContain("t.trip_status =");
      expect(values).toContain(service); expect(values).toContain("Completed"); expect(values).toContain("%DEMO%");
    }
  });
  it.each([jsonGet, excelGet, listGet])("rejects invalid service before querying", async handler => {
    const result = await handler(request("/api/test", { service: "NOT_A_SERVICE" }));
    expect(result.status).toBe(400); expect(query).not.toHaveBeenCalled();
  });
  it.each([jsonGet, excelGet])("reports database failure as 500, rather than bad filter", async handler => {
    query.mockRejectedValue(new Error("Database unavailable"));
    expect((await handler(request("/api/test", {}))).status).toBe(500);
  });
});
