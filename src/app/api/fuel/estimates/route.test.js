import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const fake = vi.hoisted(() => ({
  role: "fleet_manager", rows: [], totals: null, regions: null, daily: null, report: null, reportArgs: null,
  sqls: [], lastSql: "", lastValues: [],
}));
vi.mock("@/lib/api/utils", () => {
  class AuthError extends Error { constructor(message, status) { super(message); this.status = status; } }
  return {
    AuthError,
    requirePermission: async () => { const { rolesFor } = await import("@/lib/auth/permissions"); if (!rolesFor("reports", "read").includes(fake.role)) throw new AuthError("Forbidden", 403); return { user: { employeeId: 3 } }; },
    ok: (data, status = 200) => Response.json(data, { status }),
    err: (error, status) => Response.json({ error }, { status }),
    handleError: (e) => Response.json({ error: e.message }, { status: e.status || 500 }),
  };
});
vi.mock("@/lib/db", () => ({
  query: async (sql, values) => {
    fake.sqls.push(sql);
    fake.lastSql = sql;
    fake.lastValues = values;
    if (sql.includes("DISTINCT")) return { rows: fake.regions ?? [] };
    if (sql.includes("AS day")) return { rows: fake.daily ?? [] };
    // The rows query carries `COUNT(*)` now (the receipt lateral), so it must
    // be matched before the totals branch.
    if (sql.includes("SELECT t.trip_id")) return { rows: fake.rows };
    if (sql.includes("COUNT(*)")) return { rows: fake.totals ? [fake.totals] : [] };
    return { rows: fake.rows };
  },
}));
vi.mock("@/lib/reports/fuel-consumption", () => ({
  MIN_EFFICIENCY_DISTANCE_KM: 50,
  getFuelConsumptionReport: async (from, to) => {
    fake.reportArgs = [from, to];
    return fake.report ?? {};
  },
}));

const get = (qs = "") => GET(new Request(`https://local/api/fuel/estimates${qs}`, { method: "GET" }));
beforeEach(() => {
  fake.role = "fleet_manager"; fake.rows = []; fake.totals = null; fake.regions = null;
  fake.daily = null; fake.report = null; fake.reportArgs = null; fake.sqls = [];
});

const row = (over = {}) => ({
  trip_id: 7, end_time: "2026-10-03T10:00:00+08:00", actual_distance_km: "120.5",
  estimated_fuel_l: "13.400", estimated_fuel_cost: "1271.52", fuel_reference_price: "94.80",
  fuel_region: "NCR", fuel_estimate_reason: "priced", fuel_estimate_captured_at: "2026-10-03T10:05:00+08:00",
  plate_number: "ABC1234", vehicle_name: "Van 1", fuel_type: "Diesel", source_url: "https://cdn.example/f/ncr.pdf",
  ...over,
});

const rowSql = () => fake.sqls.find((sql) => sql.includes("SELECT t.trip_id")) || "";

