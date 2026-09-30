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
  return new Request("https://fleet.test/api/ai/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  rolledBack = false;
  tx = { query: vi.fn(async () => ({ rows: [{ provider_id: 31, display_name: "Test Provider", model_name: "model-x", api_key: "provider-secret", is_enabled: true }] })) };
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

describe("POST /api/ai/providers", () => {
  it("audits provider creation without storing its API key", async () => {
    const req = request({ display_name: "Test Provider", model_name: "model-x", api_key: "provider-secret" });
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(committed).toBe(true);
    expect(body.api_key).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("provider-secret");
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "create",
      resource: "aiproviders",
      resourceId: 31,
    }));
    expect(JSON.stringify(mocks.writeAuditRequired.mock.calls)).not.toContain("provider-secret");
  });

  it("rolls back provider creation when the required event fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await POST(request({ display_name: "Test Provider", model_name: "model-x" }));

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });
});
