"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { getGpsHealth, speedKmhFromMps } from "@/lib/gps";
import { DISPATCH_STATUS as D, TRIP_STATUS as T } from "@/lib/constants";
import { tripProgress } from "@/lib/scheduling/trip-progress";
import { alertMessage } from "@/lib/scheduling/departure-alerts";
import { haversineKm } from "@/lib/geo/distance";
import { cn, formatDateTime, formatDuration, formatTime } from "@/lib/utils";
import {
  ArrowRight,
  CalendarDays,
  CarFront,
  Eye,
  FileText,
  MapPin,
  Radio,
  Shuffle,
  TriangleAlert,
  Users,
  XCircle,
} from "lucide-react";

// Safe numeric coercer — returns a finite number or null.
const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };

// Phase 13 — one dispatch as a scannable operations card.
//
// The board is where a dispatcher decides without opening anything, so the card
// leads with the four things that drive a decision — who, where, which car/driver,
// and when — and demotes everything else. Detail that is only occasionally needed
// (service type, distance, notes, special requests) collapses behind a disclosure
// so a column of cards stays readable at a glance.
//
// Data comes pre-joined from /api/dispatch/by-status (request, vehicle, driver,
// route, latest trip), so rendering a column of these costs one query rather
// than one per card.
//
// Presentational: the caller resolves can() once per page and passes the result
// in as `permissions`, and owns every mutation. This component decides only what
// is *applicable* to the dispatch's current state; the caller decides what the
// signed-in user is *allowed* to do.
function driverName(driver) {
  if (!driver) return null;
  const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ").trim();
  return name || `Driver #${driver.driver_id}`;
}

// One leg of the journey on a single line: planned time on the left, what
// actually happened on the right. Replaces the old four-column scheduled/actual
// grid, which spent most of its height on labels and em dashes.
const LEG_DOT = {
  dep: "bg-blue-500",
  arr: "bg-emerald-500",
};

function TimingLeg({ leg, label, planned, plannedNote, actual, isLive }) {
  const plannedFmt = planned ? formatDateTime(planned) : null;
  const actualFmt = actual ? formatTime(actual) : null;

  // On-time delta, shown only once there is something to compare.
  let delta = null;
  if (planned && actual) {
    const diff = Math.round((new Date(actual) - new Date(planned)) / 60000);
    if (Math.abs(diff) <= 3) delta = { text: "on time", tone: "text-success" };
    else if (diff < 0) delta = { text: `${Math.abs(diff)}m early`, tone: "text-primary" };
    else delta = { text: `${diff}m late`, tone: "text-danger" };
  }

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 min-w-0">
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", LEG_DOT[leg])} aria-hidden="true" />
      <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </span>
      <span className={cn("flex-1 truncate text-xs font-semibold", plannedFmt ? "text-foreground" : "text-foreground-muted font-normal")}>
        {plannedFmt ?? "Not set"}
        {plannedFmt && plannedNote && (
          <span className="ml-1 font-normal text-foreground-muted">{plannedNote}</span>
        )}
        {isLive && (
          <span className="ml-1.5 inline-flex items-center gap-1 text-[11px] font-bold uppercase text-primary align-middle">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            live
          </span>
        )}
      </span>
      <span className="shrink-0 text-xs text-right">
        {actualFmt ? (
          <>
            <span className="font-semibold text-foreground">{actualFmt}</span>
            {delta && <span className={cn("ml-1.5 text-[11px] font-medium", delta.tone)}>{delta.text}</span>}
          </>
        ) : (
          <span className="text-[11px] text-foreground-muted">Pending</span>
        )}
      </span>
    </div>
  );
}
// Departure-alert tone → banner surface. Kept beside PRIORITY_RAIL rather than
// derived, so the danger case reads the same as the overdue-trip rail above.
const ALERT_BANNER = {
  info: "bg-info/10 border-info/25 text-info",
  warning: "bg-warning/10 border-warning/25 text-warning",
  danger: "bg-danger/10 border-danger/30 text-danger",
};

