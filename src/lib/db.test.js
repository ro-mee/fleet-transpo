import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = { connect: vi.fn(async () => mockClient) };

vi.mock("pg", () => ({
  Pool: class {
    connect() {
      return mockPool.connect();
    }
  },
}));

// withTransaction lives in db.js and talks to the pg pool only. Mocking `pg`
// lets us assert the BEGIN/COMMIT/ROLLBACK contract — the "all-or-nothing"
// guarantee that trip completion, cancellation and start now depend on.
import { withTransaction } from "@/lib/db";

process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockClear();
});

describe("withTransaction", () => {
  it("runs the body between BEGIN and COMMIT, then releases the client", async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

    let sawBody = false;
    await withTransaction(async (tx) => {
      await tx.query("UPDATE trips SET trip_status = 'Completed'");
      sawBody = true;
    });

    expect(sawBody).toBe(true);
    const stmts = mockClient.query.mock.calls.map((c) => c[0]);
    expect(stmts[0]).toBe("BEGIN");
    expect(stmts).toContain("UPDATE trips SET trip_status = 'Completed'");
    expect(stmts[stmts.length - 1]).toBe("COMMIT");
    expect(stmts).not.toContain("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("ROLLBACKs and re-throws when the body throws — nothing is committed", async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(
      withTransaction(async (tx) => {
        await tx.query("UPDATE vehicles SET mileage = 100");
        await tx.query("UPDATE dispatchschedules SET status = 'Completed'");
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    const stmts = mockClient.query.mock.calls.map((c) => c[0]);
    expect(stmts[0]).toBe("BEGIN");
    expect(stmts).toContain("UPDATE vehicles SET mileage = 100");
    expect(stmts).toContain("UPDATE dispatchschedules SET status = 'Completed'");
    expect(stmts[stmts.length - 1]).toBe("ROLLBACK");
    expect(stmts).not.toContain("COMMIT");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("returns the body's value", async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const out = await withTransaction(async (tx) => {
      await tx.query("SELECT 1");
      return { rows: [{ trip_id: 7 }] };
    });
    expect(out.rows[0].trip_id).toBe(7);
  });

  it("releases the client even when the body throws", async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(withTransaction(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
