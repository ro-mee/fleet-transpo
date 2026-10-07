import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  requirePermission: vi.fn(async () => ({ user: { employeeId: 8 } })),
  writeAudit: vi.fn(async () => null),
  writeAuditRequired: vi.fn(async () => ({ log_id: 1 })),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit, writeAuditRequired: mocks.writeAuditRequired }));

import { GET, POST } from "./route";

let tx;

function request(body) {
  return new Request("https://fleet.test/api/vehicle-categories", {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tx = { query: vi.fn(async () => ({ rows: [{ category_id: 5, category_name: "Shuttle", status: "Active" }] })) };
  mocks.withTransaction.mockImplementation((callback) => callback(tx));
});

describe("vehicle category audit events", () => {
  it("audits a category create in its transaction", async () => {
    const req = request({ category_name: "Shuttle", status: "Active" });
    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "create",
      resource: "vehiclecategories",
      resourceId: 5,
    }));
  });

  it("records one best-effort seed event when a read inserts defaults", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [{ category_id: 5, category_name: "Shuttle", status: "Active" }] });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      action: "system_seed",
      resource: "vehiclecategories",
      newValues: expect.objectContaining({ source: "default_categories", count: 4 }),
    }));
  });
});
