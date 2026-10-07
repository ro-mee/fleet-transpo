import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  requirePermission: vi.fn(async () => ({ user: { employeeId: 8 } })),
  writeAuditRequired: vi.fn(async () => ({ log_id: 1 })),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
  writeAuditRequired: mocks.writeAuditRequired,
}));

import { DELETE } from "./route";

let tx;
let committed;
let rolledBack;

function request() {
  return new Request("https://fleet.test/api/fuel/41", { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  rolledBack = false;
  tx = {
    query: vi.fn(async (sql) => {
      if (sql.includes("SELECT fuel_record_id, status, fuel_request_id")) {
        return { rows: [{ fuel_record_id: 41, status: "Approved", fuel_request_id: 58 }] };
      }
      if (sql.includes("UPDATE fuelrecords")) return { rows: [{ fuel_record_id: 41 }] };
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
});

describe("DELETE /api/fuel/[id] archive audit", () => {
  it("archives and records a required audit event in the same transaction", async () => {
    const req = request();
    const response = await DELETE(req, { params: Promise.resolve({ id: "41" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Fuel record archived successfully");
    expect(committed).toBe(true);
    expect(tx.query.mock.calls[0][0]).toContain("FOR UPDATE");
    expect(tx.query.mock.calls[1][0]).toContain("deleted_at IS NULL");
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "delete",
      resource: "fuelrecords",
      resourceId: 41,
      oldValues: { status: "Approved", fuel_request_id: 58 },
      newValues: { deleted_at: true, outcome: "archived" },
    }));
  });

  it("rolls back the archive if its audit event cannot be written", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await DELETE(request(), { params: Promise.resolve({ id: "41" }) });

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });

  it("returns not found without writing an event for an already archived record", async () => {
    tx.query.mockResolvedValueOnce({ rows: [] });

    const response = await DELETE(request(), { params: Promise.resolve({ id: "41" }) });

    expect(response.status).toBe(404);
    expect(mocks.writeAuditRequired).not.toHaveBeenCalled();
  });
});
