import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/trips/[id]/complete/route";
import { POST, PATCH } from "@/app/api/fuel/reference-prices/route";
import { completeTrip } from "@/services/trip-lifecycle.service";
import * as db from "@/lib/db";

vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn(), getAdminClient: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({ AuthError: class extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }, requirePermission: async () => ({ user: { employeeId: 3 } }), parseBody: (req) => req.json(), ok: (data, status = 200) => Response.json(data, { status }), err: (error, status) => Response.json({ error }, { status }), handleError: (error) => Response.json({ error: error.message }, { status: error.status || 500 }) }));
let state; let writes; let trail; let price; let snapshots; let region; let beforeCapture;
beforeEach(() => {
  state = { trip_id: 1, trip_status: "Trip Started", vehicle_id: 5, driver_id: 7, dispatch_id: 55, distance: 32, planned_distance: 32, vehicle_mileage: 1000, fuel_efficiency_kmpl: 9, fuel_type: "Diesel", fuel_estimate_captured_at: null };
  writes = 0; trail = []; price = 62.7; snapshots = null; region = "NCR"; beforeCapture = null;
  // External Supabase and pool boundaries only; all application services run.
  db.getAdminClient.mockImplementation(() => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }));
  db.getPool.mockReturnValue({ options: { max: 10 }, totalCount: 0, idleCount: 0, waitingCount: 0 });
  let tail = Promise.resolve();
  const execute = async (sql, params) => {
    if (sql.includes("FOR UPDATE OF t")) return { rows: [{ ...state }] };
    if (sql.includes("SELECT trip_id, driver_id, vehicle_id, trip_status, dispatch_id")) return { rows: [{ ...state }] };
    if (sql.includes("FROM gpstracking")) return { rows: trail };
    if (sql.includes("INSERT INTO system_settings")) { region = JSON.parse(params[0]); return { rows: [] }; }
    if (sql.includes("fuel_price_region")) return { rows: [{ setting_value: region }] };
    if (sql.includes("INSERT INTO fuel_price_snapshots")) {
      const row = { snapshot_id: 44, fuel_product: params[0], region: params[1], currency: "PHP", unit: "L", reference_price: params[2], effective_at: params[5], source_url: params[7], verification_method: params[8], lifecycle: params[9], source_hash: params[10], verified_by: params[11] };
      snapshots.push(row); return { rows: [row] };
    }
    if (sql.includes("SELECT") && sql.includes("fuel_price_snapshots")) return { rows: snapshots ?? (price == null ? [] : [{ snapshot_id: 4, fuel_product: "Diesel", region: "NCR", currency: "PHP", unit: "L", reference_price: price, effective_at: "2020-01-01T00:00:00Z", verification_method: "Manual", verified_by: 3, lifecycle: "Active" }]) };
    if (sql.includes("UPDATE trips")) {
      if (beforeCapture) await beforeCapture();
      writes++;
      if (state.trip_status === "Completed" || state.fuel_estimate_captured_at) return { rows: [] };
      const columns = ["end_odometer", "distance", null, "gps_distance_km", "planned_distance_km", "actual_distance_km", "distance_provenance", "estimated_fuel_l", "estimated_fuel_cost", "fuel_reference_price", "fuel_price_snapshot_id", "fuel_region", "fuel_efficiency_snapshot_kmpl", "planned_estimated_fuel_l", "planned_estimated_fuel_cost", "fuel_estimate_reason", "fuel_estimate_captured_at"];
      columns.forEach((column, index) => { if (column) state[column] = params[index]; });
      state.trip_status = "Completed";
      return { rows: [{ ...state }] };
    }
    return { rows: [] };
  };
  db.query.mockImplementation(execute);
  db.withTransaction.mockImplementation((fn) => {
    const result = tail.then(() => fn({ query: execute }));
    tail = result.catch(() => {}); return result;
  });
});
describe("production completion route through real service and real price repository", () => {
  it("uses the manual API's persisted verified snapshot through the completion API", async () => {
    snapshots = []; region = null;
    const configured = await PATCH(new Request("https://local/api/fuel/reference-prices", { method: "PATCH", body: JSON.stringify({ region: "NCR" }) }));
    expect(await configured.json()).toEqual({ region: "NCR" });
    expect(configured.status).toBe(200);
    const recorded = await POST(new Request("https://local/api/fuel/reference-prices", { method: "POST", body: JSON.stringify({ fuel_product: "Diesel", region: "NCR", reference_price: "62.70", effective_at: "2020-01-01T00:00:00+08:00", source_url: "https://fixture.example/dated-price", verified_by: 999 }) }));
    expect(recorded.status).toBe(201);
    expect((await recorded.json()).snapshot).toMatchObject({ snapshot_id: 44, verified_by: 3, verification_method: "Manual" });
    const completed = await PUT(new Request("https://local/api/trips/1/complete", { method: "PUT", body: JSON.stringify({ distance: 36 }) }), { params: Promise.resolve({ id: 1 }) });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({ fuel_price_snapshot_id: 44, fuel_reference_price: 62.7, fuel_region: "NCR", estimated_fuel_l: 4, estimated_fuel_cost: 250.8, fuel_estimate_reason: null });
  });
  it("uses the locked stored start odometer when the client omits or changes it", async () => {
    state.start_odometer = 1000;
    const response = await PUT(new Request("https://local/api/trips/1/complete", { method: "PUT", body: JSON.stringify({ end_odometer: 1036, distance: 100 }) }), { params: Promise.resolve({ id: 1 }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ actual_distance_km: 36, distance_provenance: "odometer", estimated_fuel_l: 4, estimated_fuel_cost: 250.8 });
  });
  it("rejects boolean legacy start readings through both the API and service", async () => {
    const response = await PUT(new Request("https://local/api/trips/1/complete", { method: "PUT", body: JSON.stringify({ end_odometer: 1036, start_odometer: true }) }), { params: Promise.resolve({ id: 1 }) });
    expect(response.status).toBe(400);
    await expect(completeTrip(1, {}, { endOdometer: 1036, startOdometer: true })).rejects.toMatchObject({ status: 400 });
    expect(writes).toBe(0);
  });
  it("rejects nonnumeric end readings rather than completing with fabricated or missing odometer math", async () => {
    state.vehicle_mileage = 0; state.start_odometer = 0;
    for (const endOdometer of [true, {}, []]) {
      await expect(completeTrip(1, {}, { endOdometer })).rejects.toMatchObject({ status: 400 });
    }
    const response = await PUT(new Request("https://local/api/trips/1/complete", { method: "PUT", body: JSON.stringify({ end_odometer: true }) }), { params: Promise.resolve({ id: 1 }) });
    expect(response.status).toBe(400); expect(writes).toBe(0);
  });
  it("keeps numeric-string legacy readings and ignores a changed client start when stored", async () => {
    const legacy = await completeTrip(1, {}, { endOdometer: "1036", startOdometer: "1000" });
    expect(legacy.actual_distance_km).toBe(36);
    state.trip_status = "Trip Started"; state.fuel_estimate_captured_at = null; state.start_odometer = "1000";
    expect((await completeTrip(1, {}, { endOdometer: "1036", startOdometer: 1 })).actual_distance_km).toBe(36);
  });
  it("rejects a boolean distance instead of fabricating a one-kilometer trip", async () => {
    const response = await PUT(new Request("https://local/api/trips/1/complete", { method: "PUT", body: JSON.stringify({ distance: true }) }), { params: Promise.resolve({ id: 1 }) });
    expect(response.status).toBe(400); expect(writes).toBe(0);
  });
  it("stores 36/9/62.70 without a caller-injected price and keeps planned estimates separate", async () => {
    const response = await PUT(new Request("https://local/api/trips/1/complete", { method: "PUT", body: JSON.stringify({ distance: 36 }) }), { params: Promise.resolve({ id: 1 }) });
    expect(response.status).toBe(200);
    const row = await response.json();
    expect(row).toMatchObject({ estimated_fuel_l: 4, estimated_fuel_cost: 250.8, planned_distance_km: 32, actual_distance_km: 36, fuel_efficiency_snapshot_kmpl: 9, planned_estimated_fuel_l: 3.556, planned_estimated_fuel_cost: 222.96 });
  });
  it("never fabricates actual distance from the planned route", async () => {
    const row = await completeTrip(1, {}, {});
    expect(row.actual_distance_km).toBeNull();
    expect(row.distance_provenance).toBeNull();
    expect(row.fuel_estimate_reason).toBe("no-distance");
  });
  it("uses the real GPS trail when the planned route is the only stored distance", async () => {
    trail = [{ latitude: 14, longitude: 121, recorded_at: "2026-10-07T10:00:00Z" }, { latitude: 14.1, longitude: 121, recorded_at: "2026-10-07T10:30:00Z" }];
    const row = await completeTrip(1, {}, {});
    expect(row.actual_distance_km).toBeGreaterThan(11);
    expect(row.actual_distance_km).toBeLessThan(12);
    expect(row.distance_provenance).toBe("gps-trail");
    expect(row.planned_distance_km).toBe(32);
    expect(row.actual_distance_km).not.toBe(row.planned_distance_km);
    expect(row.estimated_fuel_cost).not.toBe(row.planned_estimated_fuel_cost);
  });
  it("preserves the whole nonnull basis when a retry arrives while the first capture is paused", async () => {
    let release; let entered;
    const paused = new Promise((resolve) => { entered = resolve; });
    const resume = new Promise((resolve) => { release = resolve; });
    beforeCapture = async () => { entered(); await resume; };
    const first = completeTrip(1, {}, { distance: 36 });
    await paused;
    const second = completeTrip(1, {}, { distance: 40 });
    price = 70; state.fuel_efficiency_kmpl = 12;
    expect(writes).toBe(0);
    release();
    const [a, b] = await Promise.all([first, second]);
    for (const row of [a, b]) expect(row).toMatchObject({ actual_distance_km: 36, planned_distance_km: 32, distance_provenance: "trip-distance", fuel_efficiency_snapshot_kmpl: 9, fuel_reference_price: 62.7, fuel_price_snapshot_id: 4, fuel_region: "NCR", estimated_fuel_l: 4, estimated_fuel_cost: 250.8, planned_estimated_fuel_l: 3.556, planned_estimated_fuel_cost: 222.96, fuel_estimate_reason: null });
    expect(a.fuel_estimate_captured_at).toEqual(b.fuel_estimate_captured_at);
    expect(writes).toBe(1);
  });
  it("concurrent retries capture exactly one whole basis and preserve unavailable state", async () => {
    price = null;
    const first = completeTrip(1, {}, { distance: 36 });
    const second = completeTrip(1, {}, { distance: 40 });
    const [a, b] = await Promise.all([first, second]);
    expect(writes).toBe(1); expect(a.actual_distance_km).toBe(36); expect(b.actual_distance_km).toBe(36);
    expect(b.fuel_estimate_reason).toBe("no-price"); expect(b.estimated_fuel_cost).toBeNull();
    price = 70; state.fuel_efficiency_kmpl = 12;
    const later = await completeTrip(1, {}, { distance: 50 });
    expect(writes).toBe(1); expect(later.estimated_fuel_cost).toBeNull(); expect(later.fuel_efficiency_snapshot_kmpl).toBe(9);
  });
});
