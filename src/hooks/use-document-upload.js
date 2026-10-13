"use client";
import { useEffect, useRef, useState } from "react";
import { uploadDocument, discardDocumentUpload } from "@/services/document-upload.service";
import { validateDocumentFile } from "@/lib/uploads/document-policy";

const EMPTY = { status: "idle", file: null, metadata: null, error: "", percent: 0, bytes: 0 };
export function useDocumentUpload({ kind, targetId, onUploaded, onRestore, onPending }) {
  const [state, setState] = useState({ ...EMPTY, targetId });
  const active = useRef({ sequence: 0, id: null, controller: null, file: null, knownFailure: false, attached: false });
  const callbacks = useRef({ onUploaded, onRestore, onPending });
  useEffect(() => { callbacks.current = { onUploaded, onRestore, onPending }; });

  function discard() {
    const current = active.current;
    current.controller?.abort();
    if (current.id && !current.attached) void discardDocumentUpload(current.id, { keepalive: true }).catch(() => {});
  }
  useEffect(() => () => {
    active.current.sequence++;
    active.current.controller?.abort();
    if (active.current.id && !active.current.attached) void discardDocumentUpload(active.current.id, { keepalive: true }).catch(() => {});
  }, [targetId]);

  async function selectFile(file, retry = false) {
    const validation = validateDocumentFile(file, kind);
    if (validation.error) { setState(previous => ({ ...previous, error: validation.error })); return; }
    const current = active.current;
    if (!retry || current.knownFailure) {
      discard();
      current.id = crypto.randomUUID();
    }
    current.file = file;
    current.attached = false;
    const sequence = ++current.sequence;
    const controller = new AbortController();
    current.controller = controller;
    callbacks.current.onPending?.();
    // A pending replacement keeps the saved preview available in the page.
    setState({ ...EMPTY, targetId, status: "uploading", file });
    try {
      const metadata = await uploadDocument(file, {
        kind, targetId, uploadId: current.id, signal: controller.signal,
        onProgress: progress => { if (sequence === current.sequence) setState(previous => ({ ...previous, ...progress })); },
        onTransferred: () => { if (sequence === current.sequence) setState(previous => ({ ...previous, status: "storing", percent: 100, bytes: file.size })); },
      });
      if (sequence !== current.sequence) return;
      current.knownFailure = false;
      setState({ ...EMPTY, targetId, status: "uploaded", file, metadata, percent: 100, bytes: file.size });
      callbacks.current.onUploaded?.(metadata, file);
    } catch (error) {
      if (sequence !== current.sequence) return;
      current.knownFailure = Boolean(error.status);
      setState({ ...EMPTY, targetId, status: error.name === "AbortError" ? "cancelled" : "failed", file, error: error.name === "AbortError" ? "" : error.message });
    }
  }
  function cancel() {
    active.current.sequence++;
    discard();
    active.current.id = null;
    active.current.file = null;
    callbacks.current.onPending?.();
    callbacks.current.onRestore?.();
    setState({ ...EMPTY, targetId, status: "cancelled" });
  }
  function markSaved() { active.current.attached = true; }
  const visible = state.targetId === targetId ? state : EMPTY;
  return { ...visible, selectFile, cancel, markSaved,
    retry: () => selectFile(active.current.file, true),
    uploadId: visible.metadata?.upload_id || null,
    blocking: Boolean(visible.file && visible.status !== "uploaded"),
  };
}
