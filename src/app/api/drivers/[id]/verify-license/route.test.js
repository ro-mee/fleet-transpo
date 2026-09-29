import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ withTransaction: vi.fn() }));
vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(),
  parseBody: vi.fn(),
  ok: (body) => Response.json(body),
  err: (error, status) => Response.json({ error }, { status }),
  handleError: (error) => Response.json({ error: error.message }, { status: error.status ?? 500 }),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

import { withTransaction } from "@/lib/db";
import { requirePermission, parseBody } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { POST } from "./route";

const LICENSE = {
  license_number: "N04-19-013583",
  license_type: "Professional",
  license_class: "B",
  license_expiry: "2030-01-01",
};
const request = () => new Request("http://localhost/api/drivers/7/verify-license", { method: "POST" });
const context = { params: Promise.resolve({ id: "7" }) };

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { employeeId: 9, role: "fleet_manager" } });
  parseBody.mockResolvedValue({ confirm: true, method: "physical_card" });
  const tx = {
    query: vi.fn(async (sql) => sql.includes("SELECT license_number")
      ? { rows: [LICENSE] }
      : { rows: [{ license_verified_at: "2026-09-27T10:00:00+08:00", license_verified_by: 9, license_verification_method: "physical_card" }] }),
  };
  withTransaction.mockImplementation((write) => write(tx));
});

it("requires the existing drivers.update permission before verification", async () => {
  requirePermission.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
  const response = await POST(request(), context);
  expect(response.status).toBe(403);
  expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "drivers", "update");
  expect(withTransaction).not.toHaveBeenCalled();
});

it("does not verify missing license details", async () => {
  const tx = { query: vi.fn(async () => ({ rows: [{ ...LICENSE, license_number: null }] })) };
  withTransaction.mockImplementation((write) => write(tx));
  const response = await POST(request(), context);
  expect(response.status).toBe(400);
  expect(tx.query).toHaveBeenCalledTimes(1);
  expect((await response.json()).error).toMatch(/complete and valid/i);
});

it("stores an authorized review and audits only a masked license number", async () => {
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ license_verification_method: "physical_card", license_verified_by: 9 });
  expect(writeAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
    newValues: expect.objectContaining({ license_number: "********3583" }),
  }));
  expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("N04-19-013583");
});
