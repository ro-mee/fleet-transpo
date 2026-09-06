// Route tests for Pass 1b (/api/errors): gates, validation, throttling,
// and the events+groups read shape. DB and auth are mocked; no live writes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import * as rl from "@/lib/rate-limit";

function mockReq({ url = "http://x/api/errors", body = undefined, ua = "test-agent" } = {}) {
  return {
    url,
    headers: { get: (k) => (k === "user-agent" ? ua : null) },
    json: async () => body,
  };
}

function mockSession(role = "driver", employeeId = 41) {
  vi.spyOn(utils, "requireAuth").mockResolvedValue({
    user: { role, employeeId },
  });
}

function mockAllowWrites(insertId = 7) {
  return vi.spyOn(db, "query").mockImplementation(async (sql) => {
    if (String(sql).includes("INSERT INTO app_errors")) {
      return { rows: [{ error_id: insertId }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.spyOn(rl, "rateLimit").mockResolvedValue({ allowed: true, remaining: 19, retryAfter: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/errors", () => {
  it("authorizes with an explicit role list that includes driver", async () => {
    mockSession("driver", 41);
    mockAllowWrites();
    const res = await POST(
      mockReq({ body: { source: "mobile", message: "Render crash", route: "/trips" } })
    );
    expect(res.status).toBe(200);
    const authCall = utils.requireAuth.mock.calls[0];
    expect(Array.isArray(authCall[1])).toBe(true);
    expect(authCall[1]).toContain("driver");
    expect(authCall[1]).toContain("system_admin");
  });

  it("rejects source=server (server writes directly, never POSTs)", async () => {
    mockSession();
    const res = await POST(mockReq({ body: { source: "server", message: "x" } }));
    expect(res.status).toBe(400);
  });

  it("rejects missing message and non-object bodies", async () => {
    mockSession();
    expect((await POST(mockReq({ body: { source: "web" } }))).status).toBe(400);
    expect((await POST(mockReq({ body: "just a string" }))).status).toBe(400);
    expect((await POST(mockReq({ body: null }))).status).toBe(400);
  });

  it("rejects oversized payloads with 413 (junk-field stuffing)", async () => {
    mockSession();
    const body = { source: "web", message: "ok" };
    for (let i = 0; i < 500; i++) body[`junk${i}`] = "x".repeat(100);
    const res = await POST(mockReq({ body }));
    expect(res.status).toBe(413);
  });

  it("rejects non-path routes", async () => {
    mockSession();
    const res = await POST(
      mockReq({ body: { source: "web", message: "x", route: "not a path" } })
    );
    expect(res.status).toBe(400);
  });

  it("derives identity from the session, never the body", async () => {
    mockSession("driver", 41);
    const querySpy = mockAllowWrites();
    const res = await POST(
      mockReq({ body: { source: "mobile", message: "boom", employeeId: 1 } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, error_id: 7 });
    const insert = querySpy.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO app_errors")
    );
    // params: source, route, message, stack, status, employee, fingerprint, ua
    expect(insert[1][5]).toBe(41);
  });

  it("returns 429 when throttled (repeated crash loop)", async () => {
    mockSession();
    rl.rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfter: 60 });
    const res = await POST(mockReq({ body: { source: "web", message: "boom" } }));
    expect(res.status).toBe(429);
  });

  it("still 200s with received:false when the DB write fails (no retry loop)", async () => {
    mockSession();
    vi.spyOn(db, "query").mockRejectedValue(new Error("connection lost"));
    const res = await POST(mockReq({ body: { source: "web", message: "boom" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: false, error_id: null });
  });
});

describe("GET /api/errors", () => {
  function mockReads() {
    vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { role: "system_admin" } });
    return vi.spyOn(db, "query").mockImplementation(async (sql, params) => {
      const s = String(sql);
      if (s.includes("GROUP BY a.fingerprint")) {
        return {
          rows: [
            {
              fingerprint: "web|/x|boom",
              occurrences: 3,
              first_seen: "2026-09-06T07:52:00Z",
              last_seen: "2026-09-06T08:41:00Z",
              sample: "boom",
            },
          ],
        };
      }
      if (s.includes("COUNT(*)::int AS total")) return { rows: [{ total: 3 }] };
      if (s.includes("WHERE a.error_id")) {
        return {
          rows: [
            {
              error_id: 9,
              source: "web",
              route: "/x",
              message: "boom",
              stack: "Error: boom",
              status_code: null,
              employee_id: 8,
              reporter_email: "admin@fleetops.com",
              fingerprint: "web|/x|boom",
              user_agent: "ua",
              created_at: "2026-09-06T08:41:00Z",
            },
          ],
        };
      }
      return {
        rows: [
          {
            error_id: 9,
            source: "web",
            route: "/x",
            message: "boom",
            status_code: null,
            employee_id: 8,
            reporter_email: "admin@fleetops.com",
            fingerprint: "web|/x|boom",
            user_agent: "ua",
            created_at: "2026-09-06T08:41:00Z",
            has_stack: true,
          },
        ],
      };
    });
  }

  it("gates reads behind audit-read permission", async () => {
    mockReads();
    await GET(mockReq());
    expect(utils.requirePermission).toHaveBeenCalledWith(expect.anything(), "audit", "read");
  });

  it("returns events + groups + total", async () => {
    mockReads();
    const res = await GET(mockReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].has_stack).toBe(true);
    expect(body.events[0]).not.toHaveProperty("stack");
    expect(body.groups).toEqual([
      {
        fingerprint: "web|/x|boom",
        occurrences: 3,
        first_seen: "2026-09-06T07:52:00Z",
        last_seen: "2026-09-06T08:41:00Z",
        sample: "boom",
      },
    ]);
    expect(body.total).toBe(3);
  });

  it("rejects invalid source and invalid dates", async () => {
    mockReads();
    expect((await GET(mockReq({ url: "http://x/api/errors?source=bogus" }))).status).toBe(400);
    expect((await GET(mockReq({ url: "http://x/api/errors?from=not-a-date" }))).status).toBe(400);
  });

  it("returns full stack only on single-row detail lookup", async () => {
    mockReads();
    const res = await GET(mockReq({ url: "http://x/api/errors?error_id=9" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.event.stack).toBe("Error: boom");
  });

  it("404s unknown error_id and 400s malformed error_id", async () => {
    vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { role: "system_admin" } });
    vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    expect((await GET(mockReq({ url: "http://x/api/errors?error_id=999" }))).status).toBe(404);
    expect((await GET(mockReq({ url: "http://x/api/errors?error_id=abc" }))).status).toBe(400);
  });
});
