import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn(), permission: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/api/utils", async () => ({ ...await vi.importActual("@/lib/api/utils"), requireAuth: mocks.auth, requirePermission: mocks.permission }));
vi.mock("@/lib/uploads/document-storage", () => ({ cleanupDocumentDrafts: mocks.cleanup, DOCUMENT_UPLOAD_ROLES: ["admin", "fleet_manager"] }));
import { DELETE } from "./route";
const id = "b31b58a1-cb15-4a1a-9cd0-013273ed42cc";
const req = new Request("https://fleet.test/api/document-uploads/" + id, { method: "DELETE" });
const context = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { employeeId: 8 } });
  mocks.permission.mockResolvedValue({ user: { employeeId: 8 } });
  mocks.query.mockResolvedValueOnce({ rows: [{ state: "ready", resource: "vehicles", target_id: 29 }] }).mockResolvedValue({ rows: [{ upload_id: id }] });
  mocks.cleanup.mockResolvedValue({ deleted: 1, pending: 0 });
});
describe("document draft cancellation", () => {
  it("cancels an owned draft and reports storage cleanup", async () => {
    const response = await DELETE(req, context);
    expect(response.status).toBe(200);
    expect(mocks.query.mock.calls[0][1]).toEqual([id, 8]);
    expect(mocks.permission).toHaveBeenCalledWith(req, "vehicles", "update");
    expect(mocks.cleanup).toHaveBeenCalledWith({ uploadId: id, ownerId: 8 });
    expect((await response.json()).cleanup_pending).toBe(false);
  });
  it("never removes a saved attachment", async () => {
    mocks.query.mockReset().mockResolvedValue({ rows: [{ state: "attached", resource: "vehicles", target_id: 29 }] });
    expect((await DELETE(req, context)).status).toBe(409);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("does not remove an attachment if Save wins the race", async () => {
    mocks.query.mockReset().mockResolvedValueOnce({ rows: [{ state: "ready", resource: "vehicles", target_id: 29 }] }).mockResolvedValueOnce({ rows: [] });
    expect((await DELETE(req, context)).status).toBe(409);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("treats a missing or another owner's draft as absent", async () => {
    mocks.query.mockReset().mockResolvedValue({ rows: [] });
    expect((await DELETE(req, context)).status).toBe(200);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("leaves failed storage cleanup available for retry", async () => {
    mocks.cleanup.mockResolvedValue({ deleted: 0, pending: 1 });
    expect((await (await DELETE(req, context)).json()).cleanup_pending).toBe(true);
  });
  it("rejects malformed IDs before querying storage", async () => {
    expect((await DELETE(req, { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
