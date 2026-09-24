import { describe, it, expect } from "vitest";
import { resolveRouteEndpoints, resolveRouteForRequest, linkRequestLocations } from "@/services/route-resolver.service";

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

const HOTEL = { location_id: 7, name: "CoCo Star Hotel", address: "1 Roxas Blvd", latitude: 14.5, longitude: 121 };
const HOTEL_RENAMED = { location_id: 7, name: "CoCo Star Hotel Manila", address: "1 Roxas Blvd", latitude: 14.5, longitude: 121 };
const HOTEL_NEW_ROW = { location_id: 11, name: "CoCo Star Hotel", address: "9 Bay Blvd", latitude: 14.6, longitude: 121 };
const NAIA = { location_id: 9, name: "NAIA Terminal 3", address: "Andrews Ave", latitude: 14.52, longitude: 121.01 };
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
