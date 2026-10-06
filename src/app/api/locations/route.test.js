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

vi.mock("@/lib/auth/permissions", () => ({ rolesFor: () => ["admin"] }));
vi.mock("@/lib/locations/coordinates", () => ({
  resolveCoordinates: mocks.resolveCoordinates,
}));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/services/address.service", () => ({ saveAddress: vi.fn() }));
vi.mock("@/lib/address/validate-structured", () => ({ resolveStructuredAddress: vi.fn() }));

import { GET, POST } from "./route";

const SESSION = { user: { role: "admin", employeeId: 1 } };
const LOCATION_CODE = "f902c1ea-6019-46e0-b56d-0b429fae0ee6";
const GENERATED_CODE = "842c8f2f-c30f-4bd2-b2a5-8c89b1d9995a";
const SPOOFED_CODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function locationRow(overrides = {}) {
  return {
    location_id: 17,
    location_code: LOCATION_CODE,
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
  return { url: "http://localhost/api/locations", body };
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

describe("GET /api/locations", () => {
  it("projects the stable code for each visible location", async () => {
    mocks.query.mockResolvedValue({ rows: [locationRow()] });

    const res = await GET(request());
    const body = await res.json();
    const [sql] = mocks.query.mock.calls[0];

    expect(res.status).toBe(200);
    expect(body[0].location_code).toBe(LOCATION_CODE);
    expect(sql).toMatch(/SELECT location_id, location_code,/i);
  });
});

describe("POST /api/locations", () => {
  it("ignores a client-supplied code and returns the database-generated code", async () => {
    const created = locationRow({ location_code: GENERATED_CODE });
    const tx = {
      query: vi.fn(async (sql) => {
        if (String(sql).includes("INSERT INTO locations")) return { rows: [created], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    mocks.withTransaction.mockImplementation(async (callback) => callback(tx));

    const res = await POST(request({
      name: "BGC Terminal",
      address: "8572 Winding Creek Boulevard, Quezon City",
      latitude: 14.6538,
      longitude: 121.0282,
      location_code: SPOOFED_CODE,
    }));
    const body = await res.json();
    const [insertSql, insertValues] = tx.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO locations"));

    expect(res.status).toBe(201);
    expect(body.location_code).toBe(GENERATED_CODE);
    expect(insertSql).toMatch(/RETURNING[\s\S]*\blocation_code\b/i);
    expect(insertSql).not.toMatch(/INSERT INTO locations\s*\([^)]*\blocation_code\b/i);
    expect(insertValues).not.toContain(SPOOFED_CODE);
  });
});
