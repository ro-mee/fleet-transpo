import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import * as tomtom from "@/lib/tomtom";

function mockReq(url = "http://localhost:3000/api/system/health?timeframe=24h") {
  return {
    url,
    headers: { get: () => null },
  };
}

describe("GET /api/system/health", () => {
  beforeEach(() => {
    vi.spyOn(utils, "requirePermission").mockResolvedValue(true);
    vi.spyOn(tomtom, "getServerKey").mockReturnValue("mock-tomtom-key");
    vi.spyOn(tomtom, "fetchTomTomRoute").mockResolvedValue({
      distanceKm: 5.2,
      durationMin: 12,
    });
    vi.spyOn(db, "getAdminClient").mockReturnValue({
      storage: {
        listBuckets: vi.fn().mockResolvedValue({
          data: [{ name: "driver-licenses" }, { name: "fuel-receipts" }],
          error: null,
        }),
      },
    });
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      const q = String(sql);
      if (q.includes("app_errors WHERE created_at >= NOW()")) {
        return { rows: [{ n: 0 }] };
      }
      if (q.includes("SELECT 1")) {
        return { rows: [{ "?column?": 1 }] };
      }
      if (q.includes("system_health_snapshots")) {
        return { rows: [] };
      }
      if (q.includes("system_settings")) {
        return { rows: [{ setting_value: { at: new Date().toISOString() } }] };
      }
      return { rows: [] };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires audit read permission and returns full telemetry payload", async () => {
    const res = await GET(mockReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.overall).toBeDefined();
    expect(body.checked_at).toBeDefined();
    expect(body.timeframe).toBe("24h");
    expect(body.kpis).toBeDefined();
    expect(body.kpis.availability).toBeDefined();
    expect(body.kpis.dbLatencyCurrent).toBeDefined();
    expect(body.charts).toBeDefined();
    expect(Array.isArray(body.charts.reliabilityTrend)).toBe(true);
    expect(Array.isArray(body.charts.errorDistribution)).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(Array.isArray(body.incidents)).toBe(true);

    // Verify 9 technical subsystems
    const ids = body.rows.map((r) => r.id);
    expect(ids).toContain("app-runtime");
    expect(ids).toContain("database");
    expect(ids).toContain("integrations");
    expect(ids).toContain("push");
    expect(ids).toContain("ai");
    expect(ids).toContain("auth");
    expect(ids).toContain("sync");
    expect(ids).toContain("storage");
    expect(ids).toContain("maps");
  });

  it("handles timeframe parameter correctly", async () => {
    const res = await GET(mockReq("http://localhost:3000/api/system/health?timeframe=7d"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeframe).toBe("7d");
  });
});
