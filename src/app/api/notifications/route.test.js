// Soft delete (migration 127): every inbox read excludes dismissed rows —
// this one filter is what hides a soft-deleted notification from the web
// inbox, the bell badge, the unread counts, and the mobile feed at once.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { query } from "@/lib/db";
import { requirePermission } from "@/lib/api/utils";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});
// GET never pushes, but the route module imports the push service for POST.
vi.mock("@/services/push.service", () => ({
  deliveryFor: vi.fn(),
  sendPush: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({
    user: { employeeId: 7, role: "driver" },
  });
  vi.mocked(query).mockResolvedValue({ rows: [] });
});

describe("GET /api/notifications — soft-delete filter", () => {
  it("always excludes dismissed rows", async () => {
    const res = await GET({ url: "http://localhost/api/notifications" });

    expect(res.status).toBe(200);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("n.deleted_at IS NULL");
    expect(sql).not.toContain("DELETE");
  });

  it("keeps the self-scope and param numbering intact", async () => {
    await GET({ url: "http://localhost/api/notifications" });

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("n.employee_id = $1");
    expect(params).toEqual([7]);
  });

  it("still applies the is_read filter alongside the soft-delete filter", async () => {
    await GET({ url: "http://localhost/api/notifications?is_read=false" });

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("n.deleted_at IS NULL");
    expect(sql).toContain("n.is_read = $2");
    expect(params).toEqual([7, false]);
  });
});
