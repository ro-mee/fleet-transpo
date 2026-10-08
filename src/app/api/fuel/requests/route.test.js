import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: state.query,
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/api/utils", () => ({
  AuthError: class AuthError extends Error {},
  requirePermission: vi.fn(async () => ({ user: { role: "fleet_manager" } })),
  requireDriver: vi.fn(),
  parseBody: vi.fn(),
  ok: (data) => Response.json(data),
  err: (message, status = 400) => Response.json({ message }, { status }),
  handleError: (error) => Response.json({ message: error.message }, { status: 500 }),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/fuel/receipt-storage", () => ({
  isOwnedFuelImageUrl: vi.fn(),
  toStoredReceiptRef: vi.fn((value) => value),
  signFuelReceipt: vi.fn(async (row) => row),
  signFuelReceiptList: vi.fn(async (rows) => rows),
}));

const { GET } = await import("./route");

describe("GET /api/fuel/requests receipt state", () => {
  beforeEach(() => {
    state.query.mockReset();
    state.query
      .mockResolvedValueOnce({
        rows: [{
          fuel_request_id: 58,
          status: "Fulfilled",
          active_receipt_count: 0,
          archived_receipt_count: 1,
          active_receipt_statuses: [],
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ pending: 0, approved: 0, rejected: 0, fulfilled: 1 }],
      });
  });

  it("returns active and archived receipt metadata with each permit", async () => {
    const response = await GET(new Request("https://fleet.test/api/fuel/requests"));
    const body = await response.json();
    const requestSql = state.query.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(requestSql).toContain("LEFT JOIN LATERAL");
    expect(requestSql).toContain("AS active_receipt_count");
    expect(requestSql).toContain("AS archived_receipt_count");
    expect(requestSql).toContain("AS active_receipt_statuses");
    expect(body.rows[0]).toMatchObject({
      status: "Fulfilled",
      active_receipt_count: 0,
      archived_receipt_count: 1,
      active_receipt_statuses: [],
    });
  });
});
