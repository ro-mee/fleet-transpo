import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [{ receipt_storage_key: "private/receipt.png" }] })), sign: vi.fn(async () => "https://signed.test/receipt") }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/expenses/receipt-storage", () => ({ getExpenseReceiptSignedUrl: mocks.sign }));
vi.mock("@/lib/api/utils", () => ({
  requireAuth: async () => ({}), requirePermission: async () => ({}),
  ok: (data) => Response.json(data),
  err: (error, status) => Response.json({ error }, { status }),
  handleError: () => Response.json({}, { status: 500 }),
}));
import { GET } from "./route";
describe("expense receipt route", () => {
  it("resolves promised route parameters before looking up private evidence", async () => {
    const response = await GET(new Request("https://fleet.test/api/expenses/17/receipt"), { params: Promise.resolve({ id: "17" }) });
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), [17]);
    expect(await response.json()).toEqual({ url: "https://signed.test/receipt" });
  });
});
