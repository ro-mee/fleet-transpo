// API-level tests for GET /api/drivers/[id] — the two saved addresses it attaches
// so the edit page's picker can reopen on them.
//
// WHY THIS FILE IS SEPARATE FROM `route.test.js`
// ---------------------------------------------
// That file covers PUT, and it is about the three ways an EDIT can corrupt an
// address. This one covers the READ path, which fails differently: nothing is
// written at all, and the only question is whether the detail the picker needs
// reaches the client intact. Kept apart for the same reason POST and PUT are — a
// reader asking "why does a failed load not fail the whole page" should find the
// answer here rather than in a file about writes.
//
// WHAT IS ACTUALLY BEING HELD DOWN
// --------------------------------
//   1. BOTH KEYS ARE ALWAYS PRESENT. A missing `structured_address` and a
//      `structured_address: null` are different facts and only one is the truth.
//      The route promises the key is there either way, so a caller may read the
//      value without first checking that it exists — and `null` never has to be
//      disambiguated against a sibling that might be what is missing.
//   2. THE TWO LOADERS ARE NOT SWAPPED. Residential goes to `structured_address`
//      and emergency to `emergency_structured_address`. Swapping them shows a
//      driver's next-of-kin's address as their home — silently, on the one form
//      where it is a single Save away from being written back as the truth.
//   3. A LOAD THAT CANNOT SUCCEED STILL RETURNS A DRIVER. This endpoint also
//      serves the detail view, which has nothing to do with editing, so a legacy
//      address must cost the operator a blank picker and a stated reason — not a
//      500 on a page they only wanted to read.
//
// The loader's own four outcomes are NOT re-tested here; `address.service.test.js`
// owns those. These tests double `loadStructuredAddress` and assert only what the
// route does with what it returns.
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

vi.mock("@/lib/drivers/media", () => ({
  signDriverMedia: vi.fn(async (row) => row),
  toStoredMediaRef: vi.fn((value) => (value === undefined ? undefined : value ?? null)),
}));

// Not part of the read path; stubbed only so the module graph matches the one
// the route is actually loaded with.
vi.mock("@/services/status.service", () => ({ syncDriverStatus: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/drivers/compliance", () => ({
  suspensionAction: vi.fn(() => ({ action: "none" })),
}));

import { GET } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";

const DRIVER_ID = 7;
const RESIDENTIAL_ID = 11;
const EMERGENCY_ID = 12;

const RESIDENTIAL_STREET = "Winding Creek Boulevard";
const EMERGENCY_STREET = "Balibago Road";

/**
 * A loader result, shaped the way `loadStructuredAddress` returns one.
 *
 * The street is what tells the two apart in assertions, because it is the one
 * field the route must carry through untouched — nothing re-derives it.
 */
function loaded(overrides = {}) {
  return {
    ok: true,
    value: {
      type: "home",
      psgcBarangayCode: "043404001",
      regionCode: "0400000000",
      regionName: "CALABARZON (Region IV-A)",
      provinceCode: "0434000000",
      provinceName: "Laguna",
      cityCode: "0434040000",
      cityName: "Santa Rosa City",
      barangayName: "Balibago",
      cityHasNoProvince: false,
      houseBuildingNumber: "8572",
      streetRoad: RESIDENTIAL_STREET,
      unitFloorBuilding: "",
      subdivisionVillage: "",
      landmark: "",
      additionalDetails: "",
      postalCode: "4026",
      latitude: null,
      longitude: null,
      ...overrides,
    },
  };
}

const RESIDENTIAL_LOADED = loaded();
const EMERGENCY_LOADED = loaded({ streetRoad: EMERGENCY_STREET });

function driverRow(overrides = {}) {
  return {
    driver_id: DRIVER_ID,
    employee_id: 55,
    address_id: RESIDENTIAL_ID,
    emergency_contact_address_id: EMERGENCY_ID,
    deleted_at: null,
    ...overrides,
  };
}

/**
 * Install the `query` double.
 *
 * GET issues four reads, matched here on the text that distinguishes each. The
 * catch-all returns empty rows rather than throwing, so a query this file does
 * not know about degrades to "no trips, no stats" instead of an unrelated failure
 * in a test that was never about it.
 */
