"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge, TONE_RAIL } from "@/components/ui/status-badge";
import { DISPATCH_STATUS as D, TRIP_STATUS as T } from "@/lib/constants";
import { tripProgress } from "@/lib/scheduling/trip-progress";
import { alertMessage } from "@/lib/scheduling/departure-alerts";
import { haversineKm } from "@/lib/geo/distance";
import { cn, formatDateTime, formatDistance, formatDuration, formatTime } from "@/lib/utils";
import {
  ArrowRight,
  CarFront,
  ChevronDown,
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
          <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-primary align-middle">
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

  const distanceKm = num(ds.estimated_distance) ?? num(request?.estimated_distance) ?? num(route?.estimated_distance);
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
  if (moving && gps && dest?.latitude != null && dest?.longitude != null) {
    const remainingKm = haversineKm(
      { lat: Number(gps.latitude), lng: Number(gps.longitude) },
      { lat: Number(dest.latitude), lng: Number(dest.longitude) }
    );
    const speed = Number(gps.speed) > 3 ? Number(gps.speed) : null;
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

  const hasMeta = distanceKm != null || durationMin != null ||
    request?.service_name || request?.requested_vehicle_type || request?.passenger_count ||
    ds.notes || request?.special_requests;

  return (
    <Card
      className={cn(
        "rounded-2xl border border-border/70 bg-surface p-4 shadow-sm hover:shadow-md transition-all duration-200 border-l-[3px]",
        progress.overdue || alert?.tone === "danger"
          ? TONE_RAIL.danger
          : PRIORITY_RAIL[priority] || "border-l-border"
      )}
    >
      {/* ── HEADER: Guest + dispatch number + status ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-foreground tracking-tight truncate">
              {guestName}
            </h3>
            {priority && priority !== "Medium" && <StatusBadge status={priority} entity="priority" />}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-foreground-muted">
            <Link
              href={`/dispatch/${ds.dispatch_id}`}
              className="font-data font-semibold text-foreground/80 hover:text-primary transition-colors"
            >
              {ds.dispatch_number || `DSP-${ds.dispatch_id}`}
            </Link>
            {request?.reservation_number && (
              <span className="font-data opacity-60">· {request.reservation_number}</span>
            )}
          </div>
        </div>
        <StatusBadge status={ds.status} entity="dispatch" />
      </div>
      {/* ── ROUTE ── */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <MapPin className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
        <span className="font-semibold text-foreground truncate">{pickup || "—"}</span>
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
        <span className="font-semibold text-foreground truncate">{dropoff || "—"}</span>
      </div>

      {/* ── ASSIGNMENT: vehicle + driver on one line each ── */}
      <div className="mt-3 rounded-xl border border-border/50 bg-hover/30 divide-y divide-border/40">
        <div className="flex items-center gap-2.5 px-3 py-2 min-w-0">
          <CarFront className="w-3.5 h-3.5 text-foreground-muted shrink-0" aria-hidden="true" />
          {vehicle ? (
            <p className="text-xs truncate">
              <span className="font-data font-semibold text-foreground">{vehicle.plate_number}</span>
              {vehicle.model && <span className="text-foreground-secondary ml-1.5">{vehicle.model}</span>}
            </p>
          ) : (
            <p className="text-xs font-semibold text-warning">Vehicle unassigned</p>
          )}
        </div>
        <div className="flex items-center gap-2.5 px-3 py-2 min-w-0">
          <Users className="w-3.5 h-3.5 text-foreground-muted shrink-0" aria-hidden="true" />
          {driverNameStr ? (
            <p className="text-xs font-semibold text-foreground truncate">{driverNameStr.trim()}</p>
          ) : (
            <p className="text-xs font-semibold text-warning">Driver unassigned</p>
          )}
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
      {progress.pct !== null && progress.pct > 0 && (
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

      {/* ── DETAILS — collapsed by default so the card stays scannable ── */}
      {hasMeta && (
        <details className="group mt-3">
          <summary className="flex items-center gap-1 cursor-pointer list-none text-[11px] font-semibold text-foreground-muted hover:text-foreground transition-colors">
            <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" aria-hidden="true" />
            Trip details
          </summary>
          <div className="mt-2 space-y-2 text-xs">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-foreground-secondary">
              {request?.passenger_count && (
                <span><span className="text-foreground-muted">Passengers</span> {request.passenger_count}</span>
              )}
              {(request?.service_name || request?.requested_vehicle_type) && (
                <span><span className="text-foreground-muted">Service</span> {request.service_name || request.requested_vehicle_type}</span>
              )}
              {(distanceKm != null || durationMin != null) && (
                <span>
                  <span className="text-foreground-muted">Estimate</span>{" "}
                  {[
                    distanceKm != null ? formatDistance(distanceKm) : null,
                    durationMin != null ? formatDuration(durationMin) : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            {request?.special_requests && (
              <p className="flex items-start gap-1.5 text-foreground-secondary">
                <FileText className="mt-0.5 w-3 h-3 shrink-0 text-foreground-muted" aria-hidden="true" />
                <span className="min-w-0">{request.special_requests}</span>
              </p>
            )}
            {/* Dispatcher notes often restate the request verbatim — skip the echo. */}
            {ds.notes && ds.notes !== request?.special_requests && (
              <p className="flex items-start gap-1.5 text-foreground-secondary">
                <FileText className="mt-0.5 w-3 h-3 shrink-0 text-foreground-muted" aria-hidden="true" />
                <span className="min-w-0">{ds.notes}</span>
              </p>
            )}
          </div>
        </details>
      )}

      {/* ── ACTIONS: the primary decision on the right, everything else quiet ── */}
      <div className="mt-3 flex items-center gap-1 border-t border-border/60 pt-3">
        <Button variant="ghost" size="sm" asChild className="text-foreground-secondary">
          <Link href={`/dispatch/${ds.dispatch_id}`}>
            <Eye className="w-3.5 h-3.5 mr-1" />
            Details
          </Link>
        </Button>

        {ds.status === D.IN_PROGRESS && permissions.dispatchRead && (
          <Button variant="ghost" size="sm" asChild className="text-foreground-secondary">
            <Link href="/tracking/live-map">
              <Radio className="w-3.5 h-3.5 mr-1" />
              Track
            </Link>
          </Button>
        )}

        {canNotes && (
          <Button
            variant="ghost"
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
              variant="ghost"
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
              variant={isPendingReassignment || !fullyAssigned ? "default" : "outline"}
              size="sm"
              disabled={isBusy}
              onClick={() => onReassign?.(ds, "assign")}
              className={cn(isPendingReassignment && "bg-danger hover:bg-danger/90 text-white")}
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
    <Card className="rounded-2xl border-l-[3px] border-l-border p-4">
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
