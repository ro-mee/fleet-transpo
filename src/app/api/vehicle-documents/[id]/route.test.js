import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), permission: vi.fn(), attach: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
vi.mock("@/lib/api/utils", async () => ({ ...await vi.importActual("@/lib/api/utils"), requirePermission: mocks.permission }));
vi.mock("@/lib/uploads/document-storage", () => ({ attachVehicleDocument: mocks.attach, signVehicleDocuments: async docs => docs }));
vi.mock("@/lib/audit", () => ({ writeAuditRequired: mocks.audit }));
import { PUT } from "./route";
const ref = "vehicle-documents/drafts/8/b31b58a1-cb15-4a1a-9cd0-013273ed42cc.pdf";
const context = { params: Promise.resolve({ id: "2" }) };
const request = body => ({ json: async () => body });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ user: { employeeId: 8 } });
  mocks.transaction.mockImplementation(fn => fn({ query: mocks.query }));
  mocks.query.mockResolvedValueOnce({ rows: [{ document_id: 2, vehicle_id: 29, document_type: "OR_CR", file_url: ref, status: "Active" }] }).mockResolvedValue({ rows: [{ document_id: 2 }] });
  mocks.attach.mockResolvedValue(ref); mocks.audit.mockResolvedValue();
});
describe("vehicle document update binding", () => {
  it("checks an existing private file when changing its record or kind", async () => {
    const response = await PUT(request({ vehicle_id: 30 }), context);
    expect(response.status).toBe(200);
    expect(mocks.attach).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ file_url: ref, document_type: "OR_CR" }), 30);
    expect(mocks.query.mock.calls[1][0]).toContain("verification_status = 'Pending'");
  });
  it("refuses a forbidden reattachment before writing or auditing", async () => {
    const { AuthError } = await import("@/lib/api/utils");
    mocks.attach.mockRejectedValue(new AuthError("Wrong record", 403));
    expect((await PUT(request({ vehicle_id: 30 }), context)).status).toBe(403);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("does not clear a review for an unchanged stored document", async () => {
    expect((await PUT(request({ file_url: ref }), context)).status).toBe(200);
    expect(mocks.query.mock.calls[1][0]).not.toContain("verification_status = 'Pending'");
  });
  it("rejects an upload ID without its matching file reference", async () => {
    expect((await PUT(request({ upload_id: "some-id", status: "Active" }), context)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