describe("fuel estimates monitoring", () => {
  it("lists completed-trip estimates with range totals and filters", async () => {
    fake.rows = [row(), row({ trip_id: 8, estimated_fuel_cost: null, estimated_fuel_l: null, fuel_estimate_reason: "no-price" })];
    fake.totals = { trips: 2, priced_trips: 1, estimated_cost: "1271.52", estimated_liters: "13.40" };
    const body = await (await get("?from=2026-10-01&to=2026-11-01&region=NCR&search=ABC")).json();
    expect(body.totals).toMatchObject({ trips: 2, priced_trips: 1, estimated_cost: 1271.52, estimated_liters: 13.4 });
    expect(body.truncated).toBe(false);
    expect(body.page).toBe(1);
    expect(body.rows[0]).toMatchObject({ trip_id: 7, plate_number: "ABC1234" });
    expect(fake.lastSql).toContain("trip_status = 'Completed'");
    expect(fake.lastValues).toEqual(expect.arrayContaining(["NCR", "%ABC%"]));
  });
  it("rejects bad dates and non-report roles", async () => {
    expect((await get("?from=october")).status).toBe(400);
    expect((await get("?from=2026-11-01&to=2026-10-01")).status).toBe(400);
    fake.role = "driver";
    expect((await get()).status).toBe(403);
  });
  it("rejects impossible calendar days before querying and accepts a real leap day", async () => {
    for (const range of [
      "?from=2026-02-30&to=2026-03-31",
      "?from=2026-04-01&to=2026-04-31",
      "?from=2026-02-29&to=2026-03-01",
    ]) {
      expect((await get(range)).status).toBe(400);
      expect(fake.sqls).toHaveLength(0);
    }
    expect((await get("?from=2024-02-29&to=2024-02-29")).status).toBe(200);
  });
  it("uses a unique tie-breaker when paging trips completed at the same time", async () => {
    await get("?page=2");
    expect(rowSql()).toMatch(/ORDER BY t\.end_time DESC, t\.trip_id DESC\s+LIMIT 500 OFFSET 500/);
  });
  it("treats `to` as inclusive and escapes LIKE wildcards", async () => {
    await get("?from=2026-10-01&to=2026-11-01&search=100%_x");
    // Inclusive `to`: the exclusive bound is the next calendar day.
    expect(fake.lastValues).toEqual(expect.arrayContaining(["2026-10-01T00:00:00+08:00", "2026-11-02T00:00:00+08:00"]));
    expect(fake.lastValues).toEqual(expect.arrayContaining(["%100\\%\\_x%"]));
  });
  it("defaults to the current Manila month, ending on its last day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T12:00:00+08:00"));
    try {
      const body = await (await get()).json();
      expect(body.from).toBe("2026-10-01");
      expect(body.to).toBe("2026-10-31");
      // The exclusive upper bound is the first day of November, not a day later.
      expect(fake.lastValues).toEqual(expect.arrayContaining(["2026-10-01T00:00:00+08:00", "2026-11-01T00:00:00+08:00"]));
    } finally {
      vi.useRealTimers();
    }
  });
  it("flags truncation when the range holds more trips than the 500-row page", async () => {
    fake.rows = Array.from({ length: 500 }, (_, index) => row({ trip_id: index + 1 }));
    fake.totals = { trips: 731, priced_trips: 640, estimated_cost: "91000.00", estimated_liters: "1200.50" };
    const body = await (await get("?from=2026-10-01&to=2026-10-31")).json();
    expect(body.truncated).toBe(true);
    expect(body.totals).toMatchObject({ trips: 731, priced_trips: 640 });
  });
  it("selects the planned-vs-actual columns and price provenance for each row", async () => {
    fake.rows = [row({
      planned_distance_km: "118.0", planned_estimated_fuel_l: "13.111", planned_estimated_fuel_cost: "1241.15",
      distance_provenance: "odometer", fuel_efficiency_snapshot_kmpl: "9.0000",
      effective_at: "2026-09-30T16:00:00Z", verification_method: "Automatic",
    })];
    const body = await (await get("?from=2026-10-01&to=2026-10-31")).json();
    for (const column of [
      "t.planned_distance_km", "t.planned_estimated_fuel_l", "t.planned_estimated_fuel_cost",
      "t.distance_provenance", "t.fuel_efficiency_snapshot_kmpl",
      "s.effective_at", "s.verification_method",
    ]) {
      expect(rowSql()).toContain(column);
    }
    expect(body.rows[0]).toMatchObject({ distance_provenance: "odometer", verification_method: "Automatic" });
  });
  it("matches the region filter case-insensitively", async () => {
    await get("?from=2026-10-01&to=2026-10-31&region=ncr");
    expect(rowSql()).toContain("UPPER(t.fuel_region) = UPPER(");
    expect(fake.lastValues).toEqual(expect.arrayContaining(["ncr"]));
  });
  it("lists the distinct regions for the filter select", async () => {
    fake.regions = [{ fuel_region: "NCR" }, { fuel_region: "REGION III" }];
    const body = await (await get()).json();
    expect(body.regions).toEqual(["NCR", "REGION III"]);
    const regionsSql = fake.sqls.find((sql) => sql.includes("DISTINCT")) || "";
    expect(regionsSql).toContain("FROM trips");
    expect(regionsSql).toContain("trip_status = 'Completed'");
  });
  it("pages past the first 500 rows for exports and only truncates when more remain", async () => {
    fake.rows = Array.from({ length: 231 }, (_, index) => row({ trip_id: 501 + index }));
    fake.totals = { trips: 731, priced_trips: 640, estimated_cost: "91000.00", estimated_liters: "1200.50" };
    const body = await (await get("?from=2026-10-01&to=2026-10-31&page=2")).json();
    expect(body.page).toBe(2);
    expect(body.total).toBe(731);
    expect(rowSql()).toContain("OFFSET 500");
    // Page 2 covers the remainder: the response is the whole filtered set.
    expect(body.truncated).toBe(false);

    const fallback = await (await get("?page=0")).json();
    expect(fallback.page).toBe(1);
  });
  it("carries the distance-ratio aggregates the cost/km and L/100km KPIs divide", async () => {
    fake.totals = {
      trips: 10, priced_trips: 8, litered_trips: 9,
      estimated_cost: "9000.00", estimated_liters: "100.0",
      liters_distance_km: "1000.00", liters_with_distance: "100.0",
      priced_distance_km: "900.00", priced_cost_with_distance: "9000.00",
    };
    const body = await (await get()).json();
    expect(body.totals).toMatchObject({
      litered_trips: 9, liters_distance_km: 1000, liters_with_distance: 100,
      priced_distance_km: 900, priced_cost_with_distance: 9000,
    });
    const totalsSql = fake.sqls.find((sql) => sql.includes("litered_trips")) || "";
    expect(totalsSql).toContain("FILTER (");
    expect(totalsSql).toContain("t.actual_distance_km > 0");
  });
  it("computes the reference-price age and flags stale pricing at the 14-day horizon", async () => {
    fake.rows = [
      row({ price_age_days: 20, price_stale: true }),
      row({ trip_id: 8, price_age_days: 3, price_stale: false }),
    ];
    fake.totals = { trips: 2, priced_trips: 2, stale_priced_trips: "1" };
    const body = await (await get("?from=2026-10-01&to=2026-10-31")).json();

    expect(rowSql()).toContain("AS price_age_days");
    expect(rowSql()).toContain("interval '14 days'");
    expect(body.rows[0]).toMatchObject({ price_age_days: 20, price_stale: true });
    expect(body.rows[1]).toMatchObject({ price_stale: false });

    const staleTotalsSql = fake.sqls.find((sql) => sql.includes("stale_priced_trips")) || "";
    expect(staleTotalsSql).toContain("fuel_price_snapshots");
    expect(staleTotalsSql).toContain("interval '14 days'");
    expect(body.totals.stale_priced_trips).toBe(1);
  });
  it("joins verified receipts to each trip for the estimate-vs-receipt variance", async () => {
    fake.rows = [row({ actual_fuel_l: "12.900", actual_cost: "1200.00", actual_receipt_count: 1 })];
    const body = await (await get("?from=2026-10-01&to=2026-10-31")).json();

    for (const fragment of [
      "fuelrecords", "fr.trip_id = t.trip_id", "fr.status IN ('Approved', 'Completed')", "fr.deleted_at IS NULL",
      "AS actual_fuel_l", "AS actual_cost", "AS actual_receipt_count",
    ]) {
      expect(rowSql()).toContain(fragment);
    }
    expect(body.rows[0]).toMatchObject({ actual_fuel_l: "12.900", actual_cost: "1200.00", actual_receipt_count: 1 });
  });
  it("aggregates the locked cost per completion day for the chart", async () => {
    fake.daily = [{ day: "2026-10-03", trips: "2", priced_trips: "1", estimated_cost: "500.00", estimated_liters: "55.00" }];
    const body = await (await get("?from=2026-10-01&to=2026-10-31&region=NCR")).json();

    expect(body.daily).toEqual([{ day: "2026-10-03", trips: 2, priced_trips: 1, estimated_cost: 500, estimated_liters: 55 }]);
    const dailySql = fake.sqls.find((sql) => sql.includes("AS day")) || "";
    expect(dailySql).toContain("AT TIME ZONE 'Asia/Manila'");
    expect(dailySql).toContain("GROUP BY 1");
  });
  it("preserves unavailable daily cost separately from a genuine zero", async () => {
    fake.daily = [
      { day: "2026-10-01", trips: 2, priced_trips: 0, estimated_cost: null, estimated_liters: null },
      { day: "2026-10-02", trips: 1, priced_trips: 1, estimated_cost: "0.00", estimated_liters: "0.000" },
    ];
    const body = await (await get()).json();
    expect(body.daily).toEqual([
      { day: "2026-10-01", trips: 2, priced_trips: 0, estimated_cost: null, estimated_liters: null },
      { day: "2026-10-02", trips: 1, priced_trips: 1, estimated_cost: 0, estimated_liters: 0 },
    ]);
    const sql = fake.sqls.find((value) => value.includes("AS day"));
    expect(sql).toContain("COUNT(t.estimated_fuel_cost)::int AS priced_trips");
    expect(sql).not.toContain("COALESCE(SUM(t.estimated_fuel_cost), 0)");
  });
  it("reports the measured efficiency read-out from the official report caliber", async () => {
    fake.report = { estimatedEfficiency: 8.4, totalLiters: 1240, totalDistance: 10400 };
    const body = await (await get("?from=2026-10-01&to=2026-10-31")).json();

    expect(fake.reportArgs).toEqual(["2026-10-01", "2026-10-31"]);
    expect(body.measured).toEqual({ efficiency_kmpl: 8.4, liters: 1240, distance_km: 10400, min_distance_km: 50 });

    fake.report = { estimatedEfficiency: null, totalLiters: 0, totalDistance: 0 };
    const insufficient = await (await get("?from=2026-10-01&to=2026-10-31")).json();
    expect(insufficient.measured).toMatchObject({ efficiency_kmpl: null });
  });
});
