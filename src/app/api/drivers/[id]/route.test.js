// API-level tests for PUT /api/drivers/[id] — the edit path's address rules.
//
// THREE THINGS ARE BEING HELD DOWN HERE, and they are the three ways an edit can
// corrupt an address:
//
//   1. A RENAME MUST NOT TOUCH THE ADDRESS. An omitted `structured_address` means
//      "leave the stored text and the registry row alone", not "clear them".
//      This is the same omitted-vs-empty rule PUT /api/locations relies on, and
//      it is why the picker only sends the field when the operator picked one.
//   2. AN EDIT THAT DOES PICK MUST NOT DUPLICATE. The registry is append-only, so
//      a re-pick adds a row and repoints the FK — it never rewrites in place.
//   3. A FAILURE MUST FAIL HARD. An address refusal happens before the driver
//      `UPDATE` is built, so it costs a retry and writes nothing at all. A
//      driver-`UPDATE` failure comes after the address transaction has already
//      committed — one orphaned registry row, and a 500. Not atomicity; the test
//      says which of the two it is rather than flattening them together.
//
// The sibling file `../route.test.js` covers POST's atomicity. These are kept
// apart because the two routes fail differently on purpose, and a reader looking
// for "why does POST roll back and PUT not need to" should find both.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const resolveBarangayChain = vi.fn();
vi.mock("@/lib/geo/psgc", () => ({
  resolveBarangayChain: (...args) => resolveBarangayChain(...args),
}));
vi.mock("@/services/postal-code.service", () => ({
  checkPostalCodeForLocality: vi.fn(async () => ({ status: "unknown", postalCodes: [] })),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("@/services/address.service", () => ({ saveAddress: vi.fn() }));

vi.mock("@/lib/drivers/media", () => ({
  signDriverMedia: vi.fn(async (row) => row),
  toStoredMediaRef: vi.fn((value) => (value === undefined ? undefined : value ?? null)),
}));

// Not part of the address path; stubbed only so the route can run to completion.
vi.mock("@/services/status.service", () => ({ syncDriverStatus: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(async () => {}),
  writeAuditRequired: vi.fn(async () => ({ log_id: 1 })),
}));
vi.mock("@/lib/drivers/compliance", () => ({
  suspensionAction: vi.fn(() => ({ action: "none" })),
}));

import { GET, PUT } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import { saveAddress } from "@/services/address.service";
import { writeAudit, writeAuditRequired } from "@/lib/audit";

const SANTA_ROSA = {
  region: { code: "0400000000", name: "CALABARZON (Region IV-A)" },
  province: { code: "0434000000", name: "Laguna" },
  city: { code: "0434040000", name: "Santa Rosa City" },
  barangay: { code: "043404001", name: "Balibago" },
};

const DRIVER_ID = 7;
const RESIDENTIAL_ID = 11;
const EMERGENCY_ID = 12;

/** The two streets. See `isEmergencyPick` for why these are what tell the picks apart. */
const RESIDENTIAL_STREET = "Winding Creek Boulevard";
const EMERGENCY_STREET = "Balibago Road";

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
 * Tell the two picks apart inside `saveAddress`.
 *
 * NOT by `psgcBarangayCode`: that is the one the route RESOLVED, not the one the
 * client sent, so the mock's single fixed chain collapses both picks onto the
 * same code and a mock keyed on it would hand the residential id to the
 * emergency column. The street survives resolution.
 */
const isEmergencyPick = (value) =>
  String(value?.formattedAddress ?? "").includes(EMERGENCY_STREET);

/**
 * Install the `query` and `withTransaction` doubles.
 *
 * `driverUpdates` collects every `UPDATE drivers SET …` the route issues, which
 * is where "did this edit touch the address ids?" is answered.
 */
function installDb({ failOn } = {}) {
  const driverUpdates = [];
  const employeeUpdates = [];
  const state = { committed: false, rolledBack: false };
  let txQuery;

  db.query.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes("ALTER TABLE drivers")) return { rows: [], rowCount: 0 };
    // The existing-driver lookup, before anything is written.
    if (text.includes("d.employee_id, e.email")) {
      return {
        rows: [{
          driver_id: DRIVER_ID,
          employee_id: 55,
          email: "juan@fleetops.ph",
          employee_first_name: "Juan",
          employee_last_name: "Dela Cruz",
          employee_phone: null,
          employee_position: "Driver",
          employee_avatar_url: null,
          license_number: "N04-19-013583",
          driver_status: "Available",
          years_of_experience: 0,
          address: null,
          license_expiry: "2031-09-20",
          license_image_url: null,
          license_back_image_url: null,
          sex: null,
          license_class: "B",
          license_type: "Professional",
          birthdate: null,
          nationality: null,
          emergency_contact_name: null,
          emergency_contact_phone: null,
          emergency_contact_address: null,
          address_id: null,
          emergency_contact_address_id: null,
          license_verified_at: "2026-09-27T10:00:00+08:00",
          license_verified_by: 9,
          license_verification_method: "physical_card",
        }],
        rowCount: 1,
      };
    }
    // The reinstatement probe (only on an edit with no explicit driver_status).
    if (text.includes("suspension_reason")) {
      return {
        rows: [
          {
            driver_status: "Available",
            suspension_reason: null,
            license_expiry: null,
            name: "Juan Dela Cruz",
          },
        ],
        rowCount: 1,
      };
    }
    if (text.includes("UPDATE employees SET")) {
      employeeUpdates.push({ sql: text, params });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("UPDATE drivers SET")) {
      if (failOn && failOn(text)) {
        const err = new Error("simulated driver update failure");
        if (failOn.code) err.code = failOn.code;
        throw err;
      }
      driverUpdates.push({ sql: text, params });
      const assignments = text.match(/UPDATE drivers SET ([\s\S]*?) WHERE/)?.[1] || "";
      const updated = { sex: null, license_class: "B", license_type: "Professional" };
      assignments
        .split(",")
        .map((assignment) => assignment.trim())
        .filter(Boolean)
        .forEach((assignment, index) => {
          const column = assignment.split("=")[0].trim();
          if (Object.hasOwn(updated, column)) updated[column] = params[index];
        });
      return { rows: [{ sex: updated.sex, license_class: updated.license_class, license_type: updated.license_type }], rowCount: 1 };
    }
    // The response SELECT.
    return { rows: [{ driver_id: DRIVER_ID, first_name: "Juan" }], rowCount: 1 };
  });

  db.withTransaction.mockImplementation(async (fn) => {
    txQuery = vi.fn(async (sql, params) => {
      if (String(sql).includes("set_config('statement_timeout'")) return { rows: [], rowCount: 0 };
      if (String(sql).includes("INSERT INTO audit_logs")) return { rows: [{ log_id: 1 }], rowCount: 1 };
      return db.query(sql, params);
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

  return { driverUpdates, employeeUpdates, state };
}

/** The last `UPDATE drivers SET …` as a column→value map. */
function lastDriverUpdate(driverUpdates) {
  const call = driverUpdates[driverUpdates.length - 1];
  if (!call) return null;
  const match = call.sql.match(/UPDATE drivers SET ([\s\S]*?) WHERE/);
  if (!match) return null;
  const columns = {};
  match[1]
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .forEach((assignment, i) => {
      const name = assignment.split("=")[0].trim();
      columns[name] = call.params[i];
    });
  return columns;
}

const request = (body) => ({ json: async () => body });
const context = () => ({ params: Promise.resolve({ id: String(DRIVER_ID) }) });

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

describe("PUT /api/drivers/[id] — an edit that does not touch the address", () => {
  it("leaves the address ids and both text columns out of the UPDATE entirely", async () => {
    // The load-bearing rule. If a rename wrote `address_id: null` — or wrote the
    // id back by reading it from somewhere — an operator editing a phone number
    // would silently detach a driver's home from the registry.
    const { driverUpdates } = installDb();

    const res = await PUT(request({ first_name: "Juana", sex: "M" }), context());

    expect(res.status).toBe(200);
    // The field edit and audit still share a transaction; no address row is made.
    expect(db.withTransaction).toHaveBeenCalledTimes(1);
    expect(saveAddress).not.toHaveBeenCalled();

    const columns = lastDriverUpdate(driverUpdates);
    expect(columns).not.toBeNull();
    expect(columns).not.toHaveProperty("address_id");
    expect(columns).not.toHaveProperty("emergency_contact_address_id");
    expect(columns).not.toHaveProperty("address");
    expect(columns).not.toHaveProperty("emergency_contact_address");
  });

  it("does not write anything address-shaped for a plain text edit either", async () => {
    // A legacy free-text address still on the form is not a pick, so it must not
    // create a registry row — the same as before the migration.
    const { driverUpdates } = installDb();

    await PUT(request({ address: "12 Mabini St, Manila" }), context());

    expect(saveAddress).not.toHaveBeenCalled();
    const columns = lastDriverUpdate(driverUpdates);
    expect(columns.address).toBe("12 Mabini St, Manila");
    expect(columns).not.toHaveProperty("address_id");
  });
});

describe("GET /api/drivers/[id] — full license access", () => {
  it("requires drivers.update when the editor requests the full license number", async () => {
    const permissionSpy = vi.spyOn(utils, "requirePermission");
    permissionSpy
      .mockResolvedValueOnce({ user: { role: "dispatcher", employeeId: 4 } })
      .mockRejectedValueOnce(new utils.AuthError("Forbidden", 403));
    const querySpy = vi.spyOn(db, "query");

    const response = await GET(new Request(`http://localhost/api/drivers/${DRIVER_ID}?include_license=1`), context());

    expect(response.status).toBe(403);
    expect(permissionSpy).toHaveBeenNthCalledWith(1, expect.anything(), "drivers", "read_all");
    expect(permissionSpy).toHaveBeenNthCalledWith(2, expect.anything(), "drivers", "update");
    expect(querySpy.mock.calls.some(([sql]) => String(sql).includes("FROM drivers"))).toBe(false);
  });
});

describe("PUT /api/drivers/[id] — license verification invalidation", () => {
  it("keeps staff review when an unchanged PostgreSQL DATE is submitted", async () => {
    const { driverUpdates } = installDb();
    const originalQuery = db.query.getMockImplementation();
    db.query.mockImplementation((sql, params) => {
      if (String(sql).includes("d.employee_id, e.email")) {
        return Promise.resolve({
          rows: [{
            driver_id: DRIVER_ID,
            employee_id: 55,
            email: "juan@fleetops.ph",
            license_number: "N04-19-013583",
            license_expiry: String(sql).includes("d.license_expiry::text")
              ? "2031-09-20"
              : new Date(2031, 8, 20),
            license_type: "Professional",
            license_class: "B",
            license_image_url: null,
            license_back_image_url: null,
          }],
          rowCount: 1,
        });
      }
      return originalQuery(sql, params);
    });

    const response = await PUT(request({
      license_number: "N04-19-013583",
      license_expiry: "2031-09-20",
      license_type: "Professional",
      license_class: "B",
      sex: "M",
    }), context());

    expect(response.status).toBe(200);
    expect(lastDriverUpdate(driverUpdates)).not.toHaveProperty("license_verified_at");
    expect(writeAuditRequired).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ user: expect.objectContaining({ employeeId: 1 }) }),
      expect.objectContaining({
        action: "update",
        resource: "drivers",
        resourceId: 7,
        newValues: expect.objectContaining({ verification_cleared: false }),
      })
    );
  });

  it("clears verification when license details change and audits field names without license values", async () => {
    const { driverUpdates } = installDb();
    const response = await PUT(request({
      license_number: "N04-19-013583",
      license_expiry: "2030-01-01",
      license_type: "Professional",
      license_class: "B1",
    }), context());

    expect(response.status).toBe(200);
    expect(lastDriverUpdate(driverUpdates)).toMatchObject({
      license_verified_at: null,
      license_verified_by: null,
      license_verification_method: null,
    });
    expect(JSON.stringify(writeAuditRequired.mock.calls)).toContain('"license_expiry"');
    expect(JSON.stringify(writeAuditRequired.mock.calls)).not.toContain('"license_number"');
    expect(JSON.stringify(writeAuditRequired.mock.calls)).not.toContain("********3583");
    expect(JSON.stringify(writeAuditRequired.mock.calls)).not.toContain("N04-19-013583");
  });
});

describe("PUT /api/drivers/[id] — an edit that does pick", () => {
  it("appends a registry row and repoints the FK without touching the other address", async () => {
    saveAddress.mockResolvedValue(RESIDENTIAL_ID);
    const { driverUpdates, state } = installDb();

    const res = await PUT(request({ structured_address: RESIDENTIAL_PICK }), context());

    expect(res.status).toBe(200);
    expect(state.committed).toBe(true);
    expect(saveAddress).toHaveBeenCalledTimes(1);

    const columns = lastDriverUpdate(driverUpdates);
    expect(columns.address_id).toBe(RESIDENTIAL_ID);
    // Only the column whose field was picked. Setting the emergency id to null
    // here would clear an address the operator never touched.
    expect(columns).not.toHaveProperty("emergency_contact_address_id");
  });

  it("writes both ids in one transaction when both are picked", async () => {
    saveAddress.mockImplementation(async (value) => (isEmergencyPick(value) ? EMERGENCY_ID : RESIDENTIAL_ID));
    const { driverUpdates, state } = installDb();

    const res = await PUT(
      request({
        structured_address: RESIDENTIAL_PICK,
        emergency_structured_address: EMERGENCY_PICK,
      }),
      context()
    );

    expect(res.status).toBe(200);
    expect(state.committed).toBe(true);
    expect(saveAddress).toHaveBeenCalledTimes(2);

    const columns = lastDriverUpdate(driverUpdates);
    expect(columns.address_id).toBe(RESIDENTIAL_ID);
    expect(columns.emergency_contact_address_id).toBe(EMERGENCY_ID);
  });
});

describe("PUT /api/drivers/[id] — a failure fails hard", () => {
  it("rolls back the driver edit when its required audit event fails", async () => {
    const { driverUpdates, state } = installDb();
    writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await PUT(request({ first_name: "Juana", sex: "M" }), context());

    expect(response.status).toBe(500);
    expect(driverUpdates).toHaveLength(1);
    expect(state.rolledBack).toBe(true);
  });

  it("returns a failure and updates no driver row when the address write fails", async () => {
    // Nothing is committed yet when the registry write runs, so there is no
    // partial state to compensate for — but ONLY because the addresses are saved
    // before the driver UPDATE. This asserts that ordering.
    saveAddress.mockRejectedValue(new Error("address registry unavailable"));
    const { driverUpdates, state } = installDb();

    const res = await PUT(request({ structured_address: RESIDENTIAL_PICK }), context());

    expect(res.status).toBe(500);
    expect(state.committed).toBe(false);
    expect(state.rolledBack).toBe(true);
    expect(driverUpdates).toHaveLength(0);
  });

  it("propagates a driver UPDATE failure rather than reporting success", async () => {
    // The address transaction has ALREADY COMMITTED when the driver UPDATE runs
    // — that UPDATE is a plain `query`, outside the transaction — so this
    // failure leaves an orphaned registry row behind. Harmless, because the
    // registry is append-only and nothing joins it by value, but it is not
    // atomicity and this test does not claim it is. What it does hold down is
    // that the operator is told: a failure, never a success.
    saveAddress.mockResolvedValue(RESIDENTIAL_ID);
    const failOn = () => true;
    failOn.code = "23503";
    const { state, driverUpdates } = installDb({ failOn });

    const res = await PUT(request({ structured_address: RESIDENTIAL_PICK }), context());

    expect(res.status).toBe(500);
    expect(state.committed).toBe(false);
    expect(state.rolledBack).toBe(true);
    expect(saveAddress).toHaveBeenCalledTimes(1);
    expect(driverUpdates).toHaveLength(0);
  });

  it("refuses a half coordinate pair before writing anything", async () => {
    const { driverUpdates } = installDb();

    const res = await PUT(
      request({ structured_address: pick({ latitude: 14.5097, longitude: null }) }),
      context()
    );

    expect(res.status).toBe(400);
    expect((await res.json()).errors["structured_address"]).toMatch(/together/);
    expect(saveAddress).not.toHaveBeenCalled();
    expect(driverUpdates).toHaveLength(0);
  });

  it("namespaces a refusal to the emergency field when that is the one that failed", async () => {
    // A driver carries two addresses; an unprefixed key could not say which.
    const { driverUpdates } = installDb();

    const res = await PUT(
      request({
        structured_address: RESIDENTIAL_PICK,
        emergency_structured_address: pick({ postalCode: "" }),
      }),
      context()
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.errors).some((k) => k.startsWith("emergency_structured_address."))).toBe(
      true
    );
    expect(saveAddress).not.toHaveBeenCalled();
    expect(driverUpdates).toHaveLength(0);
  });
});
