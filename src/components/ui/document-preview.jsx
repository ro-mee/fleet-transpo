import { FileText } from "lucide-react";
import { isPdfDocument } from "@/lib/uploads/document-policy";

export function DocumentPreview({ url, contentType, alt = "Document scan", expanded = false }) {
  if (isPdfDocument(url, contentType)) {
    return <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 p-4 text-foreground-secondary"><FileText className="h-10 w-10" /><span className="text-xs font-medium">PDF document</span>{expanded ? <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-2 text-xs font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open PDF in new tab</a> : <span className="text-xs">Open to preview</span>}</div>;
  }
  return <img src={url} alt={alt} className="h-full w-full object-contain" />;
}
