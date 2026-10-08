import { describe, expect, it, afterEach, vi } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";

const req = () => new Request("http://test/api/incidents/responders/active");

describe("GET /api/incidents/responders/active mechanic scope (G2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scopes the feed to the mechanic's assigned work orders", async () => {
    vi.spyOn(utils, "requirePermission").mockResolvedValue({
      user: { role: "mechanic", employeeId: 135 },
    });
    const querySpy = vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const [sql, params] = querySpy.mock.calls[0];
    expect(sql).toContain("assigned_mechanic_id = $1");
    expect(params).toEqual([135]);
  });

  it("leaves the staff feed unfiltered", async () => {
    vi.spyOn(utils, "requirePermission").mockResolvedValue({
      user: { role: "dispatcher", employeeId: 21 },
    });
    const querySpy = vi.spyOn(db, "query").mockResolvedValue({ rows: [] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const [sql, params] = querySpy.mock.calls[0];
    expect(sql).not.toContain("assigned_mechanic_id");
    expect(params).toEqual([]);
  });
});
