import { afterEach, describe, expect, it, vi } from "vitest";
import { getAnalyticsWorkbook, getFleetUtilizationWorkbook } from "@/services/report.service";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Minimal stand-ins for the two Web APIs `getWorkbook` touches. `Blob` exists in
// Node; only the fetch response has to be faked.
function response({ ok = true, status = 200, type = XLSX_MIME, body = "xlsx-bytes", disposition = null }) {
  const blob = new Blob([body], { type });
  return {
    ok,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-disposition" ? disposition : name.toLowerCase() === "content-type" ? type : null) },
    blob: async () => blob,
    json: async () => ({ error: "Not signed in" }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("report.service workbook downloads", () => {
  it("returns the blob and the server's filename", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      disposition: 'attachment; filename="fleet-activity-utilization-2026-09-01-to-2026-10-01.xlsx"',
    })));
    const result = await getFleetUtilizationWorkbook("2026-09-01", "2026-10-01");
    expect(result.filename).toBe("fleet-activity-utilization-2026-09-01-to-2026-10-01.xlsx");
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("falls back to the canonical name when the header carries none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({})));
    const result = await getAnalyticsWorkbook("2026-09-01", "2026-10-01");
    expect(result.filename).toBe("fleet-analytics-2026-09-01-to-2026-10-01.xlsx");
  });

  it("rejects a non-OK response with the server's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: false, status: 403 })));
    await expect(getAnalyticsWorkbook("2026-09-01", "2026-10-01")).rejects.toThrow("Not signed in");
  });

  it("rejects an empty body — a 200 is not a workbook", async () => {
    // `downloadBlob` saves whatever it is handed, so this must fail before any
    // success feedback rather than landing an empty .xlsx in Downloads.
    vi.stubGlobal("fetch", vi.fn(async () => response({ body: "" })));
    await expect(getAnalyticsWorkbook("2026-09-01", "2026-10-01")).rejects.toThrow(/came back empty/);
  });

  it("rejects a page served with 200 instead of a workbook", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ type: "text/html", body: "<html>Sign in</html>" })));
    await expect(getAnalyticsWorkbook("2026-09-01", "2026-10-01")).rejects.toThrow(/instead of a workbook/);
  });
});
