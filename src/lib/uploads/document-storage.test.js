import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.transaction }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ remove: mocks.remove }) } }) }));
vi.mock("@/lib/storage/object-refs", () => ({
  canonicalStoredRef: (ref, bucket) => !ref ? null : ref.startsWith(bucket + "/") ? ref : ref.startsWith("drafts/") ? `${bucket}/${ref}` : ref,
  signedUrlFor: vi.fn(async () => "https://fleet.test/short-preview"),
}));
import { attachDocumentUpload, attachVehicleDocument, cleanupDocumentDrafts, publicUpload } from "./document-storage";
const id = "b31b58a1-cb15-4a1a-9cd0-013273ed42cc";
const ref = `vehicle-documents/drafts/8/${id}.pdf`;
let row, tx;
beforeEach(() => {
  vi.clearAllMocks();
  row = { upload_id: id, owner_id: 8, resource: "vehicles", kind: "OR_CR", target_id: 29, attached_record_id: null,
    bucket: "vehicle-documents", object_key: `drafts/8/${id}.pdf`, state: "ready", expires_at: "2099-01-01", file_name: "test.pdf" };
  tx = { query: vi.fn(async () => ({ rows: [row] })) };
  mocks.transaction.mockImplementation(fn => fn(tx));
  mocks.remove.mockResolvedValue({ error: null });
});
const bind = () => attachDocumentUpload(tx, { user: { employeeId: 8 } }, { uploadId: id, kind: "OR_CR", recordId: 29, ref });
describe("private draft attachment", () => {
  it("locks and binds only a ready owned file to the saved record", async () => {
    expect(await bind()).toBe(ref);
    expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    expect(tx.query.mock.calls[1][1]).toEqual([id, 29]);
  });
  it.each([{ owner_id: 9 }, { kind: "Insurance" }, { resource: "drivers" }, { target_id: 30 }])("refuses mismatched ownership/context %j", async patch => {
    Object.assign(row, patch);
    await expect(bind()).rejects.toMatchObject({ status: 403 });
    expect(tx.query).toHaveBeenCalledTimes(1);
  });
  it.each(["cancelled", "deleted", "uploading"])("cannot attach a %s draft", async state => {
    row.state = state;
    await expect(bind()).rejects.toMatchObject({ status: 409 });
  });
  it("rejects expired uploads and a substituted object reference", async () => {
    row.expires_at = "2000-01-01";
    await expect(bind()).rejects.toMatchObject({ status: 409 });
    row.expires_at = "2099-01-01";
    await expect(attachDocumentUpload(tx, { user: { employeeId: 8 } }, { uploadId: id, kind: "OR_CR", recordId: 29, ref: "vehicle-documents/drafts/9/other.pdf" })).rejects.toMatchObject({ status: 400 });
  });
  it("cannot bypass attachment by omitting the upload ID", async () => {
    tx.query.mockResolvedValue({ rows: [] });
    await expect(attachDocumentUpload(tx, { user: { employeeId: 8 } }, { kind: "OR_CR", recordId: 29, ref })).rejects.toMatchObject({ status: 403 });
    expect(tx.query.mock.calls[0][0]).toContain("state = 'attached'");
  });
  it("cannot put a private vehicle draft in a license slot or unknown document slot", async () => {
    await expect(attachDocumentUpload(tx, { user: { employeeId: 8 } }, { kind: "license_front", recordId: 29, ref })).rejects.toMatchObject({ status: 403 });
    await expect(attachVehicleDocument(tx, { user: { employeeId: 8 } }, { document_type: "Other", file_url: ref }, 29)).rejects.toMatchObject({ status: 400 });
  });
  it("allows an unchanged saved reference without mutating it", async () => {
    row.state = "attached"; row.attached_record_id = 29;
    expect(await bind()).toBe(ref);
    expect(tx.query).toHaveBeenCalledTimes(1);
  });
  it("keeps cleanup scoped to uncommitted drafts and retains failed removals", async () => {
    mocks.remove.mockResolvedValueOnce({ error: new Error("storage unavailable") });
    expect(await cleanupDocumentDrafts()).toEqual({ deleted: 0, pending: 1 });
    expect(tx.query.mock.calls[0][0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(tx.query.mock.calls[0][0]).toContain("state IN ('uploading', 'ready')");
    expect(tx.query).toHaveBeenCalledTimes(1);
  });
  it("only marks a draft deleted after object removal succeeds", async () => {
    row.expires_at = "2000-01-01";
    expect(await cleanupDocumentDrafts()).toEqual({ deleted: 1, pending: 0 });
    expect(mocks.remove).toHaveBeenCalledWith([row.object_key]);
    expect(tx.query.mock.calls[1][0]).toContain("state = 'deleted'");
  });
  it("retains a cancellation tombstone for transfers that finish late", async () => {
    row.state = "cancelled";
    expect(await cleanupDocumentDrafts({ uploadId: id, ownerId: 8 })).toEqual({ deleted: 1, pending: 0 });
    expect(tx.query).toHaveBeenCalledTimes(1);
    expect(tx.query.mock.calls[0][0]).toContain("expires_at < NOW()");
  });
  it("does not return storage credentials or paths in public metadata", () => {
    const metadata = publicUpload(row);
    expect(metadata).not.toHaveProperty("object_key");
    expect(metadata).not.toHaveProperty("sha256");
    expect(metadata).not.toHaveProperty("owner_id");
  });
});
