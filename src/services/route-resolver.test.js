import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveRequestEstimate,
  resolveRouteEndpoints,
  resolveRouteForRequest,
  linkRequestLocations,
} from "@/services/route-resolver.service";

const { fetchTomTomEstimate, getHotelContext, getActiveLocations } = vi.hoisted(() => ({
  fetchTomTomEstimate: vi.fn(),
  getHotelContext: vi.fn(),
  getActiveLocations: vi.fn(),
}));

vi.mock("@/lib/tomtom", () => ({ fetchTomTomEstimate }));
vi.mock("@/lib/geo/dynamic-locations", () => ({ getHotelContext, getActiveLocations }));

beforeEach(() => {
  fetchTomTomEstimate.mockReset().mockResolvedValue({
    distanceKm: 8.2,
    durationMin: 20,
    confidence: "high",
    basis: "TomTom route",
    source: "TomTom",
  });
  getHotelContext.mockReset().mockResolvedValue({ hotel_name: "Configured Hotel", latitude: 14.5, longitude: 121 });
  getActiveLocations.mockReset().mockResolvedValue([]);
});

// The module is otherwise only ever mocked (dispatch-radar, recommendation,
// the security assessment), so nothing here was pinned before. These tests fix
// the two things that are easy to break silently: which rows a name is allowed
// to match, and whether the ID seed degrades to the name or to nothing.

function stubDb(rows = [], { rowCount = 1 } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("UPDATE transportation_requests")) return { rows: [], rowCount };
      return { rows };
    },
  };
}

const HOTEL = { location_id: 7, name: "CoCo Star Hotel", address: "1 Roxas Blvd", latitude: 14.5, longitude: 121, is_active: true, retired_at: null };
const HOTEL_RENAMED = { location_id: 7, name: "CoCo Star Hotel Manila", address: "1 Roxas Blvd", latitude: 14.5, longitude: 121, is_active: true, retired_at: null };
const HOTEL_NEW_ROW = { location_id: 11, name: "CoCo Star Hotel", address: "9 Bay Blvd", latitude: 14.6, longitude: 121, is_active: true, retired_at: null };
const NAIA = { location_id: 9, name: "NAIA Terminal 3", address: "Andrews Ave", latitude: 14.52, longitude: 121.01, is_active: true, retired_at: null };
const ROUTE = { route_id: 30, origin_location_id: 7, destination_location_id: 9, status: "Active" };

/**
 * A db whose route lookup answers only for the canonical pair.
 *
 * `stubDb` returns the same rows to every query, which is fine for the endpoint
 * rules but useless here: a canned route row would be returned whether or not
 * the endpoints resolved, so the test could pass while resolution was broken.
 * This returns the route only when it is asked for origin 7 and destination 9,
 * which makes a returned route evidence that resolution happened.
 */
function requestDb({ locations = [], route = null } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM routes")) {
        const [origin, destination] = params;
        const hit = route && Number(origin) === route.origin_location_id && Number(destination) === route.destination_location_id;
        return { rows: hit ? [route] : [] };
      }
      return { rows: locations };
    },
  };
}

