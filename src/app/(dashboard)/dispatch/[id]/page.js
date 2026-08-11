"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { DispatchEditDialog } from "@/components/dispatch/dispatch-edit-dialog";
import { tripProgress } from "@/lib/scheduling/trip-progress";
import { ReservationTimeline } from "@/components/reservations/reservation-timeline";
import { useRoleAccess } from "@/hooks/use-role-access";
import { useRequireRole } from "@/lib/auth/role-guard";
import { getDispatch, updateDispatch, updateDispatchStatus } from "@/services/dispatch.service";
import { DISPATCH_STATUS as D } from "@/lib/constants";
import { formatDateTime, formatDistance, formatDuration, cn } from "@/lib/utils";
import {
  ArrowLeft,
  CalendarClock,
  CarFront,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  MapPin,
  Navigation,
  PlayCircle,
  Route as RouteIcon,
  Send,
  StickyNote,
  TriangleAlert,
  User,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";

// Phase 17 — the dispatch detail page.
//
// Rewritten off `vehiclereservations`. The old page read
// `dispatch.estimated_distance` (dropped by migration 007 as a route property) and
// `dispatch.vehiclereservations.*` (now a legacy FK target whose guest columns 015
// deprecates), so the distance card always read "— km" and the guest panel never
// rendered at all. Both now come from the originating transportation request.
//
// Actions mirror the board exactly, and for the same reason: Start and Complete go
// through the TRIP endpoints, never PUT /api/dispatch/[id]/status. Only the trip
// routes advance the originating request and append its reservation_events row —
// moving the dispatch column alone would leave the request behind and punch a hole
// in the timeline rendered further down this very page.
//
// Styling follows the reservation detail page (`/reservations/[id]`): the two pages
// describe the same journey from either side of the handoff, so they share the
// banner, the 7/5 column split, the tinted section headers and the Field shell.

// pg returns DECIMAL columns as strings, and formatDistance() calls .toFixed() on
// what it is given — so every numeric read goes through here before formatting.
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// Matches the reservation detail page's Field so the two records read as one
// system. Values wrap rather than truncate — a route or a special request that
// silently loses its tail is worse than one that takes a second line.
function Field({ icon: Icon, label, value, children, tone = "text-foreground-muted", href, className }) {
  const content = children ?? value;
  const body = (
    <>
      <p className="text-xs font-medium text-foreground-secondary flex items-center gap-1.5">
        {Icon && <Icon className={cn("w-3.5 h-3.5 shrink-0", tone)} />}
        {label}
      </p>
      <p className="text-sm font-semibold text-foreground break-words">{content ?? "—"}</p>
    </>
  );
  return (
    <div
      className={cn(
        "min-w-0 p-4 rounded-xl bg-muted/20 border border-border/40 space-y-1.5",
        className
      )}
    >
      {href ? (
        <Link href={href} className="block hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

/** Section shell shared by every panel below, mirroring the reservation page. */
function Section({ icon: Icon, iconClass, title, description, children, className }) {
  return (
    <Card className={cn("border-0 shadow-sm rounded-2xl", className)}>
      <CardHeader className="pb-3 border-b border-border/60">
        <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
          <div className={cn("p-2 rounded-xl", iconClass)}>
            <Icon className="w-4 h-4" />
          </div>
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}

/** Prominent origin/destination block — the same treatment the reservation page gives it. */
function Endpoint({ label, value, tone }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-muted/20 border border-border/50 p-4">
      <MapPin className={cn("mt-0.5 w-4 h-4 shrink-0", tone)} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">{label}</p>
        <p className="text-base font-bold text-foreground break-words mt-0.5">{value || "—"}</p>
      </div>
    </div>
  );
}

export default function DispatchDetailPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  const dispatchId = Number(params.id);

  const [editing, setEditing] = useState(null); // { dispatch, mode }
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const {
    data: dispatch,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["dispatch", dispatchId],
    queryFn: () => getDispatch(dispatchId),
    enabled: Number.isFinite(dispatchId),
    // A trip can start or finish from the driver's phone while this page is open.
    refetchInterval: 30_000,
  });

  const permissions = useMemo(
    () => ({
      dispatchUpdate: can("dispatch", "update"),
      tripsUpdate: can("trips", "update"),
      reservationsRead: can("reservations", "read"),
    }),
    [can]
  );

  const invalidate = () => {
    for (const key of [
      ["dispatch", dispatchId],
      ["dispatches-status"],
      ["dispatches"],
      ["vehicles"],
      ["drivers"],
      ["transport-requests"],
      ["reservation-timeline"],
      ["trips"],
      ["trips-active"],
    ]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const cancelMutation = useMutation({
    mutationFn: () => updateDispatchStatus(dispatchId, D.CANCELLED, cancelReason.trim() || null),
    onSuccess: () => {
      toast.success("Dispatch cancelled");
      setConfirmCancel(false);
      setCancelReason("");
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to cancel the dispatch"),
  });

  const patchMutation = useMutation({
    mutationFn: ({ patch }) => updateDispatch(dispatchId, patch),
    onSuccess: (_res, { patch }) => {
      toast.success(patch.notes !== undefined ? "Notes saved" : "Dispatch updated");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to update the dispatch"),
  });

  if (isLoading) return <DetailSkeleton />;

  if (isError) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Could not load this dispatch"
        description={error?.message || "Something went wrong reading the dispatch."}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  }

  if (!dispatch) {
    return (
      <EmptyState
        icon={Send}
        title="Dispatch not found"
        description="It may have been removed, or the link is wrong."
        action={
          <Button variant="outline" onClick={() => router.push("/dispatch")}>
            Back to the board
          </Button>
        }
      />
    );
  }

  const request = dispatch.transportation_requests || null;
  const vehicle = dispatch.vehicles || null;
  const driver = dispatch.drivers || null;
  const route = dispatch.routes || null;
  const trip = dispatch.latest_trip || null;
  const progress = tripProgress(dispatch);
  const priority = dispatch.priority || request?.priority;

  // Locations live on the request; a dispatch raised without one falls back to its
  // route's endpoints so the page is never blank about where the car is going.
  const pickup = request?.pickup_location || route?.origin;
  const dropoff = request?.dropoff_location || route?.destination;

  const distanceKm =
    num(request?.estimated_distance) ?? num(trip?.distance) ?? num(route?.estimated_distance);
  const durationMin = num(request?.estimated_duration) ?? num(trip?.actual_duration);

  const driverName = driver ? [driver.first_name, driver.last_name].filter(Boolean).join(" ") : null;

  const isScheduled = dispatch.status === D.SCHEDULED;
  const isInProgress = dispatch.status === D.IN_PROGRESS;
  const isOpen = isScheduled || isInProgress;
  const fullyAssigned = Boolean(dispatch.vehicle_id && dispatch.driver_id);
  const hasTrip = Boolean(trip?.trip_id);

  const canCancel = isOpen && permissions.dispatchUpdate;
  const busy = cancelMutation.isPending || patchMutation.isPending;

  return (
    <div className="space-y-6 w-full pb-6">
      {/* ── Top Page Banner & Header Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface border border-border p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3.5">
          <Button
            variant="outline"
            size="icon"
            className="rounded-xl shrink-0"
            onClick={() => router.back()}
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-foreground-secondary" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">{dispatch.dispatch_number}</h1>
              {priority && <StatusBadge status={priority} entity="priority" />}
              <StatusBadge status={dispatch.status} entity="dispatch" />
              {trip?.trip_status && <StatusBadge status={trip.trip_status} entity="trip" />}
            </div>
            <p className="text-xs text-foreground-secondary mt-0.5">
              Created {formatDateTime(dispatch.created_at)}
              {request?.reservation_number && (
                <>
                  {" · from "}
                  {permissions.reservationsRead ? (
                    <Link
                      href={`/reservations/${request.request_id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {request.reservation_number}
                    </Link>
                  ) : (
                    <span className="font-medium">{request.reservation_number}</span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Actions match the board's, and each verb matches the role list its
            endpoint enforces. A hidden button is a convenience, not the boundary. */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {isScheduled && permissions.dispatchUpdate && !fullyAssigned && (
            <Badge variant="warning" className="gap-1">
              <TriangleAlert className="h-3 w-3" />
              Needs a vehicle and driver
            </Badge>
          )}
          {isScheduled && permissions.dispatchUpdate && fullyAssigned && !hasTrip && (
            <Badge variant="warning" className="gap-1">
              <TriangleAlert className="h-3 w-3" />
              No trip record yet
            </Badge>
          )}
          {permissions.dispatchUpdate && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs"
              disabled={busy}
              onClick={() => setEditing({ dispatch, mode: "notes" })}
            >
              <FileText className="w-3.5 h-3.5 mr-1" /> Notes
            </Button>
          )}
          {canCancel && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs text-danger border-danger/30 hover:bg-danger/10"
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
            >
              <XCircle className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
          )}
        </div>
      </div>

      {/* ── At-a-glance strip: who is driving what, and when ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          icon={CarFront}
          label="Vehicle"
          value={vehicle ? [vehicle.plate_number, vehicle.model].filter(Boolean).join(" · ") : "Unassigned"}
        />
        <Field icon={UserCheck} label="Driver" value={driverName || "Unassigned"} />
        <Field
          icon={Clock}
          label="Departure"
          value={dispatch.scheduled_departure ? formatDateTime(dispatch.scheduled_departure) : null}
        />
        <Field
          icon={RouteIcon}
          label="Est. distance / duration"
          value={
            distanceKm == null && durationMin == null
              ? null
              : [distanceKm != null && formatDistance(distanceKm), durationMin != null && formatDuration(durationMin)]
                  .filter(Boolean)
                  .join(" · ")
          }
        />
      </div>

      {/* Progress is rendered as text when there is no honest denominator — an
          in-progress trip with no scheduled arrival has no percentage to show. */}
      <div className="p-4 rounded-2xl bg-surface border border-border/60 shadow-xs">
        {progress.pct === null ? (
          <p className="text-sm text-foreground-secondary">
            {progress.label}
            {progress.elapsedMin != null && ` · ${formatDuration(progress.elapsedMin)} elapsed`}
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

      {/* ── Main Details Layout (7 Cols Left / 5 Cols Right) ── */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* ── LEFT COLUMN: Journey, Guest Info & Trip Record (7 Cols) ── */}
        <div className="lg:col-span-7 space-y-6">
          <Section
            icon={Navigation}
            iconClass="bg-primary/10 text-primary"
            title="Journey"
            description="Where this dispatch is going, and the times it is held to."
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <Endpoint label="Pickup Location" value={pickup} tone="text-danger" />
                <Endpoint label="Dropoff Destination" value={dropoff} tone="text-success" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  icon={CalendarClock}
                  label="Scheduled arrival"
                  value={dispatch.scheduled_arrival ? formatDateTime(dispatch.scheduled_arrival) : null}
                />
                <Field
                  icon={PlayCircle}
                  label="Actual departure"
                  value={dispatch.actual_departure ? formatDateTime(dispatch.actual_departure) : null}
                />
                <Field
                  icon={CheckCircle2}
                  label="Actual arrival"
                  value={dispatch.actual_arrival ? formatDateTime(dispatch.actual_arrival) : null}
                />
                {route && (
                  <Field
                    icon={RouteIcon}
                    label="Route"
                    value={`${route.route_name}${route.origin ? ` · ${route.origin} → ${route.destination}` : ""}`}
                  />
                )}
              </div>
            </div>
          </Section>

          {/* Guest data is Booking's, shown read-only. Fleet never authors a booking. */}
          {request && (
            <Section
              icon={User}
              iconClass="bg-blue-500/10 text-blue-500"
              title="Guest & booking"
              description="Inbound booking details from the originating reservation."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field icon={Users} label="Guest" value={request.guest_name} />
                <Field icon={FileText} label="Booking reference">
                  {request.booking_reference ? (
                    <span className="font-data text-xs">{request.booking_reference}</span>
                  ) : null}
                </Field>
                <Field icon={Users} label="Passengers" value={request.passenger_count} />
                <Field
                  icon={CarFront}
                  label="Service"
                  value={request.service_name || request.requested_vehicle_type}
                />
                {request.special_requests && (
                  <Field
                    icon={TriangleAlert}
                    label="Special requests"
                    value={request.special_requests}
                    tone="text-warning"
                    className="sm:col-span-2"
                  />
                )}
              </div>
            </Section>
          )}

          {trip && (
            <Section
              icon={Gauge}
              iconClass="bg-amber-500/10 text-amber-500"
              title="Trip record"
              description="What the driver actually logged against this dispatch."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field icon={Gauge} label="Start odometer" value={trip.start_odometer} />
                <Field icon={Gauge} label="End odometer" value={trip.end_odometer} />
                <Field
                  icon={RouteIcon}
                  label="Distance travelled"
                  value={num(trip.distance) != null ? formatDistance(num(trip.distance)) : null}
                />
                <Field
                  icon={Clock}
                  label="Actual duration"
                  value={num(trip.actual_duration) != null ? formatDuration(num(trip.actual_duration)) : null}
                />
                <Field icon={Gauge} label="Fuel consumed" value={trip.fuel_consumed} />
                <Field icon={Gauge} label="Average speed" value={trip.avg_speed} />
              </div>
            </Section>
          )}

          {dispatch.notes && (
            <Section
              icon={StickyNote}
              iconClass="bg-violet-500/10 text-violet-500"
              title="Notes"
              description="Dispatcher notes recorded against this run."
            >
              <p className="whitespace-pre-wrap break-words text-sm text-foreground-secondary">
                {dispatch.notes}
              </p>
            </Section>
          )}
        </div>

        {/* ── RIGHT COLUMN: History (5 Cols) ──
            The same append-only history the reservation page shows. A dispatch
            raised outside the request flow has none, which the component treats as
            a normal empty state rather than an error. */}
        <div className="lg:col-span-5 space-y-6">
          {request?.request_id ? (
            <ReservationTimeline requestId={request.request_id} />
          ) : (
            <Section
              icon={FileText}
              iconClass="bg-primary/10 text-primary"
              title="History"
              description="Append-only record of everything that happened to this booking."
            >
              <p className="text-sm text-foreground-muted">
                This dispatch was not raised from a transportation request, so there is no
                reservation history to show.
              </p>
            </Section>
          )}
        </div>
      </div>

      <DispatchEditDialog
        dispatch={editing?.dispatch || null}
        mode={editing?.mode || null}
        isPending={patchMutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={({ patch }) => patchMutation.mutate({ patch })}
      />

      {confirmCancel && (
        <Dialog open onOpenChange={(open) => { if (!open) { setConfirmCancel(false); setCancelReason(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel this dispatch?</DialogTitle>
              <DialogDescription>
                {dispatch.dispatch_number} will be stood down. The vehicle and driver are released,
                and the originating request goes back to needing a dispatch.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6">
              <label htmlFor="cancel-reason" className="text-xs font-semibold text-foreground-secondary">
                Reason for cancellation <span className="text-danger">*</span>
              </label>
              <textarea
                id="cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Vehicle unavailable, driver not required, request withdrawn…"
                className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setConfirmCancel(false); setCancelReason(""); }}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                disabled={cancelMutation.isPending || cancelReason.trim().length === 0}
                onClick={() => cancelMutation.mutate()}
              >
                {cancelMutation.isPending ? "Cancelling…" : "Cancel dispatch"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}