// Tests for /api/ai/instructions: DB-backed prompt overrides with .md
// fallback. The client only sends keys — never paths — so traversal is
// impossible by construction; these tests pin that plus the audit trail.
import { describe, it, expect, vi, afterEach } from "vitest";
import { GET, PUT, DELETE } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import { AuthError } from "@/lib/api/utils";
import * as auditLog from "@/lib/audit";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockReq({ body, url = "http://x/api/ai/instructions" } = {}) {
  return {
    url,
    headers: { get: () => null },
    json: async () => body,
  };
}

function mockAdmin() {
  vi.spyOn(utils, "requirePermission").mockResolvedValue({
    user: { role: "system_admin", employeeId: 8 },
  });
  vi.spyOn(auditLog, "writeAudit").mockResolvedValue();
}

describe("PUT /api/ai/instructions", () => {
  it("rejects callers without ai_settings update permission", async () => {
    vi.spyOn(utils, "requirePermission").mockRejectedValue(new AuthError("Forbidden", 403));
    const res = await PUT(mockReq({ body: { target: "main", content: "hi" } }));
    expect(res.status).toBe(403);
    expect(utils.requirePermission).toHaveBeenCalledWith(expect.anything(), "ai_settings", "update");
  });

  it("rejects traversal and unknown targets without touching the DB", async () => {
    mockAdmin();
    const querySpy = vi.spyOn(db, "query");
    for (const target of ["../secret", "../../etc/passwd", "reports/drivers", "drivers.md", "", null]) {
      const res = await PUT(mockReq({ body: { target, content: "hi" } }));
      expect(res.status).toBe(400);
    }
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("rejects empty content and oversized payloads without touching the DB", async () => {
    mockAdmin();
    const querySpy = vi.spyOn(db, "query");
    expect((await PUT(mockReq({ body: { target: "main", content: "   " } }))).status).toBe(400);
    expect((await PUT(mockReq({ body: { target: "main" } }))).status).toBe(400);
    expect((await PUT(mockReq({ body: { target: "main", content: "x".repeat(60000) } }))).status).toBe(413);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("upserts the override and audits the change", async () => {
    mockAdmin();
    const querySpy = vi.spyOn(db, "query").mockResolvedValue({ rows: [{ version: 2 }] });
    const res = await PUT(mockReq({ body: { target: "main", content: "# Hello" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ saved: true, target: "main", version: 2 });
    const [sql, params] = querySpy.mock.calls[0];
    expect(sql).toContain("INSERT INTO ai_prompt_templates");
    expect(sql).toContain("ON CONFLICT (prompt_key)");
    expect(params).toEqual(["main", "# Hello", 8]);
    expect(auditLog.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "ai_instructions_update", resource: "ai_instructions" })
    );
  });

  it("accepts only known report types as keys, never paths", async () => {
    mockAdmin();
    const querySpy = vi.spyOn(db, "query").mockResolvedValue({ rows: [{ version: 1 }] });
    const res = await PUT(mockReq({ body: { target: "drivers", content: "# D" } }));
    expect(res.status).toBe(200);
    expect(querySpy.mock.calls[0][1][0]).toBe("drivers");
  });

  it("returns 500 when the DB write fails", async () => {
    mockAdmin();
    vi.spyOn(db, "query").mockRejectedValue(new Error("db gone"));
    const res = await PUT(mockReq({ body: { target: "main", content: "# Hello" } }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/ai/instructions (Reset to Default)", () => {
  it("rejects callers without ai_settings update permission", async () => {
    vi.spyOn(utils, "requirePermission").mockRejectedValue(new AuthError("Forbidden", 403));
    const res = await DELETE(mockReq({ url: "http://x/api/ai/instructions?target=main" }));
    expect(res.status).toBe(403);
  });

  it("rejects unknown targets", async () => {
    mockAdmin();
    const querySpy = vi.spyOn(db, "query");
    const res = await DELETE(mockReq({ url: "http://x/api/ai/instructions?target=../x" }));
    expect(res.status).toBe(400);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("deletes the override and audits the reset", async () => {
    mockAdmin();
    const querySpy = vi.spyOn(db, "query").mockResolvedValue({ rows: [{ prompt_key: "drivers" }] });
    const res = await DELETE(mockReq({ url: "http://x/api/ai/instructions?target=drivers" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reset: true, target: "drivers", had_override: true });
    const [sql, params] = querySpy.mock.calls[0];
    expect(sql).toContain("DELETE FROM ai_prompt_templates");
    expect(params).toEqual(["drivers"]);
    expect(auditLog.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "ai_instructions_reset" })
    );
  });

  it("is idempotent when no override exists", async () => {
    mockAdmin();
    vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    const res = await DELETE(mockReq({ url: "http://x/api/ai/instructions?target=main" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reset: true, target: "main", had_override: false });
  });
});

describe("GET /api/ai/instructions", () => {
  it("serves .md defaults with overridden:false when no DB rows exist", async () => {
    vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { role: "system_admin", employeeId: 8 } });
    vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    const res = await GET(mockReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.content).toBe("string");
    expect(body.content.length).toBeGreaterThan(100);
    expect(body.overridden).toBe(false);
    expect(body.reports).toHaveLength(6);
    expect(body.reports.every((r) => r.overridden === false)).toBe(true);
  });

  it("prefers the DB override and flags it", async () => {
    vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { role: "system_admin", employeeId: 8 } });
    vi.spyOn(db, "query").mockImplementation(async (sql, params) => {
      if (params?.[0] === "main") return { rows: [{ content: "# Custom", version: 3 }] };
      return { rows: [] };
    });
    const body = await (await GET(mockReq())).json();
    expect(body.content).toBe("# Custom");
    expect(body.overridden).toBe(true);
    expect(body.version).toBe(3);
  });
});
