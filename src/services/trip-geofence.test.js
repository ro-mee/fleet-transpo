import { describe, it, expect } from "vitest";
import { getTripGeofenceTargets, checkDestinationProximity, checkPickupProximity, clearTripGeofenceCache } from "@/services/trip-geofence.service";

function stubDb(handlers) {
  return {
    query: async (sql, params) => {
      for (const [match, rows] of handlers) {
        if (sql.includes(match)) return { rows };
      }
      return { rows: [] };
    },
  };
}

describe("getTripGeofenceTargets", () => {
  it("resolves canonical targets with per-location radii", async () => {
    const db = stubDb([
      ["FROM dispatchschedules", [{ route_id: 12 }]],
      ["FROM routes r", [{
        route_id: 12,
        o_id: 1, o_name: "CoCo Star Hotel", o_lat: "14.5159034", o_lng: "120.9953405", o_radius: 60,
        d_id: 10, d_name: "NAIA Terminal 3 - Arrivals (Bay 9)", d_lat: "14.5204800", d_lng: "121.0144500", d_radius: 150,
      }]],
    ]);
    const out = await getTripGeofenceTargets(db, {
      trip_id: 5, origin: "CoCo Star Hotel", destination: "NAIA T3", dispatch_id: 9, route_id: null,
    });
    expect(out.pickup).toMatchObject({ radiusM: 60, label: "CoCo Star Hotel", source: "canonical" });
    expect(out.destination).toMatchObject({ radiusM: 150, source: "canonical" });
  });

  it("falls back to the gazetteer per end with default radii", async () => {
    const db = stubDb([]);
    const out = await getTripGeofenceTargets(db, {
      trip_id: 5, origin: "CoCo Star Hotel", destination: "Nowhere Fictional XYZ", dispatch_id: null, route_id: null,
    });
    expect(out.pickup).toMatchObject({ source: "gazetteer", radiusM: 100 });
    expect(out.destination).toBeNull();
  });

  it("stays null instead of guessing when nothing resolves", async () => {
    const db = stubDb([]);
    const out = await getTripGeofenceTargets(db, {
      trip_id: 5, origin: "Nowhere Fictional XYZ", destination: null, dispatch_id: null, route_id: null,
    });
    expect(out).toEqual({ pickup: null, destination: null });
    expect(await getTripGeofenceTargets(null, { trip_id: 1 })).toEqual({ pickup: null, destination: null });
  });

  it("derives endpoints through the request when the trip row has none", async () => {
    // Real callers (assertTripOwnership, the monitor's loadMonitorTrips rows)
    // pass plain trip rows: dispatch_id but no origin — trips has no such
    // column. The re-query must DERIVE the endpoint names from the booking
    // request (route as fallback), never select them from trips: that raised
    // "column does not exist" on the live database and this function's catch
    // silently turned it into "no targets" — no geofence verdicts, no monitor
    // target, no route line. Pinned after it bit twice.
    clearTripGeofenceCache();
    const seen = [];
    const db = {
      query: async (sql, params) => {
        seen.push(sql);
        if (sql.includes("FROM trips t")) {
          return {
            rows: [{
              trip_id: params[0], dispatch_id: 9, route_id: null,
              origin: "CoCo Star Hotel", destination: "NAIA Terminal 3 - Arrivals (Bay 9)",
            }],
          };
        }
        return { rows: [] };
      },
    };
    const out = await getTripGeofenceTargets(db, { trip_id: 55, dispatch_id: 9 });
    expect(out.pickup).toMatchObject({ source: "gazetteer", label: "CoCo Star Hotel" });
    expect(out.destination).toMatchObject({ source: "gazetteer", label: "NAIA Terminal 3 - Arrivals (Bay 9)" });
    const deriveQuery = seen.find((sql) => sql.includes("FROM trips t"));
    expect(deriveQuery).toContain("transportation_requests");
    expect(deriveQuery).toContain("COALESCE");
  });

  it("prefers the trip's own route_id over the dispatch's", async () => {
    const seen = [];
    const db = {
      query: async (sql, params) => {
        seen.push(params?.[0]);
        if (sql.includes("FROM routes r")) {
          return {
            rows: [{
              route_id: params[0],
              o_id: 1, o_name: "A", o_lat: "14.5", o_lng: "121.0", o_radius: 100,
              d_id: 2, d_name: "B", d_lat: "14.6", d_lng: "121.1", d_radius: 100,
            }],
          };
        }
        return { rows: [] };
      },
    };
    await getTripGeofenceTargets(db, { trip_id: 5, origin: "A", destination: "B", dispatch_id: 9, route_id: 77 });
    expect(seen).toContain(77);
    expect(seen).not.toContain(9);
  });
});

