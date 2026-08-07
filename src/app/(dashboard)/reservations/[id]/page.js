"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
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
  ShieldAlert,
  Car,
  User,
  Navigation,
  TriangleAlert,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";

const STEPS = [L.PENDING, L.UNDER_REVIEW, L.APPROVED, L.SCHEDULED, L.ASSIGNED, L.IN_PROGRESS, L.COMPLETED];

const ABORTED = { [L.REJECTED]: "Rejected", [L.CANCELLED]: "Cancelled" };

const isReviewable = (s) => s === L.PENDING || s === L.UNDER_REVIEW;
const isAssignable = (s) => s === L.APPROVED || s === L.SCHEDULED || s === L.ASSIGNED;
const isCancellable = (s) => ![L.REJECTED, L.CANCELLED, L.COMPLETED].includes(s);

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function driverName(d) {
  if (!d) return null;
  return [d.first_name, d.last_name].filter(Boolean).join(" ").trim() || `Driver #${d.driver_id}`;
}

function personName(p) {
  if (!p) return null;
  return [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || null;
}

function Field({ icon: Icon, label, children, className }) {
  return (
    <div className={cn("min-w-0 p-4 rounded-xl bg-muted/20 border border-border/40 space-y-1.5", className)}>
      <p className="text-xs font-medium text-foreground-secondary flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-foreground-muted shrink-0" />}
        {label}
      </p>
      <p className="text-sm font-semibold text-foreground break-words">{children ?? "—"}</p>
    </div>
  );
}

