import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const fake = vi.hoisted(() => ({ role: "fleet_manager", rows: [], lastSql: "", lastValues: [] }));
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
  query: async (sql, values) => { fake.lastSql = sql; fake.lastValues = values; return { rows: fake.rows }; },
}));

const get = (qs = "") => GET(new Request(`https://local/api/fuel/estimates${qs}`, { method: "GET" }));
beforeEach(() => { fake.role = "fleet_manager"; fake.rows = []; });

const row = (over = {}) => ({
  trip_id: 7, end_time: "2026-10-03T10:00:00+08:00", actual_distance_km: "120.5",
  estimated_fuel_l: "13.400", estimated_fuel_cost: "1271.52", fuel_reference_price: "94.80",
  fuel_region: "NCR", fuel_estimate_reason: "priced", fuel_estimate_captured_at: "2026-10-03T10:05:00+08:00",
  plate_number: "ABC1234", vehicle_name: "Van 1", fuel_type: "Diesel", source_url: "https://cdn.example/f/ncr.pdf",
  ...over,
});

describe("fuel estimates monitoring", () => {
  it("lists completed-trip estimates with totals and filters", async () => {
    fake.rows = [row(), row({ trip_id: 8, estimated_fuel_cost: null, estimated_fuel_l: null, fuel_estimate_reason: "no-price" })];
    const body = await (await get("?from=2026-10-01&to=2026-11-01&region=NCR&search=ABC")).json();
    expect(body.totals).toMatchObject({ trips: 2, estimated_cost: 1271.52, estimated_liters: 13.4 });
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
  it("treats `to` as inclusive and escapes LIKE wildcards", async () => {
    await get("?from=2026-10-01&to=2026-11-01&search=100%_x");
    // Inclusive `to`: the exclusive bound is the next calendar day.
    expect(fake.lastValues).toEqual(expect.arrayContaining(["2026-10-01T00:00:00+08:00", "2026-11-02T00:00:00+08:00"]));
    expect(fake.lastValues).toEqual(expect.arrayContaining(["%100\\%\\_x%"]));
  });
});