function installDb({ driver = driverRow() } = {}) {
  db.query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes("ALTER TABLE drivers")) return { rows: [], rowCount: 0 };
    if (text.includes("AS employees")) {
      return { rows: driver ? [driver] : [], rowCount: driver ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

const request = () => ({});
const context = () => ({ params: Promise.resolve({ id: String(DRIVER_ID) }) });

/** The ids passed to the loader, in call order — Promise.all keeps the array order. */
const loadedIds = () => loadStructuredAddress.mock.calls.map((call) => call[0]);

beforeEach(() => {
  loadStructuredAddress.mockReset();
  loadStructuredAddress.mockImplementation(async (id) =>
    id === EMERGENCY_ID ? EMERGENCY_LOADED : RESIDENTIAL_LOADED
  );
  vi.spyOn(utils, "requirePermission").mockResolvedValue({
    user: { role: "admin", employeeId: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/drivers/[id] — the saved addresses it hands the picker", () => {
  it("attaches each address to its own field, residential first", async () => {
    installDb();

    const res = await GET(request(), context());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.structured_address.streetRoad).toBe(RESIDENTIAL_STREET);
    expect(body.emergency_structured_address.streetRoad).toBe(EMERGENCY_STREET);
    expect(body.structured_address_reason).toBeNull();
    expect(body.emergency_structured_address_reason).toBeNull();

    // The pairing, asserted at the call site rather than inferred from the
    // payload: both ids reach the loader in the residential-then-emergency order.
    // A swap here is the failure this file most exists to catch.
    expect(loadedIds()).toEqual([RESIDENTIAL_ID, EMERGENCY_ID]);
  });

  it("sends both keys even when neither address can be reopened", async () => {
    loadStructuredAddress.mockResolvedValue({ ok: false, reason: "no-psgc-code" });
    installDb();

    const body = await (await GET(request(), context())).json();

    // `toHaveProperty` rather than `toBeNull` on a bare read: it fails on a KEY
    // that is absent, which is the distinction this test is about. Reading
    // `body.structured_address` and finding `undefined` would pass a comparison
    // and hide exactly the bug.
    expect(body).toHaveProperty("structured_address", null);
    expect(body).toHaveProperty("structured_address_reason", "no-psgc-code");
    expect(body).toHaveProperty("emergency_structured_address", null);
    expect(body).toHaveProperty("emergency_structured_address_reason", "no-psgc-code");
  });

  it("still returns the driver when one legacy address cannot be reopened", async () => {
    loadStructuredAddress.mockImplementation(async (id) =>
      id === RESIDENTIAL_ID ? { ok: false, reason: "no-psgc-code" } : EMERGENCY_LOADED
    );
    installDb();

    const res = await GET(request(), context());

    // The detail page must not go down over a blank picker it was not asked to
    // populate. One refusal, one unaffected sibling.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.driver_id).toBe(DRIVER_ID);
    expect(body.structured_address).toBeNull();
    expect(body.structured_address_reason).toBe("no-psgc-code");
    expect(body.emergency_structured_address.streetRoad).toBe(EMERGENCY_STREET);
  });

  it("serves a driver with no addresses at all rather than failing", async () => {
    loadStructuredAddress.mockResolvedValue({ ok: false, reason: "no-address-id" });
    installDb({ driver: driverRow({ address_id: null, emergency_contact_address_id: null }) });

    const res = await GET(request(), context());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("structured_address", null);
    expect(body).toHaveProperty("structured_address_reason", "no-address-id");
    expect(body).toHaveProperty("emergency_structured_address_reason", "no-address-id");

    // Both calls still happen, with the nulls forwarded. Skipping the call and
    // omitting the key would look identical down the wire and loses the reason.
    expect(loadedIds()).toEqual([null, null]);
  });

  it("404s an unknown driver without spending a load on it", async () => {
    installDb({ driver: null });

    const res = await GET(request(), context());

    expect(res.status).toBe(404);
    expect(loadStructuredAddress).not.toHaveBeenCalled();
  });
});
