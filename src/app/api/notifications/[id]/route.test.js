// Soft delete (migration 127): DELETE must stamp deleted_at and never run a
// literal DELETE FROM — the row survives for the 90-day retention purge.
// Scoping (delete_all vs self, employee_id vs user_id) is unchanged, and a
// repeat dismiss 404s so mobile can treat it as idempotent.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE } from "./route";
import { query } from "@/lib/db";
import { requirePermission } from "@/lib/api/utils";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});

const routeParams = (id) => ({ params: Promise.resolve({ id: String(id) }) });

function sessionFor(user) {
  vi.mocked(requirePermission).mockResolvedValue({ user });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/notifications/[id] — soft delete", () => {
  it("stamps deleted_at instead of deleting the row (delete_all role)", async () => {
    sessionFor({ employeeId: 7, role: "fleet_manager" });
    vi.mocked(query).mockResolvedValue({ rowCount: 1 });

    const res = await DELETE({}, routeParams(5));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("SET deleted_at");
    expect(sql).not.toContain("DELETE FROM");
    expect(sql).toContain("deleted_at IS NULL");
    expect(params).toEqual([5]);
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "notifications", "delete");
  });

  it("self-scopes on employee_id for a role without delete_all", async () => {
    sessionFor({ employeeId: 7, role: "driver" });
    vi.mocked(query).mockResolvedValue({ rowCount: 1 });

    const res = await DELETE({}, routeParams(9));

    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("SET deleted_at");
    expect(sql).toContain("employee_id = $2");
    expect(params).toEqual([9, 7]);
  });

  it("self-scopes on user_id when the session has no employee_id", async () => {
    sessionFor({ userId: "u-1", role: "driver" });
    vi.mocked(query).mockResolvedValue({ rowCount: 1 });

    const res = await DELETE({}, routeParams(3));

    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("user_id = $2");
    expect(params).toEqual([3, "u-1"]);
  });

  it("refuses to match anything when the session has no identity at all", async () => {
    sessionFor({ role: "driver" });
    vi.mocked(query).mockResolvedValue({ rowCount: 0 });

    const res = await DELETE({}, routeParams(3));

    expect(res.status).toBe(404);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("1 = 0");
  });

  it("404s a repeat dismiss (already soft-deleted or purged row)", async () => {
    sessionFor({ employeeId: 7, role: "fleet_manager" });
    vi.mocked(query).mockResolvedValue({ rowCount: 0 });

    const res = await DELETE({}, routeParams(5));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Notification not found");
  });

  it("400s a non-numeric id before touching the database", async () => {
    sessionFor({ employeeId: 7, role: "fleet_manager" });

    const res = await DELETE({}, routeParams("abc"));

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
