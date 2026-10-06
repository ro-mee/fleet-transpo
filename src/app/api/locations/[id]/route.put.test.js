import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  requirePermission: vi.fn(),
  parseBody: vi.fn(),
  resolveCoordinates: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction,
}));

vi.mock("@/lib/api/utils", () => ({
  requirePermission: mocks.requirePermission,
  parseBody: mocks.parseBody,
  ok: (data, status = 200) => Response.json(data, { status }),
  err: (message, status = 400) => Response.json({ error: message }, { status }),
  errValidation: (errors) => Response.json({ errors }, { status: 400 }),
  handleError: (error) => Response.json({ error: error.message }, { status: error.status ?? 500 }),
}));

vi.mock("@/lib/locations/coordinates", () => ({
  resolveCoordinates: mocks.resolveCoordinates,
}));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/services/address.service", () => ({ saveAddress: vi.fn(), loadStructuredAddress: vi.fn() }));
vi.mock("@/lib/address/validate-structured", () => ({ resolveStructuredAddress: vi.fn() }));

import { PUT } from "./route";

const SESSION = { user: { role: "admin", employeeId: 1 } };
const EXISTING_CODE = "f902c1ea-6019-46e0-b56d-0b429fae0ee6";
const GENERATED_CODE = "842c8f2f-c30f-4bd2-b2a5-8c89b1d9995a";
const SPOOFED_CODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function locationRow(overrides = {}) {
  return {
    location_id: 17,
    location_code: EXISTING_CODE,
    name: "BGC Terminal",
    address: "8572 Winding Creek Boulevard, Quezon City",
    latitude: 14.6538,
    longitude: 121.0282,
    pickup_radius_m: 150,
    dropoff_radius_m: 150,
    address_id: null,
    created_at: "2026-09-01T00:00:00.000Z",
    is_active: true,
    retired_at: null,
    ...overrides,
  };
}

function request(body) {
  return { url: "http://localhost/api/locations/17", body };
}

function context() {
  return { params: Promise.resolve({ id: "17" }) };
}

function baseBody(overrides = {}) {
  return {
    name: "BGC Terminal",
    latitude: 14.6538,
    longitude: 121.0282,
    location_code: SPOOFED_CODE,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.query.mockReset();
  mocks.withTransaction.mockReset();
  mocks.requirePermission.mockReset().mockResolvedValue(SESSION);
  mocks.parseBody.mockReset().mockImplementation(async (req) => req.body);
  mocks.resolveCoordinates.mockReset().mockImplementation(async (body) => ({
    latitude: Number(body.latitude),
    longitude: Number(body.longitude),
  }));
  mocks.writeAudit.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/locations/[id]", () => {
  it("preserves the code during an in-place edit and never writes a supplied code", async () => {
    const current = locationRow();
    const updated = locationRow({ address: "8572 Winding Creek Boulevard, Quezon City" });
    const tx = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        if (text.includes("LOWER(REGEXP_REPLACE")) return { rows: [] };
        if (text.includes("SELECT COUNT(*)::int")) return { rows: [{ usage_count: 0 }] };
        if (text.includes("UPDATE locations")) return { rows: [updated], rowCount: 1 };
        if (text.includes("FROM locations")) return { rows: [current], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    mocks.withTransaction.mockImplementation(async (callback) => callback(tx));

    const res = await PUT(request(baseBody()), context());
    const body = await res.json();
    const locationReadSql = tx.query.mock.calls.find(([sql]) => String(sql).includes("FROM locations"))[0];
    const updateCall = tx.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE locations"));
    const [updateSql, updateValues] = updateCall;

    expect(res.status).toBe(200);
    expect(body.location_code).toBe(EXISTING_CODE);
    expect(locationReadSql).toMatch(/SELECT location_id, location_code,/i);
    expect(updateSql).toMatch(/RETURNING[\s\S]*\blocation_code\b/i);
    expect(updateSql).not.toMatch(/SET[\s\S]*\blocation_code\s*=/i);
    expect(updateValues).not.toContain(SPOOFED_CODE);
  });

  it("gives a versioned location a database-generated code, not the caller's value", async () => {
    const current = locationRow();
    const replacement = locationRow({
      location_id: 18,
      location_code: GENERATED_CODE,
      latitude: 14.66,
      longitude: 121.04,
    });
    const tx = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        if (text.includes("LOWER(REGEXP_REPLACE")) return { rows: [] };
        if (text.includes("SELECT COUNT(*)::int")) return { rows: [{ usage_count: 1 }] };
        if (text.includes("INSERT INTO locations")) return { rows: [replacement], rowCount: 1 };
        if (text.includes("UPDATE locations")) return { rows: [], rowCount: 1 };
        if (text.includes("FROM locations")) return { rows: [current], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    mocks.withTransaction.mockImplementation(async (callback) => callback(tx));

    const res = await PUT(request(baseBody({ latitude: 14.66, longitude: 121.04 })), context());
    const body = await res.json();
    const [insertSql, insertValues] = tx.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO locations"));

    expect(res.status).toBe(200);
    expect(body.location_code).toBe(GENERATED_CODE);
    expect(body.versioned).toBe(true);
    expect(insertSql).toMatch(/RETURNING[\s\S]*\blocation_code\b/i);
    expect(insertSql).not.toMatch(/INSERT INTO locations\s*\([^)]*\blocation_code\b/i);
    expect(insertValues).not.toContain(SPOOFED_CODE);
  });
});
