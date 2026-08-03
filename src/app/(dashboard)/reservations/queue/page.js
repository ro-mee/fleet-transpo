"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  ReservationCard,
  ReservationCardSkeleton,
} from "@/components/reservations/reservation-card";
import {
  QueueFilters,
  EMPTY_FILTERS,
  hasActiveFilters,
  toQueryParams,
} from "@/components/reservations/queue-filters";
import { AssignDialog } from "@/components/reservations/assign-dialog";
import { ReviewDialog } from "@/components/reservations/review-dialog";
import { useRoleAccess } from "@/hooks/use-role-access";
import {
  getTransportRequests,
  startReview,
  approveTransportRequest,
  rejectTransportRequest,
  assignResources,
  pullTransportRequests,
} from "@/services/transport.service";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import {
  Building2,
  CheckCircle2,
  Clock,
  DownloadCloud,
  Inbox,
  Search,
  TriangleAlert,
} from "lucide-react";

// The dispatcher's workspace over requests received from Booking.
//
// Filtering is server-side (every control maps to a query param the list GET
// already accepts), and the list polls so a request injected by Booking appears
// without a manual refresh. Conflicts come from ?with_conflicts=true, which
// batches the detection into four queries for the whole page rather than four
// per card.
const REFETCH_MS = 30_000;

const isReviewable = (status) => status === L.PENDING || status === L.UNDER_REVIEW;

