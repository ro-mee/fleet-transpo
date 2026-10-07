import { describe, it, expect } from "vitest";
import { clearDynamicLocationCache } from "@/lib/geo/dynamic-locations";
import { getTripGeofenceTargets, evaluatePingGeofence, checkDestinationProximity, checkPickupProximity, clearTripGeofenceCache } from "@/services/trip-geofence.service";

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
    // Dynamic: no hotel row in this mock db, so the generic on-site fallback
    // labels the base without a brand literal.
    expect(out.pickup).toMatchObject({ source: "gazetteer", label: "Hotel Base" });
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

describe("v2 trip geofence targets", () => {
  it("keeps partner proposals and matching text out of targets and leaves the ping unknown", async () => {
    clearTripGeofenceCache();
    clearDynamicLocationCache();
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes("FROM trips t")) {
          return { rows: [{
            trip_id: 55,
            dispatch_id: 9,
            route_id: null,
            origin: "CoCo Star Hotel",
            destination: "NAIA Terminal 3 - Arrivals (Bay 9)",
            external_create_fingerprint: "v2-fingerprint",
            pickup_location_id: null,
            dropoff_location_id: null,
            _pickup_registry_location_id: null,
            _pickup_registry_is_active: null,
            _pickup_registry_retired_at: null,
            _pickup_registry_name: null,
            _pickup_registry_latitude: null,
            _pickup_registry_longitude: null,
            _pickup_registry_radius: null,
            _pickup_proposal_present: true,
            _dropoff_registry_location_id: null,
            _dropoff_registry_is_active: null,
            _dropoff_registry_retired_at: null,
            _dropoff_registry_name: null,
            _dropoff_registry_latitude: null,
            _dropoff_registry_longitude: null,
            _dropoff_registry_radius: null,
            _dropoff_proposal_present: false,
          }] };
        }
        return { rows: [] };
      },
    };

    const targets = await getTripGeofenceTargets(db, { trip_id: 55, dispatch_id: 9 });
    expect(targets.pickup).toBeNull();
    expect(targets.destination).toBeNull();
    expect(targets.pickup_location_provenance).toBe("pending_review");
    expect(targets.dropoff_location_provenance).toBe("unknown");

    clearTripGeofenceCache();
    const ping = await evaluatePingGeofence(db, { trip_id: 55 }, {
      latitude: 14.5159034,
      longitude: 120.9953405,
      accuracy: 12,
    });
    expect(ping.geofence_state).toBe("unknown");
    expect(calls.some(({ sql }) => /\bUPDATE\s+(trips|dispatchschedules)\b/i.test(sql))).toBe(false);
  });

  it("uses only active request-linked points when stored route endpoints differ", async () => {
    clearTripGeofenceCache();
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes("FROM trips t")) {
          return { rows: [{
            trip_id: 56,
            dispatch_id: 9,
            route_id: 12,
            origin: "Partner pickup label",
            destination: "Partner drop-off label",
            external_create_fingerprint: "v2-fingerprint",
            pickup_location_id: 101,
            dropoff_location_id: 102,
            route_origin_location_id: 901,
            route_destination_location_id: 902,
            _pickup_registry_location_id: 101,
            _pickup_registry_is_active: true,
            _pickup_registry_retired_at: null,
            _pickup_registry_name: "Fleet pickup",
            _pickup_registry_latitude: "14.6000",
            _pickup_registry_longitude: "121.0200",
            _pickup_registry_radius: 65,
            _pickup_proposal_present: false,
            _dropoff_registry_location_id: 102,
            _dropoff_registry_is_active: true,
            _dropoff_registry_retired_at: null,
            _dropoff_registry_name: "Fleet drop-off",
            _dropoff_registry_latitude: "14.7000",
            _dropoff_registry_longitude: "121.0300",
            _dropoff_registry_radius: 175,
            _dropoff_proposal_present: false,
          }] };
        }
        if (sql.includes("FROM routes r")) {
          return { rows: [{
            route_id: 12,
            o_id: 901, o_name: "Mismatched route pickup", o_lat: "1.0000", o_lng: "2.0000", o_radius: 100,
            d_id: 902, d_name: "Mismatched route drop-off", d_lat: "3.0000", d_lng: "4.0000", d_radius: 100,
          }] };
        }
        return { rows: [] };
      },
    };

    const targets = await getTripGeofenceTargets(db, { trip_id: 56, dispatch_id: 9 });

    expect(targets.pickup).toMatchObject({
      lat: 14.6, lng: 121.02, radiusM: 65, label: "Fleet pickup", source: "canonical_registry",
    });
    expect(targets.destination).toMatchObject({
      lat: 14.7, lng: 121.03, radiusM: 175, label: "Fleet drop-off", source: "canonical_registry",
    });
    expect(targets.pickup_location_provenance).toBe("canonical_registry");
    expect(targets.dropoff_location_provenance).toBe("canonical_registry");
    expect(calls.some(({ sql }) => sql.includes("FROM routes r"))).toBe(false);
  });

  it("accepts the equator-prime-meridian point for a v2 linked active location", async () => {
    const targets = await getTripGeofenceTargets(stubDb([]), {
      trip_id: 58,
      dispatch_id: 9,
      route_id: null,
      origin: "Partner pickup label",
      destination: "Partner drop-off label",
      external_create_fingerprint: "v2-fingerprint",
      pickup_location_id: 41,
      dropoff_location_id: 42,
      _pickup_registry_location_id: 41,
      _pickup_registry_is_active: true,
      _pickup_registry_retired_at: null,
      _pickup_registry_name: "Equator Harbor",
      _pickup_registry_latitude: "0",
      _pickup_registry_longitude: "0",
      _pickup_registry_radius: 75,
      _dropoff_registry_location_id: 42,
      _dropoff_registry_is_active: true,
      _dropoff_registry_retired_at: null,
      _dropoff_registry_name: "Harbor Warehouse",
      _dropoff_registry_latitude: "14.7",
      _dropoff_registry_longitude: "121.03",
      _dropoff_registry_radius: 80,
    });

    expect(targets.pickup).toMatchObject({
      lat: 0, lng: 0, radiusM: 75, label: "Equator Harbor", source: "canonical_registry",
    });
    expect(targets.pickup_location_provenance).toBe("canonical_registry");
  });

  it("evaluates a v2 zero-coordinate target through ping and arrival gates", async () => {
    clearTripGeofenceCache();
    const zeroV2Trip = {
      trip_id: 58, dispatch_id: 9, route_id: null,
      origin: "Partner pickup", destination: "Partner drop-off",
      external_create_fingerprint: "v2-zero", pickup_location_id: 41, dropoff_location_id: null,
      _pickup_registry_location_id: 41, _pickup_registry_name: "Equator Harbor",
      _pickup_registry_is_active: true, _pickup_registry_retired_at: null,
      _pickup_registry_latitude: "0", _pickup_registry_longitude: "0", _pickup_registry_radius: 75,
      _dropoff_registry_location_id: null,
    };
    const pingResult = await evaluatePingGeofence(stubDb([]), zeroV2Trip, {
      latitude: 0.0005, longitude: 0, accuracy: 10,
    });
    expect(pingResult.near_pickup).toBe(true);

    const zeroPositionResult = await evaluatePingGeofence(stubDb([]), zeroV2Trip, {
      latitude: 0, longitude: 0, accuracy: 10,
    });
    expect(zeroPositionResult.near_pickup).toBe(false);
    expect(zeroPositionResult.pickup.state).toBe("unknown");

    clearTripGeofenceCache();
    const now = new Date("2026-09-07T10:00:00+08:00");
    const arrivalDb = stubDb([
      ["FROM gpstracking", [{ latitude: "0.0005", longitude: "0", accuracy: "10", recorded_at: now.toISOString() }]],
      ["FROM trips t", [zeroV2Trip]],
    ]);
    expect((await checkPickupProximity(arrivalDb, 58, now)).state).toBe("inside");
  });

  it("preserves the legacy (0,0) sentinel for route points", async () => {
    const db = stubDb([
      ["FROM dispatchschedules", [{ route_id: 23 }]],
      ["FROM routes r", [{
        route_id: 23,
        o_id: 1, o_name: "Legacy zero point", o_lat: "0", o_lng: "0", o_radius: 100,
        d_id: 2, d_name: "Unknown", d_lat: null, d_lng: null, d_radius: 100,
      }]],
    ]);

    const targets = await getTripGeofenceTargets(db, {
      trip_id: 59, dispatch_id: 9, route_id: null,
      origin: "Unknown legacy pickup", destination: "Unknown legacy drop-off",
    });

    expect(targets.pickup).toBeNull();
  });

  it("does not reuse a retired linked point or resolve its text", async () => {
    clearTripGeofenceCache();
    clearDynamicLocationCache();
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes("FROM trips t")) {
          return { rows: [{
            trip_id: 57,
            dispatch_id: 9,
            route_id: null,
            origin: "CoCo Star Hotel",
            destination: "NAIA Terminal 3 - Arrivals (Bay 9)",
            external_create_fingerprint: "v2-fingerprint",
            pickup_location_id: 41,
            dropoff_location_id: null,
            _pickup_registry_location_id: 41,
            _pickup_registry_is_active: false,
            _pickup_registry_retired_at: "2026-09-01T00:00:00Z",
            _pickup_registry_name: "Retired Fleet pickup",
            _pickup_registry_latitude: "14.6000",
            _pickup_registry_longitude: "121.0200",
            _pickup_registry_radius: 65,
            _pickup_proposal_present: true,
            _dropoff_registry_location_id: null,
            _dropoff_registry_is_active: null,
            _dropoff_registry_retired_at: null,
            _dropoff_registry_name: null,
            _dropoff_registry_latitude: null,
            _dropoff_registry_longitude: null,
            _dropoff_registry_radius: null,
            _dropoff_proposal_present: false,
          }] };
        }
        return { rows: [] };
      },
    };

    const targets = await getTripGeofenceTargets(db, { trip_id: 57, dispatch_id: 9 });

    expect(targets.pickup).toBeNull();
    expect(targets.destination).toBeNull();
    expect(targets.pickup_location_provenance).toBe("pending_review");
    expect(targets.dropoff_location_provenance).toBe("unknown");
    expect(calls.some(({ sql }) => sql.includes("FROM routes r"))).toBe(false);
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
