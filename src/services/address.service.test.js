import { describe, it, expect, vi, beforeEach } from "vitest";

// The module's only dependency is the pool, so the two functions can be tested
// against each other rather than against two hand-written mocks that agree.
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { saveAddress, getAddress, loadStructuredAddress } from "@/services/address.service";
import { resolveStructuredAddress } from "@/lib/address/validate-structured";
import { PREFILL_REASON_MESSAGES } from "@/lib/address/structured";

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

// ── The PSGC chain, for the reopen tests at the bottom ──────────────────────
// `resolveBarangayChain` is the one thing `loadStructuredAddress` calls that is
// not `addresses`, so it is answered here rather than mocked as a module: the
// loader's contract is about what it DOES with a chain, and stubbing the module
// would let this file's idea of a chain diverge from the real one.
const CHAIN_SQL = /FROM public\.ph_barangays/i;
const CHAIN_ROW = {
  barangay_code: "0403416001",
  barangay_name: "Balibago",
  city_code: "0403416000",
  city_name: "Santa Rosa City",
  province_code: "0403400000",
  province_name: "Laguna",
  region_code: "0400000000",
  region_name: "CALABARZON (Region IV-A)",
};

beforeEach(() => {
  inserted = null;
  query.mockReset();
  query.mockImplementation(async (sql, params) => {
    if (/^\s*INSERT INTO addresses/i.test(sql)) {
      inserted = { sql, params };
      return { rows: [{ address_id: 1 }] };
    }
    if (CHAIN_SQL.test(sql)) return { rows: [CHAIN_ROW] };
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

// ── Reopening a saved address in the form that wrote it ─────────────────────
//
// The whole journey, through the real functions at every step: a form value →
// `resolveStructuredAddress` (the server's own resolution) → `saveAddress` (the
// real INSERT) → `loadStructuredAddress` → a form value again.
//
// It runs in THIS file, beside the write path, because the claim it tests is that
// the two directions agree — and two files holding half the mapping each is how
// they stop agreeing without either one looking wrong.

/**
 * The form value AS THE CLIENT SENDS IT, with every field set.
 *
 * Deliberately includes the geography the client sends and the server DISCARDS,
 * so the round trip also proves the reopened value is derived from the code
 * rather than echoed back from the submission.
 */
const FORM = {
  type: "home",
  regionCode: "0400000000",
  regionName: "CALABARZON (Region IV-A)",
  provinceCode: "0403400000",
  provinceName: "Laguna",
  cityCode: "0403416000",
  cityName: "Santa Rosa City",
  psgcBarangayCode: "0403416001",
  barangayName: "Balibago",
  cityHasNoProvince: false,
  houseBuildingNumber: "8572",
  streetRoad: "Winding Creek Boulevard",
  unitFloorBuilding: "2nd floor",
  subdivisionVillage: "Winding Creek",
  landmark: "Across from the barangay hall",
  additionalDetails: "2nd floor, blue gate",
  postalCode: "4026",
  latitude: 14.2874,
  longitude: 121.0907,
};

/** Save the form value the way a route does, then reopen it the way a picker does. */
async function saveThenReopen(form) {
  const resolved = await resolveStructuredAddress(form);
  expect(resolved.ok).toBe(true);
  const addressId = await saveAddress(resolved.value);
  return loadStructuredAddress(addressId);
}

describe("loadStructuredAddress — the round trip is total", () => {
  it("returns the same form value that was saved", async () => {
    const reopened = await saveThenReopen(FORM);
    expect(reopened.ok).toBe(true);
    // `toEqual` over the WHOLE object, not field by field. A key that the save
    // drops and the load invents, or that the load forgets, fails here — which is
    // the failure that would matter, since it is silent in review: a reopened
    // form that lost one field still looks like it worked.
    expect(reopened.value).toEqual(FORM);
  });

  it("carries the pin back", async () => {
    const reopened = await saveThenReopen(FORM);
    expect(reopened.value.latitude).toBe(14.2874);
    expect(reopened.value.longitude).toBe(121.0907);
  });

  it("reopens an address with no pin, rather than inventing one", async () => {
    const reopened = await saveThenReopen({ ...FORM, latitude: null, longitude: null });
    expect(reopened.ok).toBe(true);
    expect(reopened.value.latitude).toBeNull();
    expect(reopened.value.longitude).toBeNull();
  });

  it("shows empty strings, not nulls, for detail that was never filled in", async () => {
    // The form's own empty value uses "", and the loader must not hand it nulls:
    // `detailErrors` and the preview call String methods on these.
    const reopened = await saveThenReopen({
      ...FORM,
      unitFloorBuilding: "",
      subdivisionVillage: "",
      landmark: "",
      additionalDetails: "",
    });
    expect(reopened.value.unitFloorBuilding).toBe("");
    expect(reopened.value.subdivisionVillage).toBe("");
    expect(reopened.value.landmark).toBe("");
    expect(reopened.value.additionalDetails).toBe("");
  });

  it("derives the geography from the CODE, not from what the client submitted", async () => {
    // The falsification of "it just echoes the request back". Every name here is
    // wrong; the reopen must return the chain's, because the code is the identity
    // and the submitted names were discarded on the way in.
    const reopened = await saveThenReopen({
      ...FORM,
      cityName: "Not A City",
      provinceName: "Not A Province",
      regionName: "Not A Region",
      barangayName: "Not A Barangay",
    });
    expect(reopened.value.cityName).toBe("Santa Rosa City");
    expect(reopened.value.provinceName).toBe("Laguna");
    expect(reopened.value.regionName).toBe("CALABARZON (Region IV-A)");
    expect(reopened.value.barangayName).toBe("Balibago");
  });
});

describe("loadStructuredAddress — the four refusals", () => {
  it("reports no-address-id when nothing is linked", async () => {
    // Not an error in the UI: this is every location and driver that predates the
    // address registry, and the picker opens blank exactly as it used to.
    expect(await loadStructuredAddress(null)).toEqual({ ok: false, reason: "no-address-id" });
    expect(await loadStructuredAddress(undefined)).toEqual({ ok: false, reason: "no-address-id" });
  });

  it("reports no-address-id when the id resolves to no row", async () => {
    expect(await loadStructuredAddress(999)).toEqual({ ok: false, reason: "no-address-id" });
  });

  it("reports no-psgc-code for a row that cannot be reopened", async () => {
    // A row saved before the cascade, or by the provider path: it exists and is
    // perfectly displayable, but there is no CODE behind it. This is the case the
    // whole design refuses to paper over — recovering a barangay from the stored
    // name is the fuzzy match that would be wrong exactly where it is hardest to
    // notice.
    const addressId = await saveAddress(GEOCODED);
    expect(await loadStructuredAddress(addressId)).toEqual({ ok: false, reason: "no-psgc-code" });
  });

  it("reports unknown-barangay when the code no longer resolves", async () => {
    const addressId = await saveAddress({ ...PICKED, psgcBarangayCode: "9999999999" });
    query.mockImplementation(async (sql) => {
      if (CHAIN_SQL.test(sql)) return { rows: [] };
      if (/FROM addresses/i.test(sql)) {
        return { rows: [project(rowFromInsert(inserted.sql, inserted.params), sql)] };
      }
      return { rows: [] };
    });
    expect(await loadStructuredAddress(addressId)).toEqual({ ok: false, reason: "unknown-barangay" });
  });

  it("reports unavailable rather than throwing when the read itself fails", async () => {
    // The endpoint this feeds also serves a detail page. A database error must
    // not turn "the edit form cannot be pre-filled" into a 500 for the whole
    // view, so the loader degrades — and says which of the four it is.
    query.mockImplementation(async () => {
      throw new Error("connection terminated");
    });
    expect(await loadStructuredAddress(1)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("names every reason the UI has copy for", async () => {
    // A reason returned but not translated reaches the operator as nothing at
    // all — the field just will not open, which is the silent refusal this
    // feature exists to remove. `no-address-id` is the one exception: it means
    // there is no address, so there is nothing to explain.
    const reasons = ["no-psgc-code", "unknown-barangay", "unavailable"];
    for (const reason of reasons) {
      expect(PREFILL_REASON_MESSAGES[reason]).toBeTruthy();
    }
    expect(Object.keys(PREFILL_REASON_MESSAGES).sort()).toEqual([...reasons].sort());
  });
});