export default function ReservationQueuePage() {
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [reviewing, setReviewing] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [assigning, setAssigning] = useState(null);
  const [assignError, setAssignError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Authorization is resolved once here and passed down, so the card stays
  // presentational. Each verb matches the role list its endpoint enforces —
  // scripts/verify-rbac.mjs asserts the two layers agree.
  const permissions = useMemo(
    () => ({
      update: can("reservations", "update"),
      approve: can("reservations", "approve"),
      assign: can("reservations", "assign"),
      cancel: can("reservations", "cancel"),
    }),
    [can]
  );

  const queryParams = useMemo(
    () => ({ ...toQueryParams(filters), with_conflicts: "true" }),
    [filters]
  );

  const {
    data: requests = [],
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["transport-requests", queryParams],
    queryFn: () => getTransportRequests(queryParams),
    refetchInterval: REFETCH_MS,
    placeholderData: (prev) => prev,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
    queryClient.invalidateQueries({ queryKey: ["dispatches"] });
    queryClient.invalidateQueries({ queryKey: ["dispatches-status"] });
  };

  const pullMutation = useMutation({
    mutationFn: pullTransportRequests,
    onSuccess: (res) => {
      toast.success(
        res?.ingested
          ? `Pulled ${res.ingested} new request${res.ingested === 1 ? "" : "s"} from Booking`
          : "No new requests from Booking"
      );
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to pull requests"),
  });

  const reviewMutation = useMutation({
    mutationFn: (r) => startReview(r.request_id),
    onMutate: (r) => setBusyId(r.request_id),
    onSuccess: (data, r) => {
      toast.success("Review started — opening workspace");
      setReviewing(r);
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to start review"),
    onSettled: () => setBusyId(null),
  });

  const approveMutation = useMutation({
    mutationFn: (r) => approveTransportRequest(r.request_id),
    onMutate: (r) => setBusyId(r.request_id),
    onSuccess: () => {
      toast.success("Request approved — ready to assign");
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to approve request"),
    onSettled: () => setBusyId(null),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => rejectTransportRequest(id, reason),
    onSuccess: () => {
      toast.success("Request rejected — Booking will be notified");
      setRejecting(null);
      setRejectReason("");
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to reject request"),
  });

  // A 409 carries the blocking conflicts; keep the dialog open and hand them to
  // it so the dispatcher can see and knowingly override rather than guess.
  const assignMutation = useMutation({
    mutationFn: ({ request, vehicleId, driverId, force }) =>
      assignResources(request.request_id, { vehicleId, driverId, force }),
    onSuccess: (res) => {
      const forced = res?.warnings?.length;
      toast[forced ? "warning" : "success"](
        forced
          ? `Assigned with ${res.warnings.length} conflict override${res.warnings.length === 1 ? "" : "s"}`
          : "Resources assigned"
      );
      setAssigning(null);
      setAssignError(null);
      invalidate();
    },
    onError: (e) => {
      if (e?.status === 409 && e?.data?.conflicts?.length) setAssignError(e);
      else toast.error(e.message || "Failed to assign resources");
    },
  });

  const stats = useMemo(() => {
    const count = (fn) => requests.filter(fn).length;
    return [
      { label: "In Queue", value: requests.length, icon: Inbox, tone: "primary", trend: "from Booking" },
      { label: "Awaiting Review", value: count((r) => isReviewable(r.fleet_status)), icon: Clock, tone: "warning", trend: "needs a decision" },
      { label: "Ready to Assign", value: count((r) => r.fleet_status === L.APPROVED), icon: CheckCircle2, tone: "success", trend: "approved" },
      { label: "With Conflicts", value: count((r) => r.conflicts?.length), icon: TriangleAlert, tone: "danger", trend: "review before assigning" },
    ];
  }, [requests]);

  const filtered = hasActiveFilters(filters);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Request Queue"
        description="Transportation requests received from the Booking system."
        actions={
          <Button onClick={() => pullMutation.mutate()} disabled={pullMutation.isPending}>
            <DownloadCloud className="w-4 h-4 mr-2" />
            {pullMutation.isPending ? "Pulling…" : "Pull from Booking"}
          </Button>
        }
      />

      <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/5 p-4">
        <Building2 className="mt-0.5 w-5 h-5 shrink-0 text-info" aria-hidden="true" />
        <div className="text-sm text-foreground-secondary">
          <p className="font-medium text-foreground">Requests originate from the Booking system.</p>
          <p className="mt-0.5">
            Fleet reviews each request, then approves or rejects it and commits a vehicle and driver.
            Guest and booking details are owned by Booking and shown read-only. Conflict chips are
            advisory — assignment enforces them.
          </p>
        </div>
      </div>

      <StatGrid cols={4}>
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatGrid>

      <QueueFilters
        filters={filters}
        onChange={setFilters}
        resultCount={isLoading ? null : requests.length}
        isFetching={isFetching}
      />

      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 w-5 h-5 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Could not load the queue</p>
              <p className="mt-0.5 text-sm text-foreground-secondary">
                {error?.message || "The request failed."}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <ReservationCardSkeleton key={i} />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={filtered ? Search : Inbox}
            title={filtered ? "No requests match these filters" : "No transportation requests"}
            description={
              filtered
                ? "Try widening the search or clearing the filters."
                : "Requests from the Booking system will appear here. Use “Pull from Booking” to fetch them."
            }
            action={
              filtered ? (
                <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" onClick={() => pullMutation.mutate()} disabled={pullMutation.isPending}>
                  <DownloadCloud className="w-4 h-4 mr-2" />
                  Pull from Booking
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <ReservationCard
              key={r.request_id}
              request={r}
              permissions={permissions}
              isBusy={busyId === r.request_id}
              onReview={(req) => reviewMutation.mutate(req)}
              onApprove={(req) => approveMutation.mutate(req)}
              onReject={(req) => {
                setRejectReason("");
                setRejecting(req);
              }}
              onAssign={(req) => {
                setAssignError(null);
                setAssigning(req);
              }}
            />
          ))}
        </div>
      )}

      <Dialog
        open={!!rejecting}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Request?</DialogTitle>
            <DialogDescription>
              Booking will be notified so the guest can be re-routed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pt-4">
            <label className="text-sm font-medium text-foreground" htmlFor="reject-reason">
              Reason (optional)
            </label>
            <Input
              id="reject-reason"
              className="mt-1.5"
              placeholder="e.g. No vehicle available for that window"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejecting(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectMutation.isPending}
              onClick={() =>
                rejecting &&
                rejectMutation.mutate({ id: rejecting.request_id, reason: rejectReason || null })
              }
            >
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {Boolean(reviewing) && (
        <ReviewDialog
          key={reviewing?.request_id || "review-workspace"}
          request={reviewing}
          isOpen={Boolean(reviewing)}
          onClose={() => setReviewing(null)}
          onApprove={(req) => {
            setReviewing(null);
            approveMutation.mutate(req);
          }}
          onReject={(req) => {
            setReviewing(null);
            setRejectReason("");
            setRejecting(req);
          }}
          onAssign={(req) => {
            setReviewing(null);
            setAssignError(null);
            setAssigning(req);
          }}
          isPending={approveMutation.isPending || rejectMutation.isPending || assignMutation.isPending}
        />
      )}

      <AssignDialog
        request={assigning}
        conflictError={assignError}
        isPending={assignMutation.isPending}
        onClose={() => {
          setAssigning(null);
          setAssignError(null);
        }}
        onSubmit={(payload) => assignMutation.mutate(payload)}
      />
    </div>
  );
}
