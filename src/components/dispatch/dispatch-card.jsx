"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge, TONE_RAIL } from "@/components/ui/status-badge";
import { DISPATCH_STATUS as D } from "@/lib/constants";
import { tripProgress } from "@/lib/scheduling/trip-progress";
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
  Minus,
  PlayCircle,
  Radio,
  Route as RouteIcon,
  Shuffle,
  TrendingDown,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";

// Safe numeric coercer — returns a finite number or null.
const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };

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

function driverName(driver) {
  if (!driver) return null;
  const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ").trim();
  return name || `Driver #${driver.driver_id}`;
}

function Field({ icon: Icon, label, children, className, highlight }) {
  const isBlank = !children || children === "—";
  return (
    <div
      className={cn(
        "rounded-2xl border p-2.5 min-w-0 flex flex-col justify-between transition-colors",
        isBlank
          ? "border-border/30 bg-muted/15"
          : highlight
          ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
          : "border-border/50 bg-hover/40 hover:bg-hover/80",
        className
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3 text-primary/70 shrink-0" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </p>
      <div className="mt-1 flex items-center gap-1.5 min-w-0">
        <span className={cn("truncate text-xs font-bold text-foreground", isBlank && "text-foreground-muted font-normal")}>
          {children ?? "—"}
        </span>
      </div>
    </div>
  );
}

// Paired timing row: shows Scheduled vs Actual for one leg (departure or arrival)
// and computes an on-time delta badge automatically.
const LEG_STYLE = {
  Dep: {
    bg: "bg-blue-500/15 border-blue-500/30",
    text: "text-blue-500",
    icon: "text-blue-400",
    border: "border-blue-500/25",
  },
  Arr: {
    bg: "bg-emerald-500/15 border-emerald-500/30",
    text: "text-emerald-500",
    icon: "text-emerald-400",
    border: "border-emerald-500/25",
  },
};

function TripTimingRow({ leg, scheduledIcon: SIcon, actualIcon: AIcon, scheduled, actual }) {
  // Compute delta in minutes (actual - scheduled, positive = late)
  let deltaLabel = null;
  let deltaStyle = null;
  let DeltaIcon = null;

  if (scheduled && actual) {
    const diff = Math.round((new Date(actual) - new Date(scheduled)) / 60000);
    if (Math.abs(diff) <= 3) {
      deltaLabel = "On time";
      deltaStyle = "bg-success/10 text-success border-success/30";
      DeltaIcon = Minus;
    } else if (diff < 0) {
      deltaLabel = `${Math.abs(diff)}m early`;
      deltaStyle = "bg-primary/10 text-primary border-primary/30";
      DeltaIcon = TrendingUp;
    } else {
      deltaLabel = `${diff}m late`;
      deltaStyle = "bg-danger/10 text-danger border-danger/30";
      DeltaIcon = TrendingDown;
    }
  }

  const style = LEG_STYLE[leg] || LEG_STYLE.Dep;
  const scheduledFmt = scheduled ? formatDateTime(scheduled) : null;
  const actualFmt = actual ? formatTime(actual) : null;

  return (
    <div className={cn("flex items-stretch gap-0 rounded-2xl border overflow-hidden text-xs", style.border, "bg-hover/20")}>
      {/* Left: colored leg strip */}
      <div className={cn("flex items-center justify-center px-2.5 py-2 border-r shrink-0", style.bg, style.border)}>
        <span
          className={cn("text-[11px] font-black uppercase tracking-widest", style.text)}
          style={{ writingMode: "vertical-lr", transform: "rotate(180deg)" }}
        >
          {leg}
        </span>
      </div>

      {/* Middle-left: Scheduled */}
      <div className="flex-1 px-3 py-2 min-w-0 border-r border-border/30">
        <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-foreground-muted mb-0.5">
          {SIcon && <SIcon className={cn("w-3 h-3 shrink-0", style.icon)} />}
          Scheduled
        </p>
        <p className={cn("font-bold truncate text-xs", scheduledFmt ? "text-foreground" : "text-foreground-muted font-normal")}>
          {scheduledFmt ?? "—"}
        </p>
      </div>

      {/* Middle-right: Actual */}
      <div className="flex-1 px-3 py-2 min-w-0">
        <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-foreground-muted mb-0.5">
          {AIcon && <AIcon className={cn("w-3 h-3 shrink-0", style.icon)} />}
          Actual
        </p>
        <p className={cn("font-bold truncate text-xs", actualFmt ? "text-foreground" : "text-foreground-muted font-normal")}>
          {actualFmt ?? "—"}
        </p>
      </div>

      {/* Right: Delta badge */}
      <div className="flex items-center justify-center px-2.5 py-2 shrink-0">
        {deltaLabel ? (
          <span className={cn("inline-flex items-center gap-1 border rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap", deltaStyle)}>
            {DeltaIcon && <DeltaIcon className="w-2.5 h-2.5" />}
            {deltaLabel}
          </span>
        ) : (
          <span className="inline-flex items-center border border-border/40 rounded-full px-2 py-0.5 text-[11px] text-foreground-muted bg-muted/20">
            Pending
          </span>
        )}
      </div>
    </div>
  );
}

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

  const pickup = request?.pickup_location || route?.origin;
  const dropoff = request?.dropoff_location || route?.destination;

  const distanceKm = num(ds.estimated_distance) ?? num(request?.estimated_distance) ?? num(route?.estimated_distance);
  const durationMin = num(ds.estimated_duration) ?? num(request?.estimated_duration);

  const isPendingReassignment = ds.status === D.PENDING_REASSIGNMENT;
  const isScheduled = ds.status === D.SCHEDULED;
  const isInProgress = ds.status === D.IN_PROGRESS;
  const isOpen = isScheduled || isInProgress || isPendingReassignment;
  const isCompleted = ds.status === D.COMPLETED;

  const fullyAssigned = Boolean(ds.vehicle_id && ds.driver_id);
  const hasTrip = Boolean(trip?.trip_id);
  const canStart = isScheduled && permissions.tripsUpdate && fullyAssigned && hasTrip;
  const canComplete = isInProgress && permissions.tripsUpdate && hasTrip;
  const canCancelDispatch = isOpen && permissions.dispatchUpdate;
  const canAssign = (isPendingReassignment || isScheduled) && permissions.dispatchUpdate;
  const canNotes = permissions.dispatchUpdate && !isCompleted;

  const guestName = request?.guest_name || "Unnamed guest";
  const driverNameStr = driverName(driver);

  return (
    <Card
      className={cn(
        "rounded-3xl border border-border/80 bg-surface/95 p-5 shadow-sm hover:shadow-xl transition-all duration-300 backdrop-blur-xl hover:border-primary/40 border-l-4",
        progress.overdue ? TONE_RAIL.danger : PRIORITY_RAIL[priority] || "border-l-border"
      )}
    >
      {/* 1 · Top Header: Guest Name Spotlight + Status Badges */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-foreground tracking-tight truncate">
              {guestName}
            </h3>
            {priority && <StatusBadge status={priority} entity="priority" />}
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-xs text-foreground-muted font-medium">
            <Link
              href={`/dispatch/${ds.dispatch_id}`}
              className="font-data font-bold text-foreground hover:text-primary transition-colors"
            >
              {ds.dispatch_number || `DSP-${ds.dispatch_id}`}
            </Link>
            {request?.reservation_number && (
              <span className="font-data">· {request.reservation_number}</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 flex-wrap justify-end">
          <StatusBadge status={ds.status} entity="dispatch" />
          {request?.fleet_status && request.fleet_status !== ds.status && (
            <StatusBadge status={request.fleet_status} entity="reservation" />
          )}
        </div>
      </div>

      {/* 2 · Origin -> Destination Route Pill */}
      <div className="mt-3.5 flex items-center gap-2 rounded-2xl border border-border/60 bg-hover/40 px-3.5 py-2.5 text-xs shadow-2xs">
        <MapPin className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
        <span className="font-semibold text-foreground truncate max-w-[45%]">{pickup || "—"}</span>
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
        <span className="font-semibold text-foreground truncate max-w-[45%]">{dropoff || "—"}</span>
      </div>

      {/* 3 · Custodial Assignment Banner (Vehicle + Driver Spotlight) */}
      <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-surface px-3 py-2 text-xs">
          <CarFront className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted">Vehicle</p>
            {vehicle ? (
              <p className="font-bold text-foreground truncate">
                <span className="font-data text-xs">{vehicle.plate_number}</span>
                {vehicle.model && <span className="font-normal text-foreground-secondary ml-1">· {vehicle.model}</span>}
              </p>
            ) : (
              <p className="text-xs font-semibold text-amber-500">Unassigned</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-surface px-3 py-2 text-xs">
          <Users className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted">Driver</p>
            {driverNameStr ? (
              <p className="font-bold text-foreground truncate">{driverNameStr}</p>
            ) : (
              <p className="text-xs font-semibold text-amber-500">Unassigned</p>
            )}
          </div>
        </div>
      </div>

      {/* 4 · Trip Progress */}
      <div className="mt-3.5">
        {progress.pct === null ? (
          <div className="flex items-center gap-1.5 text-xs text-foreground-muted font-medium bg-muted/20 px-3 py-1.5 rounded-xl border border-border/30">
            <Radio className="w-3.5 h-3.5 text-primary animate-pulse shrink-0" aria-hidden="true" />
            <span className="font-bold text-foreground">{progress.label}</span>
            {progress.elapsedMin != null && ` · ${formatDuration(progress.elapsedMin)} elapsed`}
          </div>
        ) : (
          <ProgressBar
            value={progress.pct}
            tone={progress.tone}
            label="Trip progress"
            valueLabel={progress.label}
          />
        )}
      </div>

      {/* 5 · Paired Timing Rows — Scheduled vs Actual per leg */}
      <div className="mt-3.5 space-y-1.5">
        <TripTimingRow
          leg="Dep"
          scheduledIcon={CalendarClock}
          actualIcon={PlayCircle}
          scheduled={ds.scheduled_departure || null}
          actual={ds.actual_departure || trip?.start_time || null}
        />
        <TripTimingRow
          leg="Arr"
          scheduledIcon={Clock}
          actualIcon={CheckCircle2}
          scheduled={ds.scheduled_arrival || null}
          actual={ds.actual_arrival || trip?.end_time || null}
        />
      </div>

      {/* 6 · Inline Metadata Chips (Passengers, Service, Estimate) */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        {request?.passenger_count && (
          <span className="inline-flex items-center gap-1 bg-hover/60 border border-border/50 text-foreground-secondary px-2.5 py-1 rounded-full text-[11px] font-semibold">
            <Users className="w-3 h-3 text-foreground-muted" />
            {request.passenger_count} passengers
          </span>
        )}
        {(request?.service_name || request?.requested_vehicle_type) && (
          <span className="inline-flex items-center gap-1 bg-hover/60 border border-border/50 text-foreground-secondary px-2.5 py-1 rounded-full text-[11px] font-semibold">
            <CarFront className="w-3 h-3 text-foreground-muted" />
            {request.service_name || request.requested_vehicle_type}
          </span>
        )}
        {(distanceKm != null || durationMin != null) && (
          <span className="inline-flex items-center gap-1 bg-hover/60 border border-border/50 text-foreground-secondary px-2.5 py-1 rounded-full text-[11px] font-semibold">
            <RouteIcon className="w-3 h-3 text-foreground-muted" />
            {[
              distanceKm != null ? formatDistance(distanceKm) : null,
              durationMin != null ? formatDuration(durationMin) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
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
        {!isCompleted && request && permissions.reservationsRead && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/reservations/${request.request_id}`}>Request</Link>
          </Button>
        )}

        {/* 3 · View the trip record */}
        {!isCompleted && trip && permissions.tripsRead && (
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
        {!isCompleted && route && permissions.routesRead && (
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

        {/* 7 · Assign / reassign vehicle + driver together, as one choice */}
        {canAssign && (
          <Button
            variant={isPendingReassignment ? "default" : "outline"}
            size="sm"
            disabled={isBusy}
            onClick={() => onReassign?.(ds, "assign")}
            className={cn(
              isPendingReassignment && "bg-danger hover:bg-danger/90 text-white font-bold shadow-xs animate-pulse"
            )}
          >
            <Shuffle className="w-3.5 h-3.5 mr-1" />
            {isPendingReassignment ? "Reassign Now" : fullyAssigned ? "Reassign" : "Assign"}
          </Button>
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
          <Badge variant="outline" className="text-[11px]">
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

