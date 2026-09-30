import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requireAuth: mocks.requireAuth, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { GET } from "@/app/api/audit/route";

const session = { user: { employeeId: 7, role: "system_admin" } };

function request(search = "") {
  return new Request(`http://localhost/api/audit${search}`);
}

describe("GET /api/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(session);
    mocks.requireAuth.mockResolvedValue(session);
    mocks.writeAudit.mockResolvedValue({ log_id: 999 });
  });

  it("returns a small cursor page without JSON payloads or a count query", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ log_id: 4, employee_id: 7, action: "login_success", resource: "authentication", created_at: new Date("2026-09-30T10:00:00Z") }] })
      .mockResolvedValueOnce({ rows: [{ kind: "action", value: "login_success" }, { kind: "resource", value: "authentication" }] });

    const req = request();
    const response = await GET(req);
    const body = await response.json();
    const [listSql, params] = mocks.query.mock.calls[0];

    expect(response.status).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
    expect(body.actions).toEqual(["login_success"]);
    expect(body.logs[0]).not.toHaveProperty("old_values");
    expect(listSql).not.toMatch(/COUNT\s*\(|old_values|new_values|OFFSET/i);
    expect(params).toEqual([26]);
    expect(mocks.writeAudit).toHaveBeenCalledWith(req, session, expect.anything());
  });

  it("builds a stable cursor predicate with the correct parameters", async () => {
    const cursor = Buffer.from(JSON.stringify({ createdAt: "2026-09-30T10:00:00.000Z", logId: 44 })).toString("base64url");
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await GET(request(`?action=update&employee_id=7&cursor=${encodeURIComponent(cursor)}&limit=2`));
    const [sql, params] = mocks.query.mock.calls[0];

    expect(response.status).toBe(200);
    expect(sql).toContain("a.created_at < $3::timestamptz");
    expect(sql).toContain("a.created_at = $3::timestamptz AND a.log_id < $4");
    expect(params).toEqual(["update", 7, "2026-09-30T10:00:00.000Z", 44, 3]);
  });

  it("rejects broad or reversed date ranges", async () => {
    const response = await GET(request("?from=2025-01-01&to=2026-09-30"));
    expect(response.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
