"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { ConflictChips } from "@/components/reservations/conflict-chips";
import { ReservationTimeline } from "@/components/reservations/reservation-timeline";
import { AiRecommendationPanel } from "@/components/reservations/ai-recommendation-panel";
import { AssignDialog } from "@/components/reservations/assign-dialog";
import { useRoleAccess } from "@/hooks/use-role-access";
import {
  getTransportRequest,
  startReview,
  approveTransportRequest,
  rejectTransportRequest,
  assignResources,
  cancelRequest,
  rescheduleRequest,
} from "@/services/transport.service";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { cn, formatDateTime, formatDistance, formatDuration } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Building2,
  CalendarClock,
  CarFront,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Inbox,
  MapPin,
  Send,
  Sparkles,
  TriangleAlert,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";

// Phase 17 — the reservation detail page, repointed to transportation_requests.
//
// This page used to read `vehiclereservations` and drive a four-step
// Pending→Approved→Dispatched→Completed bar, writing status directly with
// updateReservation(). That entity is now a legacy FK target: the reservation IS
// the transportation request. So every action here goes through the lifecycle
// endpoints, which validate the hop, append a timeline event, and notify Booking
// — none of which a direct status write did.
//
// Guest data is Booking's, shown read-only. Fleet decides; it never authors a
// booking.
const STEPS = [L.PENDING, L.UNDER_REVIEW, L.APPROVED, L.SCHEDULED, L.ASSIGNED, L.IN_PROGRESS, L.COMPLETED];

/** Statuses that ended the request rather than advancing it. */
const ABORTED = { [L.REJECTED]: "Rejected", [L.CANCELLED]: "Cancelled" };

const isReviewable = (s) => s === L.PENDING || s === L.UNDER_REVIEW;
const isAssignable = (s) => s === L.APPROVED || s === L.SCHEDULED || s === L.ASSIGNED;
const isCancellable = (s) => ![L.REJECTED, L.CANCELLED, L.COMPLETED].includes(s);

// pg returns DECIMAL columns as strings, and formatDistance() calls .toFixed() on
// what it is given — so every numeric read goes through here before formatting.
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function driverName(d) {
  if (!d) return null;
  return [d.first_name, d.last_name].filter(Boolean).join(" ").trim() || `Driver #${d.driver_id}`;
}

