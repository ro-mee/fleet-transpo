import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  requireDriver: vi.fn(async () => ({ user: { employeeId: 8, driverId: 4 } })),
  writeAudit: vi.fn(async () => ({ log_id: 1 })),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requireDriver: mocks.requireDriver };
});
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { POST } from "./route";

const submissionId = "9e6b51d4-50f5-4f3d-9dbd-41346e5a11d1";
let tx;
let duplicateRecord;

function request() {
  return new Request("https://fleet.test/api/mobile/expenses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_submission_id: submissionId,
      category: "Toll",
      merchant_name: "North Gate Toll",
      amount: 120,
      currency: "PHP",
      expense_date: "2026-10-01",
      payment_method: "Cash",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  duplicateRecord = null;
  mocks.query.mockResolvedValue({ rows: [{ trip_id: 55, vehicle_id: 33 }] });
  tx = {
    query: vi.fn(async (sql) => {
      if (sql.includes("WHERE client_submission_id = $1") && sql.includes("FROM expense_records")) {
        return { rows: duplicateRecord ? [duplicateRecord] : [] };
      }
      if (sql.includes("FROM expense_receipt_scans")) {
        return { rows: [{ driver_id: 4, ocr_snapshot: { amount: 120 }, receipt_storage_key: "4/receipt.jpg", receipt_sha256: "hash-1" }] };
      }
      if (sql.includes("SELECT id FROM expense_records WHERE receipt_sha256")) return { rows: [] };
      if (sql.includes("SELECT id FROM expense_records")) return { rows: [] };
      if (sql.includes("INSERT INTO expense_records")) return { rows: [{ id: 22, status: "Pending" }] };
      if (sql.includes("UPDATE expense_receipt_scans")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
  mocks.withTransaction.mockImplementation((callback) => callback(tx));
});

describe("POST /api/mobile/expenses audit idempotency", () => {
  it("audits only the first durable submission", async () => {
    const req = request();
    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
    expect(mocks.writeAudit).toHaveBeenCalledWith(req, expect.anything(), expect.objectContaining({
      action: "expense_submitted",
      resource: "expense_records",
      resourceId: 22,
      newValues: { status: "Pending", source: "mobile" },
    }));

    duplicateRecord = { id: 22, status: "Pending" };
    const retry = await POST(request());
    expect(retry.status).toBe(201);
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
  });
});
