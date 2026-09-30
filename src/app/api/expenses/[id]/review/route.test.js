import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  requirePermission: vi.fn(async () => ({ user: { employeeId: 8 } })),
  writeAuditRequired: vi.fn(async () => ({ log_id: 42 })),
}));

vi.mock("@/lib/db", () => ({ withTransaction: mocks.withTransaction }));
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));
vi.mock("@/lib/api/utils", () => ({
  AuthError: class AuthError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  },
  requirePermission: mocks.requirePermission,
  parseBody: (req) => req.json(),
  ok: (value) => Response.json(value),
  err: (message, status) => Response.json({ error: message }, { status }),
  handleError: (error) => Response.json({ error: error.message }, { status: error.status || 500 }),
}));

import { POST } from "./route";

let tx;
let committed;
let rolledBack;
let expenseStatus;

function makeRequest(body) {
  return new Request("https://fleet.test/api/expenses/17/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  rolledBack = false;
  expenseStatus = "Pending";
  tx = {
    query: vi.fn(async (sql) => {
      if (sql.includes("SELECT status FROM expense_records")) return { rows: [{ status: expenseStatus }] };
      if (sql.includes("UPDATE expense_records")) return { rows: [{ id: 17, status: "Approved" }] };
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

describe("POST /api/expenses/[id]/review", () => {
  it("audits the decision in the same transaction", async () => {
    const req = makeRequest({ action: "Approve" });
    const response = await POST(req, { params: Promise.resolve({ id: "17" }) });

    expect(response.status).toBe(200);
    expect(committed).toBe(true);
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, expect.anything(), expect.objectContaining({
      action: "expense_reviewed",
      resourceId: 17,
      oldValues: { status: "Pending" },
      newValues: { decision: "approve", status: "Approved", outcome: "completed" },
    }));
    expect(tx.query).toHaveBeenCalledTimes(2);
  });

  it("rolls back the review when its required audit insert fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await POST(makeRequest({ action: "Approve" }), { params: Promise.resolve({ id: "17" }) });

    expect(response.status).toBe(500);
    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
  });

  it("does not emit another decision for an already reviewed expense", async () => {
    expenseStatus = "Approved";

    const response = await POST(makeRequest({ action: "Reject", review_remarks: "Duplicate" }), { params: Promise.resolve({ id: "17" }) });

    expect(response.status).toBe(409);
    expect(mocks.writeAuditRequired).not.toHaveBeenCalled();
    expect(tx.query).toHaveBeenCalledTimes(1);
    expect(rolledBack).toBe(true);
  });
});
