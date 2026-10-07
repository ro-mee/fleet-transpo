import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(async () => ({})),
  err: (message, status) => Response.json({ error: message }, { status }),
  handleError: (e) => Response.json({ error: e.message }, { status: e.status ?? 500 }),
}));
vi.mock("@/lib/reports/operational-reports", () => ({ getTripPerformanceReport: vi.fn(), validateReportRange: vi.fn() }));
vi.mock("@/lib/reports/remaining-workbooks", () => ({ buildTripPerformanceWorkbook: vi.fn(async () => ({})) }));
vi.mock("@/lib/reports/excel-response", () => ({ xlsxResponse: vi.fn(async (book) => Response.json({ workbook: true })) }));

import { getTripPerformanceReport, validateReportRange } from "@/lib/reports/operational-reports";
import { buildTripPerformanceWorkbook } from "@/lib/reports/remaining-workbooks";
import { GET } from "./route";

const call = (qs) => GET(new Request(`http://localhost/api/reports/trip-performance/excel${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  validateReportRange.mockReturnValue(null);
  getTripPerformanceReport.mockResolvedValue({ totalTrips: 0, trips: [] });
});

describe("GET /api/reports/trip-performance/excel", () => {
  it("exports the same filtered view the selector returns, including the service filter", async () => {
    const res = await call("?from=2026-10-01&to=2026-10-07&service=RESTAURANT_SUPPLY_PICKUP");
    expect(res.status).toBe(200);
    expect(getTripPerformanceReport).toHaveBeenCalledWith("2026-10-01", "2026-10-07", {
      serviceCode: "RESTAURANT_SUPPLY_PICKUP", status: null, search: null,
    });
    expect(buildTripPerformanceWorkbook).toHaveBeenCalledWith(
      { totalTrips: 0, trips: [] },
      { from: "2026-10-01", to: "2026-10-07" }
    );
  });

  it("rejects an unknown service instead of exporting every service", async () => {
    getTripPerformanceReport.mockRejectedValue(new Error("Unknown service code 'SHUTTLE'. Use one of: A, B."));
    const res = await call("?from=2026-10-01&to=2026-10-07&service=SHUTTLE");
    expect(res.status).toBe(400);
    expect(buildTripPerformanceWorkbook).not.toHaveBeenCalled();
  });
});
