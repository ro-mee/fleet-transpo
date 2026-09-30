import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  requirePermission: vi.fn(async () => ({ user: { employeeId: 8 } })),
  writeAuditRequired: vi.fn(async () => ({ log_id: 1 })),
}));

vi.mock("@/lib/db", () => ({ withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));

import { DELETE, PUT } from "./route";

let tx;

function request(method, body) {
  return new Request("https://fleet.test/api/vehicle-categories/5", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tx = {
    query: vi.fn(async (sql) => {
      if (sql.includes("SELECT status")) return { rows: [{ status: "Active" }] };
      if (sql.includes("UPDATE vehiclecategories")) return { rows: [{ category_id: 5, status: "Inactive" }] };
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
  mocks.withTransaction.mockImplementation((callback) => callback(tx));
});

describe("vehicle category update and archive events", () => {
  it("audits a category edit in the same transaction", async () => {
    const req = request("PUT", { category_name: "Executive Shuttle" });
    const response = await PUT(req, { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(200);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "update",
      resource: "vehiclecategories",
      resourceId: 5,
      newValues: expect.objectContaining({ changed_fields: ["category_name"] }),
    }));
  });

  it("audits archive as a delete event", async () => {
    const req = request("DELETE");
    const response = await DELETE(req, { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(200);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "delete",
      resource: "vehiclecategories",
      resourceId: 5,
      newValues: expect.objectContaining({ status: "Inactive", outcome: "archived" }),
    }));
  });
});
