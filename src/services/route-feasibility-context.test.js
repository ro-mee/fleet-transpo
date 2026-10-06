import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/tomtom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchTomTomRoute: vi.fn(async () => null) };
});

import { fetchTomTomRoute } from "@/lib/tomtom";
import { clearRouteCache } from "@/lib/routing/route-cache";
import { clearDynamicLocationCache } from "@/lib/geo/dynamic-locations";
import {
  buildPairFeasibility,
  attachPairFeasibility,
  provenanceOfEstimate,
  resolvePassengerMinutes,
} from "@/services/route-feasibility-context.service";

beforeEach(() => {
  clearRouteCache();
  clearDynamicLocationCache();
  fetchTomTomRoute.mockReset();
  fetchTomTomRoute.mockResolvedValue(null);
});

// Offline stubs: no TomTom key in test env, so every live resolve fails open
// to the haversine fallback and every DB lookup returns no rows.
const db = { query: async () => ({ rows: [] }) };

const REQUEST = {
  pickup_location: "CoCo Star Hotel",
  dropoff_location: "Makati",
  pickup_datetime: "2026-09-07T09:00:00+08:00",
  passenger_count: 4,
};
const NOW = new Date("2026-09-07T08:15:00+08:00");
const ESTIMATE = { distanceKm: 6.5, durationMin: 42, basis: "Stored TomTom estimate", source: "TomTom" };

const DRIVER = {
  driver_id: 7,
  _position_lat: 14.53,
  _position_lng: 121.02,
  _pickup_distance_km: 3.1,
  _deadhead_minutes_routed: 19,
  _deadhead_provenance: "live",
};

describe("provenanceOfEstimate", () => {
  it("labels snapshots, live calls, and fallbacks honestly", () => {
    expect(provenanceOfEstimate(ESTIMATE)).toBe("snapshot");
    expect(provenanceOfEstimate({ durationMin: 30, basis: "TomTom", source: "TomTom" })).toBe("live");
    expect(provenanceOfEstimate({ durationMin: 30, basis: "metro average", source: "Legacy / Unknown" })).toBe("fallback");
    expect(provenanceOfEstimate(null)).toBe("unknown");
  });
});

describe("buildPairFeasibility", () => {
  it("returns the SAFE acceptance shape for one pair", async () => {
    const out = await buildPairFeasibility(db, {
      request: REQUEST,
      passengerMinutes: 42,
      passengerProvenance: "snapshot",
      driverRow: DRIVER,
      pickupCoords: { lat: 14.5159, lng: 120.9953 },
      destinationCoords: { lat: 14.5547, lng: 121.0244 },
      vehicleId: 1,
      driverId: 7,
      now: NOW,
    });
    expect(out.verdict).toBe("SAFE");
    expect(out.deadheadMin).toBe(19); // shortlist routed minutes preferred
    expect(out.passengerMin).toBe(42);
    expect(out.pickupBufferMin).toBe(16);
    expect(out.nextPickupAt).toBeNull(); // no assigned dispatch in stub DB
    expect(out.provenance).toMatchObject({ deadhead: "live", passenger: "snapshot" });
    expect(typeof out.requiredDeparture).toBe("string");
    expect(out.reasons.length).toBeGreaterThan(0);
  });

  it("fails open to UNKNOWN when the driver position is unknown", async () => {
    const out = await buildPairFeasibility(db, {
      request: REQUEST,
      passengerMinutes: 42,
      passengerProvenance: "snapshot",
      driverRow: { driver_id: 9 },
      pickupCoords: null,
      destinationCoords: null,
      vehicleId: 2,
      driverId: 9,
      now: NOW,
    });
    expect(out.verdict).toBe("UNKNOWN");
  });
});

