import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  requirePermission: vi.fn(),
  writeAuditRequired: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => ({
  ...(await vi.importActual("@/lib/api/utils")),
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));

import { POST } from "@/app/api/drivers/license-views/route";

const session = { user: { employeeId: 7 } };
const key = "be4ad8bb-260b-4b73-994a-ccbc884606d4";

function request(body) {
  return new Request("http://localhost/api/drivers/license-views", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/drivers/license-views", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(session);
    mocks.rateLimit.mockResolvedValue({ allowed: true });
    mocks.withTransaction.mockImplementation((fn) => fn({
      query: vi.fn().mockResolvedValue({ rows: [{ driver_id: 12, license_number: "N04-19-013583" }] }),
    }));
    mocks.writeAuditRequired.mockResolvedValue({ log_id: 99 });
  });

  it("audits the deliberate page access before returning only the masked value", async () => {
    const req = request({ driver_ids: [12], source: "staff_directory", event_key: key });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ drivers: [{ driver_id: 12, license_number: "********3583" }] });
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(expect.anything(), req, session, expect.objectContaining({
      action: "license_masked_viewed",
      resource: "drivers",
      resourceId: 12,
      eventKey: key,
      newValues: { driver_ids: [12], source: "staff_directory", count: 1 },
    }));
  });

  it("bounds the ID list and does not open a transaction for invalid input", async () => {
    const response = await POST(request({ driver_ids: Array.from({ length: 26 }, (_, i) => i + 1), source: "staff_directory", event_key: key }));
    expect(response.status).toBe(400);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });
});
