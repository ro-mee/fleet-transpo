import { apiFetch } from "@/lib/api/client";
import { dispatchSessionAuthError } from "@/lib/auth/session-bus";

// XHR reports actual browser-to-server transfer progress. A completed transfer
// still waits for the server's storage response; it is not a saved record.
export function uploadDocument(file, { kind, targetId, uploadId, signal, onProgress, onTransferred }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    form.append("upload_id", uploadId);
    if (targetId) form.append("target_id", String(targetId));
    const abort = () => xhr.abort();
    const finish = (fn, value) => { signal?.removeEventListener("abort", abort); fn(value); };
    xhr.open("POST", "/api/document-uploads");
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.({ percent: Math.round(event.loaded / event.total * 100), bytes: Math.min(file.size, Math.round(event.loaded / event.total * file.size)) });
    };
    xhr.upload.onload = () => onTransferred?.();
    xhr.onload = () => {
      let body;
      try { body = JSON.parse(xhr.responseText); } catch { body = {}; }
      if (xhr.status >= 200 && xhr.status < 300) return finish(resolve, body);
      if (xhr.status === 401) dispatchSessionAuthError(body.code || "SESSION_INVALID", body.error);
      const error = new Error(body.error || "Upload failed. Try again.");
      error.status = xhr.status;
      finish(reject, error);
    };
    xhr.onerror = () => finish(reject, new Error("Connection lost. Check your connection and retry."));
    xhr.ontimeout = () => finish(reject, new Error("Upload timed out. Check your connection and retry."));
    xhr.onabort = () => finish(reject, new DOMException("Upload cancelled", "AbortError"));
    if (signal?.aborted) return finish(reject, new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(form);
  });
}

export function discardDocumentUpload(id, { keepalive = false } = {}) {
  return apiFetch(`/api/document-uploads/${id}`, { method: "DELETE", keepalive });
}