describe("attachPairFeasibility", () => {
  const rec = () => ({
    pair: {
      recommended: { vehicle_id: 1, driver_id: 7, score: 92 },
      alternate: { vehicle_id: 2, driver_id: 8, score: 81 },
      candidates: [
        { vehicle_id: 1, driver_id: 7, score: 92 },
        { vehicle_id: 2, driver_id: 8, score: 81 },
        { vehicle_id: 3, driver_id: 9, score: 70 },
      ],
    },
  });

  it("attaches feasibility to recommended + alternate + top candidates", async () => {
    const recommendation = rec();
    await attachPairFeasibility(db, {
      request: REQUEST,
      estimate: ESTIMATE,
      recommendation,
      drivers: [DRIVER],
      now: NOW,
    });
    expect(recommendation.pair.recommended.feasibility.verdict).toBe("SAFE");
    expect(recommendation.pair.alternate.feasibility.verdict).toBe("UNKNOWN"); // no driver row
    expect(recommendation.pair.candidates[0].feasibility.verdict).toBe("SAFE");
    expect(recommendation.pair.candidates[2].feasibility.verdict).toBe("UNKNOWN");
  });

  it("passes the payload through untouched when there is nothing to score", async () => {
    const recommendation = { pair: null };
    await attachPairFeasibility(db, { request: REQUEST, estimate: ESTIMATE, recommendation, drivers: [], now: NOW });
    expect(recommendation.pair).toBeNull();
  });

  it("uses only matching active request-linked points for v2 current-pair feasibility", async () => {
    clearDynamicLocationCache();
    const calls = [];
    const strictDb = {
      async query(sql, params = []) {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes("SELECT name, latitude, longitude FROM locations")) {
          return { rows: [
            { name: REQUEST.pickup_location, latitude: 1, longitude: 2 },
            { name: REQUEST.dropoff_location, latitude: 3, longitude: 4 },
          ] };
        }
        if (String(sql).includes("FROM locations") && String(sql).includes("location_id")) {
          return { rows: [
            { location_id: 41, is_active: true, retired_at: null, latitude: 14.6, longitude: 121.02 },
            { location_id: 42, is_active: true, retired_at: null, latitude: 14.7, longitude: 121.03 },
          ] };
        }
        return { rows: [] };
      },
    };
    const recommendation = { pair: { recommended: { vehicle_id: 1, driver_id: 7 }, alternate: null, candidates: [] } };

    await attachPairFeasibility(strictDb, {
      request: { ...REQUEST, external_create_fingerprint: "v2", pickup_location_id: 41, dropoff_location_id: 42 },
      estimate: ESTIMATE,
      recommendation,
      drivers: [{ driver_id: 7, _position_lat: 14.53, _position_lng: 121.02 }],
      now: NOW,
    });

    expect(calls.some(({ sql }) => sql.includes("SELECT name, latitude, longitude FROM locations"))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes("location_id = ANY($1::integer[])"))).toBe(true);
    expect(fetchTomTomRoute.mock.calls[0][0]).toEqual([14.53, 121.02]);
    expect(fetchTomTomRoute.mock.calls[0][1]).toEqual([14.6, 121.02]);
  });

  it.each([
    ["missing", null, []],
    ["mismatched", 41, [{ location_id: 99, is_active: true, retired_at: null, latitude: 14.6, longitude: 121.02 }]],
    ["retired", 41, [{ location_id: 41, is_active: false, retired_at: "2026-09-01T00:00:00Z", latitude: 14.6, longitude: 121.02 }]],
    ["invalid coordinates", 41, [{ location_id: 41, is_active: true, retired_at: null, latitude: 91, longitude: 121.02 }]],
  ])("keeps a v2 %s pickup unknown instead of resolving its text", async (_label, pickupLocationId, registryRows) => {
    clearDynamicLocationCache();
    const calls = [];
    const strictDb = {
      async query(sql, params = []) {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes("SELECT name, latitude, longitude FROM locations")) {
          return { rows: [{ name: REQUEST.pickup_location, latitude: 1, longitude: 2 }] };
        }
        if (String(sql).includes("FROM locations") && String(sql).includes("location_id")) {
          return { rows: registryRows };
        }
        return { rows: [] };
      },
    };
    const recommendation = { pair: { recommended: { vehicle_id: 1, driver_id: 7 }, alternate: null, candidates: [] } };

    await attachPairFeasibility(strictDb, {
      request: { ...REQUEST, external_create_fingerprint: "v2", pickup_location_id: pickupLocationId, dropoff_location_id: null },
      estimate: ESTIMATE,
      recommendation,
      drivers: [{ driver_id: 7, _position_lat: 14.53, _position_lng: 121.02 }],
      now: NOW,
    });

    expect(recommendation.pair.recommended.feasibility.verdict).toBe("UNKNOWN");
    expect(calls.some(({ sql }) => sql.includes("SELECT name, latitude, longitude FROM locations"))).toBe(false);
    expect(fetchTomTomRoute).not.toHaveBeenCalled();
  });

  it("retains strict request endpoint provenance on attached feasibility", async () => {
    const recommendation = {
      pair: { recommended: { vehicle_id: 1, driver_id: 7 }, alternate: null, candidates: [] },
    };
    const endpointProvenance = { pickup: "pending_review", dropoff: "unknown" };

    await attachPairFeasibility(db, {
      request: REQUEST,
      estimate: { durationMin: null, endpointProvenance },
      recommendation,
      drivers: [DRIVER],
      now: NOW,
    });

    expect(recommendation.pair.recommended.feasibility.endpointProvenance).toEqual(endpointProvenance);
  });
});

