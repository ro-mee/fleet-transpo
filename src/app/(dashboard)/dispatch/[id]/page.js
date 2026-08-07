"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton, DetailSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { TripOdometerDialog } from "@/components/dispatch/trip-odometer-dialog";
import { DispatchEditDialog } from "@/components/dispatch/dispatch-edit-dialog";
import { tripProgress } from "@/lib/scheduling/trip-progress";
import { ReservationTimeline } from "@/components/reservations/reservation-timeline";
import { useRoleAccess } from "@/hooks/use-role-access";
import { useRequireRole } from "@/lib/auth/role-guard";
import { getDispatch, updateDispatch, updateDispatchStatus } from "@/services/dispatch.service";
import { startTrip, completeTrip } from "@/services/trip.service";
import { DISPATCH_STATUS as D } from "@/lib/constants";
import { formatDateTime, formatDistance, formatDuration } from "@/lib/utils";
import {
  ArrowLeft,
  CalendarClock,
  CarFront,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  MapPin,
  PlayCircle,
  Route as RouteIcon,
  Send,
  TriangleAlert,
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
// pg returns DECIMAL columns as strings, and formatDistance() calls .toFixed() on
// what it is given — so every numeric read goes through here before formatting.
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function Field({ icon: Icon, label, value, tone = "text-foreground-muted", href }) {
  const body = (
    <>
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className="truncate text-sm font-medium text-foreground">{value ?? "—"}</p>
    </>
  );
  return (
    <div className="flex items-start gap-3 rounded-xl bg-muted/30 p-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0">
        {href ? (
          <Link href={href} className="block hover:underline">
            {body}
          </Link>
        ) : (
          body
        )}
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

  const [odometer, setOdometer] = useState(null); // { dispatch, mode }
  const [editing, setEditing] = useState(null); // { dispatch, mode }
  const [confirmCancel, setConfirmCancel] = useState(false);

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

  const tripMutation = useMutation({
    mutationFn: ({ mode, body }) => {
      const tripId = dispatch?.latest_trip?.trip_id;
      if (!tripId) throw new Error("This dispatch has no trip record yet.");
      return mode === "start" ? startTrip(tripId, body) : completeTrip(tripId, body);
    },
    onSuccess: (_res, { mode }) => {
      toast.success(mode === "start" ? "Trip started" : "Trip completed");
      setOdometer(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to update the trip"),
  });

  const cancelMutation = useMutation({
    mutationFn: () => updateDispatchStatus(dispatchId, D.CANCELLED),
    onSuccess: () => {
      toast.success("Dispatch cancelled");
      setConfirmCancel(false);
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

  const canStart = isScheduled && permissions.tripsUpdate && fullyAssigned && hasTrip;
  const canComplete = isInProgress && permissions.tripsUpdate && hasTrip;
  const canCancel = isOpen && permissions.dispatchUpdate;
  const busy = tripMutation.isPending || cancelMutation.isPending || patchMutation.isPending;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{dispatch.dispatch_number}</h1>
              <StatusBadge status={dispatch.status} entity="dispatch" />
              {priority && <StatusBadge status={priority} entity="priority" />}
              {trip?.trip_status && <StatusBadge status={trip.trip_status} entity="trip" />}
            </div>
            <p className="mt-1 text-sm text-foreground-secondary">
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
        <div className="flex flex-wrap items-center gap-2">
          {canStart && (
            <Button disabled={busy} onClick={() => setOdometer({ dispatch, mode: "start" })}>
              <PlayCircle className="mr-2 h-4 w-4" />
              Start trip
            </Button>
          )}
          {canComplete && (
            <Button disabled={busy} onClick={() => setOdometer({ dispatch, mode: "complete" })}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Complete trip
            </Button>
          )}
          {isScheduled && permissions.tripsUpdate && !fullyAssigned && (
            <Badge variant="warning" className="gap-1">
              <TriangleAlert className="h-3 w-3" />
              Needs a vehicle and driver
            </Badge>
          )}
          {isScheduled && permissions.tripsUpdate && fullyAssigned && !hasTrip && (
            <Badge variant="warning" className="gap-1">
              <TriangleAlert className="h-3 w-3" />
              No trip record yet
            </Badge>
          )}
          {permissions.dispatchUpdate && (
            <Button variant="outline" disabled={busy} onClick={() => setEditing({ dispatch, mode: "notes" })}>
              <FileText className="mr-2 h-4 w-4" />
              Notes
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" disabled={busy} onClick={() => setConfirmCancel(true)}>
              <XCircle className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
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
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Journey</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field icon={MapPin} label="Pickup" value={pickup} tone="text-danger" />
              <Field icon={MapPin} label="Dropoff" value={dropoff} tone="text-success" />
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
            </CardContent>
          </Card>

          {/* Guest data is Booking's, shown read-only. Fleet never authors a booking. */}
          {request && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Guest &amp; booking</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Field icon={Users} label="Guest" value={request.guest_name} />
                <Field icon={FileText} label="Booking reference" value={request.booking_reference} />
                <Field icon={Users} label="Passengers" value={request.passenger_count} />
                <Field icon={CarFront} label="Service" value={request.service_name || request.requested_vehicle_type} />
                {request.special_requests && (
                  <div className="sm:col-span-2">
                    <Field icon={TriangleAlert} label="Special requests" value={request.special_requests} tone="text-warning" />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {trip && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Trip record</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
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
                  value={num(trip.actual_duration) != null ? formatDuration(trip.actual_duration) : null}
                />
                <Field icon={Gauge} label="Fuel consumed" value={trip.fuel_consumed} />
                <Field icon={Gauge} label="Average speed" value={trip.avg_speed} />
              </CardContent>
            </Card>
          )}

          {dispatch.notes && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-foreground-secondary">{dispatch.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* The same append-only history the reservation page shows. A dispatch
            raised outside the request flow has none, which the component treats as
            a normal empty state rather than an error. */}
        <div className="space-y-6">
          {request?.request_id ? (
            <ReservationTimeline requestId={request.request_id} />
          ) : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">History</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground-muted">
                  This dispatch was not raised from a transportation request, so there is no
                  reservation history to show.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Both dialogs own their own <Dialog> wrapper and hand back the whole
          payload ({ dispatch, mode, body } / { dispatch, patch }), so the
          mutations take it as-is. */}
      <TripOdometerDialog
        dispatch={odometer?.dispatch || null}
        mode={odometer?.mode || null}
        isPending={tripMutation.isPending}
        onClose={() => setOdometer(null)}
        onSubmit={({ mode, body }) => tripMutation.mutate({ mode, body })}
      />

      <DispatchEditDialog
        dispatch={editing?.dispatch || null}
        mode={editing?.mode || null}
        isPending={patchMutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={({ patch }) => patchMutation.mutate({ patch })}
      />

      {confirmCancel && (
        <Dialog open onOpenChange={(open) => !open && setConfirmCancel(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel this dispatch?</DialogTitle>
              <DialogDescription>
                {dispatch.dispatch_number} will be stood down. The vehicle and driver are released,
                and the originating request goes back to needing a dispatch.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmCancel(false)}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                disabled={cancelMutation.isPending}
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
