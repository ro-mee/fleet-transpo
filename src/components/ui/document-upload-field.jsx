"use client";
import { useId, useRef, useState } from "react";
import { Upload, FileText, CheckCircle2, AlertCircle, LockKeyhole, X, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOCUMENT_KINDS, formatFileSize } from "@/lib/uploads/document-policy";
import { cn } from "@/lib/utils";

export function DocumentUploadField({ kind, upload, destination, savedMetadata, hasSavedFile, disabled, scanning }) {
  const id = useId();
  const input = useRef(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState("");
  const policy = DOCUMENT_KINDS[kind];
  const busy = upload.status === "uploading" || upload.status === "storing";
  const metadata = upload.metadata || savedMetadata;
  const filename = upload.file?.name || metadata?.file_name;
  const status = upload.status === "uploaded" ? "Uploaded — awaiting Save" : upload.status === "storing" ? "Storing file…" : upload.status === "uploading" ? "Uploading…" : upload.status === "failed" ? "Upload failed" : upload.status === "cancelled" ? "Upload cancelled — not attached" : hasSavedFile ? "Saved attachment" : "No file selected";
  function choose(files) {
    if (disabled) return;
    if (files.length !== 1) { setDropError("Choose one file for this section."); return; }
    setDropError("");
    void upload.selectFile(files[0]);
  }
  return (
    <div className="space-y-3">
      <input ref={input} id={id} type="file" accept={policy.accept} disabled={disabled} className="sr-only" tabIndex={-1}
        onChange={event => { const files = Array.from(event.target.files || []); if (files.length) choose(files); event.target.value = ""; }} />
      <button type="button" disabled={disabled} onClick={() => input.current?.click()}
        aria-label={`Browse or drop ${policy.label} file`} aria-describedby={`${id}-help`}
        onDragEnter={event => { event.preventDefault(); if (!disabled && event.dataTransfer.types.includes("Files")) { depth.current++; setDragging(true); } }}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
        onDragLeave={event => { event.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
        onDrop={event => { event.preventDefault(); depth.current = 0; setDragging(false); choose(Array.from(event.dataTransfer.files)); }}
        className={cn("w-full rounded-xl border-2 border-dashed border-border bg-muted/20 px-4 py-5 text-center transition-colors hover:border-primary/50 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed", dragging && "border-primary bg-primary/5")}>
        <Upload className="mx-auto mb-2 h-5 w-5 text-primary" aria-hidden="true" />
        <span className="block text-xs font-semibold text-foreground">{dragging ? "Drop to upload" : hasSavedFile || upload.status === "uploaded" ? "Drag a replacement here or browse" : "Drag a file here or browse"}</span>
        <span id={`${id}-help`} className="mt-1 block text-[11px] text-foreground-secondary">{policy.formats}</span>
      </button>
      <div className="flex items-start gap-2 text-[11px] text-foreground-secondary">
        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0"><p>Destination: <span className="font-medium text-foreground">{destination}</span></p>
          <p className="mt-0.5">Private FleetOps storage · access follows record permissions.</p>
          <p className="mt-0.5">Save attaches this file to the record. Unused drafts expire after 24 hours.</p></div>
      </div>
      {(filename || hasSavedFile || upload.status === "cancelled") && (
        <div className="rounded-xl border border-border bg-surface p-3 space-y-2">
          <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[1rem_minmax(0,1fr)_auto]">
            {busy ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" /> : upload.status === "failed" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" /> : upload.status === "uploaded" || hasSavedFile ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <div className="min-w-0 flex-1"><p className="break-all text-xs font-semibold">{filename || (hasSavedFile ? "Current saved document" : "No file attached")}</p>
              {(upload.file?.size || metadata?.size_bytes) && <p className="mt-0.5 text-[11px] text-foreground-secondary">{formatFileSize(upload.file?.size || metadata.size_bytes)} · {(upload.file?.type || metadata?.content_type) === "application/pdf" ? "PDF" : "Image"}</p>}</div>
            {(busy || upload.status === "uploaded" || upload.status === "failed") && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={upload.cancel} className="col-start-2 h-7 justify-self-end px-2 text-xs sm:col-start-auto" aria-label={busy ? "Cancel upload" : "Remove pending attachment"}><X className="mr-1 h-3.5 w-3.5" />{busy ? "Cancel" : "Remove"}</Button>}
          </div>
          {busy && <div role="progressbar" aria-label={`${policy.label} upload`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={upload.status === "uploading" ? upload.percent : undefined} aria-valuetext={status} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none", upload.status === "storing" && "opacity-50")} style={{ width: `${upload.percent}%` }} /></div>}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground-secondary">
            <span role="status" aria-live="polite">{status}</span>
            {upload.status === "uploading" && <span className="font-data tabular-nums">{formatFileSize(upload.bytes)} / {formatFileSize(upload.file.size)} · {upload.percent}%</span>}
            {upload.status === "failed" && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={upload.retry} className="h-7 px-2 text-xs"><RefreshCw className="mr-1 h-3 w-3" />Retry</Button>}
          </div>
          {metadata?.attached_at && upload.status === "idle" && <p className="text-[11px] text-foreground-secondary">Saved {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(metadata.attached_at))}</p>}
        </div>
      )}
      {(dropError || upload.error) && <p role="alert" className="text-xs text-danger">{dropError || upload.error}</p>}
      <p className="text-[11px] text-foreground-secondary">{scanning ? "Reading with Gemini… Review suggested values before saving." : "Auto-fill uses Google Gemini. Review suggested values before saving."}</p>
    </div>
  );
}