describe("checkDestinationProximity", () => {
  const NOW = new Date("2026-09-07T10:00:00+08:00");
  const routeRows = [{
    route_id: 12,
    o_id: 1, o_name: "CoCo Star Hotel", o_lat: "14.5159034", o_lng: "120.9953405", o_radius: 60,
    d_id: 10, d_name: "NAIA Terminal 3 - Arrivals (Bay 9)", d_lat: "14.5204800", d_lng: "121.0144500", d_radius: 150,
  }];

  function dbWithPing(ping) {
    return {
      query: async (sql, params) => {
        if (sql.includes("FROM gpstracking")) return { rows: ping ? [ping] : [] };
        if (sql.includes("FROM trips")) {
          return { rows: [{ trip_id: params[0], origin: "CoCo Star Hotel", destination: "NAIA T3", dispatch_id: 9, route_id: 12 }] };
        }
        if (sql.includes("FROM routes r")) return { rows: routeRows };
        return { rows: [] };
      },
    };
  }

  it("reports inside at the destination", async () => {
    clearTripGeofenceCache();
    const out = await checkDestinationProximity(
      dbWithPing({ latitude: "14.52048", longitude: "121.01445", accuracy: "12", recorded_at: "2026-09-07T09:59:00+08:00" }),
      5, NOW
    );
    expect(out.state).toBe("inside");
    expect(out.label).toBe("NAIA Terminal 3 - Arrivals (Bay 9)");
  });

  it("reports outside with distance 1.3 km away", async () => {
    clearTripGeofenceCache();
    const out = await checkDestinationProximity(
      dbWithPing({ latitude: "14.51590", longitude: 121.002, accuracy: "12", recorded_at: "2026-09-07T09:59:00+08:00" }),
      5, NOW
    );
    expect(out.state).toBe("outside");
    expect(out.distanceM).toBeGreaterThan(1000);
  });

  it("fails open on missing or stale fixes", async () => {
    clearTripGeofenceCache();
    expect((await checkDestinationProximity(dbWithPing(null), 5, NOW)).state).toBe("unknown");
    clearTripGeofenceCache();
    const stale = await checkDestinationProximity(
      dbWithPing({ latitude: "14.52", longitude: "121.01", accuracy: "12", recorded_at: "2026-09-07T08:00:00+08:00" }),
      5, NOW
    );
    expect(stale.state).toBe("unknown");
    expect(stale.reason).toMatch(/stale/i);
  });
});

describe("checkPickupProximity", () => {
  const NOW = new Date("2026-09-07T10:00:00+08:00");
  const routeRows = [{
    route_id: 12,
    o_id: 1, o_name: "CoCo Star Hotel", o_lat: "14.5159034", o_lng: "120.9953405", o_radius: 60,
    d_id: 10, d_name: "NAIA Terminal 3 - Arrivals (Bay 9)", d_lat: "14.5204800", d_lng: "121.0144500", d_radius: 150,
  }];

  function dbWithPing(ping) {
    return {
      query: async (sql, params) => {
        if (sql.includes("FROM gpstracking")) return { rows: ping ? [ping] : [] };
        if (sql.includes("FROM trips")) {
          return { rows: [{ trip_id: params[0], origin: "CoCo Star Hotel", destination: "NAIA T3", dispatch_id: 9, route_id: 12 }] };
        }
        if (sql.includes("FROM routes r")) return { rows: routeRows };
        return { rows: [] };
      },
    };
  }

  it("reports inside at the pickup point", async () => {
    clearTripGeofenceCache();
    const out = await checkPickupProximity(
      dbWithPing({ latitude: "14.5159034", longitude: "120.9953405", accuracy: "12", recorded_at: "2026-09-07T09:59:00+08:00" }),
      5, NOW
    );
    expect(out.state).toBe("inside");
    expect(out.label).toBe("CoCo Star Hotel");
  });

  it("reports outside far from the pickup point", async () => {
    clearTripGeofenceCache();
    const out = await checkPickupProximity(
      dbWithPing({ latitude: "14.52048", longitude: "121.01445", accuracy: "12", recorded_at: "2026-09-07T09:59:00+08:00" }),
      5, NOW
    );
    expect(out.state).toBe("outside");
    expect(out.distanceM).toBeGreaterThan(1000);
  });

  it("fails open on missing or stale fixes", async () => {
    clearTripGeofenceCache();
    expect((await checkPickupProximity(dbWithPing(null), 5, NOW)).state).toBe("unknown");
    clearTripGeofenceCache();
    const stale = await checkPickupProximity(
      dbWithPing({ latitude: "14.52", longitude: "121.01", accuracy: "12", recorded_at: "2026-09-07T08:00:00+08:00" }),
      5, NOW
    );
    expect(stale.state).toBe("unknown");
    expect(stale.reason).toMatch(/stale/i);
  });
});
