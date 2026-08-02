"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge, TONE_RAIL } from "@/components/ui/status-badge";
import { DISPATCH_STATUS as D } from "@/lib/constants";
import { cn, formatDateTime, formatDistance, formatDuration, formatTime } from "@/lib/utils";
import {
  ArrowRight,
  CalendarClock,
  CarFront,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  MapPin,
  PlayCircle,
  Radio,
  Route as RouteIcon,
  Shuffle,
  Users,
  XCircle,
} from "lucide-react";

// Phase 13 — one dispatch as a dense operations card.
//
// The board is where a dispatcher decides without opening anything, so every
// field the decision needs is on the card. Data comes pre-joined from
// /api/dispatch/by-status (request, vehicle, driver, route, latest trip), so
// rendering a column of these costs one query rather than one per card.
//
// Presentational: the caller resolves can() once per page and passes the result
// in as `permissions`, and owns every mutation. This component decides only what
// is *applicable* to the dispatch's current state; the caller decides what the
// signed-in user is *allowed* to do.
const PRIORITY_RAIL = {
  Urgent: "border-l-danger",
  High: "border-l-warning",
  Medium: "border-l-border",
  Low: "border-l-border",
};

// pg returns DECIMAL as a string; formatDistance calls .toFixed on its argument.
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function driverName(driver) {
  if (!driver) return null;
  const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ").trim();
  return name || `Driver #${driver.driver_id}`;
}

/**
 * How far along is this dispatch?
 *
 * Completed and Cancelled are certain. In Progress is measured against the
 * planned window — actual departure to scheduled arrival, falling back to an
 * estimated duration. When neither exists there is no honest denominator, so
 * `pct` comes back null and the caller renders elapsed time as text instead of
 * inventing a bar position.
 */
export function tripProgress(dispatch) {
  const status = dispatch?.status;
  const trip = dispatch?.latest_trip;
  const request = dispatch?.transportation_requests;

  if (status === D.COMPLETED) return { pct: 100, tone: "success", label: "Complete" };
  if (status === D.CANCELLED) return { pct: 0, tone: "secondary", label: "Cancelled" };

  if (status === D.SCHEDULED) {
    return {
      pct: trip ? 8 : 0,
      tone: "info",
      label: trip ? "Trip created, not started" : "Awaiting departure",
    };
  }

  // In Progress — measure elapsed against whatever plan we actually have.
  const departedAt = dispatch?.actual_departure || trip?.start_time;
  const departed = departedAt ? new Date(departedAt).getTime() : null;
  if (!departed || Number.isNaN(departed)) {
    return { pct: null, tone: "primary", label: "Underway" };
  }

  const elapsedMin = Math.max(0, Math.round((Date.now() - departed) / 60000));

  const arrival = dispatch?.scheduled_arrival
    ? new Date(dispatch.scheduled_arrival).getTime()
    : null;
  let plannedMin = null;
  if (arrival && !Number.isNaN(arrival) && arrival > departed) {
    plannedMin = Math.round((arrival - departed) / 60000);
  } else {
    plannedMin = num(dispatch?.estimated_duration) ?? num(request?.estimated_duration);
  }

  if (!plannedMin || plannedMin <= 0) {
    return { pct: null, tone: "primary", label: "Underway", elapsedMin };
  }

  const raw = Math.round((elapsedMin / plannedMin) * 100);
  const overdue = raw > 100;
  return {
    // Never 0 or 100 while underway: the trip has demonstrably started and has
    // demonstrably not finished, so neither endpoint would be true.
    pct: Math.min(97, Math.max(5, raw)),
    tone: overdue ? "danger" : "primary",
    label: overdue ? `${elapsedMin - plannedMin}m over plan` : `${elapsedMin}m of ~${plannedMin}m`,
    elapsedMin,
    plannedMin,
    overdue,
  };
}

function Field({ icon: Icon, label, children, className, mono }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-foreground-muted">{label}</p>
      <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
        {Icon && (
          <Icon className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
        )}
        <span
          className={cn(
            "truncate text-sm text-foreground-secondary",
            mono && "font-data text-xs"
          )}
        >
          {children ?? "—"}
        </span>
      </div>
    </div>
  );
}
/**
 * The 17 fields, in the order a dispatcher reads them:
 *   1 dispatch number   2 dispatch status   3 priority
 *   4 reservation no.   5 guest             6 request lifecycle status
 *   7 pickup            8 dropoff
 *   9 scheduled departure  10 scheduled arrival
 *  11 actual departure    12 actual arrival
 *  13 vehicle          14 driver           15 passengers
 *  16 service type     17 estimated distance / duration
 * plus the trip progress bar, route, and notes.
 */
