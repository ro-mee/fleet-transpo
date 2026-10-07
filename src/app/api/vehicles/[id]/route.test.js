import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  requirePermission: vi.fn(async () => ({ user: { employeeId: 8 } })),
  writeAuditRequired: vi.fn(async () => ({ log_id: 1 })),
  syncVehicleStatus: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));
vi.mock("@/services/status.service", () => ({ syncVehicleStatus: mocks.syncVehicleStatus }));

import { DELETE, PUT } from "./route";

let tx;
let committed;
let rolledBack;

function request(method, body) {
  return new Request("https://fleet.test/api/vehicles/29", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  rolledBack = false;
  tx = {
    query: vi.fn(async (sql) => {
      if (sql.includes("SELECT vehicle_status")) return { rows: [{ vehicle_status: "Available" }] };
      if (sql.includes("UPDATE vehicles")) return { rows: [{ vehicle_id: 29, vehicle_status: "Available" }] };
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
  mocks.withTransaction.mockImplementation(async (callback) => {
    try {
      const result = await callback(tx);
      committed = true;
      return result;
    } catch (error) {
      rolledBack = true;
      throw error;
    }
  });
  mocks.query.mockResolvedValue({ rows: [{ vehicle_id: 29, vehicle_status: "Available" }] });
});

describe("vehicle update and archive audit events", () => {
  it("audits a successful update with field names only", async () => {
    const req = request("PUT", {
      plate_number: "ABC-1234",
      vehicle_name: "Toyota Hiace",
      required_license_class: "B",
      vehicle_status: "Available",
    });
    const response = await PUT(req, { params: Promise.resolve({ id: "29" }) });

    expect(response.status).toBe(200);
    expect(committed).toBe(true);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "update",
      resource: "vehicles",
      resourceId: 29,
      newValues: expect.objectContaining({ changed_fields: expect.arrayContaining(["plate_number", "vehicle_name"]) }),
    }));
  });

  it("rolls back an archive if its required event fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await DELETE(request("DELETE"), { params: Promise.resolve({ id: "29" }) });

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });

  it("writes capability fields on update but never commissioning status", async () => {
    const okReq = request("PUT", {
      plate_number: "ABC-1234",
      vehicle_name: "Isuzu Elf",
      required_license_class: "B",
      fleet_asset_code: "flt-008",
      operational_use: "Cargo",
      cargo_capacity_kg: 1500,
    });
    const okRes = await PUT(okReq, { params: Promise.resolve({ id: "29" }) });
    expect(okRes.status).toBe(200);
    const updateCall = tx.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE vehicles SET"));
    expect(updateCall[0]).toMatch(/fleet_asset_code/);
    expect(updateCall[1]).toContain("FLT-008");

    const badReq = request("PUT", {
      plate_number: "ABC-1234",
      vehicle_name: "Isuzu Elf",
      required_license_class: "B",
      commissioning_status: "Ready",
    });
    const badRes = await PUT(badReq, { params: Promise.resolve({ id: "29" }) });
    expect(badRes.status).toBe(400);
  });
});
