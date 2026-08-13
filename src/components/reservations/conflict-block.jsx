"use client";

import { ConflictChips } from "@/components/reservations/conflict-chips";
import { AlertTriangle } from "lucide-react";

// The "here is what blocks this assignment" surface.
//
// The assign endpoint answers a blocking conflict with 409 and the findings on
// `data.conflicts`; both the queue's assign dialog and the AI panel need to show
// those findings next to an explicit override. Extracted here so there is exactly
// one rendering of an override decision — the dispatcher sees the same messages,
// worded by the server, wherever the override is offered.
//
// Presentational only: the caller owns the override button, because only the
// caller knows what it is overriding.
export function ConflictBlock({ conflicts = [], title, className }) {
  if (!conflicts.length) return null;

  const heading =
    title ||
    `Assignment blocked by ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`;

  return (
    <div className={className}>
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{heading}</p>
            <ul className="mt-1 space-y-0.5 text-sm text-foreground-secondary">
              {conflicts.map((c, i) => (
                <li key={`${c.type}-${i}`}>· {c.message}</li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap">
              <ConflictChips conflicts={conflicts} max={conflicts.length} />
            </div>
            <p className="mt-1 text-xs text-foreground-muted">
              Overriding is recorded on the request timeline.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
