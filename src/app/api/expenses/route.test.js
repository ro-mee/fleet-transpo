import { beforeEach, describe, expect, it, vi } from "vitest";
import { rolesFor } from "@/lib/auth/permissions";

const mocks = vi.hoisted(() => ({ query: vi.fn(), role: "admin", requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/api/utils", () => ({
  requireAuth: mocks.requireAuth,
  requirePermission: (req, resource, action) => mocks.requireAuth(req, rolesFor(resource, action)),
  ok: (data) => Response.json(data),
  err: (error, status) => Response.json({ error }, { status }),
  handleError: (error) => Response.json({ error: error.message }, { status: error.status || 500 }),
}));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "admin";
  mocks.requireAuth.mockImplementation(async (_req, allowed) => {
    if (!allowed.includes(mocks.role)) throw Object.assign(new Error("Forbidden"), { status: 403 });
    return { user: { role: mocks.role } };
  });
  mocks.query.mockImplementation(async (sql) => {
    if (sql.includes("filtered_total")) return { rows: [{ filtered_total: "23" }] };
    if (sql.includes("approved_cost")) return { rows: [{ total: "23", pending: "23", approved: "0", rejected: "0", approved_cost: "0" }] };
    return { rows: [] };
  });
});

const request = (search = "") => new Request(`https://fleet.test/api/expenses${search}`);
const listQuery = () => mocks.query.mock.calls.find(([sql]) => sql.includes("LIMIT"));

describe("expense registry read contract", () => {
  it("selects only display identity fields from employee joins", async () => {
    expect((await GET(request())).status).toBe(200);
    const [sql] = listQuery();
    expect(sql).not.toMatch(/row_to_json\((?:emp|rev)\.\*\)/);
    expect(sql).toContain("'first_name', emp.first_name");
    expect(sql).toContain("'last_name', rev.last_name");
    expect(sql).not.toContain("password_hash");
  });

  it("applies sorting and pagination to the filtered query with a stable tie-breaker", async () => {
    await GET(request("?page=2&pageSize=10&status=Approved&search=van&sort=amount&sortDir=asc"));
    const [sql, params] = listQuery();
    expect(sql).toMatch(/ORDER BY e\.amount ASC(?: NULLS LAST)?, e\.id DESC/);
    expect(params).toEqual(["Approved", "%van%", 10, 10]);
  });

  it("never inserts an unrecognized sort expression into SQL", async () => {
    await GET(request("?sort=amount%3BDROP%20TABLE%20employees&sortDir=desc%3BSELECT"));
    expect(listQuery()[0]).toMatch(/ORDER BY e\.created_at DESC, e\.id DESC/);
    expect(listQuery()[0]).not.toContain("DROP TABLE");
  });

  it("does not treat inherited object keys as allowed sort columns", async () => {
    await GET(request("?sort=constructor&sortDir=asc"));
    expect(listQuery()[0]).toMatch(/ORDER BY e\.created_at DESC, e\.id DESC/);
  });

  it("keeps foreign-currency expenses out of the PHP summary", async () => {
    await GET(request());
    const [sql] = mocks.query.mock.calls.find(([sql]) => sql.includes("approved_cost"));
    expect(sql).toMatch(/SUM\(e\.amount\) FILTER \(WHERE e\.status = 'Approved' AND UPPER\(TRIM\(e\.currency\)\) = 'PHP'\)/);
    expect(sql).toContain("approved_other_currency");
  });

  it("rejects malformed pagination before querying", async () => {
    expect((await GET(request("?page=abc&pageSize=NaN"))).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each(["super_admin", "admin", "fleet_manager", "management"])("allows the documented %s read role", async (role) => {
    mocks.role = role;
    expect((await GET(request())).status).toBe(200);
  });

  it.each(["dispatcher", "driver", "mechanic"])("denies %s before reading financial data", async (role) => {
    mocks.role = role;
    expect((await GET(request())).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
