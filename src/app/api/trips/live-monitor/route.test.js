// Tests for GET /api/trips/live-monitor — the fleet triage endpoint.
//
// Contracts pinned:
// - operations roles (trips read_all) get the cheap summary; drivers 403;
// - the endpoint NEVER calls TomTom (review correction #4: fleet overview =
//   cheap triage from cached signals + durable alerts only);
// - the payload carries per-risk counts for the Live Operations top line;
// - the defensive stale-alert sweep runs server-side.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import { AuthError } from "@/lib/api/utils";
import { TRIP_STATUS } from "@/lib/constants";
import { clearRouteCache } from "@/lib/routing/route-cache";
import { clearTripGeofenceCache } from "@/services/trip-geofence.service";
import { clearMonitorSnapshots } from "@/services/live-trip-monitor.service";

vi.mock("@/lib/tomtom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchTomTomRoute: vi.fn(async () => null) };
});
import { fetchTomTomRoute } from "@/lib/tomtom";

const NOW = new Date("2026-09-08T10:00:00+08:00");

const LIVE_TRIP = {
  trip_id: 101,
  trip_status: TRIP_STATUS.TRIP_STARTED,
  vehicle_id: 5,
  driver_id: 40,
  dispatch_id: 55,
  route_id: 1,
  origin: "CoCo Star Hotel",
  destination: "Makati",
  start_time: NOW.toISOString(),
  plate_number: "ABC 1234",
  vehicle_name: "Hiace",
  driver_first_name: "Ana",
  driver_last_name: "Reyes",
  dispatch_number: "DSP-001",
  scheduled_departure: NOW.toISOString(),
  scheduled_arrival: "2026-09-08T11:00:00+08:00",
  request_id: 900,
  pickup_datetime: "2026-09-08T10:30:00+08:00",
  pickup_location: "Makati",
  dropoff_location: "CoCo Star Hotel",
  gps_pings: [{
    tracking_id: 1,
    latitude: "14.505",
    longitude: "121.0",
    accuracy: 20,
    recorded_at: NOW.toISOString(),
  }],
};

function mockDb(rows = [LIVE_TRIP]) {
  return vi.spyOn(db, "query").mockImplementation(async (sql) => {
    const s = String(sql);
    if (s.includes("FROM trips t")) return { rows };
    if (s.includes("FROM routes r")) {
      return {
        rows: [{
          route_id: 1,
          o_id: 11, o_name: "CoCo Star Hotel", o_lat: "14.5", o_lng: "121.0", o_radius: null,
          d_id: 12, d_name: "Makati", d_lat: "14.52", d_lng: "121.0", d_radius: null,
        }],
      };
    }
    return { rows: [] };
  });
}

function mockRequest(role = "dispatcher") {
  vi.spyOn(utils, "requirePermission").mockResolvedValue({
    user: { role, employeeId: 3 },
  });
  return {};
}

beforeEach(() => {
  vi.clearAllMocks();
  clearMonitorSnapshots();
  clearRouteCache();
  clearTripGeofenceCache();
});

describe("GET /api/trips/live-monitor", () => {
  it("returns the cheap fleet summary with risk counts and no TomTom calls", async () => {
    const spy = mockDb();
    const res = await GET(mockRequest("dispatcher"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.trips[0].vehicle.plateNumber).toBe("ABC 1234");
    // No cached ETA snapshot exists → honestly UNKNOWN, never fabricated NORMAL.
    expect(body.trips[0].risk).toBe("UNKNOWN");
    expect(body.byRisk).toMatchObject({ UNKNOWN: 1, ACTION: 0 });
    expect(fetchTomTomRoute).not.toHaveBeenCalled();
    // Defensive sweep ran.
    expect(spy.mock.calls.some((c) => String(c[0]).includes("NOT EXISTS"))).toBe(true);
  });

  it("returns an empty fleet when nothing is live", async () => {
    mockDb([]);
    const res = await GET(mockRequest("fleet_manager"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.count).toBe(0);
    expect(body.trips).toEqual([]);
  });

  it("rejects drivers — this is an operations-wide read", async () => {
    vi.spyOn(utils, "requirePermission")
      .mockRejectedValue(new AuthError("Forbidden", 403));
    const res = await GET({});
    expect(res.status).toBe(403);
  });
});