function LifecycleBar({ status }) {
  if (ABORTED[status]) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-xs">
        <Ban className="w-4 h-4 shrink-0 text-danger" />
        <p className="text-foreground">
          This request was <span className="font-bold text-danger">{ABORTED[status].toLowerCase()}</span> and is no longer progressing.
        </p>
      </div>
    );
  }

  const current = STEPS.indexOf(status);

  return (
    <div className="p-4 rounded-2xl bg-surface border border-border/60 shadow-xs">
      <ol className="flex flex-wrap items-center gap-2">
        {STEPS.map((step, i) => {
          const done = current > -1 && i < current;
          const active = i === current;
          return (
            <li key={step} className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  active
                    ? "bg-blue-600 text-white shadow-xs"
                    : done
                    ? "bg-success/15 text-success border border-success/30 font-medium"
                    : "bg-muted/50 text-foreground-muted border border-border/40"
                )}
              >
                {done && <CheckCircle2 className="w-3.5 h-3.5" />}
                {step}
              </span>
              {i < STEPS.length - 1 && (
                <ArrowRight
                  className={cn("w-3.5 h-3.5", done ? "text-success" : "text-foreground-muted/40")}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DispatchList({ dispatches }) {
  if (!dispatches?.length) return null;

  return (
    <Card className="border-0 shadow-sm rounded-2xl">
      <CardHeader className="pb-3 border-b border-border/60">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" /> Dispatches Raised
        </CardTitle>
        <CardDescription className="text-xs">
          {dispatches.length === 1
            ? "The dispatch raised from this request."
            : `${dispatches.length} dispatches have been raised from this request.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {dispatches.map((d) => (
          <Link
            key={d.dispatch_id}
            href={`/dispatch/${d.dispatch_id}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-border p-3.5 transition-all hover:bg-hover hover:border-primary/40 bg-surface"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Send className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span className="font-data text-xs font-bold text-foreground">
                  {d.dispatch_number || `DSP-${d.dispatch_id}`}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-foreground-secondary">
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

  if (isLoading) return <DetailSkeleton />;

  if (isError || !request) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto py-12">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Card className="border-0 shadow-sm text-center p-12 rounded-2xl">
          <CardContent className="space-y-3">
            <Inbox className="w-12 h-12 text-foreground-muted mx-auto opacity-50" />
            <p className="text-lg font-bold text-foreground">Reservation Record Not Found</p>
            <p className="text-xs text-foreground-secondary">{error?.message || "It may have been deleted or archived."}</p>
            <Button className="mt-4 rounded-xl" onClick={() => router.push("/reservations")}>Back to Reservations List</Button>
          </CardContent>
        </Card>
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
    <div className="space-y-6 w-full pb-6">
      {/* ── Top Page Banner & Header Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-surface border border-border p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3.5">
          <Button variant="outline" size="icon" className="rounded-xl shrink-0" onClick={() => router.push("/reservations")}>
            <ArrowLeft className="w-5 h-5 text-foreground-secondary" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">
                {r.reservation_number || `Request #${r.request_id}`}
              </h1>
              <StatusBadge status={r.priority} entity="priority" />
              <StatusBadge status={status} entity="reservation" />
            </div>
            <p className="text-xs text-foreground-secondary mt-0.5">
              {r.created_at
                ? `Received from ${r.source_system || "Booking"} on ${formatDateTime(r.created_at)}`
                : `Received from ${r.source_system || "Booking"}`}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {status === L.PENDING && permissions.update && (
            <Button
              variant="outline"
              size="sm"
              disabled={reviewMutation.isPending}
              onClick={() => reviewMutation.mutate()}
              className="rounded-xl text-xs"
            >
              <Clock className="w-3.5 h-3.5 mr-1" /> Start Review
            </Button>
          )}
          {isReviewable(status) && permissions.approve && (
            <>
              <Button
                size="sm"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate()}
                className="rounded-xl text-xs bg-success text-success-foreground hover:bg-success/90"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve Request
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-xs text-danger border-danger/30 hover:bg-danger/10"
                onClick={() => { setReason(""); setRejecting(true); }}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
              </Button>
            </>
          )}
          {isAssignable(status) && permissions.assign && (
            <Button
              size="sm"
              onClick={() => { setAssignError(null); setAssigning(true); }}
              className="rounded-xl text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-xs"
            >
              <Send className="w-3.5 h-3.5 mr-1 text-white" />
              {r.vehicle_id && r.driver_id ? "Reassign Resources" : "Assign Resources"}
            </Button>
          )}
          {isCancellable(status) && permissions.reschedule && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs"
              onClick={() => {
                const d = r.pickup_datetime ? new Date(r.pickup_datetime) : new Date();
                const pad = (n) => String(n).padStart(2, "0");
                setNewPickup(
                  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
                );
                setReason("");
                setRescheduling(true);
              }}
            >
              <CalendarClock className="w-3.5 h-3.5 mr-1" /> Reschedule
            </Button>
          )}
          {isCancellable(status) && permissions.cancel && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs text-danger border-danger/30 hover:bg-danger/10"
              onClick={() => { setReason(""); setCancelling(true); }}
            >
              <Ban className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
          )}
        </div>
      </div>

      {/* ── Lifecycle Progress Bar ── */}
      <LifecycleBar status={status} />

      {conflicts.length > 0 && (
        <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 w-5 h-5 shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground">
                {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"} detected
              </p>
              <p className="mt-0.5 text-xs text-foreground-secondary">
                Advisory — assignment enforces these. Overriding is recorded on the timeline.
              </p>
              <div className="mt-2 flex flex-wrap">
                <ConflictChips conflicts={conflicts} max={6} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Details Layout (7 Cols Left / 5 Cols Right) ── */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        
        {/* ── LEFT COLUMN: Trip Route, Guest Info & Assignment Details (7 Cols) ── */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* TRIP ROUTE & SCHEDULE */}
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <Navigation className="w-4 h-4" />
                </div>
                Trip Route &amp; Schedule
              </CardTitle>
              <CardDescription className="text-xs">
                Requested pickup location, destination, and travel estimates.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <div className="flex items-start gap-3 rounded-xl bg-muted/20 border border-border/50 p-4">
                  <MapPin className="mt-0.5 w-4 h-4 shrink-0 text-danger" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">Pickup Location</p>
                    <p className="text-base font-bold text-foreground break-words mt-0.5">{r.pickup_location || "—"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl bg-muted/20 border border-border/50 p-4">
                  <MapPin className="mt-0.5 w-4 h-4 shrink-0 text-success" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">Dropoff Destination</p>
                    <p className="text-base font-bold text-foreground break-words mt-0.5">{r.dropoff_location || "—"}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field icon={Clock} label="Pickup Time">
                  {r.pickup_datetime ? formatDateTime(r.pickup_datetime) : null}
                </Field>
                <Field icon={Users} label="Passengers">{r.passenger_count || 1} Person(s)</Field>
                <Field icon={Car} label="Vehicle Category">
                  {r.vehiclecategories?.category_name || r.requested_vehicle_type || "Any Category"}
                </Field>
                <Field label="Est. Distance">
                  {num(r.estimated_distance) != null ? formatDistance(num(r.estimated_distance)) : "—"}
                </Field>
                <Field label="Est. Duration">
                  {num(r.estimated_duration) != null ? formatDuration(num(r.estimated_duration)) : "—"}
                </Field>
                <Field label="Service Type">{r.service_types?.service_name || "Transfer"}</Field>
              </div>

              {r.special_requests && (
                <Field icon={FileText} label="Special Requests & Notes">{r.special_requests}</Field>
              )}
              {r.status_reason && (
                <Field icon={FileText} label="Status Reason / Notes">{r.status_reason}</Field>
              )}
            </CardContent>
          </Card>

          {/* GUEST & BOOKING PROVENANCE */}
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                  <User className="w-4 h-4" />
                </div>
                Guest &amp; External Booking Info
              </CardTitle>
              <CardDescription className="text-xs">
                Inbound booking details from connected PMS / POS systems.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field icon={Users} label="Guest Name">{r.guest_name}</Field>
                <Field icon={ExternalLink} label="Booking Reference">
                  {r.booking_reference ? <span className="font-data text-xs">{r.booking_reference}</span> : null}
                </Field>
                <Field icon={Building2} label="Source System">{r.source_system}</Field>
                <Field label="Booking Status">{r.booking_status}</Field>
                <Field label="External ID">
                  {r.external_booking_id ? <span className="font-data text-xs">{r.external_booking_id}</span> : null}
                </Field>
                <Field label="Received At">
                  {r.created_at ? formatDateTime(r.created_at) : null}
                </Field>
              </div>
            </CardContent>
          </Card>

          {/* COMMITTED RESOURCE ASSIGNMENT */}
          <Card className="border-0 shadow-sm rounded-2xl">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
                  <CarFront className="w-4 h-4" />
                </div>
                Resource Assignment &amp; Audit
              </CardTitle>
              <CardDescription className="text-xs">
                Vehicle and driver assigned to fulfill this request.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field icon={CarFront} label="Assigned Vehicle">
                  {vehicle
                    ? `${vehicle.plate_number}${vehicle.model ? ` · ${vehicle.model}` : ""}`
                    : null}
                </Field>
                <Field icon={UserCheck} label="Assigned Driver">{driverName(driver)}</Field>
                <Field label="Driver Phone">{driver?.phone}</Field>
                <Field label="Reviewed By">
                  {reviewer
                    ? `${reviewer}${r.reviewed_at ? ` · ${formatDateTime(r.reviewed_at)}` : ""}`
                    : null}
                </Field>
                <Field label="Approved By">
                  {approver
                    ? `${approver}${r.approved_at ? ` · ${formatDateTime(r.approved_at)}` : ""}`
                    : null}
                </Field>
                <Field label="Reservation ID">
                  {r.reservation_id ? <span className="font-data text-xs">#{r.reservation_id}</span> : null}
                </Field>
              </div>
            </CardContent>
          </Card>

          <DispatchList dispatches={r.dispatches} />
        </div>

        {/* ── RIGHT COLUMN: AI Advisor & Timeline (5 Cols) ── */}
        <div className="lg:col-span-5 space-y-6">
          {isAssignable(status) && (
            <AiRecommendationPanel
              requestId={requestId}
              pickupAt={r.pickup_datetime}
              canAssign={permissions.assign}
              onAssigned={invalidate}
              alreadyAssigned={status === L.ASSIGNED}
            />
          )}

          <ReservationTimeline requestId={requestId} />
        </div>
      </div>

      {/* ── Dialogs ── */}
      {assigning && (
        <AssignDialog
          request={r}
          onClose={() => { setAssigning(false); setAssignError(null); }}
          conflictError={assignError}
          onAssign={({ vehicleId, driverId, force }) =>
            assignMutation.mutateAsync({ vehicleId, driverId, force })
          }
          isPending={assignMutation.isPending}
        />
      )}

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Reject Transport Request</DialogTitle>
            <DialogDescription className="text-xs">
              This will mark the request rejected and notify the originating Booking system.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reject-reason" className="text-xs font-semibold">Reason (optional)</Label>
            <Input
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. No vehicles available at requested time"
              className="rounded-xl text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejecting(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
              className="rounded-xl"
            >
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Cancel Transport Request</DialogTitle>
            <DialogDescription className="text-xs">
              This will cancel the request in Fleet and notify the Booking system.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="cancel-reason" className="text-xs font-semibold">Reason (optional)</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Guest cancelled booking"
              className="rounded-xl text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCancelling(false)} className="rounded-xl">
              Back
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
              className="rounded-xl"
            >
              Cancel Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rescheduling} onOpenChange={setRescheduling}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Reschedule Pickup Time</DialogTitle>
            <DialogDescription className="text-xs">
              Change the requested pickup datetime. The timeline will log this change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-pickup" className="text-xs font-semibold">New Pickup Date &amp; Time *</Label>
              <Input
                id="new-pickup"
                type="datetime-local"
                value={newPickup}
                onChange={(e) => setNewPickup(e.target.value)}
                className="rounded-xl text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-reason" className="text-xs font-semibold">Reason (optional)</Label>
              <Input
                id="reschedule-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Flight delay"
                className="rounded-xl text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRescheduling(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={rescheduleMutation.isPending || !newPickup}
              onClick={() => rescheduleMutation.mutate()}
              className="rounded-xl px-4"
            >
              Save New Pickup Time
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
