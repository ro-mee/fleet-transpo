import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  requirePermission: vi.fn(async () => ({ user: { employeeId: 8 } })),
  writeAuditRequired: vi.fn(async () => ({ log_id: 1 })),
}));

vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));

import { POST } from "./route";

let tx;
let committed;
let rolledBack;

function request(body) {
  return new Request("https://fleet.test/api/vehicles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  rolledBack = false;
  tx = { query: vi.fn(async () => ({ rows: [{ vehicle_id: 29, vehicle_status: "Available" }] })) };
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
});

describe("POST /api/vehicles", () => {
  const vehicle = {
    plate_number: "ABC-1234",
    vehicle_name: "Toyota Hiace",
    required_license_class: "B",
  };

  it("writes the create event in the vehicle transaction", async () => {
    const req = request(vehicle);
    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(committed).toBe(true);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "create",
      resource: "vehicles",
      resourceId: 29,
      newValues: expect.objectContaining({ changed_fields: expect.arrayContaining(["plate_number", "vehicle_name"]) }),
    }));
  });

  it("rolls back vehicle creation if its audit insert fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await POST(request(vehicle));

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });

  it("writes normalized capability fields for a cargo vehicle", async () => {
    const response = await POST(request({
      ...vehicle,
      fleet_asset_code: "  flt-007 ",
      operational_use: "Cargo",
      cargo_capacity_kg: 1000,
    }));

    expect(response.status).toBe(201);
    const [sql, values] = tx.query.mock.calls[0];
    expect(sql).toMatch(/fleet_asset_code/);
    expect(sql).toMatch(/operational_use/);
    expect(sql).toMatch(/cargo_capacity_kg/);
    expect(values).toContain("FLT-007");
    expect(values).toContain("Cargo");
    expect(values).toContain(1000);
  });

  it.each([
    [{ operational_use: "Shuttle" }, "unknown operational use"],
    [{ operational_use: "Cargo", cargo_capacity_kg: 0 }, "non-positive capacity"],
    [{ operational_use: "Cargo", cargo_capacity_kg: -50 }, "negative capacity"],
    [{ operational_use: "Passenger", cargo_capacity_kg: 500 }, "capacity on a passenger vehicle"],
    [{ commissioning_status: "Ready" }, "client-set commissioning status"],
  ])("rejects %s (%s)", async (patch) => {
    const response = await POST(request({ ...vehicle, ...patch }));

    expect(response.status).toBe(400);
    expect(committed).toBe(false);
  });
});