describe("resolveRouteEndpoints", () => {
  it("resolves by name alone when no link is supplied", async () => {
    const db = stubDb([HOTEL, NAIA]);
    const out = await resolveRouteEndpoints(db, { origin: "CoCo Star Hotel", destination: "NAIA Terminal 3" });
    expect(out).toMatchObject({ origin: "CoCo Star Hotel", destination: "NAIA Terminal 3", originLocationId: 7, destinationLocationId: 9 });
    // Parameter numbering: ids first, then names, in that order.
    expect(db.calls[0].params).toEqual(["coco star hotel", "naia terminal 3"]);
  });

  it("prefers the link over the stored text when the text has gone stale", async () => {
    const db = stubDb([HOTEL_RENAMED, NAIA]);
    const out = await resolveRouteEndpoints(db, {
      origin: "CoCo Star Hotel",            // what Booking wrote, before the rename
      destination: "NAIA Terminal 3",
      originLocationId: 7,
      destinationLocationId: 9,
      allowNameFallback: true,
    });
    expect(out).toMatchObject({ origin: "CoCo Star Hotel Manila", originLocationId: 7 });
    // The name was still QUERIED for the linked side — that is what makes the
    // fallback possible — but it did not decide the match.
    expect(db.calls[0].params).toEqual([7, 9, "coco star hotel", "naia terminal 3"]);
  });

  it("falls back to the name when the linked location has been retired", async () => {
    // A physical move retires the old row and creates a new one under the same
    // name, so id 7 is absent from the active-only result but the name matches.
    const db = stubDb([HOTEL_NEW_ROW, NAIA]);
    const out = await resolveRouteEndpoints(db, {
      origin: "CoCo Star Hotel",
      destination: "NAIA Terminal 3",
      originLocationId: 7,
      destinationLocationId: 9,
      allowNameFallback: true,
    });
    expect(out).toMatchObject({ originLocationId: 11, destinationLocationId: 9 });
  });

  it("stays null when a name matches more than one active location", async () => {
    const db = stubDb([HOTEL, HOTEL_NEW_ROW, NAIA]);
    const out = await resolveRouteEndpoints(db, { origin: "CoCo Star Hotel", destination: "NAIA Terminal 3" });
    expect(out).toBeNull();
  });

  it("refuses to fall back to a name for an id side when the option is off", async () => {
    const db = stubDb([HOTEL_NEW_ROW, NAIA]);
    const out = await resolveRouteEndpoints(db, {
      origin: "CoCo Star Hotel",
      destination: "NAIA Terminal 3",
      originLocationId: 7,
      destinationLocationId: 9,
    });
    expect(out).toBeNull();
    // Route creation naming a location must not silently accept a different
    // one, so a side that supplied an id is not matched by name at all — the
    // names are not even sent. This output is identical to the pre-option code.
    expect(db.calls[0].params).toEqual([7, 9]);
  });

  it("returns null without querying when given neither ids nor names", async () => {
    const db = stubDb([HOTEL]);
    expect(await resolveRouteEndpoints(db, {})).toBeNull();
    expect(await resolveRouteEndpoints(db, { origin: "   ", destination: null })).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it("refuses a pair that resolves to the same location", async () => {
    const db = stubDb([HOTEL]);
    const out = await resolveRouteEndpoints(db, { origin: "CoCo Star Hotel", destination: "coco  star hotel" });
    expect(out).toBeNull();
  });
});

describe("resolveRouteForRequest — the link survives a rename", () => {
  // The proof the endpoint tests above cannot give. Those pass options in by
  // hand, so they pin the RULE without showing that a request ever reaches it.
  // These go through the entry point production uses, which does the seeding
  // (pickup_location_id ?? origin_location_id) and turns the name fallback on.
  //
  // The rename is what separates the two paths. Before it, id resolution and
  // name resolution return the same location, so a request that ignored its link
  // entirely and matched on text would pass every other assertion in this file.
  //
  // Why a returned route proves the ID was used, in three steps:
  //   requestDb hands back the route ONLY for the pair (7, 9);
  //   findActiveRoute is reached only if both endpoints resolved (both-or-null);
  //   after the rename no location name matches the stored text,
  // so the endpoints can only have come from the id columns.
  const request = {
    request_id: 42,
    // Booking's text, captured before the rename and never rewritten — which is
    // the entire reason the link has to exist.
    pickup_location: "CoCo Star Hotel",
    dropoff_location: "NAIA Terminal 3",
    pickup_location_id: 7,
    dropoff_location_id: 9,
  };

  it("resolves the same request before and after its location is renamed", async () => {
    const before = await resolveRouteForRequest(
      requestDb({ locations: [HOTEL, NAIA], route: ROUTE }), request, { createMissing: false });
    expect(before?.route_id).toBe(30);

    // The location now carries a name the stored text does not match. Only the
    // link can still connect these two.
    const after = await resolveRouteForRequest(
      requestDb({ locations: [HOTEL_RENAMED, NAIA], route: ROUTE }), request, { createMissing: false });
    expect(after?.route_id).toBe(30);
    expect(after).toEqual(before);
  });

  it("orphans an unlinked request with the very same text after the rename", async () => {
    // Same stored text, same locations, same route to be found — only the link
    // is gone. This is the state every request was in before the backfill.
    const db = requestDb({ locations: [HOTEL_RENAMED, NAIA], route: ROUTE });
    const unlinked = { ...request, pickup_location_id: null, dropoff_location_id: null };

    expect(await resolveRouteForRequest(db, unlinked, { createMissing: false })).toBeNull();
    // The pickup matched nothing, so the pair was null and the route table was
    // never consulted — findActiveRoute returns before querying.
    expect(db.calls.some((c) => c.sql.includes("FROM routes"))).toBe(false);
  });

  it("resolves the linked request while the text still matches (control)", async () => {
    // No rename here. Same linked request, same link, text still matching: this
    // passes whether or not the id path is exercised, which is exactly why it is
    // a control and not evidence. The renamed pair above is the one that proves
    // anything.
    const db = requestDb({ locations: [HOTEL, NAIA], route: ROUTE });
    expect((await resolveRouteForRequest(db, request, { createMissing: false }))?.route_id).toBe(30);
  });
});

describe("resolveRequestEstimate — strict v2 registry", () => {
  const unknownEstimate = (reason, endpointProvenance) => ({
    distanceKm: null,
    durationMin: null,
    confidence: "low",
    basis: "Canonical location unavailable",
    source: null,
    reason,
    endpointProvenance,
  });

  it("keeps text-only v2 requests unknown without loading dynamic or seed locations", async () => {
    const db = requestDb();
    const request = {
      external_create_fingerprint: "persisted-v2-fingerprint",
      pickup_location: "Hotel Lobby",
      dropoff_location: "NAIA Terminal 3",
      partner_pickup_location_proposal: { address: "Hotel side gate" },
      partner_dropoff_location_proposal: { latitude: 14.5, longitude: 121 },
    };

    const estimate = await resolveRequestEstimate(request, db, { persistRoute: true });

    expect(estimate).toEqual(unknownEstimate("location_ids_required", {
      pickup: "pending_review",
      dropoff: "pending_review",
    }));
    expect(fetchTomTomEstimate).not.toHaveBeenCalled();
    expect(getHotelContext).not.toHaveBeenCalled();
    expect(getActiveLocations).not.toHaveBeenCalled();
    expect(db.calls.some(({ sql }) => sql.includes("FROM routes"))).toBe(false);
    expect(db.calls.some(({ sql }) => sql.includes("INSERT INTO routes"))).toBe(false);
  });

  it("does not fill an unlinked v2 endpoint from its matching text", async () => {
    const db = requestDb({ locations: [HOTEL, NAIA] });
    const request = {
      external_create_fingerprint: "persisted-v2-fingerprint",
      pickup_location: "CoCo Star Hotel",
      dropoff_location: "NAIA Terminal 3",
      pickup_location_id: 7,
      partner_dropoff_location_proposal: { address: "Terminal curb" },
    };

    const estimate = await resolveRequestEstimate(request, db, { persistRoute: true });

    expect(estimate).toEqual(unknownEstimate("location_ids_required", {
      pickup: "canonical_registry",
      dropoff: "pending_review",
    }));
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).not.toContain("regexp_replace");
    expect(db.calls[0].params).toEqual([7]);
    expect(fetchTomTomEstimate).not.toHaveBeenCalled();
    expect(db.calls.some(({ sql }) => sql.includes("FROM routes"))).toBe(false);
    expect(db.calls.some(({ sql }) => sql.includes("INSERT INTO routes"))).toBe(false);
  });

  it("uses only linked active registry coordinates for v2 TomTom estimates", async () => {
    const db = requestDb({ locations: [HOTEL, NAIA] });
    const request = {
      external_create_fingerprint: "persisted-v2-fingerprint",
      pickup_location: "untrusted Hotel Lobby proposal",
      dropoff_location: "untrusted NAIA proposal",
      pickup_location_id: 7,
      dropoff_location_id: 9,
      partner_pickup_location_proposal: { address: "Bogus pickup", latitude: 0, longitude: 0 },
      partner_dropoff_location_proposal: { address: "Bogus dropoff", latitude: 0, longitude: 0 },
    };

    const estimate = await resolveRequestEstimate(request, db);

    expect(estimate).toEqual({
      distanceKm: 8.2,
      durationMin: 20,
      confidence: "high",
      basis: "TomTom route",
      source: "TomTom",
    });
    expect(fetchTomTomEstimate).toHaveBeenCalledWith([14.5, 121], [14.52, 121.01], {
      departAt: undefined,
    });
    expect(db.calls[0].params).toEqual([7, 9]);
    expect(db.calls[0].sql).not.toContain("regexp_replace");
    expect(getHotelContext).not.toHaveBeenCalled();
    expect(getActiveLocations).not.toHaveBeenCalled();
  });

  it("does not fall back by name when a linked v2 location is retired", async () => {
    const db = requestDb({ locations: [NAIA] });
    const request = {
      external_create_fingerprint: "persisted-v2-fingerprint",
      pickup_location: "CoCo Star Hotel",
      dropoff_location: "NAIA Terminal 3",
      pickup_location_id: 7,
      dropoff_location_id: 9,
      partner_pickup_location_proposal: { address: "Hotel side gate" },
    };

    const estimate = await resolveRequestEstimate(request, db, { persistRoute: true });

    expect(estimate).toEqual(unknownEstimate("canonical_locations_unavailable", {
      pickup: "pending_review",
      dropoff: "canonical_registry",
    }));
    expect(db.calls[0].params).toEqual([7, 9]);
    expect(db.calls[0].sql).not.toContain("regexp_replace");
    expect(fetchTomTomEstimate).not.toHaveBeenCalled();
    expect(getHotelContext).not.toHaveBeenCalled();
    expect(getActiveLocations).not.toHaveBeenCalled();
    expect(db.calls.some(({ sql }) => sql.includes("FROM routes"))).toBe(false);
    expect(db.calls.some(({ sql }) => sql.includes("INSERT INTO routes"))).toBe(false);
  });

  it("does not trust a stored route estimate when a linked registry point is missing", async () => {
    const db = requestDb({
      locations: [{ ...HOTEL, latitude: null, longitude: null }, NAIA],
      route: { ...ROUTE, estimated_distance: 6.4, estimated_duration: 18, estimate_source: "Manual" },
    });
    const request = {
      external_create_fingerprint: "persisted-v2-fingerprint",
      pickup_location: "CoCo Star Hotel",
      dropoff_location: "NAIA Terminal 3",
      pickup_location_id: 7,
      dropoff_location_id: 9,
      partner_pickup_location_proposal: { address: "Hotel side gate" },
    };

    const estimate = await resolveRequestEstimate(request, db, { persistRoute: true });

    expect(estimate).toEqual(unknownEstimate("canonical_coordinates_unavailable", {
      pickup: "pending_review",
      dropoff: "canonical_registry",
    }));
    expect(db.calls.some(({ sql }) => sql.includes("FROM routes"))).toBe(false);
    expect(db.calls.some(({ sql }) => sql.includes("INSERT INTO routes"))).toBe(false);
    expect(fetchTomTomEstimate).not.toHaveBeenCalled();
    expect(getHotelContext).not.toHaveBeenCalled();
    expect(getActiveLocations).not.toHaveBeenCalled();
  });

  it.each([
    ["partial", { latitude: 14.5, longitude: null }],
    ["non-finite", { latitude: Number.NaN, longitude: 121 }],
    ["out-of-range", { latitude: 90.1, longitude: 121 }],
    ["blank", { latitude: "", longitude: 121 }],
  ])("rejects %s linked coordinates before using a stored route", async (_kind, coordinates) => {
    const db = requestDb({
      locations: [{ ...HOTEL, ...coordinates }, NAIA],
      route: { ...ROUTE, estimated_distance: 6.4, estimated_duration: 18, estimate_source: "Manual" },
    });
    const request = {
      external_create_fingerprint: "persisted-v2-fingerprint",
      pickup_location_id: 7,
      dropoff_location_id: 9,
    };

    const estimate = await resolveRequestEstimate(request, db, { persistRoute: true });

    expect(estimate.source).toBeNull();
    expect(estimate.distanceKm).toBeNull();
    expect(estimate.durationMin).toBeNull();
    expect(estimate.reason).toBe("canonical_coordinates_unavailable");
    expect(db.calls.some(({ sql }) => sql.includes("FROM routes"))).toBe(false);
    expect(db.calls.some(({ sql }) => sql.includes("INSERT INTO routes"))).toBe(false);
    expect(fetchTomTomEstimate).not.toHaveBeenCalled();
  });

  it("treats an incomplete TomTom result as unknown and does not persist a route", async () => {
    fetchTomTomEstimate.mockResolvedValueOnce({
      distanceKm: 0,
      durationMin: null,
      confidence: "low",
      basis: "TomTom",
      source: "TomTom",
    });
    const db = requestDb({ locations: [HOTEL, NAIA] });
    const request = {
      external_create_fingerprint: "persisted-v2-fingerprint",
      pickup_location_id: 7,
      dropoff_location_id: 9,
    };

    const estimate = await resolveRequestEstimate(request, db, { persistRoute: true });

    expect(estimate).toEqual(unknownEstimate("route_estimate_unavailable", {
      pickup: "canonical_registry",
      dropoff: "canonical_registry",
    }));
    expect(db.calls.some(({ sql }) => sql.includes("INSERT INTO routes"))).toBe(false);
  });

  it("honors explicit strict registry mode before a fingerprint is persisted", async () => {
    const db = requestDb();
    const estimate = await resolveRequestEstimate({
      pickup_location: "Hotel Lobby",
      dropoff_location: "NAIA Terminal 3",
    }, db, { strictRegistry: true });

    expect(estimate).toEqual(unknownEstimate("location_ids_required", {
      pickup: "unknown",
      dropoff: "unknown",
    }));
    expect(fetchTomTomEstimate).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });

  it("keeps the legacy v1 text estimator fallback", async () => {
    const estimate = await resolveRequestEstimate({
      pickup_location: "Hotel Lobby",
      dropoff_location: "NAIA Terminal 3",
    }, null);

    expect(estimate).toMatchObject({
      source: "Legacy / Unknown",
      basis: expect.any(String),
    });
    expect(estimate.distanceKm).toBeGreaterThan(0);
    expect(estimate.durationMin).toBeGreaterThan(0);
    expect(estimate).not.toHaveProperty("endpointProvenance");
  });
});

describe("linkRequestLocations", () => {
  it("links both sides of a round trip to the same location", async () => {
    const db = stubDb([HOTEL]);
    const out = await linkRequestLocations(db, { requestId: 42, pickup: "CoCo Star Hotel", dropoff: "coco  star hotel" });
    expect(out).toEqual({ pickupLocationId: 7, dropoffLocationId: 7, updated: true });
    expect(db.calls[1].params).toEqual([7, 7, 42]);
  });

  it("links the pickup alone when the request has no drop-off", async () => {
    const db = stubDb([HOTEL]);
    const out = await linkRequestLocations(db, { requestId: 42, pickup: "CoCo Star Hotel", dropoff: null });
    expect(out).toEqual({ pickupLocationId: 7, dropoffLocationId: null, updated: true });
    expect(db.calls[1].params).toEqual([7, null, 42]);
    // The unresolved side must not be searched for: one placeholder, one value.
    expect(db.calls[0].params).toEqual(["coco star hotel"]);
  });

  it("only ever looks at active locations", async () => {
    const db = stubDb([]);
    expect(await linkRequestLocations(db, { requestId: 42, pickup: "CoCo Star Hotel", dropoff: null })).toBeNull();
    expect(db.calls[0].sql).toContain("is_active = true");
    // Nothing resolved, so nothing was written.
    expect(db.calls).toHaveLength(1);
  });

  it("writes nothing when the row already holds the right ids", async () => {
    const db = stubDb([HOTEL], { rowCount: 0 });
    const out = await linkRequestLocations(db, { requestId: 42, pickup: "CoCo Star Hotel", dropoff: null });
    expect(out).toEqual({ pickupLocationId: 7, dropoffLocationId: null, updated: false });
  });

  it("does not guess between two locations sharing a name", async () => {
    const db = stubDb([HOTEL, HOTEL_NEW_ROW]);
    expect(await linkRequestLocations(db, { requestId: 42, pickup: "CoCo Star Hotel", dropoff: null })).toBeNull();
    expect(db.calls).toHaveLength(1);
  });

  it("returns null without querying when there is nothing to link", async () => {
    const db = stubDb([HOTEL]);
    expect(await linkRequestLocations(db, { requestId: 42, pickup: null, dropoff: "  " })).toBeNull();
    expect(await linkRequestLocations(db, { requestId: null, pickup: "CoCo Star Hotel" })).toBeNull();
    expect(db.calls).toHaveLength(0);
  });
});