const NEXT_PICKUP_AT = "2026-09-07T11:00:00+08:00";

function nextDispatchDb(nextDispatch) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("FROM dispatchschedules ds")) {
        return { rows: nextDispatch ? [nextDispatch] : [] };
      }
      return { rows: [] };
    },
  };
}

function v2NextDispatch(overrides = {}) {
  return {
    dispatch_id: 77,
    vehicle_id: 1,
    driver_id: 7,
    scheduled_departure: NEXT_PICKUP_AT,
    scheduled_arrival: "2026-09-07T12:00:00+08:00",
    pickup_location: "Makati",
    dropoff_location: "Pasay",
    external_create_fingerprint: "persisted-v2",
    pickup_location_id: 41,
    dropoff_location_id: 42,
    partner_pickup_location_proposal: { address: "Partner pickup", latitude: 14.6, longitude: 121.0 },
    partner_dropoff_location_proposal: null,
    _pickup_proposal_present: true,
    _dropoff_proposal_present: false,
    _pickup_registry_location_id: 41,
    _pickup_registry_is_active: true,
    _pickup_registry_retired_at: null,
    _pickup_registry_latitude: "14.7000",
    _pickup_registry_longitude: "121.0300",
    _dropoff_registry_location_id: 42,
    _dropoff_registry_is_active: true,
    _dropoff_registry_retired_at: null,
    _dropoff_registry_latitude: "14.7200",
    _dropoff_registry_longitude: "121.0400",
    // A stale route can disagree with the request link; its endpoint is not authority here.
    _route_origin_location_id: 99,
    _route_origin_latitude: "14.5000",
    _route_origin_longitude: "121.0000",
    ...overrides,
  };
}

async function buildForNextDispatch(nextDispatch) {
  const nextDb = nextDispatchDb(nextDispatch);
  const feasibility = await buildPairFeasibility(nextDb, {
    request: REQUEST,
    passengerMinutes: 42,
    passengerProvenance: "snapshot",
    driverRow: DRIVER,
    pickupCoords: { lat: 14.5159, lng: 120.9953 },
    destinationCoords: { lat: 14.5, lng: 121 },
    vehicleId: 1,
    driverId: 7,
    now: NOW,
  });
  return { feasibility, db: nextDb };
}

