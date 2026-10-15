import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "./route";
import * as db from "@/lib/db";
import * as utils from "@/lib/api/utils";
import { AuthError } from "@/lib/api/utils";
import { ROLE_IDS } from "@/lib/constants";
import { can } from "@/lib/auth/permissions";

// P0 mechanic integration: the staff assign-mechanic select reads this
// directory. Pins the guard (maintenance:create only), the mechanic-only
// filter, and the lean shape (no credentials, no other roles).
describe("GET /api/mechanics", () => {
  beforeEach(() => {
    vi.spyOn(db, "query").mockImplementation(async (sql) => {
      if (sql.includes("FROM employees")) {
        return {
          rows: [
            { employee_id: 77, first_name: "Rosa", last_name: "Diaz", email: "rosa@example.com" },
            { employee_id: 78, first_name: "Amy", last_name: "Santiago", email: "amy@example.com" },
          ],
        };
      }
      return { rows: [] };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("staff (fleet_manager) gets the active-mechanic directory", async () => {
    vi.spyOn(utils, "requirePermission").mockResolvedValue({ user: { role: "fleet_manager", employeeId: 888 } });
    const res = await GET({});
    expect(utils.requirePermission).toHaveBeenCalledWith({}, "maintenance", "create");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({ employee_id: 77, first_name: "Rosa", last_name: "Diaz", email: "rosa@example.com" });

    const [sql, params] = db.query.mock.calls.find(([s]) => s.includes("FROM employees"));
    expect(params).toEqual([ROLE_IDS.mechanic]);
    expect(ROLE_IDS.mechanic).toBe(10);
    expect(sql).toContain("role_id = $1");
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).toContain("status = 'Active'");
    expect(sql).not.toContain("password_hash");
  });

  it("requires the maintenance:create grant (mechanic role is denied)", async () => {
    expect(can({ role: "mechanic" }, "maintenance", "create")).toBe(false);
    vi.spyOn(utils, "requirePermission").mockRejectedValue(new AuthError("Forbidden", 403));
    const res = await GET({});
    expect(res.status).toBe(403);
    expect(utils.requirePermission).toHaveBeenCalledWith({}, "maintenance", "create");
    expect(db.query).not.toHaveBeenCalled();
  });
});
