import { describe, it, expect, vi, beforeEach } from "vitest";

// The module's only dependency is the pool, so the two functions can be tested
// against each other rather than against two hand-written mocks that agree.
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { saveAddress, getAddress } from "@/services/address.service";

// A picked address, as `resolveStructuredAddress` produces one. The PSGC code is
// a fixture: nothing in this file reaches a database.
const PICKED = {
  raw: "8572 Winding Creek Boulevard, Barangay Balibago, Santa Rosa City",
  formattedAddress:
    "8572 Winding Creek Boulevard, Barangay Balibago, Santa Rosa City, Laguna, CALABARZON (Region IV-A), 4026, Philippines",
  components: {
    houseNumber: "8572",
    street: "Winding Creek Boulevard",
    unitNumber: null,
    building: null,
    subdivision: null,
    barangay: "Balibago",
    city: "Santa Rosa City",
    municipality: null,
    province: "Laguna",
    region: "CALABARZON (Region IV-A)",
    country: "Philippines",
  },
  postalCode: "4026",
  postalCodeSource: "manual",
  latitude: 14.2874,
  longitude: 121.0907,
  // The structured path's own claim, and the reason `verified` is not enough on
  // its own: a dropped pin is a position, not a verification.
  provider: "manual",
  providerPlaceId: null,
  verified: false,
  verifiedAt: null,
  addressType: "home",
  landmark: "Across from the barangay hall",
  additionalDetails: "2nd floor, blue gate",
  psgcBarangayCode: "0403416001",
};

// The provider path, which has no cascade behind it and so no structured detail.
const GEOCODED = {
  raw: "CoCo Star Hotel, Manila",
  formattedAddress: "CoCo Star Hotel, Manila, Philippines",
  components: { city: "Manila", country: "Philippines" },
  latitude: 14.5159034,
  longitude: 120.9953405,
  provider: "tomtom",
  providerPlaceId: "abc123",
  verified: true,
  verifiedAt: "2026-09-24T00:00:00.000Z",
};

/** The INSERT's column list, in order — `$n` binds to the nth name in it. */
function insertColumns(sql) {
  return sql
    .slice(sql.indexOf("(") + 1, sql.indexOf(")"))
    .split(",")
    .map((name) => name.trim());
}

/**
 * The row Postgres would hold after the INSERT just captured.
 *
 * Built from the statement's OWN column list and params rather than from this
 * file's idea of the shape, so a column dropped from `INSERT_SQL` disappears
 * from the row instead of being quietly re-added by the fixture.
 */
function rowFromInsert(sql, params) {
  const row = {};
  insertColumns(sql).forEach((column, index) => {
    row[column] = params[index];
  });
  row.address_id = 1;
  row.created_at = new Date("2026-09-24T00:00:00.000Z");
  row.updated_at = new Date("2026-09-24T00:00:00.000Z");
  return row;
}

/**
 * Postgres returns the columns a statement ASKED FOR, and nothing else.
 *
 * This is what makes the round trip below real. The fixture row carries every
 * column the INSERT wrote, so a test that simply handed that row back would see
 * `psgc_barangay_code` whether or not `getAddress` ever selected it — which is
 * exactly the bug this file exists to catch, invisible by construction. Narrowing
 * the row to the words the statement contains is what turns "the read path
 * dropped a field" from something this test cannot see into a failure.
 */
function project(row, sql) {
  const out = {};
  for (const column of Object.keys(row)) {
    if (new RegExp(`\\b${column}\\b`).test(sql)) out[column] = row[column];
  }
  return out;
}

let inserted = null;

beforeEach(() => {
  inserted = null;
  query.mockReset();
  query.mockImplementation(async (sql, params) => {
    if (/^\s*INSERT INTO addresses/i.test(sql)) {
      inserted = { sql, params };
      return { rows: [{ address_id: 1 }] };
    }
    return { rows: inserted ? [project(rowFromInsert(inserted.sql, inserted.params), sql)] : [] };
  });
});

/** Save then read, through the two public functions and nothing else. */
async function roundTrip(value) {
  const addressId = await saveAddress(value);
  return { addressId, stored: await getAddress(addressId) };
}

