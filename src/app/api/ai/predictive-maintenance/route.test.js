import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({ requirePermission: vi.fn(), ok: data => Response.json({ data }), handleError: error => Response.json({ error: error.message }, { status: error.status ?? 500 }) }));
import { query } from "@/lib/db";
import { requirePermission } from "@/lib/api/utils";
import { GET } from "./route";
beforeEach(() => vi.resetAllMocks());
it("denies an unauthorized request before reading forecast evidence", async () => {
  requirePermission.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
  const response = await GET(new Request("http://localhost/api/ai/predictive-maintenance"));
  expect(response.status).toBe(403);
  expect(query).not.toHaveBeenCalled();
});
it("keeps the fleet summary response shape and returns date-only service evidence", async () => {
  requirePermission.mockResolvedValue({ user: { role: "fleet_manager", employeeId: 9 } });
  query.mockResolvedValueOnce({ rows: [{ vehicle_id: 7, mileage: null, service_plans: [{ plan_id: 10, version: 1, service_code: "routine", next_service_date: "2000-01-01" }] }] }).mockResolvedValueOnce({ rows: [{ vehicle_id: 7, inspections: [], orders: [] }] });
  const response = await GET(new Request("http://localhost/api/ai/predictive-maintenance"));
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(query).toHaveBeenCalledTimes(2);
  expect(data.predictions[0].signals).toEqual([]);
  expect(data.summary).toMatchObject({ overdue: 1, total: 1, unscheduled: 0 });
  expect(data.predictions[0]).toMatchObject({ vehicle_id: 7, risk: "overdue", basis: "time", mileage: null, evidence: { latestReadingAt: null } });
  expect(data.predictions[0].services[0]).toMatchObject({ plan_id: 10, service_code: "routine", risk: "overdue" });
  expect(requirePermission).toHaveBeenCalledWith(expect.any(Request), "predictive_maintenance", "read");
});
it("returns a failure if evidence retrieval fails rather than an empty healthy fleet", async () => {
  requirePermission.mockResolvedValue({ user: { role: "fleet_manager", employeeId: 9 } });
  query.mockRejectedValue(new Error("Database unavailable"));
  expect((await GET(new Request("http://localhost/api/ai/predictive-maintenance"))).status).toBe(500);
});
