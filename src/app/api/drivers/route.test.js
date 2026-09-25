// API-level tests for POST /api/drivers — the create path's atomicity.
//
// WHAT THESE ARE FOR. The route used to write in two places: the employee and
// driver inserts went through the Supabase client (PostgREST over HTTPS) and the
// address rows through `withTransaction`'s `pg` handle. Those cannot share a
// transaction, so an address failure left a committed driver with both address
// ids NULL, reported as a `warning`. The route now runs all three writes on one
// `pg` transaction, and these tests are what hold that shape in place.
//
// The transaction is doubled at the SEAM rather than stubbed flat, because the
// property under test is control flow: the `withTransaction` double here mimics
// the real helper — run the callback, mark committed on resolve, mark rolled
// back and re-throw on throw. A double that simply resolved would let a
// regression pass, since a route that swallowed its own error would still look
// green.
//
// The geography resolver is mocked where `validate-structured.js` reads it, so
// the real pick resolution, the real detail rules and the real composition all
// still run.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const resolveBarangayChain = vi.fn();
vi.mock("@/lib/geo/psgc", () => ({
  resolveBarangayChain: (...args) => resolveBarangayChain(...args),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getAdminClient: vi.fn(),
}));

vi.mock("@/services/address.service", () => ({ saveAddress: vi.fn() }));

// Stub the storage layer: these tests are about which rows the route writes, not
// about how a stored media ref is signed.
vi.mock("@/lib/drivers/media", () => ({
  signDriverMedia: vi.fn(async (row) => row),
  signDriverMediaList: vi.fn(async (rows) => rows),
  toStoredMediaRef: vi.fn((value) => (value === undefined ? undefined : value ?? null)),
}));

import { POST } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import { saveAddress } from "@/services/address.service";
// The FORM's constructors, imported so the last describe can build the body the
// browser actually sends rather than one written in the server's vocabulary.
import {
  CASCADE_LEVEL_KEYS,
  EMPTY_STRUCTURED_ADDRESS,
  editDetail,
  selectLevel,
} from "@/lib/address/structured";

/** A resolved chain, shaped exactly like `resolveBarangayChain`'s return. */
const SANTA_ROSA = {
  region: { code: "0400000000", name: "CALABARZON (Region IV-A)" },
  province: { code: "0434000000", name: "Laguna" },
  city: { code: "0434040000", name: "Santa Rosa City" },
  barangay: { code: "043404001", name: "Balibago" },
};

const RESIDENTIAL_ID = 11;
const EMERGENCY_ID = 12;

/** The two streets. See `isEmergencyPick` for why these are what tell the picks apart. */
const RESIDENTIAL_STREET = "Winding Creek Boulevard";
const EMERGENCY_STREET = "Balibago Road";

/** The minimum a savable address needs, plus its barangay choice. */
function pick(overrides = {}) {
  return {
    type: "home",
    psgcBarangayCode: "043404001",
    houseBuildingNumber: "8572",
    streetRoad: RESIDENTIAL_STREET,
    postalCode: "4026",
    ...overrides,
  };
}

const RESIDENTIAL_PICK = pick();
const EMERGENCY_PICK = pick({ psgcBarangayCode: "043404002", streetRoad: EMERGENCY_STREET });

/**
 * Tell the two picks apart inside `saveAddress`, so the assertions can prove the
 * residential id did not land in the emergency column.
 *
 * NOT by `psgcBarangayCode`, which is the obvious-looking key and is a trap: the
 * value arriving at `saveAddress` is the SERVER-RESOLVED one, and
 * `validate-structured.js` overwrites the submitted code with the barangay that
 * code resolved to. This file's `resolveBarangayChain` double answers with
 * Santa Rosa for every code, so both picks carry an identical `psgcBarangayCode`
 * and a mock keyed on it hands the residential id to both columns — which is
 * exactly the failure the first version of these tests had. The street survives
 * resolution, so it is what they are told apart by.
 */
const isEmergencyPick = (value) =>
  String(value?.formattedAddress ?? "").includes(EMERGENCY_STREET);

function baseBody(extra = {}) {
  return {
    first_name: "Juan",
    last_name: "Dela Cruz",
    email: "juan.dela.cruz@fleetops.ph",
    license_number: "N01-23-456789",
    birthdate: "1990-05-04",
    ...extra,
  };
}

/**
 * A Supabase client double. The route still uses the client for its two guard
 * READS; nothing should write through it any more, so every mutating method is
 * inert and records itself in `writes` if it is ever reached.
 */