describe("saveAddress — the four structured columns are bound", () => {
  it("names all four in the INSERT", async () => {
    await saveAddress(PICKED);
    const columns = insertColumns(inserted.sql);
    for (const column of ["address_type", "landmark", "additional_details", "psgc_barangay_code"]) {
      expect(columns).toContain(column);
    }
  });

  it("writes NULL for all four on the provider path", async () => {
    await saveAddress(GEOCODED);
    const row = rowFromInsert(inserted.sql, inserted.params);
    // Not "absent" — an explicit NULL, which is what keeps a geocoded row
    // distinguishable from one a cascade produced.
    expect(row.address_type).toBeNull();
    expect(row.landmark).toBeNull();
    expect(row.additional_details).toBeNull();
    expect(row.psgc_barangay_code).toBeNull();
  });

  it("writes the value it was given into each column", async () => {
    await saveAddress(PICKED);
    const row = rowFromInsert(inserted.sql, inserted.params);
    expect(row.address_type).toBe("home");
    expect(row.landmark).toBe("Across from the barangay hall");
    expect(row.additional_details).toBe("2nd floor, blue gate");
    expect(row.psgc_barangay_code).toBe("0403416001");
  });

  it("writes nothing for a blank address", async () => {
    expect(await saveAddress({ raw: "   ", formattedAddress: null, providerPlaceId: null })).toBeNull();
    expect(inserted).toBeNull();
  });
});

describe("getAddress — the four structured fields survive the round trip", () => {
  it("names all four in the SELECT, not merely in the row", async () => {
    // The falsification of the round trip, stated directly. Every test below
    // depends on `project` narrowing the fixture row to the columns the SELECT
    // asks for; this asserts the thing that narrowing is testing, so a future
    // reader does not have to reason through a test helper to see that the read
    // path is covered. Remove a column from the SELECT and this fails by name.
    await roundTrip(PICKED);
    const [selectSql] = query.mock.calls.find(([sql]) => /FROM addresses/i.test(sql));
    for (const column of ["address_type", "landmark", "additional_details", "psgc_barangay_code"]) {
      expect(selectSql).toContain(column);
    }
  });

  it("carries psgc_barangay_code back", async () => {
    const { stored } = await roundTrip(PICKED);
    expect(stored.psgcBarangayCode).toBe("0403416001");
  });

  it("carries landmark back", async () => {
    const { stored } = await roundTrip(PICKED);
    expect(stored.landmark).toBe("Across from the barangay hall");
  });

  it("carries additional_details back", async () => {
    const { stored } = await roundTrip(PICKED);
    expect(stored.additionalDetails).toBe("2nd floor, blue gate");
  });

  it("carries address_type back", async () => {
    const { stored } = await roundTrip(PICKED);
    expect(stored.addressType).toBe("home");
  });

  it("carries the whole structured slice, so a fifth field cannot be added to one side only", async () => {
    const { stored } = await roundTrip(PICKED);
    // `toEqual` and not four separate assertions: a field added to the INSERT
    // and not to the SELECT fails here rather than passing silently, which is
    // how the first four spent a release being written and never read.
    expect({
      addressType: stored.addressType,
      landmark: stored.landmark,
      additionalDetails: stored.additionalDetails,
      psgcBarangayCode: stored.psgcBarangayCode,
    }).toEqual({
      addressType: PICKED.addressType,
      landmark: PICKED.landmark,
      additionalDetails: PICKED.additionalDetails,
      psgcBarangayCode: PICKED.psgcBarangayCode,
    });
  });

  it("reads null for all four on a provider row, inventing nothing", async () => {
    const { stored } = await roundTrip(GEOCODED);
    expect(stored.addressType).toBeNull();
    expect(stored.landmark).toBeNull();
    expect(stored.additionalDetails).toBeNull();
    expect(stored.psgcBarangayCode).toBeNull();
  });

  it("still reads the geography the provider path does have", async () => {
    // The four fields are an addition to this function, not a rewrite of it.
    const { stored } = await roundTrip(GEOCODED);
    expect(stored.formattedAddress).toBe(GEOCODED.formattedAddress);
    expect(stored.components.city).toBe("Manila");
    expect(stored.verified).toBe(true);
    expect(stored.provider).toBe("tomtom");
  });

  it("returns null for an id that resolves to no row", async () => {
    expect(await getAddress(999)).toBeNull();
  });

  it("returns null without querying for an id that is not one", async () => {
    expect(await getAddress("not-an-id")).toBeNull();
    expect(await getAddress(null)).toBeNull();
    expect(await getAddress(0)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
