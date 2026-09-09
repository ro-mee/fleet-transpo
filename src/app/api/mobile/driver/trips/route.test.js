// Tests for the endpoint-coordinate fallback in GET /api/mobile/driver/trips.
//
// Covers the "current trip has no route preview" report: trips created by
// ensureTripForDispatch from booking dispatches carry no route_id, so the
// canonical location joins return null and Home's current card fell to
// "Route preview unavailable" even mid-trip. The route now fills missing
// endpoint coordinates from the shared gazetteer on the endpoint text —
// the same canonical → gazetteer → none chain getTripGeofenceTargets uses.
import { describe, it, expect, vi, afterEach } from "vitest";
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
});
