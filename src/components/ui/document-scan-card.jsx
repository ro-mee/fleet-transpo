import { CheckCircle2, ZoomIn } from "lucide-react";

// Reusable document scan preview block (used across vehicle/driver detail + form pages).
// Renders an attachment tile with a click-to-zoom image and optional metadata lines.
export function DocumentScanCard({ title, icon: Icon, fileUrl, alt = title, meta = [], onPreview }) {
  return (
    <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <Icon className="w-4 h-4 text-primary" /> {title}
        </span>
        {fileUrl ? (
          <span className="text-[11px] text-success font-medium flex items-center gap-0.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Attached
          </span>
        ) : (
          <span className="text-[11px] text-foreground-muted">No Scan</span>
        )}
      </div>
      {meta.map((m) => (
        <p key={m.label} className="text-[11px] text-foreground-secondary">
          {m.label}: <span className="font-medium text-foreground">{m.value}</span>
        </p>
      ))}
      {fileUrl ? (
        <div
          className="rounded-lg overflow-hidden border border-border bg-black/5 aspect-[16/10] relative group cursor-pointer"
          onClick={() => onPreview?.(fileUrl)}
        >
          <img src={fileUrl} alt={alt} className="w-full h-full object-contain" />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium gap-1">
            <ZoomIn className="w-3.5 h-3.5" /> Click to Zoom
          </div>
        </div>
      ) : (
        <p className="text-xs text-foreground-muted italic pt-1">No scan image uploaded.</p>
      )}
    </div>
  );
}
