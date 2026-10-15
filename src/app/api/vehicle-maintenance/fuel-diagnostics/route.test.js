import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", async (original) => ({ ...await original(), requirePermission: vi.fn() }));
import { query } from "@/lib/db";
import { requirePermission, AuthError } from "@/lib/api/utils";
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { role: "fleet_manager" } });
  query.mockResolvedValue({ rows: [{ maintenance_id: 44, vehicle_id: 12, status: "Scheduled", maintenance_date: "2026-10-10" }] });
});
it("returns a lean newest open diagnostic for each requested vehicle", async () => {
  const req = { url: "http://localhost/api/vehicle-maintenance/fuel-diagnostics?vehicle_ids=12,13" };
  const response = await GET(req);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([{ maintenance_id: 44, vehicle_id: 12, status: "Scheduled", maintenance_date: "2026-10-10" }]);
  expect(requirePermission).toHaveBeenCalledWith(req, "maintenance", "create");
  const [sql, params] = query.mock.calls[0];
  expect(params).toEqual([[12, 13], "Inspection", "%[fuel-diagnostic v1]%", ["Scheduled", "In Progress", "Pending Inspection"]]);
  expect(sql).toContain("DISTINCT ON (vehicle_id)");
  expect(sql).toContain("deleted_at IS NULL");
  expect(sql).toContain("status = ANY($4)");
  expect(sql).toContain("ORDER BY vehicle_id, created_at DESC, maintenance_id DESC");
  expect(sql).not.toContain("SELECT *");
});
it.each(["", "0", "-1", "1.5", "12abc", "1,,2", "1,2,3,4,5,6,7,8,9,10,11", "9007199254740992", "2147483648"])("rejects invalid ids %s before database reads", async (ids) => {
  expect((await GET({ url: `http://localhost/api/vehicle-maintenance/fuel-diagnostics?vehicle_ids=${ids}` })).status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});
it("denies unauthorized callers before querying", async () => {
  requirePermission.mockRejectedValue(new AuthError("Forbidden", 403));
  expect((await GET({ url: "http://localhost/api/vehicle-maintenance/fuel-diagnostics?vehicle_ids=12" })).status).toBe(403);
  expect(query).not.toHaveBeenCalled();
});
