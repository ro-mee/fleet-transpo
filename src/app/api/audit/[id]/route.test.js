import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  writeAudit: vi.fn(),
  writeAuditRequired: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requireAuth: mocks.requireAuth, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual("@/lib/audit");
  return {
    ...actual,
    writeAudit: mocks.writeAudit,
    writeAuditRequired: mocks.writeAuditRequired,
  };
});

import { GET } from "./route";
import { AuthError } from "@/lib/api/utils";

const session = { user: { employeeId: 7, role: "super_admin" } };

function request(id = "14") {
  return new Request(`http://localhost/api/audit/${id}`);
}

describe("GET /api/audit/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(session);
    mocks.requireAuth.mockResolvedValue(session);
    mocks.query.mockResolvedValue({ rows: [{
      log_id: 14,
      employee_id: 7,
      action: "update",
      resource: "drivers",
      resource_id: 12,
      old_values: { status: "Available", license_number: "N04-19-013583" },
      new_values: { status: "Suspended", provider_secret: "do-not-show" },
    }] });
    mocks.withTransaction.mockImplementation(async (callback) => callback({ query: vi.fn() }));
  });

  it("audits detail access before returning redacted payload data", async () => {
    const req = request();
    const response = await GET(req, { params: Promise.resolve({ id: "14" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.payload_redacted).toBe(true);
    expect(body.old_values).toEqual({ status: "Available" });
    expect(body.new_values).toEqual({ status: "Suspended" });
    expect(JSON.stringify(body)).not.toContain("N04-19-013583");
    expect(JSON.stringify(body)).not.toContain("do-not-show");
    expect(mocks.writeAuditRequired).toHaveBeenCalledWith(expect.anything(), req, session, expect.objectContaining({
      action: "audit_detail_viewed",
      resource: "audit_logs",
      resourceId: 14,
    }));
  });

  it("fails closed when the required detail-access audit cannot be written", async () => {
    mocks.writeAuditRequired.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await GET(request(), { params: Promise.resolve({ id: "14" }) });

    expect(response.status).toBe(500);
  });

  it("records a selected permission denial without returning audit details", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new AuthError("Forbidden", 403));

    const response = await GET(request(), { params: Promise.resolve({ id: "14" }) });

    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), session, expect.objectContaining({
      action: "sensitive_access_denied",
      resource: "audit_logs",
    }));
  });
});
