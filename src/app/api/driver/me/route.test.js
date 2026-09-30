import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
  withTransaction: vi.fn(),
  requireDriver: vi.fn(async () => ({ user: { employeeId: 8, driverId: 4 } })),
  writeAuditRequired: vi.fn(async () => ({ log_id: 1 })),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, transaction: vi.fn(), withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requireDriver: mocks.requireDriver };
});
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));
vi.mock("@/services/status.service", () => ({ syncDriverStatus: vi.fn() }));

import { PATCH } from "./route";

let tx;
let committed;
let rolledBack;

function request(body) {
  return new Request("https://fleet.test/api/driver/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  rolledBack = false;
  tx = {
    query: vi.fn(async (sql) => {
      if (sql.includes("SELECT d.driver_id")) return { rows: [{ driver_id: 4, employee_id: 3 }] };
      return { rows: [] };
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
});

describe("PATCH /api/driver/me", () => {
  it("records changed profile fields without storing their values", async () => {
    const req = request({ phone: "09171234567" });
    const response = await PATCH(req);

    expect(response.status).toBe(200);
    expect(committed).toBe(true);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "driver_self_profile_updated",
      resource: "drivers",
      resourceId: 4,
      newValues: expect.objectContaining({ changed_fields: ["phone"], channel: "self_service" }),
    }));
    expect(JSON.stringify(mocks.writeAuditRequired.mock.calls)).not.toContain("09171234567");
  });

  it("rolls back a self-service profile update when audit storage fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await PATCH(request({ phone: "09171234567" }));

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });
});
