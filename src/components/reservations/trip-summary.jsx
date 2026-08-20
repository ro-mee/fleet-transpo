"use client";

import { useEffect, useState } from "react";
import { Clock, Route } from "lucide-react";
import { cn, formatDateTime, formatDistance, formatDuration } from "@/lib/utils";

/**
 * A live "now" that ticks every 30s, so countdowns and "X ago" stay current.
 */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Pickup countdown + trip estimate box.
 *
 * Lives on the request-context (left) side of the AI-Assisted Assignment dialog
 * so dispatchers read "how soon is pickup, how far is the run, which route" at a
 * glance, separate from the recommendation itself. `trip` streams up from the
 * panel via its `onTrip` callback, so this card only renders once the scorer has
 * answered - the countdown is immediate.
 */
export function TripEstimateCard({ pickupAt = null, trip = null, className }) {
  const now = useNow();

  let remaining = null;
  let tone = null;
  if (pickupAt) {
    const t = new Date(pickupAt).getTime();
    if (Number.isFinite(t)) {
      const mins = Math.floor((t - now) / 60_000);
      remaining = mins >= 0 ? `${mins} min${mins === 1 ? "" : "s"} remaining` : "Pickup time passed";
      tone = mins < 30 ? "text-danger" : mins < 60 ? "text-warning" : "text-success";
    }
  }

  const hasEstimate = trip && (trip.estimated_distance_km != null || trip.estimated_travel_minutes != null);

  return (
    <div className={cn("rounded-xl border border-border/80 bg-surface shadow-xs p-3.5 space-y-2.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          Pickup &amp; Trip Estimate
        </span>
        {remaining && (
          <span
            className={cn(
              "inline-flex items-center rounded-full bg-hover px-2 py-0.5 text-[11px] font-bold",
              tone
            )}
          >
            {remaining}
          </span>
        )}
      </div>

      {pickupAt && <p className="text-sm font-bold text-foreground">{formatDateTime(pickupAt)}</p>}

      {hasEstimate ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {trip.estimated_distance_km != null && (
            <span className="flex items-center gap-1.5 text-foreground font-medium">
              <Route className="w-3.5 h-3.5 text-foreground-muted" aria-hidden="true" />
              ~{formatDistance(trip.estimated_distance_km)}
            </span>
          )}
          {trip.estimated_travel_minutes != null && (
            <span className="flex items-center gap-1.5 text-foreground font-medium">
              <Clock className="w-3.5 h-3.5 text-foreground-muted" aria-hidden="true" />
              ~{formatDuration(trip.estimated_travel_minutes)}
            </span>
          )}
        </div>
      ) : (
        trip && <p className="text-xs text-foreground-muted">Trip estimate unavailable.</p>
      )}

      {trip?.estimate_basis && (
        <p className="flex items-start gap-1.5 text-xs text-foreground-secondary leading-relaxed">
          <Route className="w-3.5 h-3.5 text-foreground-muted shrink-0 mt-0.5" aria-hidden="true" />
          <span>{trip.estimate_basis}</span>
        </p>
      )}
    </div>
  );
}