function fakeSupabase({ existingEmp = null, existingDriver = null, writes } = {}) {
  return {
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => ({
          data: table === "employees" ? existingEmp : existingDriver,
          error: null,
        }),
        insert: () => {
          writes?.push(`insert:${table}`);
          return chain;
        },
        update: () => {
          writes?.push(`update:${table}`);
          return chain;
        },
        single: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
}

/**
 * Install the `withTransaction` and `query` doubles.
 *
 * @param {object} [opts]
 * @param {(sql: string, params: any[]) => boolean} [opts.failOn] statement to fail on
 * @param {string} [opts.code] SQLSTATE to attach to that failure
 * @param {number} [opts.driverId]
 */
function installDb({ failOn, code, driverId = 77, existingEmp = null, existingDriver = null } = {}) {
  const txCalls = [];
  const supabaseWrites = [];
  const state = { committed: false, rolledBack: false, driverInserted: false };
  let txQuery;

  db.getAdminClient.mockReturnValue(
    fakeSupabase({ existingEmp, existingDriver, writes: supabaseWrites })
  );

  db.query.mockImplementation(async (sql) => {
    if (String(sql).includes("ALTER TABLE drivers")) return { rows: [], rowCount: 0 };
    // The response SELECT.
    return { rows: [{ driver_id: driverId, first_name: "Juan" }], rowCount: 1 };
  });

  db.withTransaction.mockImplementation(async (fn) => {
    txQuery = vi.fn(async (sql, params = []) => {
      txCalls.push({ sql: String(sql), params });
      if (failOn && failOn(String(sql), params)) {
        const err = new Error("simulated database failure");
        if (code) err.code = code;
        throw err;
      }
      if (String(sql).includes("INSERT INTO employees")) {
        return { rows: [{ employee_id: 55 }], rowCount: 1 };
      }
      if (String(sql).includes("INSERT INTO drivers")) {
        state.driverInserted = true;
        return { rows: [{ driver_id: driverId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    try {
      const out = await fn({ query: txQuery });
      state.committed = true;
      return out;
    } catch (e) {
      state.rolledBack = true;
      throw e;
    }
  });

  return { txCalls, state, supabaseWrites, txQuery: () => txQuery };
}

/** Read a statement's parameters back as a column→value map. */
function columnsOf(call) {
  const match = call.sql.match(/INSERT INTO (\w+)\s*\(([\s\S]*?)\)\s*VALUES/);
  if (!match) return { table: null, columns: {} };
  const names = match[2]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const columns = {};
  names.forEach((name, i) => {
    columns[name] = call.params[i];
  });
  return { table: match[1], columns };
}

const findInsert = (calls, table) =>
  calls.find((c) => new RegExp(`INSERT INTO ${table}\\b`).test(c.sql));

beforeEach(() => {
  resolveBarangayChain.mockReset();
  resolveBarangayChain.mockResolvedValue(SANTA_ROSA);
  saveAddress.mockReset();
  vi.spyOn(utils, "requirePermission").mockResolvedValue({
    user: { role: "admin", employeeId: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const request = (body) => ({ json: async () => body });

describe("POST /api/drivers — successful create", () => {
  it("writes both addresses and the driver in ONE insert-bearing transaction", async () => {
    saveAddress.mockImplementation(async (value) => (isEmergencyPick(value) ? EMERGENCY_ID : RESIDENTIAL_ID));
    const { txCalls, state } = installDb();

    const res = await POST(
      request(
        baseBody({
          structured_address: RESIDENTIAL_PICK,
          emergency_structured_address: EMERGENCY_PICK,
        })
      )
    );

    expect(res.status).toBe(201);
    expect(state.committed).toBe(true);
    expect(state.rolledBack).toBe(false);

    // Both ids land in the driver INSERT itself. There is no follow-up UPDATE
    // that could leave the row visible without them.
    const { table, columns } = columnsOf(findInsert(txCalls, "drivers"));
    expect(table).toBe("drivers");
    expect(columns.address_id).toBe(RESIDENTIAL_ID);
    expect(columns.emergency_contact_address_id).toBe(EMERGENCY_ID);
    expect(txCalls.some((c) => /UPDATE drivers SET address_id/.test(c.sql))).toBe(false);

    // The composed address is mirrored into the legacy text columns, so every
    // existing reader of `drivers.address` keeps working unchanged.
    expect(columns.address).toContain("Winding Creek Boulevard");
    expect(columns.emergency_contact_address).toContain("Balibago Road");
  });

  it("writes exactly one address when only one was picked", async () => {
    saveAddress.mockResolvedValue(RESIDENTIAL_ID);
    const { txCalls, state } = installDb();

    const res = await POST(request(baseBody({ structured_address: RESIDENTIAL_PICK })));

    expect(res.status).toBe(201);
    expect(state.committed).toBe(true);
    expect(saveAddress).toHaveBeenCalledTimes(1);

    const { columns } = columnsOf(findInsert(txCalls, "drivers"));
    expect(columns.address_id).toBe(RESIDENTIAL_ID);
    expect(columns.emergency_contact_address_id).toBeNull();
  });

  it("still creates a driver with no addresses at all — they stay optional", async () => {
    const { txCalls, state } = installDb();

    const res = await POST(request(baseBody({ address: "12 Mabini St, Manila" })));

    expect(res.status).toBe(201);
    expect(state.committed).toBe(true);
    expect(saveAddress).not.toHaveBeenCalled();

    const { columns } = columnsOf(findInsert(txCalls, "drivers"));
    expect(columns.address_id).toBeNull();
    expect(columns.emergency_contact_address_id).toBeNull();
    // Legacy free text with no pick behind it passes through untouched — the
    // pre-migration behaviour for a driver who has not been re-edited yet.
    expect(columns.address).toBe("12 Mabini St, Manila");
  });

  it("never writes through the Supabase client", async () => {
    // The split that broke atomicity. A regression reintroducing it would
    // otherwise be invisible, since the response would still be a 201.
    saveAddress.mockResolvedValue(RESIDENTIAL_ID);
    const { supabaseWrites } = installDb();

    await POST(request(baseBody({ structured_address: RESIDENTIAL_PICK })));

    expect(supabaseWrites).toEqual([]);
  });

  it("writes the addresses BEFORE the driver row, so the ids are never dangling", async () => {
    // The ordering is what makes the rollback story simple: an address failure
    // means the driver INSERT is never reached at all, which is a stronger
    // guarantee than insert-then-rollback. Reversing these would silently
    // reintroduce a driver row briefly visible without its addresses.
    saveAddress.mockResolvedValue(RESIDENTIAL_ID);
    const { txCalls, txQuery } = installDb();

    await POST(request(baseBody({ structured_address: RESIDENTIAL_PICK })));

    const driverIndex = txCalls.findIndex((c) => c.sql.includes("INSERT INTO drivers"));
    expect(driverIndex).toBeGreaterThanOrEqual(0);

    const driverOrder = txQuery().mock.invocationCallOrder[driverIndex];
    expect(saveAddress.mock.invocationCallOrder[0]).toBeLessThan(driverOrder);
  });
});

describe("POST /api/drivers — an address failure fails the create", () => {
  it("returns a failure rather than a 201 carrying a warning", async () => {
    saveAddress.mockRejectedValue(new Error("address registry unavailable"));
    const { state } = installDb();

    const res = await POST(request(baseBody({ structured_address: RESIDENTIAL_PICK })));

    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("warning");
    expect(state.committed).toBe(false);
  });

  it("leaves no driver behind — the row is never inserted when the address fails", async () => {
    saveAddress.mockRejectedValue(new Error("address registry unavailable"));
    const { txCalls, state } = installDb();

    await POST(request(baseBody({ structured_address: RESIDENTIAL_PICK })));

    expect(state.driverInserted).toBe(false);
    expect(findInsert(txCalls, "drivers")).toBeUndefined();
    expect(state.rolledBack).toBe(true);
  });

  it("keeps both addresses all-or-nothing when only the second one fails", async () => {
    saveAddress.mockImplementation(async (value) => {
      if (isEmergencyPick(value)) {
        throw new Error("second address refused");
      }
      return RESIDENTIAL_ID;
    });
    const { txCalls, state } = installDb();

    const res = await POST(
      request(
        baseBody({
          structured_address: RESIDENTIAL_PICK,
          emergency_structured_address: EMERGENCY_PICK,
        })
      )
    );

    expect(res.status).toBe(500);
    expect(state.committed).toBe(false);
    expect(findInsert(txCalls, "drivers")).toBeUndefined();
  });

  it("rolls back the employee when the driver insert fails", async () => {
    saveAddress.mockResolvedValue(RESIDENTIAL_ID);
    const { state } = installDb({ failOn: (sql) => sql.includes("INSERT INTO drivers") });

    const res = await POST(request(baseBody({ structured_address: RESIDENTIAL_PICK })));

    expect(res.status).toBe(500);
    expect(state.rolledBack).toBe(true);
    expect(state.committed).toBe(false);
  });

  it("maps a unique violation to a 409 and does not hand-roll compensation", async () => {
    saveAddress.mockResolvedValue(RESIDENTIAL_ID);
    const { state, supabaseWrites } = installDb({
      failOn: (sql) => sql.includes("INSERT INTO employees"),
      code: "23505",
    });

    const res = await POST(request(baseBody({ structured_address: RESIDENTIAL_PICK })));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already exists/);
    expect(state.committed).toBe(false);
    // The old path compensated by soft-deleting the employee. A rollback makes
    // that unnecessary, and this asserts the compensation did not come back.
    expect(supabaseWrites).toEqual([]);
  });

  it("rejects a half coordinate pair before any write, and writes nothing", async () => {
    // The validation half: `chk_addresses_coords_pair` is the database's backstop,
    // and `validate-structured.js` Stage 4 is the first line. A refused pick must
    // not reach the transaction at all.
    const { state, txCalls, supabaseWrites } = installDb();

    const res = await POST(
      request(baseBody({ structured_address: pick({ latitude: 14.5097, longitude: null }) }))
    );

    expect(res.status).toBe(400);
    expect((await res.json()).errors["structured_address"]).toMatch(/together/);
    expect(state.committed).toBe(false);
    expect(txCalls).toEqual([]);
    expect(supabaseWrites).toEqual([]);
    expect(saveAddress).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The payload the address form really submits
// ---------------------------------------------------------------------------

/**
 * Every pick above is written by hand in the SERVER's vocabulary. That is the
 * right default for testing what the route does with a valid request — and it is
 * exactly why the route shipped accepting a body no browser sends.
 *
 * Until 2026-09-24 the cascade built its value with `selectLevel`, which wrote
 * `barangayCode`, while `normalizeStructuredInput` read `psgcBarangayCode`. Both
 * sides were tested against themselves, so both were green: creating a driver in
 * the browser returned 400 "Select a barangay." with a barangay selected, and no
 * test anywhere noticed. The fix renamed the form's key.
 *
 * This one starts from `EMPTY_STRUCTURED_ADDRESS` and `selectLevel` — the form's
 * own constructors — so the body under test is the body the page builds. It is
 * deliberately not "a test for the driver route": it is the crossing check that
 * the two halves of the contract agree, and it is the reason a future rename on
 * either side fails here instead of in an operator's face.
 */
describe("POST /api/drivers — the payload the address form actually builds", () => {
  /** A value built the way `AddressFormDialog` builds one, via the real helpers. */
  function formValue({ streetRoad, postalCode }) {
    // From the form's own declaration of the key, not a hardcoded string, so this
    // follows the rename rather than pinning a name that could go dead again.
    const [codeKey] = CASCADE_LEVEL_KEYS.barangay;

    let value = EMPTY_STRUCTURED_ADDRESS;
    value = selectLevel(value, "region", {
      regionCode: SANTA_ROSA.region.code,
      regionName: SANTA_ROSA.region.name,
    });
    value = selectLevel(value, "province", {
      provinceCode: SANTA_ROSA.province.code,
      provinceName: SANTA_ROSA.province.name,
    });
    value = selectLevel(value, "city", {
      cityCode: SANTA_ROSA.city.code,
      cityName: SANTA_ROSA.city.name,
      cityHasNoProvince: false,
    });
    value = selectLevel(value, "barangay", {
      [codeKey]: SANTA_ROSA.barangay.code,
      barangayName: SANTA_ROSA.barangay.name,
    });
    value = editDetail(value, "houseBuildingNumber", "8572");
    value = editDetail(value, "streetRoad", streetRoad);
    value = editDetail(value, "postalCode", postalCode);
    return value;
  }

  it("accepts it, and records the barangay the operator picked", async () => {
    saveAddress.mockResolvedValue(RESIDENTIAL_ID);
    const { txCalls, state } = installDb();

    const res = await POST(
      request(
        baseBody({
          structured_address: formValue({
            streetRoad: RESIDENTIAL_STREET,
            postalCode: "4026",
          }),
        })
      )
    );

    expect(res.status).toBe(201);
    expect(state.committed).toBe(true);
    expect(saveAddress).toHaveBeenCalledTimes(1);

    // Not just "it saved": the code the operator picked is the one that reached
    // `saveAddress`. A server that defaulted past a key it failed to read would
    // still return a 201 with the geography half-empty.
    const [saved] = saveAddress.mock.calls[0];
    expect(saved.psgcBarangayCode).toBe(SANTA_ROSA.barangay.code);
    expect(saved.components.barangay).toBe("Balibago");

    const { columns } = columnsOf(findInsert(txCalls, "drivers"));
    expect(columns.address_id).toBe(RESIDENTIAL_ID);
  });
});