export function DispatchCard({
  dispatch,
  permissions = {},
  isBusy = false,
  alert = null,
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

  const durationMin = num(ds.estimated_duration) ?? num(request?.estimated_duration);

  // Arrival ETA — static while the car hasn't moved, live once GPS streams in.
  const moving = trip && [T.TRIP_STARTED, T.EN_ROUTE, T.ARRIVED, T.IN_PROGRESS].includes(trip.trip_status);
  const dest = ds.destination_location || null;
  const gps = ds.latest_location || null;
  let staticEta = null;
  let liveEta = null;
  if (ds.scheduled_departure) {
    const dep = new Date(ds.scheduled_departure).getTime();
    if (Number.isFinite(dep) && durationMin) staticEta = new Date(dep + durationMin * 60000);
  }
  const gpsIsFresh = gps && getGpsHealth(gps.recorded_at).key === "fresh";
  if (moving && gpsIsFresh && dest?.latitude != null && dest?.longitude != null) {
    const remainingKm = haversineKm(
      { lat: Number(gps.latitude), lng: Number(gps.longitude) },
      { lat: Number(dest.latitude), lng: Number(dest.longitude) }
    );
    const speedKmh = gps.speed_kmh ?? speedKmhFromMps(gps.speed);
    const speed = speedKmh > 3 ? speedKmh : null;
    const recordedAt = gps.recorded_at ? new Date(gps.recorded_at).getTime() : null;
    if (speed && Number.isFinite(recordedAt)) {
      liveEta = new Date(recordedAt + (remainingKm / speed) * 3600 * 1000);
    }
  }
  const arrivalEta = liveEta || staticEta || null;
  const arrivalIsLive = Boolean(liveEta);

  const isOpen = [D.SCHEDULED, D.IN_PROGRESS, D.PENDING_REASSIGNMENT].includes(ds.status);
  const isCompleted = ds.status === D.COMPLETED;
  const isPendingReassignment = ds.status === D.PENDING_REASSIGNMENT;

  const fullyAssigned = Boolean(ds.vehicle_id && ds.driver_id);
  const canCancel = isOpen && permissions.dispatchUpdate;
  const canAssign = (isPendingReassignment || ds.status === D.SCHEDULED) && permissions.dispatchUpdate;
  const canNotes = permissions.dispatchUpdate && !isCompleted;

  const guestName = request?.guest_name || "Unnamed guest";
  const driverNameStr = driverName(driver);
  const guestInitials = guestName.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <Card
      className={cn(
        "rounded-2xl border border-border/70 bg-surface p-4 shadow-xs transition-shadow duration-200 hover:shadow-sm",
        (progress.overdue || alert?.tone === "danger") && "border-danger/40"
      )}
    >
      {/* ── HEADER: Guest + dispatch number + status ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-info/10 text-xs font-bold text-info ring-1 ring-info/15">
            {guestInitials}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-bold tracking-tight text-foreground">{guestName}</h3>
              {priority && <StatusBadge status={priority} entity="priority" />}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-foreground-muted">
              <Link href={`/dispatch/${ds.dispatch_id}`} className="font-data font-semibold transition-colors hover:text-info">
                {ds.dispatch_number || `DSP-${ds.dispatch_id}`}
              </Link>
              {request?.reservation_number && <span className="font-data">· {request.reservation_number}</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-info" aria-hidden="true" />
          <StatusBadge status={ds.status} entity="dispatch" />
        </div>
      </div>
      {/* ── ROUTE ── */}
      <div className="mt-3 rounded-xl border border-border/60 bg-hover/10 p-2">
        <div className="flex items-center gap-2 px-1.5 pb-2 text-xs">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
          <span className="truncate font-semibold text-foreground">{pickup || "—"}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
          <span className="truncate font-semibold text-foreground">{dropoff || "—"}</span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border/60 bg-surface px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
            <CarFront className="h-4 w-4" aria-hidden="true" />
          </span>
          {vehicle ? (
            <div className="min-w-0">
              <p className="truncate font-data text-xs font-semibold text-foreground">{vehicle.plate_number}</p>
              <p className="truncate text-[11px] text-foreground-muted">{vehicle.model || "Vehicle"}</p>
            </div>
          ) : (
            <p className="text-xs font-semibold text-warning">Vehicle unassigned</p>
          )}
          </div>
          <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border/60 bg-surface px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-4 w-4" aria-hidden="true" />
          </span>
          {driverNameStr ? (
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">{driverNameStr.trim()}</p>
              <p className="text-[11px] text-foreground-muted">Driver</p>
            </div>
          ) : (
            <p className="text-xs font-semibold text-warning">Driver unassigned</p>
          )}
          </div>
        </div>
      </div>

      {/* ── TIMING ── */}
      <div className="mt-2 rounded-xl border border-border/50 divide-y divide-border/40">
        <TimingLeg
          leg="dep"
          label="Depart"
          planned={ds.scheduled_departure || null}
          actual={ds.actual_departure || trip?.start_time || null}
        />
        <TimingLeg
          leg="arr"
          label="Arrive"
          planned={ds.scheduled_arrival || arrivalEta || null}
          plannedNote={!ds.scheduled_arrival && arrivalEta ? "est." : null}
          isLive={arrivalIsLive}
          actual={ds.actual_arrival || trip?.end_time || null}
        />
      </div>

      {/* ── PROGRESS — only once the trip is actually moving ── */}
      {progress.pct !== null && (
        <div className="mt-3">
          <ProgressBar value={progress.pct} tone={progress.tone} valueLabel={progress.label} />
        </div>
      )}
      {progress.pct === null && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-foreground-secondary">
          <Radio className="w-3.5 h-3.5 text-primary animate-pulse shrink-0" aria-hidden="true" />
          <span className="font-semibold text-foreground">{progress.label}</span>
          {progress.elapsedMin != null && (
            <span className="text-foreground-muted">· {formatDuration(progress.elapsedMin)} elapsed</span>
          )}
        </div>
      )}

      {/* ── UNASSIGNED WARNING — live countdown when the board supplies an
             alert, static reminder otherwise ── */}
      {isOpen && !fullyAssigned && !alert && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-warning/10 border border-warning/25 px-2.5 py-1.5 text-[11px] font-semibold text-warning">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Needs vehicle &amp; driver before departure
        </div>
      )}
      {isOpen && alert && (
        <div
          className={cn(
            "mt-3 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold",
            ALERT_BANNER[alert.tone] || ALERT_BANNER.warning
          )}
        >
          <TriangleAlert
            className={cn("w-3.5 h-3.5 shrink-0", alert.overdue && "animate-pulse")}
            aria-hidden="true"
          />
          {alertMessage(alert)}
        </div>
      )}

      {/* ── ACTIONS: the primary decision on the right, everything else quiet ── */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button variant="outline" size="sm" asChild className="text-foreground-secondary">
          <Link href={`/dispatch/${ds.dispatch_id}`}>
            <Eye className="w-3.5 h-3.5 mr-1" />
            View Details
          </Link>
        </Button>

        {ds.status === D.IN_PROGRESS && permissions.dispatchRead && (
          <Button variant="outline" size="sm" asChild className="text-foreground-secondary">
            <Link href="/tracking/live-map">
              <Radio className="w-3.5 h-3.5 mr-1" />
              Track
            </Link>
          </Button>
        )}

        {canNotes && (
          <Button
            variant="outline"
            size="sm"
            className="text-foreground-secondary"
            disabled={isBusy}
            onClick={() => onEditNotes?.(ds)}
          >
            <FileText className="w-3.5 h-3.5 mr-1" />
            Notes
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {canCancel && (
            <Button
              variant="outline"
              size="sm"
              className="text-foreground-muted hover:text-danger"
              disabled={isBusy}
              onClick={() => onCancel?.(ds)}
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              Cancel
            </Button>
          )}
          {canAssign && (
            <Button
              variant="default"
              size="sm"
              disabled={isBusy}
              onClick={() => onReassign?.(ds, "assign")}
              className={cn(
                "bg-info text-white shadow-sm hover:bg-info/90",
                isPendingReassignment && "bg-danger hover:bg-danger/90"
              )}
            >
              <Shuffle className="w-3.5 h-3.5 mr-1" />
              {isPendingReassignment ? "Reassign now" : fullyAssigned ? "Reassign" : "Assign"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function DispatchCardSkeleton() {
  return (
    <Card className="rounded-2xl border border-border/70 p-4">
      <div className="animate-pulse space-y-3">
        <div className="flex justify-between">
          <div className="space-y-2">
            <div className="h-4 w-28 rounded bg-hover" />
            <div className="h-3 w-40 rounded bg-hover" />
          </div>
          <div className="h-5 w-20 rounded bg-hover" />
        </div>
        <div className="h-4 w-3/4 rounded bg-hover" />
        <div className="h-[68px] rounded-xl bg-hover" />
        <div className="h-[68px] rounded-xl bg-hover" />
        <div className="h-8 rounded bg-hover" />
      </div>
    </Card>
  );
}
