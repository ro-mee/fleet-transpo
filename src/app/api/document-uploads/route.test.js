import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn(), permission: vi.fn(), upload: vi.fn(), remove: vi.fn(), response: vi.fn(), cleanup: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/api/utils", async () => ({ ...await vi.importActual("@/lib/api/utils"), requireAuth: mocks.auth, requirePermission: mocks.permission }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) } }) }));
vi.mock("@/lib/uploads/document-storage", () => ({ uploadResponse: mocks.response, cleanupDocumentDrafts: mocks.cleanup, DOCUMENT_UPLOAD_ROLES: ["admin", "fleet_manager"] }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limit }));
import { POST } from "./route";
const id = "b31b58a1-cb15-4a1a-9cd0-013273ed42cc";
function request({ kind = "OR_CR", bytes = [37, 80, 68, 70, 45, 49], type = "application/pdf", extraFile = false, targetId, filename = "test.pdf" } = {}) {
  const form = new FormData();
  form.append("kind", kind); form.append("upload_id", id);
  if (targetId) form.append("target_id", String(targetId));
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), filename);
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
  it.each([
    { kind: "license_front", type: "image/jpeg", signature: [255, 216, 255], filename: "front.jpg" },
    { kind: "license_back", type: "image/png", signature: [137, 80, 78, 71, 13, 10, 26, 10], filename: "back.png", targetId: 90 },
  ])("accepts a 10MB $kind scan including multipart overhead", async ({ signature, ...options }) => {
    const bytes = new Uint8Array(10 * 1024 * 1024);
    bytes.set(signature);
    const res = await POST(request({ ...options, bytes }));
    expect(res.status).toBe(201);
    expect(mocks.permission).toHaveBeenCalledWith(expect.anything(), "drivers", options.targetId ? "update" : "create");
    expect(mocks.upload.mock.calls[0][1].byteLength).toBe(bytes.byteLength);
  });
  it.each(["license_front", "license_back"])("rejects a %s scan one byte above 10MB before storage", async kind => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    bytes.set([255, 216, 255]);
    const res = await POST(request({ kind, bytes, type: "image/jpeg", filename: "license.jpg" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/10MB/);
    expect(mocks.upload).not.toHaveBeenCalled();
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
