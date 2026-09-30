import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  writeAuditRequired: vi.fn(async () => ({ log_id: 52 })),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));

import { reviewLeaveRequest } from "./driver-schedule.service";

let tx;
let committed;
let rolledBack;
let requestStatus;

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  rolledBack = false;
  requestStatus = "Pending";
  tx = {
    query: vi.fn(async (sql) => {
      if (sql.includes("SELECT driver_id, start_date")) {
        return { rows: [{ driver_id: 4, start_date: "2026-10-05", end_date: "2026-10-06", leave_type: "Vacation", status: requestStatus }] };
      }
      if (sql.includes("SELECT leave_request_id FROM driver_leave_requests")) return { rows: [] };
      if (sql.includes("UPDATE driver_leave_requests")) return { rows: [{ leave_request_id: 12, status: "Approved" }] };
      if (sql.includes("UPDATE driver_leave_balances") || sql.includes("UPDATE dispatchschedules")) return { rows: [] };
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

describe("reviewLeaveRequest", () => {
  it("locks a pending request and audits approval in the same transaction", async () => {
    const req = new Request("https://fleet.test/api/driver-leave-requests/12");
    const session = { user: { employeeId: 8 } };
    const result = await reviewLeaveRequest(12, "Approved", 8, null, { req, session });

    expect(result.status).toBe("Approved");
    expect(committed).toBe(true);
    expect(tx.query.mock.calls[0][0]).toContain("FOR UPDATE");
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(tx, req, session, expect.objectContaining({
      action: "leave_request_reviewed",
      resourceId: 12,
      oldValues: { status: "Pending" },
      newValues: { status: "Approved", decision: "approve", leave_request_id: 12 },
    }));
  });

  it("rolls back the approval and balance changes when auditing fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(reviewLeaveRequest(12, "Approved", 8, null, {
      req: new Request("https://fleet.test/api/driver-leave-requests/12"),
      session: { user: { employeeId: 8 } },
    })).rejects.toThrow("audit unavailable");

    expect(rolledBack).toBe(true);
    expect(committed).toBe(false);
    expect(tx.query.mock.calls.some(([sql]) => sql.includes("UPDATE driver_leave_balances"))).toBe(true);
  });

  it("rejects repeat review without deducting leave again", async () => {
    requestStatus = "Approved";

    await expect(reviewLeaveRequest(12, "Approved", 8)).rejects.toMatchObject({ status: 409 });

    expect(tx.query).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditRequired).not.toHaveBeenCalled();
    expect(rolledBack).toBe(true);
  });
});
