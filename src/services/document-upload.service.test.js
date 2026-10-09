import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadDocument } from "./document-upload.service";
vi.mock("@/lib/auth/session-bus", () => ({ dispatchSessionAuthError: vi.fn() }));
let xhr;
class FakeXHR {
  constructor() { xhr = this; this.upload = {}; }
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort());
}
afterEach(() => vi.unstubAllGlobals());
const file = new File(["test"], "scan.pdf", { type: "application/pdf" });
describe("measured upload transport", () => {
  it("reports transfer separately and waits for storage confirmation", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const progress = vi.fn(); const transferred = vi.fn(); let resolved = false;
    const promise = uploadDocument(file, { kind: "OR_CR", uploadId: "draft-id", onProgress: progress, onTransferred: transferred }).then(result => { resolved = true; return result; });
    xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
    expect(progress).toHaveBeenCalledWith({ percent: 50, bytes: 2 });
    xhr.upload.onload();
    await Promise.resolve();
    expect(transferred).toHaveBeenCalledOnce(); expect(resolved).toBe(false);
    xhr.status = 201; xhr.responseText = JSON.stringify({ state: "ready" }); xhr.onload();
    expect(await promise).toEqual({ state: "ready" });
  });
  it("cancels the transfer without returning upload success", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const controller = new AbortController();
    const promise = uploadDocument(file, { kind: "OR_CR", uploadId: "draft-id", signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr.abort).toHaveBeenCalledOnce();
  });
  it("preserves recoverable network and storage failures", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const first = uploadDocument(file, { kind: "OR_CR", uploadId: "draft-id" });
    xhr.onerror(); await expect(first).rejects.toThrow(/Connection lost/);
    const second = uploadDocument(file, { kind: "OR_CR", uploadId: "draft-id" });
    xhr.status = 503; xhr.responseText = JSON.stringify({ error: "File could not be stored" }); xhr.onload();
    await expect(second).rejects.toMatchObject({ status: 503, message: "File could not be stored" });
  });
});
