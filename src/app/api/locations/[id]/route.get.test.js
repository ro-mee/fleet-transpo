// API-level tests for GET /api/locations/[id] — the structured address it attaches
// so the locations page and the hotel base can reopen their picker on it.
//
// WHY THIS FILE EXISTS SEPARATELY
// ------------------------------
// The file beside it covers PUT, which is about how an edit versions or repoints a
// location. This one covers the READ path — no writes, and the only questions are
// whether the detail the picker needs reaches the client and whether the route's
// permission stays the one the hotel page borrows.
//
// IT IS THE MIRROR OF `drivers/[id]/route.get.test.js`, DELIBERATELY.
// The two routes attach the same contract to the same kind of parent read, and the
// driver one was falsified by swapping its two load calls. This route has only ONE
// address, so that particular defect cannot happen here — which is exactly why the
// two files are not identical. What this one covers instead is what is different:
//
//   1. THE ID IS VALIDATED BEFORE ANY WORK. `isId` rejects a malformed id with a 400,
//      and it does so ahead of the query — so a junk id costs no database round trip
//      and no load. Worth pinning because the guard sits above the query rather than
//      being a consequence of it.
//   2. THE REASON SURVIVES. A location that cannot be reopened must say WHY — a
//      silent refusal is indistinguishable from a bug, and this is the route the
//      hotel depends on, where a blank picker with no explanation is the worst
//      version of the failure.
//   3. THE PERMISSION IS `routes: read`. This is the load-bearing one and the reason
//      the coupling is written down in `addresses.md`: the hotel page is gated on
//      `settings: read` and reads through HERE. That is safe only because every role
//      holding `settings: read` also holds `routes: read`. Changing the permission
//      below would break the hotel picker for a role that no test would otherwise
//      name.
//
// `loadStructuredAddress` is doubled, so these assert what the ROUTE does with the
// result. The loader's own four outcomes belong to `address.service.test.js`.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const loadStructuredAddress = vi.fn();
vi.mock("@/services/address.service", () => ({
  saveAddress: vi.fn(),
  loadStructuredAddress: (...args) => loadStructuredAddress(...args),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

// Only the write path audits; stubbed so the module graph matches the route's.
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

import { GET } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";

const LOCATION_ID = 3;
const ADDRESS_ID = 4;

const STREET = "Winding Creek Boulevard";

/** A loader result, shaped the way `loadStructuredAddress` returns one. */
function loaded(overrides = {}) {
  return {
    ok: true,
    value: {
      type: "home",
      psgcBarangayCode: "137404001",
      regionCode: "1300000000",
      regionName: "National Capital Region (NCR)",
      provinceCode: null,
      provinceName: null,
      cityCode: "1374040000",
      cityName: "Quezon City",
      barangayName: "Bagong Pag-asa",
      cityHasNoProvince: true,
      houseBuildingNumber: "8572",
      streetRoad: STREET,
      unitFloorBuilding: "",
      subdivisionVillage: "",
      landmark: "",
      additionalDetails: "",
      postalCode: "1105",
      latitude: 14.6538,
      longitude: 121.0282,
      ...overrides,
    },
  };
}

const LOADED = loaded();

function locationRow(overrides = {}) {
  return {
    location_id: LOCATION_ID,
    name: "BGC Terminal",
    address: "8572 Winding Creek Boulevard, Quezon City",
    latitude: 14.6538,
    longitude: 121.0282,
    pickup_radius_m: 150,
    dropoff_radius_m: 150,
    address_id: ADDRESS_ID,
    created_at: "2026-09-01T00:00:00.000Z",
    is_active: true,
    retired_at: null,
    ...overrides,
  };
}

/** The `loadLocation` read, matched on the table it names; everything else is empty. */
function installDb({ location = locationRow() } = {}) {
  db.query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes("FROM locations")) {
      return { rows: location ? [location] : [], rowCount: location ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

const request = () => ({});
const context = (id = LOCATION_ID) => ({ params: Promise.resolve({ id: String(id) }) });

beforeEach(() => {
  loadStructuredAddress.mockReset();
  loadStructuredAddress.mockResolvedValue(LOADED);
  vi.spyOn(utils, "requirePermission").mockResolvedValue({
    user: { role: "admin", employeeId: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/locations/[id] — the address it hands the picker", () => {
  it("returns the location with its structured address attached", async () => {
    installDb();

    const res = await GET(request(), context());

    expect(res.status).toBe(200);
    const body = await res.json();
    // The row itself survives the spread — the picker needs `name` and the radii
    // as much as it needs the address.
    expect(body.location_id).toBe(LOCATION_ID);
    expect(body.name).toBe("BGC Terminal");
    expect(body.pickup_radius_m).toBe(150);
    expect(body.structured_address.streetRoad).toBe(STREET);
    expect(body.structured_address_reason).toBeNull();
    expect(loadStructuredAddress).toHaveBeenCalledWith(ADDRESS_ID);
  });

  it("sends both keys and the reason when the address cannot be reopened", async () => {
    loadStructuredAddress.mockResolvedValue({ ok: false, reason: "no-psgc-code" });
    installDb();

    const res = await GET(request(), context());

    // A legacy location is the ORDINARY case here, not an error: most predate the
    // registry. It must still be a 200 carrying a readable location.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("structured_address", null);
    expect(body).toHaveProperty("structured_address_reason", "no-psgc-code");
    expect(body.location_id).toBe(LOCATION_ID);
  });

  it("still returns the location when it has no registry row at all", async () => {
    loadStructuredAddress.mockResolvedValue({ ok: false, reason: "no-address-id" });
    installDb({ location: locationRow({ address_id: null }) });

    const res = await GET(request(), context());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("structured_address_reason", "no-address-id");

    // The null is FORWARDED, not short-circuited around. Skipping the call and
    // omitting the key would be indistinguishable down the wire and loses the
    // reason — which is the difference between a blank picker and a explained one.
    expect(loadStructuredAddress).toHaveBeenCalledWith(null);
  });

  it("404s a location that does not exist, without spending a load", async () => {
    installDb({ location: null });

    const res = await GET(request(), context());

    expect(res.status).toBe(404);
    expect(loadStructuredAddress).not.toHaveBeenCalled();
  });

  it("400s a malformed id before touching the database", async () => {
    installDb();

    const res = await GET(request(), context("abc"));

    expect(res.status).toBe(400);
    // The guard sits ABOVE the query rather than falling out of it, so a junk id
    // costs neither a round trip nor a load.
    expect(db.query).not.toHaveBeenCalled();
    expect(loadStructuredAddress).not.toHaveBeenCalled();
  });

  it("asks for routes:read — the permission the hotel page borrows", async () => {
    installDb();

    await GET(request(), context());

    // Pinned deliberately. The hotel page is gated on `settings: read` and reads
    // its address detail through THIS route; that is safe today only because every
    // role with `settings: read` also has `routes: read`. Narrowing this call would
    // break the hotel picker for a role nothing else here would name, so the change
    // should fail a test that points at the note rather than pass silently.
    expect(utils.requirePermission).toHaveBeenCalledWith(expect.anything(), "routes", "read");
  });
});
