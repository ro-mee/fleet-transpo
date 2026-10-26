import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";
import { resolveEtaMinutes } from "@/lib/scheduling/start-window";

let nextTripId = 10000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T08:00:00Z"));
  vi.stubEnv("TOMTOM_API_KEY", "test-key");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function setup() {
  const state = {
    driverId: 7,
    position: [14.5, 121],
    durationSeconds: 600,
    policy: {},
    trip: {
      trip_id: ++nextTripId,
      trip_status: "Driver Accepted",
      origin_latitude: 14.6,
      origin_longitude: 121,
      destination_latitude: 14.7,
      destination_longitude: 121,
      estimated_duration: 99,
      departure_time: "2026-10-21T10:00:00Z",
    },
  };
  vi.spyOn(apiUtils, "requireDriver").mockImplementation(async () => ({ user: { driverId: state.driverId } }));
  const query = vi.spyOn(db, "query").mockImplementation(async sql => {
    if (sql.includes("FROM trips t")) return { rows: [{ ...state.trip }] };
    if (sql.includes("FROM drivers")) return { rows: state.position ? [{ current_latitude: state.position[0], current_longitude: state.position[1] }] : [] };
    if (sql.includes("system_settings")) return { rows: [{ setting_value: state.policy }] };
    if (sql.includes("FROM vehicleinspection")) return { rows: [{ status: "Passed" }] };
    return { rows: [] };
  });
  const fetchRoute = vi.fn(async () => ({
    ok: true,
    json: async () => ({ routes: [{ summary: { travelTimeInSeconds: state.durationSeconds } }] }),
  }));
  vi.stubGlobal("fetch", fetchRoute);
  const read = async (search = "") => {
    const response = await GET({ nextUrl: new URL(`http://x/api/mobile/driver/trips${search}`) });
    expect(response.status).toBe(200);
    const body = await response.json();
    return Array.isArray(body) ? body[0] : body.trips[0];
  };
  return { state, query, fetchRoute, read };
}

describe("mobile trip feed ETA reuse", () => {
  it("reuses a recent route across 15-second polls while refreshing inspection and policy", async () => {
    const { state, query, fetchRoute, read } = setup();
    expect((await read()).eta_to_pickup_min).toBe(10);
    state.durationSeconds = 1200;
    state.policy = { departureBufferMinutes: 20, earlyStartAllowanceMinutes: 5 };
    vi.advanceTimersByTime(15000);
    const row = await read();
    expect(row.eta_to_pickup_min).toBe(10);
    expect(row.recommended_departure).toBe("2026-10-21T09:30:00.000Z");
    expect(row.earliest_start).toBe("2026-10-21T09:25:00.000Z");
    expect(row.pre_trip_status).toBe("Passed");
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.filter(([sql]) => sql.includes("FROM vehicleinspection"))).toHaveLength(2);
  });

  it("refreshes the route after one minute", async () => {
    const { state, fetchRoute, read } = setup();
    await read();
    state.durationSeconds = 1200;
    vi.advanceTimersByTime(60000);
    expect((await read()).eta_to_pickup_min).toBe(20);
    expect(fetchRoute).toHaveBeenCalledTimes(2);
  });

  it("tolerates GPS jitter but refreshes after the driver moves 50 metres", async () => {
    const { state, fetchRoute, read } = setup();
    await read();
    state.durationSeconds = 1200;
    state.position = [14.5002, 121]; // ~22 metres from the calculation.
    expect((await read()).eta_to_pickup_min).toBe(10);
    state.position = [14.501, 121]; // ~111 metres from the calculation.
    expect((await read()).eta_to_pickup_min).toBe(20);
    expect(fetchRoute).toHaveBeenCalledTimes(2);
  });

  it.each(["pickup", "estimate", "driver", "trip"])("refreshes when %s inputs change", async field => {
    const { state, fetchRoute, read } = setup();
    await read();
    state.durationSeconds = 1200;
    if (field === "pickup") state.trip.origin_latitude = 14.61;
    if (field === "estimate") state.trip.estimated_duration = 50;
    if (field === "driver") state.driverId = 8;
    if (field === "trip") state.trip.trip_id = ++nextTripId;
    expect((await read()).eta_to_pickup_min).toBe(20);
    expect(fetchRoute).toHaveBeenCalledTimes(2);
  });

  it("coalesces overlapping polls for the same route", async () => {
    const { fetchRoute, read } = setup();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    fetchRoute.mockImplementation(async () => {
      await pending;
      return { ok: true, json: async () => ({ routes: [{ summary: { travelTimeInSeconds: 600 } }] }) };
    });
    const first = read();
    const second = read();
    await vi.waitFor(() => expect(fetchRoute).toHaveBeenCalled());
    release();
    const rows = await Promise.all([first, second]);
    expect(rows.map(row => row.eta_to_pickup_min)).toEqual([10, 10]);
    expect(fetchRoute).toHaveBeenCalledTimes(1);
  });

  it("keeps unknown estimates null and resolves when GPS becomes available", async () => {
    const { state, fetchRoute, read } = setup();
    state.position = null;
    state.trip.estimated_duration = null;
    const unknown = await read();
    expect(unknown.eta_to_pickup_min).toBeNull();
    expect(unknown.earliest_start).toBeNull();
    expect(unknown.latest_start).toBe("2026-10-21T10:00:00.000Z");
    state.position = [14.5, 121];
    expect((await read()).eta_to_pickup_min).toBe(10);
    expect(fetchRoute).toHaveBeenCalledTimes(1);
  });

  it("does not let advisory caching affect the authoritative ETA resolver", async () => {
    const { state, fetchRoute, read } = setup();
    await read();
    state.durationSeconds = 1200;
    expect(await resolveEtaMinutes({ driverPosition: state.position, pickupPosition: [14.6, 121], storedDurationMinutes: 99 })).toBe(20);
    expect(fetchRoute).toHaveBeenCalledTimes(2);
  });

  it("bounds the in-memory route entries", async () => {
    const { state, fetchRoute, read } = setup();
    const firstId = state.trip.trip_id;
    for (let i = 0; i < 257; i += 1) {
      state.trip.trip_id = firstId + i;
      await read();
    }
    nextTripId = firstId + 257;
    state.trip.trip_id = firstId;
    state.durationSeconds = 1200;
    expect((await read()).eta_to_pickup_min).toBe(20);
    expect(fetchRoute).toHaveBeenCalledTimes(258);
  });
});
