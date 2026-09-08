// Tests for GET /api/trips/[id]/live-monitor — the selected-trip detail
// endpoint (the expensive-precision counterpart to the fleet summary).
//
// Contracts pinned:
// - staff read any trip; a driver may read their OWN trip only — a foreign
//   trip 404s as nonexistent (assertTripOwnership contract, never a 403 that
//   confirms the id is real);
// - a trip outside the live lifecycle returns { live: false } with its
//   status, never a fabricated evaluation;
// - a missing trip is a 404.
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

const NOW = new Date("2026-09-08T10:00:00+08:00");
const TRIP_ID = 101;

function monitorTripRow(overrides = {}) {
  return {
    trip_id: TRIP_ID,
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
    ...overrides,
  };
}

/** { ownershipRow, monitorRows } — null means "return no rows". */
function mockDb({ ownershipRow = null, monitorRows = null } = {}) {
  return vi.spyOn(db, "query").mockImplementation(async (sql) => {
    const s = String(sql);
    if (s.includes("SELECT trip_id, driver_id, vehicle_id, trip_status, dispatch_id")) {
      return { rows: ownershipRow ? [ownershipRow] : [] };
    }
    if (s.includes("FROM trips t")) {
      return { rows: monitorRows || [] };
    }
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

function ownTripDb(tripRow = monitorTripRow()) {
  return mockDb({
    ownershipRow: {
      trip_id: TRIP_ID,
      driver_id: tripRow.driver_id,
      vehicle_id: tripRow.vehicle_id,
      trip_status: tripRow.trip_status,
      dispatch_id: tripRow.dispatch_id,
    },
    monitorRows: [tripRow],
  });
}

function session(role, { driverId = null } = {}) {
  vi.spyOn(utils, "requirePermission").mockResolvedValue({
    user: { role, employeeId: 3, driverId },
  });
}

function request() {
  return { params: Promise.resolve({ id: String(TRIP_ID) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearMonitorSnapshots();
  clearRouteCache();
  clearTripGeofenceCache();
});

describe("GET /api/trips/[id]/live-monitor", () => {
  it("a dispatcher gets the full evaluation for any trip", async () => {
    ownTripDb();
    session("dispatcher");
    const res = await GET(request(), request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ tripId: TRIP_ID, live: true });
    expect(body.phase).toBe("to_pickup");
    expect(body.provenance).toBeDefined();
    expect(body.reasons).toEqual(expect.any(Array));
  });

  it("a driver gets their OWN trip", async () => {
    ownTripDb();
    session("driver", { driverId: 40 });
    const res = await GET(request(), request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.live).toBe(true);
  });

  it("a driver probing a foreign trip gets a 404, not a 403", async () => {
    ownTripDb();
    session("driver", { driverId: 77 });
    const res = await GET(request(), request());
    expect(res.status).toBe(404);
  });

  it("management (read-only role) may read the detail", async () => {
    ownTripDb();
    session("management");
    const res = await GET(request(), request());
    expect(res.status).toBe(200);
  });

  it("a completed trip returns live:false with its status, never a fabricated evaluation", async () => {
    ownTripDb(monitorTripRow({ trip_status: TRIP_STATUS.COMPLETED }));
    session("dispatcher");
    const res = await GET(request(), request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ tripId: TRIP_ID, live: false, tripStatus: TRIP_STATUS.COMPLETED });
  });

  it("a missing trip is a 404", async () => {
    mockDb({ ownershipRow: null, monitorRows: [] });
    session("dispatcher");
    const res = await GET(request(), request());
    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated callers", async () => {
    vi.spyOn(utils, "requirePermission")
      .mockRejectedValue(new AuthError("Unauthorized", 401));
    const res = await GET(request(), request());
    expect(res.status).toBe(401);
  });
});
