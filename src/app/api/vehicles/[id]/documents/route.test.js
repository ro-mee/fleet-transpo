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
  return new Request("https://fleet.test/api/vehicles/29/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  rolledBack = false;
  tx = { query: vi.fn(async () => ({ rows: [{ document_id: 61 }] })) };
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

describe("POST /api/vehicles/[id]/documents", () => {
  const document = {
    document_type: "Insurance",
    document_number: "POLICY-9981",
    file_url: "https://files.example.test/policy.pdf?token=private",
    expiry_date: "2027-04-30",
  };

  it("records the new document and audits only its safe field names", async () => {
    const req = request(document);
    const response = await POST(req, { params: Promise.resolve({ id: "29" }) });

    expect(response.status).toBe(201);
    expect(committed).toBe(true);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "create",
      resource: "vehicledocuments",
      resourceId: 61,
      newValues: {
        vehicle_id: 29,
        changed_fields: ["document_type", "document_number", "file_url", "expiry_date"],
        outcome: "created",
      },
    }));

    const auditPayload = JSON.stringify(mocks.writeAuditRequired.mock.calls);
    expect(auditPayload).not.toContain("POLICY-9981");
    expect(auditPayload).not.toContain("private");
    expect(auditPayload).not.toContain("files.example.test");
  });

  it("rolls back document creation when the required event fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await POST(request(document), { params: Promise.resolve({ id: "29" }) });

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });
});
