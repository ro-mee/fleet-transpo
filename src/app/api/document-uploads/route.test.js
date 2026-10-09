import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn(), permission: vi.fn(), upload: vi.fn(), remove: vi.fn(), response: vi.fn(), cleanup: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/api/utils", async () => ({ ...await vi.importActual("@/lib/api/utils"), requireAuth: mocks.auth, requirePermission: mocks.permission }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) } }) }));
vi.mock("@/lib/uploads/document-storage", () => ({ uploadResponse: mocks.response, cleanupDocumentDrafts: mocks.cleanup, DOCUMENT_UPLOAD_ROLES: ["admin", "fleet_manager"] }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limit }));
import { POST } from "./route";
const id = "b31b58a1-cb15-4a1a-9cd0-013273ed42cc";
function request({ kind = "OR_CR", bytes = [37, 80, 68, 70, 45, 49], type = "application/pdf", extraFile = false } = {}) {
  const form = new FormData();
  form.append("kind", kind); form.append("upload_id", id);
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), "test.pdf");
  if (extraFile) form.append("file", new Blob(["other"]), "other.txt");
  return new Request("https://fleet.test/api/document-uploads", { method: "POST", body: form });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { employeeId: 8 } }); mocks.permission.mockResolvedValue({ user: { employeeId: 8 } });
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.upload.mockResolvedValue({ error: null }); mocks.remove.mockResolvedValue({ error: null }); mocks.cleanup.mockResolvedValue({ deleted: 1 });
  mocks.query.mockResolvedValue({ rows: [{ upload_id: id, owner_id: 8, state: "ready" }] });
  mocks.response.mockResolvedValue({ upload_id: id, state: "ready", preview_url: "https://fleet.test/temporary" });
});
describe("document upload route", () => {
  it("returns storage confirmation after validating and uploading a PDF", async () => {
    const res = await POST(request());
    expect(res.status).toBe(201);
    expect(mocks.permission).toHaveBeenCalledWith(expect.anything(), "vehicles", "create");
    expect(mocks.upload).toHaveBeenCalledWith(`drafts/8/${id}.pdf`, expect.any(Uint8Array), { contentType: "application/pdf", upsert: false });
    expect((await res.json()).state).toBe("ready");
  });
  it("does not touch storage when permission is denied", async () => {
    const { AuthError } = await import("@/lib/api/utils");
    mocks.permission.mockRejectedValue(new AuthError("Forbidden", 403));
    expect((await POST(request())).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each([{ bytes: [0, 0, 0, 0, 0, 0] }, { extraFile: true }, { kind: "license_front" }, { kind: "__proto__" }])("rejects invalid files/context %j", async options => {
    expect((await POST(request(options))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("throttles before reading the file body", async () => {
    mocks.limit.mockResolvedValue({ allowed: false });
    const req = request();
    expect((await POST(req)).status).toBe(429);
    expect(req.bodyUsed).toBe(false);
  });
  it("does not report success when storage fails", async () => {
    mocks.upload.mockResolvedValue({ error: new Error("unavailable") });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.cleanup).toHaveBeenCalledWith({ uploadId: id, ownerId: 8 });
    expect(mocks.response).not.toHaveBeenCalled();
  });
  it("does not report success when a concurrent cancellation wins", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ upload_id: id }] }).mockResolvedValueOnce({ rows: [] });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.cleanup).toHaveBeenCalledWith({ uploadId: id, ownerId: 8 });
    expect(mocks.response).not.toHaveBeenCalled();
  });
});
