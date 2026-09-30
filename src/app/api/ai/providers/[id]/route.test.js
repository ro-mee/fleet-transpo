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
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));

import { PUT } from "./route";

let tx;

function request(body) {
  return new Request("https://fleet.test/api/ai/providers/31", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tx = {
    query: vi.fn(async (sql) => {
      if (sql.includes("SELECT provider_id")) return { rows: [{ provider_id: 31 }] };
      if (sql.includes("UPDATE aiproviders")) return { rows: [{ provider_id: 31, display_name: "Updated", api_key: "updated-provider-secret", is_enabled: true }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
  mocks.withTransaction.mockImplementation((callback) => callback(tx));
});

describe("PUT /api/ai/providers/[id]", () => {
  it("audits field names while keeping the updated secret out of response and event", async () => {
    const req = request({ display_name: "Updated", api_key: "updated-provider-secret" });
    const response = await PUT(req, { params: Promise.resolve({ id: "31" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.api_key).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("updated-provider-secret");
    expect(JSON.stringify(mocks.writeAuditRequired.mock.calls)).not.toContain("updated-provider-secret");
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "update",
      resource: "aiproviders",
      resourceId: 31,
      newValues: expect.objectContaining({ changed_fields: expect.arrayContaining(["display_name", "provider_configuration"]) }),
    }));
  });
});