describe("strict next-dispatch reposition coordinates", () => {
  it("does not use partner text or proposal coordinates when a v2 pickup link is missing", async () => {
    const next = v2NextDispatch({ pickup_location_id: null, _pickup_registry_location_id: null });
    const { feasibility, db: nextDb } = await buildForNextDispatch(next);

    expect(feasibility.repositionMin).toBeNull();
    expect(feasibility.provenance.reposition).toBe("unknown");
    expect(feasibility.nextDispatchEndpointProvenance).toEqual({
      pickup: "pending_review",
      dropoff: "canonical_registry",
    });
    expect(fetchTomTomRoute).not.toHaveBeenCalled();
    expect(nextDb.calls.some((call) => call.sql.includes("SELECT name, latitude, longitude FROM locations"))).toBe(false);

    const dispatchSelect = nextDb.calls.find((call) => call.sql.includes("FROM dispatchschedules ds"));
    expect(dispatchSelect.sql).toContain("tr.external_create_fingerprint");
    expect(dispatchSelect.sql).toContain("tr.pickup_location_id");
    expect(dispatchSelect.sql).toContain("tr.dropoff_location_id");
    expect(dispatchSelect.sql).toContain("partner_pickup_location_proposal IS NOT NULL AS _pickup_proposal_present");
    expect(dispatchSelect.sql).toContain("partner_dropoff_location_proposal IS NOT NULL AS _dropoff_proposal_present");
    expect(dispatchSelect.sql).toContain("pickup_registry.location_id = tr.pickup_location_id");
    expect(dispatchSelect.sql).toContain("dropoff_registry.location_id = tr.dropoff_location_id");
  });

  it("uses the explicit active request link instead of a mismatched route endpoint", async () => {
    fetchTomTomRoute.mockResolvedValue({ durationMin: 17, distanceKm: 4.2, trafficDelayMin: 0 });
    const { feasibility } = await buildForNextDispatch(v2NextDispatch());

    expect(feasibility.repositionMin).toBe(17);
    expect(fetchTomTomRoute).toHaveBeenCalledWith(
      [14.5, 121],
      [14.7, 121.03],
      expect.objectContaining({ maxAlternatives: 0 })
    );
    expect(feasibility.nextDispatchEndpointProvenance).toEqual({
      pickup: "canonical_registry",
      dropoff: "canonical_registry",
    });
  });

  it.each([
    ["a retired linked location", { _pickup_registry_is_active: false, _pickup_registry_retired_at: "2026-09-01T00:00:00Z" }],
    ["invalid linked coordinates", { _pickup_registry_latitude: "NaN" }],
    ["out-of-range linked coordinates", { _pickup_registry_latitude: "91" }],
    ["a registry row that does not match the request ID", { _pickup_registry_location_id: 99 }],
  ])("keeps reposition unknown for %s rather than using text", async (_description, registryFields) => {
    const { feasibility } = await buildForNextDispatch(v2NextDispatch(registryFields));

    expect(feasibility.repositionMin).toBeNull();
    expect(feasibility.provenance.reposition).toBe("unknown");
    expect(feasibility.nextDispatchEndpointProvenance.pickup).toBe("pending_review");
    expect(fetchTomTomRoute).not.toHaveBeenCalled();
  });

  it("keeps the legacy v1 gazetteer fallback for a next pickup", async () => {
    const legacy = v2NextDispatch({ external_create_fingerprint: null, pickup_location: "Makati" });
    const { feasibility } = await buildForNextDispatch(legacy);

    expect(feasibility.repositionMin).toBeGreaterThan(0);
    expect(feasibility.provenance.reposition).toBe("fallback");
  });
});

describe("resolvePassengerMinutes", () => {
  it("preserves per-endpoint provenance returned by strict v2 estimation", async () => {
    const result = await resolvePassengerMinutes({
      ...REQUEST,
      external_create_fingerprint: "persisted-v2",
      pickup_location_id: null,
      dropoff_location_id: null,
      partner_pickup_location_proposal: { address: "Pending pickup" },
      partner_dropoff_location_proposal: null,
    }, db);

    expect(result.endpointProvenance).toEqual({ pickup: "pending_review", dropoff: "unknown" });
  });
});
