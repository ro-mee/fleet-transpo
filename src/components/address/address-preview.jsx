"use client";

import { MapPin, StickyNote } from "lucide-react";
import { composeStructuredLines } from "@/lib/address/structured";
import { cn } from "@/lib/utils";

// The formatted address, composed live as the operator fills the form.
//
// It is a PREVIEW of what will be stored, not a separate rendering: the submit
// path writes `formatStructuredAddress(value)` to `addresses.formatted_address`,
// which is the same function this calls, so what is on screen is what goes in the
// row. Two renderings that merely look alike is how a preview starts lying.
//
// Landmark and delivery notes are shown SEPARATELY, below the address, and are
// deliberately not part of the composed lines. "Near the main gate" is an
// instruction to a driver, not a postal line, and `formatted_address` is read by
// things that would treat it as one.

export function AddressPreview({ value, className }) {
  const lines = composeStructuredLines(value);
  const hasGeography = Boolean(
    value.regionCode || value.cityCode || value.psgcBarangayCode
  );
  const notes = [value.landmark, value.additionalDetails].filter(
    (note) => typeof note === "string" && note.trim()
  );

  return (
    <div className={cn("rounded-2xl border border-border bg-surface p-4", className)}>
      <div className="mb-2.5 flex items-center gap-2">
        <MapPin className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <span className="text-[0.68rem] font-bold uppercase tracking-[0.11em] text-foreground-muted">
          Address preview
        </span>
      </div>

      {hasGeography || value.streetRoad ? (
        <address className="text-sm not-italic leading-relaxed text-foreground">
          {lines.map((line, index) => (
            // Keyed by position: these are ordered display lines, and the same
            // text can legitimately appear twice (a barangay named after its
            // city, a subdivision sharing the street name). An index key is the
            // honest choice for an ordered list with no identity of its own.
            <span key={index} className="block">
              {line}
            </span>
          ))}
        </address>
      ) : (
        <p className="text-sm text-foreground-muted/70">
          Pick a region to start building the address.
        </p>
      )}

      {notes.length > 0 && (
        <div className="mt-3 flex gap-2 border-t border-border/60 pt-3">
          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.11em] text-foreground-muted">
              Delivery notes
            </p>
            {notes.map((note, index) => (
              <p key={index} className="text-xs text-foreground-secondary">
                {note}
              </p>
            ))}
            <p className="mt-1 text-[0.68rem] text-foreground-muted">
              Not part of the saved address — shown to whoever delivers here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
