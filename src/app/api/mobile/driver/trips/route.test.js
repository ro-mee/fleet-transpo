// Tests for the endpoint-coordinate fallback in GET /api/mobile/driver/trips.
//
// Covers the "current trip has no route preview" report: trips created by
// ensureTripForDispatch from booking dispatches carry no route_id, so the
// canonical location joins return null and Home's current card fell to
// "Route preview unavailable" even mid-trip. The route now fills missing
// endpoint coordinates from the shared gazetteer on the endpoint text —
// the same canonical → gazetteer → none chain getTripGeofenceTargets uses.
import { describe, it, expect, vi, afterEach } from "vitest";
import { clearDynamicLocationCache } from "@/lib/geo/dynamic-locations";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as apiUtils from "@/lib/api/utils";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockReq(url = "http://x/api/mobile/driver/trips") {
  return { nextUrl: new URL(url) };
}

/** Script the db: each row goes out in the order its SQL matcher first hits. */
function mockQuery(tripsRow, { settingsRows = [], extra = [] } = {}) {
  return vi.spyOn(db, "query").mockImplementation(async (sql) => {
    if (sql.includes("FROM trips t")) return { rows: tripsRow };
    if (sql.includes("system_settings")) return { rows: settingsRows };
    for (const [match, rows] of extra) {
      if (sql.includes(match)) return { rows };
    }
    return { rows: [] };
  });
}

// Exact trip-row shape from the route's SELECT (coordinate + text fields only
// — the fallback touches nothing else).
function tripRow(overrides = {}) {
  return {
    trip_id: 470,
    trip_status: "En Route",
    origin: "CoCo Star Hotel",
    destination: "NAIA Terminal 3 - Arrivals (Bay 9)",
    origin_latitude: null,
    origin_longitude: null,
    destination_latitude: null,
    destination_longitude: null,
    dispatch_id: 592,
    ...overrides,
  };
}

