import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requirePermission: vi.fn() };
});

import { query } from "@/lib/db";
import { requirePermission, AuthError } from "@/lib/api/utils";
import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/system/security-alerts", () => {
  it("requires a privileged role", async () => {
    requirePermission.mockRejectedValue(new AuthError("Forbidden", 403));
    const res = await GET(new Request("http://localhost/api/system/security-alerts"));
    expect(res.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "reports", "read");
  });

  it("returns the latest alerts without secret material", async () => {
    requirePermission.mockResolvedValue({ user: { employeeId: 1, role: "admin" } });
    query.mockResolvedValue({
      rows: [{
        id: 9, created_at: "2026-09-16T00:00:00Z", employee_id: 12,
        email: "driver@fleetops.com",
        details: { type: "account_locked", channel: "web" }, ip_address: "1.2.3.4",
      }],
    });
    const res = await GET(new Request("http://localhost/api/system/security-alerts"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].type).toBe("account_locked");
    expect(JSON.stringify(body)).not.toMatch(/password|totp|secret|token[^_]/i);
  });
});