function personName(p) {
  if (!p) return null;
  return [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || null;
}

/** One labelled read-only field. */
function Field({ icon: Icon, label, children, className }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-foreground-muted">{label}</p>
      <div className="mt-0.5 flex items-start gap-1.5">
        {Icon && <Icon className="mt-0.5 w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />}
        <span className="text-sm text-foreground-secondary break-words">{children ?? "—"}</span>
      </div>
    </div>
  );
}

/**
 * Lifecycle progress.
 *
 * A rejected or cancelled request is NOT rendered as a partially-complete chain:
 * it stopped, and drawing three green steps and four grey ones would imply it is
 * still moving. The abort is shown as its own terminal state instead.
 */
function LifecycleBar({ status }) {
  if (ABORTED[status]) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-hover/40 px-4 py-3">
        <Ban className="w-4 h-4 shrink-0 text-foreground-muted" aria-hidden="true" />
        <p className="text-sm text-foreground-secondary">
          This request was <span className="font-medium text-foreground">{ABORTED[status].toLowerCase()}</span> and is
          no longer progressing.
        </p>
      </div>
    );
  }

  const current = STEPS.indexOf(status);

  return (
    <ol className="flex flex-wrap items-center gap-1">
      {STEPS.map((step, i) => {
        const done = current > -1 && i < current;
        const active = i === current;
        return (
          <li key={step} className="flex items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition-colors",
                active
                  ? "bg-primary text-surface font-semibold"
                  : done
                    ? "bg-success/10 text-success font-medium"
                    : "bg-hover text-foreground-muted"
              )}
              aria-current={active ? "step" : undefined}
            >
              {done && <CheckCircle2 className="w-3 h-3" aria-hidden="true" />}
              {step}
            </span>
            {i < STEPS.length - 1 && (
              <ArrowRight
                className={cn("w-3 h-3", done ? "text-success" : "text-foreground-muted/50")}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
/** The dispatches raised from this request, newest first. */
function DispatchList({ dispatches }) {
  if (!dispatches?.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dispatch</CardTitle>
        <CardDescription>
          {dispatches.length === 1
            ? "The dispatch raised from this request."
            : `${dispatches.length} dispatches have been raised from this request.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {dispatches.map((d) => (
          <Link
            key={d.dispatch_id}
            href={`/dispatch/${d.dispatch_id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-hover"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Send className="w-3.5 h-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="font-data text-sm font-medium text-foreground">
                  {d.dispatch_number || `DSP-${d.dispatch_id}`}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-foreground-muted">
                {d.plate_number || "No vehicle"}
                {" · "}
                {[d.driver_first_name, d.driver_last_name].filter(Boolean).join(" ") || "No driver"}
                {d.scheduled_departure ? ` · ${formatDateTime(d.scheduled_departure)}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {d.trip_status && <StatusBadge status={d.trip_status} entity="trip" />}
              <StatusBadge status={d.status} entity="dispatch" />
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

/** One candidate row inside the saved-recommendation card. */
function SavedPick({ icon: Icon, label, pick, considered }) {
  if (!pick) {
    return (
      <Field icon={Icon} label={label}>
        {considered > 0
          ? `None of ${considered} candidate${considered === 1 ? "" : "s"} fit at review`
          : "No candidate fit at review"}
      </Field>
    );
  }
  const name = pick.vehicle_name || pick.driver_name || pick.plate_number || `#${pick.vehicle_id ?? pick.driver_id}`;
  const detail = pick.seating_capacity != null
    ? `${pick.plate_number ?? name} · ${pick.seating_capacity} seats`
    : `${name}${pick.years_of_experience != null ? ` · ${pick.years_of_experience} yr exp` : ""}`;
  return (
    <Field icon={Icon} label={label}>
      <span className="font-data">{name}</span>
      {pick.score != null && <span className="text-foreground-muted"> · {pick.score}/100</span>}
      {detail !== name && <span className="block text-xs text-foreground-muted">{detail}</span>}
    </Field>
  );
}

/** Normalize a col value that could be null, a string, or an object. */
function cachedSide(v) {
  if (!v) return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

/**
 * Read-only snapshot of the deterministic scorer's pick captured when Fleet
 * started review (transportation_requests.ai_vehicle_recommendation /
 * ai_driver_recommendation). Distinct from the live advisory panel: this is the
 * decision that was recorded, not a fresh re-score.
 */
function SavedRecommendation({ vehicle, driver }) {
  const hasEither = vehicle?.recommended || vehicle?.alternate || driver?.recommended || driver?.alternate;
  if (!hasEither) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-info" aria-hidden="true" />
          Saved recommendation
        </CardTitle>
        <CardDescription>
          The pick recorded when fleet review started. Advisory — confirm before assigning.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-y-3">
        <SavedPick
          icon={CarFront}
          label="Scored vehicle"
          pick={vehicle?.recommended}
          considered={num(vehicle?.considered ?? 0)}
        />
        <SavedPick
          icon={UserCheck}
          label="Scored driver"
          pick={driver?.recommended}
          considered={num(driver?.considered ?? 0)}
        />
      </CardContent>
    </Card>
  );
}

export default function ReservationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  const requestId = Number(params.id);

  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [newPickup, setNewPickup] = useState("");

  // Resolved once and passed down, so each action button and its endpoint agree
  // on the same permission name. scripts/verify-rbac.mjs pins the two layers.
  const permissions = useMemo(
    () => ({
      update: can("reservations", "update"),
      approve: can("reservations", "approve"),
      assign: can("reservations", "assign"),
      cancel: can("reservations", "cancel"),
      reschedule: can("reservations", "reschedule"),
    }),
    [can]
  );

  const { data: request, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["transport-request", requestId],
    queryFn: () => getTransportRequest(requestId),
    enabled: Number.isFinite(requestId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["transport-request", requestId] });
    queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
    queryClient.invalidateQueries({ queryKey: ["reservation-timeline", requestId] });
    queryClient.invalidateQueries({ queryKey: ["dispatches"] });
    queryClient.invalidateQueries({ queryKey: ["dispatches-status"] });
  };

  const reviewMutation = useMutation({
    mutationFn: () => startReview(requestId),
    onSuccess: () => { toast.success("Review started"); invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to start review"),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveTransportRequest(requestId),
    onSuccess: () => { toast.success("Request approved — ready to assign"); invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to approve request"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectTransportRequest(requestId, reason || null),
    onSuccess: () => {
      toast.success("Request rejected — Booking will be notified");
      setRejecting(false);
      setReason("");
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to reject request"),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelRequest(requestId, reason || null),
    onSuccess: () => {
      toast.success("Request cancelled — Booking will be notified");
      setCancelling(false);
      setReason("");
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to cancel request"),
  });

  const rescheduleMutation = useMutation({
    mutationFn: () => rescheduleRequest(requestId, new Date(newPickup).toISOString(), reason || null),
    onSuccess: () => {
      toast.success("Pickup time updated");
      setRescheduling(false);
      setReason("");
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to reschedule"),
  });

  // A 409 carries the blocking conflicts; hand them to the dialog so the
  // override decision is made against the server's own reasons.
  const assignMutation = useMutation({
    mutationFn: ({ vehicleId, driverId, force }) =>
      assignResources(requestId, { vehicleId, driverId, force }),
    onSuccess: (res) => {
      const forced = res?.warnings?.length;
      toast[forced ? "warning" : "success"](
        forced
          ? `Assigned with ${res.warnings.length} conflict override${res.warnings.length === 1 ? "" : "s"}`
          : "Resources assigned"
      );
      setAssigning(false);
      setAssignError(null);
      invalidate();
    },
    onError: (e) => {
      if (e?.status === 409 && e?.data?.conflicts?.length) setAssignError(e);
      else toast.error(e.message || "Failed to assign resources");
    },
  });
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !request) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          icon={isError ? TriangleAlert : Inbox}
          title={isError ? "Could not load this request" : "Request not found"}
          description={
            error?.message ||
            "It may have been deleted, or you may not have permission to view it."
          }
          action={
            <div className="flex gap-2">
              {isError && (
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Try again
                </Button>
              )}
              <Button size="sm" onClick={() => router.push("/reservations")}>
                Back to Reservations
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const r = request;
  const status = r.fleet_status;
  const conflicts = r.conflicts || [];
  const vehicle = r.vehicles || null;
  const driver = r.drivers || null;
  const reviewer = personName(r.reviewer);
  const approver = personName(r.approver);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Go back">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <PageHeader
            eyebrow="Operations"
            title={r.reservation_number || `Request #${r.request_id}`}
            description={
              r.created_at
                ? `Received from ${r.source_system || "Booking"} on ${formatDateTime(r.created_at)}`
                : `Received from ${r.source_system || "Booking"}`
            }
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={r.priority} entity="priority" />
                <StatusBadge status={status} entity="reservation" />
              </div>
            }
          />
        </div>
      </div>

      <LifecycleBar status={status} />

      {conflicts.length > 0 && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 w-5 h-5 shrink-0 text-danger" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"} detected
              </p>
              <p className="mt-0.5 text-sm text-foreground-secondary">
                Advisory — assignment enforces these. Overriding is recorded on the timeline.
              </p>
              <div className="mt-2 flex flex-wrap">
                <ConflictChips conflicts={conflicts} max={6} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actions. Each is gated on the permission its endpoint enforces, and on
          the state machine's own view of what is legal from here. */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface p-3">
        {status === L.PENDING && permissions.update && (
          <Button
            variant="outline"
            size="sm"
            disabled={reviewMutation.isPending}
            onClick={() => reviewMutation.mutate()}
          >
            <Clock className="w-3.5 h-3.5 mr-1" />
            Start Review
          </Button>
        )}
        {isReviewable(status) && permissions.approve && (
          <>
            <Button
              variant="success"
              size="sm"
              disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate()}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={() => { setReason(""); setRejecting(true); }}
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              Reject
            </Button>
          </>
        )}
        {isAssignable(status) && permissions.assign && (
          <Button size="sm" onClick={() => { setAssignError(null); setAssigning(true); }}>
            <Send className="w-3.5 h-3.5 mr-1" />
            {r.vehicle_id && r.driver_id ? "Reassign" : "Assign"}
          </Button>
        )}
        {isCancellable(status) && permissions.reschedule && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // datetime-local wants local wall time, not an ISO instant.
              const d = r.pickup_datetime ? new Date(r.pickup_datetime) : new Date();
              const pad = (n) => String(n).padStart(2, "0");
              setNewPickup(
                `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
              );
              setReason("");
              setRescheduling(true);
            }}
          >
            <CalendarClock className="w-3.5 h-3.5 mr-1" />
            Reschedule
          </Button>
        )}
        {isCancellable(status) && permissions.cancel && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-foreground-muted"
            onClick={() => { setReason(""); setCancelling(true); }}
          >
            <Ban className="w-3.5 h-3.5 mr-1" />
            Cancel Request
          </Button>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Route + schedule */}
          <Card>
            <CardHeader>
              <CardTitle>Trip</CardTitle>
              <CardDescription>Requested route and schedule.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-start gap-3 rounded-lg bg-hover/50 p-3">
                  <MapPin className="mt-0.5 w-4 h-4 shrink-0 text-danger" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs text-foreground-muted">Pickup</p>
                    <p className="text-sm font-medium text-foreground break-words">
                      {r.pickup_location || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg bg-hover/50 p-3">
                  <MapPin className="mt-0.5 w-4 h-4 shrink-0 text-success" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs text-foreground-muted">Dropoff</p>
                    <p className="text-sm font-medium text-foreground break-words">
                      {r.dropoff_location || "—"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Field icon={Clock} label="Pickup time">
                  {r.pickup_datetime ? formatDateTime(r.pickup_datetime) : null}
                </Field>
                <Field icon={Users} label="Passengers">{r.passenger_count || 1}</Field>
                <Field label="Service">{r.service_types?.service_name}</Field>
                <Field label="Vehicle type">
                  {r.vehiclecategories?.category_name || r.requested_vehicle_type}
                </Field>
                {/* pg returns DECIMAL as a string and formatDistance() calls
                    .toFixed() on its argument, so both are coerced first. */}
                <Field label="Est. distance">
                  {num(r.estimated_distance) != null ? formatDistance(num(r.estimated_distance)) : null}
                </Field>
                <Field label="Est. duration">
                  {num(r.estimated_duration) != null ? formatDuration(num(r.estimated_duration)) : null}
                </Field>
              </div>

              {r.special_requests && (
                <Field icon={FileText} label="Special requests">{r.special_requests}</Field>
              )}
              {r.status_reason && (
                <Field icon={FileText} label="Reason">{r.status_reason}</Field>
              )}
            </CardContent>
          </Card>

          {/* Guest + provenance. Booking owns all of this; Fleet caches it. */}
          <Card>
            <CardHeader>
              <CardTitle>Guest &amp; Booking</CardTitle>
              <CardDescription>
                Owned by the Booking system and shown read-only.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field icon={Users} label="Guest">{r.guest_name}</Field>
              <Field icon={ExternalLink} label="Booking reference">
                {r.booking_reference ? (
                  <span className="font-data text-xs">{r.booking_reference}</span>
                ) : null}
              </Field>
              <Field icon={Building2} label="Source">{r.source_system}</Field>
              <Field label="Booking status">{r.booking_status}</Field>
              <Field label="External ID">
                {r.external_booking_id ? (
                  <span className="font-data text-xs">{r.external_booking_id}</span>
                ) : null}
              </Field>
              <Field label="Received">
                {r.created_at ? formatDateTime(r.created_at) : null}
              </Field>
            </CardContent>
          </Card>

          {/* Committed resources + approval audit */}
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
              <CardDescription>What Fleet has committed to this request.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field icon={CarFront} label="Vehicle">
                {vehicle
                  ? `${vehicle.plate_number}${vehicle.model ? ` · ${vehicle.model}` : ""}`
                  : null}
              </Field>
              <Field icon={UserCheck} label="Driver">{driverName(driver)}</Field>
              <Field label="Driver contact">{driver?.phone}</Field>
              <Field label="Reviewed by">
                {reviewer
                  ? `${reviewer}${r.reviewed_at ? ` · ${formatDateTime(r.reviewed_at)}` : ""}`
                  : null}
              </Field>
              <Field label="Approved by">
                {approver
                  ? `${approver}${r.approved_at ? ` · ${formatDateTime(r.approved_at)}` : ""}`
                  : null}
              </Field>
              <Field label="Legacy reservation">
                {r.reservation_id ? (
                  <span className="font-data text-xs">#{r.reservation_id}</span>
                ) : null}
              </Field>
            </CardContent>
          </Card>

          <DispatchList dispatches={r.dispatches} />
        </div>

        {/* Advisor + history. The advisor only appears while assignment is still
            open — a recommendation for a completed trip is noise. */}
        <div className="space-y-6">
          <SavedRecommendation
            vehicle={cachedSide(r.ai_vehicle_recommendation)}
            driver={cachedSide(r.ai_driver_recommendation)}
          />
          {isAssignable(status) && (
            <AiRecommendationPanel
              requestId={requestId}
              canAssign={permissions.assign}
              onAssigned={invalidate}
            />
          )}
          <ReservationTimeline requestId={requestId} />
        </div>
      </div>

      <AssignDialog
        request={assigning ? r : null}
        conflictError={assignError}
        isPending={assignMutation.isPending}
        onClose={() => { setAssigning(false); setAssignError(null); }}
        onSubmit={(payload) => assignMutation.mutate(payload)}
      />

      <ReasonDialog
        open={rejecting}
        title="Reject Request?"
        description="Booking will be notified so the guest can be re-routed. This cannot be undone."
        confirmLabel="Reject Request"
        variant="destructive"
        reason={reason}
        onReason={setReason}
        isPending={rejectMutation.isPending}
        onClose={() => { setRejecting(false); setReason(""); }}
        onConfirm={() => rejectMutation.mutate()}
      />

      <ReasonDialog
        open={cancelling}
        title="Cancel Request?"
        description="This releases any assigned vehicle and driver, and notifies Booking."
        confirmLabel="Cancel Request"
        variant="destructive"
        reason={reason}
        onReason={setReason}
        isPending={cancelMutation.isPending}
        onClose={() => { setCancelling(false); setReason(""); }}
        onConfirm={() => cancelMutation.mutate()}
      />

      <Dialog
        open={rescheduling}
        onOpenChange={(open) => { if (!open) { setRescheduling(false); setReason(""); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule Pickup</DialogTitle>
            <DialogDescription>
              Moving the pickup time does not change the request&apos;s status — it is a property
              change, not a lifecycle step. Any existing conflicts are re-evaluated on the next
              assignment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 pt-4">
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="new-pickup">
                New pickup time
              </label>
              <Input
                id="new-pickup"
                type="datetime-local"
                className="mt-1.5"
                value={newPickup}
                onChange={(e) => setNewPickup(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="reschedule-reason">
                Reason (optional)
              </label>
              <Input
                id="reschedule-reason"
                className="mt-1.5"
                placeholder="e.g. Guest flight delayed"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRescheduling(false); setReason(""); }}>
              Cancel
            </Button>
            <Button
              disabled={!newPickup || rescheduleMutation.isPending}
              onClick={() => rescheduleMutation.mutate()}
            >
              {rescheduleMutation.isPending ? "Saving…" : "Reschedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Confirm dialog with an optional free-text reason, shared by reject and cancel. */
function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  variant = "default",
  reason,
  onReason,
  isPending,
  onClose,
  onConfirm,
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="px-6 pt-4">
          <label className="text-sm font-medium text-foreground" htmlFor="reason-input">
            Reason (optional)
          </label>
          <Input
            id="reason-input"
            className="mt-1.5"
            placeholder="e.g. No vehicle available for that window"
            value={reason}
            onChange={(e) => onReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep Request
          </Button>
          <Button variant={variant} disabled={isPending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