describe("GET /api/mobile/driver/trips — endpoint coordinate fallback", () => {
  it("fills routeless-trip coordinates from the gazetteer on endpoint text", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });
    mockQuery([tripRow()]);

    const res = await GET(mockReq());
    const body = await res.json();

    const row = body[0];
    expect(row.origin_latitude).not.toBeNull();
    expect(row.origin_longitude).not.toBeNull();
    expect(Number(row.origin_latitude)).toBeCloseTo(14.5159034, 5);
    expect(Number(row.destination_latitude)).toBeCloseTo(14.52048, 5);
    expect(Number(row.destination_longitude)).toBeCloseTo(121.01445, 5);
  });

  it("never overwrites canonical route coordinates", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });
    const canonical = tripRow({
      origin_latitude: "14.1111000",
      origin_longitude: "121.1111000",
      destination_latitude: "14.2222000",
      destination_longitude: "121.2222000",
    });
    mockQuery([canonical]);

    const res = await GET(mockReq());
    const row = (await res.json())[0];

    expect(row.origin_latitude).toBe("14.1111000");
    expect(row.origin_longitude).toBe("121.1111000");
    expect(row.destination_latitude).toBe("14.2222000");
    expect(row.destination_longitude).toBe("121.2222000");
  });

  it("leaves unknown endpoint text null — no guessed coordinates", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });
    const unknown = tripRow({
      origin: "Somewhere not in the gazetteer",
      destination: "Also unknown",
    });
    mockQuery([unknown]);

    const res = await GET(mockReq());
    const row = (await res.json())[0];

    expect(row.origin_latitude).toBeNull();
    expect(row.origin_longitude).toBeNull();
    expect(row.destination_latitude).toBeNull();
    expect(row.destination_longitude).toBeNull();
  });

  it("fills only the missing end when just one endpoint resolves", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });
    const half = tripRow({ destination: "Unresolvable place" });
    mockQuery([half]);

    const res = await GET(mockReq());
    const row = (await res.json())[0];

    expect(Number(row.origin_latitude)).toBeCloseTo(14.5159034, 5);
    expect(row.destination_latitude).toBeNull();
  });

  it("keeps v2 partner text and proposals out of mobile coordinates", async () => {
    clearDynamicLocationCache();
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });
    mockQuery([tripRow({
      _external_create_fingerprint: "v2-fingerprint",
      _pickup_location_id: null,
      _dropoff_location_id: null,
      _pickup_registry_location_id: null,
      _pickup_registry_is_active: null,
      _pickup_registry_retired_at: null,
      _pickup_registry_latitude: null,
      _pickup_registry_longitude: null,
      _dropoff_registry_location_id: null,
      _dropoff_registry_is_active: null,
      _dropoff_registry_retired_at: null,
      _dropoff_registry_latitude: null,
      _dropoff_registry_longitude: null,
      _pickup_proposal_present: true,
      _dropoff_proposal_present: false,
    })]);

    const res = await GET(mockReq());
    const row = (await res.json())[0];

    expect(row.origin_latitude).toBeNull();
    expect(row.origin_longitude).toBeNull();
    expect(row.destination_latitude).toBeNull();
    expect(row.destination_longitude).toBeNull();
    expect(row.pickup_location_provenance).toBe("pending_review");
    expect(row.dropoff_location_provenance).toBe("unknown");
    expect(row).not.toHaveProperty("_external_create_fingerprint");
    expect(row).not.toHaveProperty("partner_pickup_location_proposal");
  });

  it("uses request-linked active points instead of mismatched stored route endpoints", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });
    const query = mockQuery([tripRow({
      origin_latitude: "1.0000",
      origin_longitude: "2.0000",
      destination_latitude: "3.0000",
      destination_longitude: "4.0000",
      _external_create_fingerprint: "v2-fingerprint",
      _pickup_location_id: 41,
      _dropoff_location_id: 42,
      _pickup_registry_location_id: 41,
      _pickup_registry_is_active: true,
      _pickup_registry_retired_at: null,
      _pickup_registry_latitude: "14.6000",
      _pickup_registry_longitude: "121.0200",
      _dropoff_registry_location_id: 42,
      _dropoff_registry_is_active: true,
      _dropoff_registry_retired_at: null,
      _dropoff_registry_latitude: "14.7000",
      _dropoff_registry_longitude: "121.0300",
      _pickup_proposal_present: false,
      _dropoff_proposal_present: false,
    })]);

    const res = await GET(mockReq());
    const row = (await res.json())[0];

    expect(Number(row.origin_latitude)).toBe(14.6);
    expect(Number(row.origin_longitude)).toBe(121.02);
    expect(Number(row.destination_latitude)).toBe(14.7);
    expect(Number(row.destination_longitude)).toBe(121.03);
    expect(row.pickup_location_provenance).toBe("canonical_registry");
    expect(row.dropoff_location_provenance).toBe("canonical_registry");

    const tripSelect = query.mock.calls.find(([sql]) => sql.includes("FROM trips t"))?.[0] ?? "";
    expect(tripSelect).toContain("tr.external_create_fingerprint");
    expect(tripSelect).toContain("tr.pickup_location_id");
    expect(tripSelect).toContain("tr.dropoff_location_id");
    expect(tripSelect).toContain("pickup_registry.location_id = tr.pickup_location_id");
    expect(tripSelect).toContain("dropoff_registry.location_id = tr.dropoff_location_id");
    expect(row).not.toHaveProperty("_pickup_registry_location_id");
    expect(row).not.toHaveProperty("_dropoff_registry_location_id");
  });

  it("does not expose a retired v2 location or substitute the stored route point", async () => {
    vi.spyOn(apiUtils, "requireDriver").mockResolvedValue({ user: { driverId: 7 } });
    mockQuery([tripRow({
      origin_latitude: "10.0000",
      origin_longitude: "20.0000",
      _external_create_fingerprint: "v2-fingerprint",
      _pickup_location_id: 41,
      _dropoff_location_id: null,
      _pickup_registry_location_id: 41,
      _pickup_registry_is_active: false,
      _pickup_registry_retired_at: "2026-09-01T00:00:00Z",
      _pickup_registry_latitude: "14.6000",
      _pickup_registry_longitude: "121.0200",
      _dropoff_registry_location_id: null,
      _dropoff_registry_is_active: null,
      _dropoff_registry_retired_at: null,
      _dropoff_registry_latitude: null,
      _dropoff_registry_longitude: null,
      _pickup_proposal_present: true,
      _dropoff_proposal_present: false,
    })]);

    const res = await GET(mockReq());
    const row = (await res.json())[0];

    expect(row.origin_latitude).toBeNull();
    expect(row.origin_longitude).toBeNull();
    expect(row.destination_latitude).toBeNull();
    expect(row.destination_longitude).toBeNull();
    expect(row.pickup_location_provenance).toBe("pending_review");
    expect(row.dropoff_location_provenance).toBe("unknown");
  });
});