export function DispatchCard({
  dispatch,
  permissions = {},
  isBusy = false,
  onStart,
  onComplete,
  onCancel,
  onReassign,
  onEditNotes,
}) {
  const ds = dispatch;
  const request = ds.transportation_requests || null;
  const vehicle = ds.vehicles || null;
  const driver = ds.drivers || null;
  const route = ds.routes || null;
  const trip = ds.latest_trip || null;

  const progress = tripProgress(ds);
  const priority = ds.priority || request?.priority;

  // Locations live on the request; a dispatch created without one falls back to
  // its route's endpoints so the card is never blank about where it is going.
  const pickup = request?.pickup_location || route?.origin;
  const dropoff = request?.dropoff_location || route?.destination;

  const distanceKm = num(ds.estimated_distance) ?? num(request?.estimated_distance) ?? num(route?.estimated_distance);
  const durationMin = num(ds.estimated_duration) ?? num(request?.estimated_duration);

  const isScheduled = ds.status === D.SCHEDULED;
  const isInProgress = ds.status === D.IN_PROGRESS;
  const isOpen = isScheduled || isInProgress;

  // Actions are offered only when they are BOTH applicable to this state and
  // permitted for this user. Each verb matches the role list its endpoint
  // enforces — the button being hidden is a convenience, not the boundary.
  // Start and Complete act on the TRIP, not the dispatch row: only the trip
  // endpoints advance the originating request and write its timeline. So both
  // need a trip to exist. ensureTripForDispatch() creates one as soon as a
  // dispatch has both a vehicle and a driver, which is also exactly when it is
  // startable — so in practice "fully assigned" and "has a trip" coincide, and
  // the two conditions are checked separately only so the card can say which
  // one is missing.
  const fullyAssigned = Boolean(ds.vehicle_id && ds.driver_id);
  const hasTrip = Boolean(trip?.trip_id);
  const canStart = isScheduled && permissions.tripsUpdate && fullyAssigned && hasTrip;
  const canComplete = isInProgress && permissions.tripsUpdate && hasTrip;
  const canCancelDispatch = isOpen && permissions.dispatchUpdate;
  const canReassign = isOpen && permissions.dispatchUpdate;
  const canNotes = permissions.dispatchUpdate;

  return (
    <Card
      className={cn(
        "border-l-4 p-4 transition-shadow hover:shadow-sm",
        progress.overdue ? TONE_RAIL.danger : PRIORITY_RAIL[priority] || "border-l-border"
      )}
    >
      {/* 1–3 · identity, dispatch status, priority */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dispatch/${ds.dispatch_id}`}
              className="font-data text-sm font-medium text-foreground hover:underline"
            >
              {ds.dispatch_number || `DSP-${ds.dispatch_id}`}
            </Link>
            {priority && <StatusBadge status={priority} entity="priority" />}
          </div>

          {/* 4–5 · the request this dispatch fulfils, and whose trip it is */}
          <p className="mt-0.5 truncate text-sm text-foreground-secondary">
            {request ? (
              <>
                {request.guest_name || "Unnamed guest"}
                {request.reservation_number && (
                  <span className="font-data text-xs text-foreground-muted">
                    {" "}
                    · {request.reservation_number}
                  </span>
                )}
              </>
            ) : (
              <span className="text-foreground-muted">No linked request</span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge status={ds.status} entity="dispatch" />
          {/* 6 · the request's own lifecycle status, which can lag the dispatch */}
          {request?.fleet_status && (
            <StatusBadge status={request.fleet_status} entity="reservation" />
          )}
        </div>
      </div>

      {/* 7–8 · route */}
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-hover/50 px-3 py-2 text-sm">
        <MapPin className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
        <span className="truncate text-foreground-secondary">{pickup || "—"}</span>
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
        <span className="truncate text-foreground-secondary">{dropoff || "—"}</span>
      </div>

      {/* Trip progress. Rendered as text when there is no honest denominator. */}
      <div className="mt-3">
        {progress.pct === null ? (
          <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
            <Radio className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
            {progress.label}
            {progress.elapsedMin != null && ` · ${formatDuration(progress.elapsedMin)} elapsed`}
            <span className="text-foreground-muted">· no ETA on file</span>
          </p>
        ) : (
          <ProgressBar
            value={progress.pct}
            tone={progress.tone}
            label="Trip progress"
            valueLabel={progress.label}
          />
        )}
      </div>

      {/* 9–17 · the operational detail */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        <Field icon={CalendarClock} label="Scheduled departure">
          {ds.scheduled_departure ? formatDateTime(ds.scheduled_departure) : null}
        </Field>
        <Field icon={Clock} label="Scheduled arrival">
          {ds.scheduled_arrival ? formatDateTime(ds.scheduled_arrival) : null}
        </Field>
        <Field icon={PlayCircle} label="Actual departure">
          {ds.actual_departure
            ? formatTime(ds.actual_departure)
            : trip?.start_time
              ? formatTime(trip.start_time)
              : null}
        </Field>
        <Field icon={CheckCircle2} label="Actual arrival">
          {ds.actual_arrival
            ? formatTime(ds.actual_arrival)
            : trip?.end_time
              ? formatTime(trip.end_time)
              : null}
        </Field>
        <Field icon={CarFront} label="Vehicle">
          {vehicle
            ? `${vehicle.plate_number}${vehicle.model ? ` · ${vehicle.model}` : ""}`
            : null}
        </Field>
        <Field icon={Users} label="Driver">
          {driverName(driver)}
        </Field>
        <Field label="Passengers">{request?.passenger_count ?? null}</Field>
        <Field label="Service">
          {request?.service_name || request?.requested_vehicle_type || null}
        </Field>
        <Field icon={RouteIcon} label="Estimate">
          {distanceKm != null || durationMin != null
            ? [
                distanceKm != null ? formatDistance(distanceKm) : null,
                durationMin != null ? formatDuration(durationMin) : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : null}
        </Field>
      </div>

      {(route?.route_name || ds.notes || request?.special_requests) && (
        <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
          {route?.route_name && (
            <p className="flex items-center gap-1.5 text-foreground-muted">
              <RouteIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{route.route_name}</span>
            </p>
          )}
          {request?.special_requests && (
            <p className="flex items-start gap-1.5 text-foreground-secondary">
              <FileText className="mt-0.5 w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
              <span className="min-w-0">{request.special_requests}</span>
            </p>
          )}
          {ds.notes && (
            <p className="flex items-start gap-1.5 text-foreground-secondary">
              <FileText className="mt-0.5 w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
              <span className="min-w-0">{ds.notes}</span>
            </p>
          )}
        </div>
      )}

      {/* The 11 actions. Read-only links first, then state changes. */}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-border pt-3">
        {/* 1 · View dispatch */}
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/dispatch/${ds.dispatch_id}`}>
            <Eye className="w-3.5 h-3.5 mr-1" />
            Details
          </Link>
        </Button>

        {/* 2 · View originating request */}
        {request && permissions.reservationsRead && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/reservations/${request.request_id}`}>Request</Link>
          </Button>
        )}

        {/* 3 · View the trip record */}
        {trip && permissions.tripsRead && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/trips?trip=${trip.trip_id}`}>Trip</Link>
          </Button>
        )}

        {/* 4 · Follow it on the live map */}
        {isInProgress && permissions.dispatchRead && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/tracking/live-map">
              <Radio className="w-3.5 h-3.5 mr-1" />
              Track
            </Link>
          </Button>
        )}

        {/* 5 · View the planned route */}
        {route && permissions.routesRead && (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/routes">Route</Link>
          </Button>
        )}

        {/* 6 · Notes */}
        {canNotes && (
          <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => onEditNotes?.(ds)}>
            <FileText className="w-3.5 h-3.5 mr-1" />
            Notes
          </Button>
        )}

        {/* 7–8 · Reassign vehicle / driver — one dialog, prefilled to the side clicked */}
        {canReassign && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => onReassign?.(ds, "vehicle")}
            >
              <Shuffle className="w-3.5 h-3.5 mr-1" />
              Vehicle
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => onReassign?.(ds, "driver")}
            >
              <Shuffle className="w-3.5 h-3.5 mr-1" />
              Driver
            </Button>
          </>
        )}

        {/* 9 · Cancel */}
        {canCancelDispatch && (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            disabled={isBusy}
            onClick={() => onCancel?.(ds)}
          >
            <XCircle className="w-3.5 h-3.5 mr-1" />
            Cancel
          </Button>
        )}

        {/* 10 · Start */}
        {canStart && (
          <Button size="sm" disabled={isBusy} onClick={() => onStart?.(ds)}>
            <PlayCircle className="w-3.5 h-3.5 mr-1" />
            Start Trip
          </Button>
        )}
        {isScheduled && permissions.dispatchUpdate && !canStart && (
          <Badge variant="outline" className="text-[10px]">
            Needs vehicle &amp; driver
          </Badge>
        )}

        {/* 11 · Complete */}
        {canComplete && (
          <Button variant="success" size="sm" disabled={isBusy} onClick={() => onComplete?.(ds)}>
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            Complete
          </Button>
        )}
      </div>
    </Card>
  );
}

export function DispatchCardSkeleton() {
  return (
    <Card className="border-l-4 border-l-border p-4">
      <div className="animate-pulse space-y-3">
        <div className="flex justify-between">
          <div className="space-y-2">
            <div className="h-4 w-28 rounded bg-hover" />
            <div className="h-3 w-40 rounded bg-hover" />
          </div>
          <div className="h-5 w-20 rounded bg-hover" />
        </div>
        <div className="h-9 rounded-lg bg-hover" />
        <div className="h-4 rounded bg-hover" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-hover" />
          ))}
        </div>
      </div>
    </Card>
  );
}

