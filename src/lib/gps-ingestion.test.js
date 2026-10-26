import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", async (importOriginal) => ({
  ...await importOriginal(), requireDriver: vi.fn(), requirePermission: vi.fn(),
}));
vi.mock("@/lib/api/ownership", () => ({ assertTripOwnership: vi.fn() }));
vi.mock("@/services/ping-advisories.service", () => ({ buildPingAdvisories: vi.fn() }));

import { query } from "@/lib/db";
import { AuthError, requireDriver, requirePermission } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { buildPingAdvisories } from "@/services/ping-advisories.service";
import { POST as mobilePost } from "@/app/api/mobile/driver/trips/[id]/gps/route";
import { POST as locationsPost } from "@/app/api/trips/[id]/locations/route";

const NOW = "2026-10-21T01:00:00.000Z";
const TRIP = { trip_id: 55, driver_id: 4, vehicle_id: 7, trip_status: "In Progress" };
const fix = { latitude: 14.5995, longitude: 120.9842, accuracy: 12 };
const ctx = () => ({ params: Promise.resolve({ id: "55" }) });
const request = (body) => new Request("http://localhost/api/gps", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  requireDriver.mockResolvedValue({ user: { role: "driver", driverId: 4 } });
  requirePermission.mockResolvedValue({ user: { role: "dispatcher" } });
  assertTripOwnership.mockResolvedValue(TRIP);
  buildPingAdvisories.mockResolvedValue({ geofence: { near_pickup: true }, monitor: null, weather: null });
  query.mockImplementation(async (sql, params) => {
    if (/INSERT INTO gpstracking/.test(sql)) return { rows: [{ tracking_id: 1, recorded_at: params[8] ?? NOW }] };
    return { rows: [{ driver_id: 4 }], rowCount: 1 };
  });
});
afterEach(() => vi.useRealTimers());

describe.each([["mobile GPS", mobilePost], ["trip locations", locationsPost]])("%s ingestion", (_name, post) => {
  it("rejects malformed, ambiguous, impossible and implausibly future capture times before writing", async () => {
    for (const recorded_at of ["", "not-a-date", "infinity", "2026-10-21", "2026-10-21T01:00:00", "2026-02-30T01:00:00Z", "2026-10-21T25:00:00Z", 1792544400000, true, {}, [], "2026-10-21T01:00:30.001Z"]) {
      const response = await post(request({ ...fix, recorded_at }), ctx());
      expect(response.status, JSON.stringify(recorded_at)).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
    expect(buildPingAdvisories).not.toHaveBeenCalled();
  });

  it("accepts an explicit offset and the existing 30-second device-clock allowance", async () => {
    const response = await post(request({ ...fix, recorded_at: "2026-10-21T09:00:30+08:00" }), ctx());
    expect(response.status).toBe(201);
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO gpstracking/.test(sql));
    expect(new Date(insert[1][8]).toISOString()).toBe("2026-10-21T01:00:30.000Z");
  });

  it("uses the stored capture time and an atomic strictly-newer guard for the current driver position", async () => {
    const recorded_at = "2026-10-21T00:59:40.000Z";
    expect((await post(request({ ...fix, recorded_at, driver_id: 999, vehicle_id: 999 }), ctx())).status).toBe(201);
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO gpstracking/.test(sql));
    expect(insert[1].slice(0, 2)).toEqual([7, 55]);
    const [sql, params] = query.mock.calls.find(([sql]) => /UPDATE drivers/.test(sql));
    expect(params).toEqual([14.5995, 120.9842, 4, recorded_at]);
    expect(sql).toMatch(/last_location_update\s*=\s*\$4/);
    expect(sql).toMatch(/last_location_update IS NULL OR last_location_update\s*<\s*\$4::TIMESTAMPTZ/i);
  });

  it.each([undefined, null])("keeps the server timestamp fallback for a missing capture time (%s)", async (recorded_at) => {
    const response = await post(request({ ...fix, recorded_at }), ctx());
    expect(response.status).toBe(201);
    expect((await response.json()).recorded_at).toBe(NOW);
    const update = query.mock.calls.find(([sql]) => /UPDATE drivers/.test(sql));
    expect(update[1][3]).toBe(NOW);
  });

  it("retains older or duplicate breadcrumbs without returning obsolete live advisories", async () => {
    query.mockImplementation(async (sql) => /INSERT INTO gpstracking/.test(sql)
      ? { rows: [{ tracking_id: 1, recorded_at: "2026-10-21T00:59:00.000Z" }] }
      : { rows: [], rowCount: 0 });
    const response = await post(request({ ...fix, recorded_at: "2026-10-21T00:59:00.000Z" }), ctx());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ tracking_id: 1, recorded_at: "2026-10-21T00:59:00.000Z", geofence: null, monitor: null, weather: null });
    expect(buildPingAdvisories).not.toHaveBeenCalled();
  });

  it("retains a historical first fix without presenting it as a live arrival hint", async () => {
    const recorded_at = "2026-10-20T01:00:00.000Z";
    const response = await post(request({ ...fix, recorded_at }), ctx());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ recorded_at, geofence: null, monitor: null, weather: null });
    expect(buildPingAdvisories).not.toHaveBeenCalled();
  });

  it("keeps live enrichment for a fresh newer fix", async () => {
    const response = await post(request({ ...fix, recorded_at: "2026-10-21T00:59:55.000Z" }), ctx());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ geofence: { near_pickup: true } });
    expect(buildPingAdvisories).toHaveBeenCalledOnce();
  });

  it("ignores callbacks after the trip closes and refuses another driver's trip", async () => {
    assertTripOwnership.mockResolvedValueOnce({ ...TRIP, trip_status: "Completed" });
    expect(await (await post(request(fix), ctx())).json()).toMatchObject({ tracked: false, reason: "trip-not-live" });
    assertTripOwnership.mockRejectedValueOnce(new AuthError("Trip not found", 404));
    expect((await post(request(fix), ctx())).status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });
});
