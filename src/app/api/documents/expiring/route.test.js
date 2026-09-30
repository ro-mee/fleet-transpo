import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  requirePermission: vi.fn(),
  writeAuditRequired: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => ({
  ...(await vi.importActual("@/lib/api/utils")),
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.writeAuditRequired }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));

import { GET } from "./route";

const session = { user: { employeeId: 7 } };
const req = new Request("http://localhost/api/documents/expiring");

describe("GET /api/documents/expiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(session);
    mocks.rateLimit.mockResolvedValue({ allowed: true });
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ driver_id: 13, license_number: "N04-19-013583", license_expiry: "2030-01-01", license_type: "Professional", first_name: "Kai", last_name: "Reyes" }] });
    mocks.withTransaction.mockImplementation((callback) => callback({ query: vi.fn() }));
  });

  it("audits a masked license document view before returning it", async () => {
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0].document_number).toBe("********3583");
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(expect.anything(), req, session, expect.objectContaining({
      action: "license_masked_viewed",
      resource: "drivers",
      resourceId: 13,
      newValues: { driver_ids: [13], count: 1, source: "expiring_documents" },
    }));
  });

  it("does not return masked values if the required audit insert fails", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await GET(req);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("********3583");
  });
});
