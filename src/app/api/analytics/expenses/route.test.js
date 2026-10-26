import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({
  requireAuth: vi.fn(),
  // The real `ok` serializes the payload bare (see responseJson in utils) —
  // the stub must match that contract or it validates nothing.
  ok: value => Response.json(value),
  handleError: error => Response.json({ error: error.message }, { status: error.status || 500 }),
}));
import { query } from "@/lib/db";
import { requireAuth } from "@/lib/api/utils";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation(async sql => {
    expect(sql).toContain("status = 'Approved'");
    if (sql.includes("GROUP BY 1")) return { rows: [{ currency: "USD", count: "1", amount: "10" }] };
    const phpOnly = sql.includes("UPPER(BTRIM(currency)) = 'PHP'");
    if (sql.includes("as month")) return { rows: [{ month: "2026-10", category: "Toll", total_amount: phpOnly ? "40" : "50" }] };
    return { rows: [{ total_approved_expenses: phpOnly ? "40" : "50" }] };
  });
});

it("keeps monthly categories and the PHP total separate from other approved currencies", async () => {
  const res = await GET(new Request("http://localhost/api/analytics/expenses"));
  expect(await res.json()).toEqual({ monthly_breakdown: [{ month: "2026-10", category: "Toll", total_amount: "40" }], total_approved: 40, currency: "PHP", excludedExpenseCurrencies: [{ currency: "USD", count: 1, amount: 10 }] });
});

it("does not read expenses when authorization fails", async () => {
  requireAuth.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
  expect((await GET(new Request("http://localhost/api/analytics/expenses"))).status).toBe(403);
  expect(query).not.toHaveBeenCalled();
});
