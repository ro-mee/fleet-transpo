import { describe, it, expect, vi } from "vitest";
import * as db from "@/lib/db";
import { buildHealthRows, getHealthTelemetry } from "./system-health";

describe("system-health row builder & evaluations", () => {
  it("builds operational state when all probes are healthy", () => {
    const { rows, overall } = buildHealthRows({
      appErrors15m: 0,
      db: { ok: true, latencyMs: 65 },
      integrationFailed: 0,
      integrationPending: 0,
      pushErrors: 0,
      pushStalePending: 0,
      pushFreshPending: 1,
      aiErrors24h: 0,
      loginFailures24h: 0,
      syncLastOkAt: new Date().toISOString(),
      storage: { ok: true, bucketsCount: 6 },
      maps: { ok: true, latencyMs: 320 },
    });

    expect(overall).toBe("operational");
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.state === "operational")).toBe(true);
  });

  it("marks overall degraded when database probe fails", () => {
    const { rows, overall } = buildHealthRows({
      appErrors15m: 0,
      db: { ok: false },
      storage: { ok: true },
      maps: { ok: true },
    });

    expect(overall).toBe("degraded");
    const dbRow = rows.find((r) => r.id === "database");
    expect(dbRow.state).toBe("degraded");
  });

  it("marks attention when push notifications are stuck", () => {
    const { rows, overall } = buildHealthRows({
      appErrors15m: 0,
      db: { ok: true, latencyMs: 80 },
      pushErrors: 0,
      pushStalePending: 3,
      pushFreshPending: 0,
      syncLastOkAt: new Date().toISOString(),
    });

    expect(overall).toBe("attention");
    const pushRow = rows.find((r) => r.id === "push");
    expect(pushRow.state).toBe("attention");
  });

  it("handles storage probe degraded and operational states", () => {
    const degraded = buildHealthRows({
      storage: { ok: false, error: "Bucket unreachable" },
    });
    const sDeg = degraded.rows.find((r) => r.id === "storage");
    expect(sDeg.state).toBe("degraded");
    expect(sDeg.summary).toBe("Bucket unreachable");

    const healthy = buildHealthRows({
      storage: { ok: true, bucketsCount: 6 },
    });
    const sOk = healthy.rows.find((r) => r.id === "storage");
    expect(sOk.state).toBe("operational");
    expect(sOk.summary).toContain("6 storage buckets active");
  });

  it("handles maps probe heuristic warning and operational states", () => {
    const warn = buildHealthRows({
      maps: { warning: true, message: "TomTom API key not configured" },
    });
    const mWarn = warn.rows.find((r) => r.id === "maps");
    expect(mWarn.state).toBe("attention");

    const okProbe = buildHealthRows({
      maps: { ok: true, latencyMs: 412 },
    });
    const mOk = okProbe.rows.find((r) => r.id === "maps");
    expect(mOk.state).toBe("operational");
    expect(mOk.summary).toContain("412ms");
  });

  it("preserves backward compatibility when storage and maps are omitted", () => {
    const res = buildHealthRows({
      appErrors15m: 0,
      db: { ok: true, latencyMs: 50 },
    });
    expect(res.rows).toHaveLength(7);
  });
});

describe("health telemetry", () => {
  it("does not manufacture history or percentages when there are no samples", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    try {
      const result = await getHealthTelemetry("24h");
      expect(query).toHaveBeenCalledTimes(4);
      expect(query.mock.calls.every(([sql]) => /^\s*(WITH|SELECT)/i.test(sql))).toBe(true);
      expect(query.mock.calls.filter(([, params]) => params.length === 1).every(([sql]) => !sql.includes("$2"))).toBe(true);
      expect(result.kpis.availability).toBeNull();
      expect(result.kpis.dbLatencyAvg).toBeNull();
      expect(result.kpis.dbLatencyP95).toBeNull();
      expect(result.kpis.pushSuccessRate).toBeNull();
      expect(result.kpis.appErrorsCount).toBe(0);
      expect(result.charts.reliabilityTrend).toEqual([]);
    } finally {
      query.mockRestore();
    }
  });

  it("uses measured snapshots and the actual push-outbox denominator", async () => {
    const bucket = "2026-10-03T00:00:00.000Z";
    const query = vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("WITH time_buckets")) return { rows: [{ bucket, app_errors: 2, integration_errors: 0, push_errors: 1, ai_errors: 0, auth_errors: 0 }] };
      if (sql.includes("AVG(db_latency_ms)")) return { rows: [{ bucket, avg_latency: 120, avg_availability: "50", count: 2 }] };
      if (sql.includes("ORDER BY db_latency_ms")) return { rows: [{ db_latency_ms: 100 }, { db_latency_ms: 120 }, { db_latency_ms: 300 }] };
      return { rows: [{ sent: 2, errors: 1, total: 4 }] };
    });
    try {
      const result = await getHealthTelemetry("24h");
      expect(result.kpis.availability).toBe(50);
      expect(result.kpis.dbLatencyP95).toBe(300);
      expect(result.kpis.pushSuccessRate).toBe(50);
      expect(result.kpis.appErrorsCount).toBe(2);
      expect(result.charts.reliabilityTrend[0]).toMatchObject({ availability: 50, latency: 120, errorCount: 3 });
    } finally {
      query.mockRestore();
    }
  });
});
