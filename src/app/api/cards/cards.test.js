import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), txQuery: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", () => ({
  requireAuth: async () => ({ user: { employeeId: 7 } }),
  parseBody: (req) => req.json(),
  ok: (data, status = 200) => Response.json(data, { status }),
  err: (error, status) => Response.json({ error }, { status }),
  handleError: (error) => Response.json({ error: error.message }, { status: error.status || 500 }),
}));
import { GET as listCards } from "./route";
import { GET as assignments, POST as assignCard } from "./[id]/assignments/route";
import { PATCH } from "./[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [{ id: 1 }] });
  mocks.txQuery.mockResolvedValue({ rows: [{ id: 1 }] });
  mocks.withTransaction.mockImplementation((callback) => callback({ query: mocks.txQuery }));
});
const req = (method = "GET", body) => new Request("https://fleet.test/api/cards/1", {
  method,
  ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
});
const context = () => ({ params: Promise.resolve({ id: "1" }) });

describe("company card employee privacy and route parameters", () => {
  it("never selects full employee records for the card registry", async () => {
    expect((await listCards(req())).status).toBe(200);
    const sql = mocks.query.mock.calls[0][0];
    expect(sql).not.toMatch(/row_to_json\(e\.\*\)/);
    expect(sql).toContain("'first_name', e.first_name");
  });
  it("loads history with awaited parameters and safe employee/assigner projections", async () => {
    expect((await assignments(req(), context())).status).toBe(200);
    const [sql, values] = mocks.query.mock.calls[0];
    expect(values).toEqual([1]);
    expect(sql).not.toMatch(/row_to_json\((?:e|assigner)\.\*\)/);
    expect(sql).toContain("'last_name', assigner.last_name");
  });
  it("updates the intended card when Next supplies promised parameters", async () => {
    expect((await PATCH(req("PATCH", { card_label: "Fleet card" }), context())).status).toBe(200);
    expect(mocks.query.mock.calls[0][1]).toEqual(["Fleet card", 1]);
  });
  it("assigns a card with promised parameters inside its transaction", async () => {
    expect((await assignCard(req("POST", { assignment_type: "Shared" }), context())).status).toBe(201);
    expect(mocks.txQuery.mock.calls[0][1]).toEqual([1]);
  });
});
