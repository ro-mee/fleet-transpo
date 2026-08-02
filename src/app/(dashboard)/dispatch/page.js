"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
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
import { DispatchCard, DispatchCardSkeleton } from "@/components/dispatch/dispatch-card";
import { DispatchEditDialog } from "@/components/dispatch/dispatch-edit-dialog";
import { TripOdometerDialog } from "@/components/dispatch/trip-odometer-dialog";
import { useRoleAccess } from "@/hooks/use-role-access";
import { useRequireRole } from "@/lib/auth/role-guard";
import {
  getDispatchesByStatus,
  updateDispatch,
  updateDispatchStatus,
} from "@/services/dispatch.service";
import { startTrip, completeTrip } from "@/services/trip.service";
import { DISPATCH_STATUS as D } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Inbox,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";

// Phase 13 — the dispatch board.
//
// Lanes are filter chips rather than columns: the card carries 17 fields, and
// four side-by-side columns would squeeze each to ~280px and truncate most of
// them. The counts stay visible either way, so the board still answers "what is
// the shape of the day" at a glance, and the selected lane gets the full width.
//
// The feed polls, because a dispatch can change from the driver's phone (trip
// start/complete) or from another dispatcher's screen.
const REFETCH_MS = 30_000;

const LANES = [
  { id: "scheduled", status: D.SCHEDULED, label: "Scheduled", icon: Clock, tone: "info" },
  { id: "inProgress", status: D.IN_PROGRESS, label: "In Progress", icon: PlayCircle, tone: "warning" },
  { id: "completed", status: D.COMPLETED, label: "Completed", icon: CheckCircle2, tone: "success" },
  { id: "cancelled", status: D.CANCELLED, label: "Cancelled", icon: XCircle, tone: "secondary" },
];

const LANE_EMPTY = {
  scheduled: "Nothing scheduled. Approved requests appear here once dispatched from the queue.",
  inProgress: "Nothing in motion right now.",
  completed: "No completed dispatches yet.",
  cancelled: "No cancelled dispatches.",
};

const LANE_ACTIVE = {
  info: "border-info bg-info/10 text-info",
  warning: "border-warning bg-warning/10 text-warning",
  success: "border-success bg-success/10 text-success",
  secondary: "border-border bg-hover text-foreground",
};

// Search is client-side: by-status already returns the whole board in one query,
// so filtering locally is instant and costs no extra round trip.
function matches(dispatch, term) {
  if (!term) return true;
  const r = dispatch.transportation_requests;
  const d = dispatch.drivers;
  const haystack = [
    dispatch.dispatch_number,
    dispatch.notes,
    dispatch.vehicles?.plate_number,
    dispatch.vehicles?.model,
    d && [d.first_name, d.last_name].filter(Boolean).join(" "),
    dispatch.routes?.route_name,
    r?.reservation_number,
    r?.guest_name,
    r?.booking_reference,
    r?.pickup_location,
    r?.dropoff_location,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}
export default function DispatchPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();

  const [lane, setLane] = useState("scheduled");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // { dispatch, mode }
  const [odometer, setOdometer] = useState(null); // { dispatch, mode: start|complete }
  const [cancelling, setCancelling] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Resolved once and passed down so the card stays presentational. Each verb
  // matches the role list its endpoint enforces (scripts/verify-rbac.mjs asserts
  // the two layers agree) — hiding a button is convenience, not the boundary.
  const permissions = useMemo(
    () => ({
      dispatchRead: can("dispatch", "read"),
      dispatchUpdate: can("dispatch", "update"),
      reservationsRead: can("reservations", "read"),
      tripsRead: can("trips", "read"),
      // Start and Complete move the trip, not the dispatch, so they check the
      // trips verb — matching the role list /api/trips/[id]/{start,complete}
      // enforces server-side.
      tripsUpdate: can("trips", "update"),
      routesRead: can("routes", "read"),
    }),
    [can]
  );

  const {
    data: groups,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["dispatches-status"],
    queryFn: () => getDispatchesByStatus(),
    refetchInterval: REFETCH_MS,
    placeholderData: (prev) => prev,
  });

  // A dispatch move touches vehicle status, driver status, the originating
  // request, and the trip record, so everything downstream is invalidated.
  const invalidate = () => {
    for (const key of [
      ["dispatches-status"],
      ["dispatches"],
      ["dispatch"],
      ["vehicles"],
      ["vehicle"],
      ["drivers"],
      ["driver-stats"],
      ["transport-requests"],
      ["reservation-timeline"],
      ["trips"],
      ["trips-active"],
    ]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  // Start and Complete go through the TRIP endpoints, never through
  // PUT /api/dispatch/[id]/status. Only the trip routes advance the originating
  // transportation request and write its reservation_events row; the dispatch
  // status route moves that one column and nothing else, which would leave the
  // request behind and punch a hole in the Phase 15 timeline. The trip routes
  // set dispatchschedules.status themselves, so the board still lands in the
  // right lane.
  const tripMutation = useMutation({
    mutationFn: ({ dispatch, mode, body }) => {
      const tripId = dispatch.latest_trip?.trip_id;
      if (!tripId) throw new Error("This dispatch has no trip record yet.");
      return mode === "start" ? startTrip(tripId, body) : completeTrip(tripId, body);
    },
    onMutate: ({ dispatch }) => setBusyId(dispatch.dispatch_id),
    onSuccess: (_res, { mode }) => {
      toast.success(mode === "start" ? "Trip started" : "Trip completed");
      setOdometer(null);
      invalidate();
    },
    // The start endpoint refuses expired registration/licence and unavailable
    // vehicles or drivers with a 400. Keep the dialog open so the reading isn't
    // retyped once the underlying problem is sorted.
    onError: (e) => toast.error(e.message || "Failed to update the trip"),
    onSettled: () => setBusyId(null),
  });

  // Cancelling stands the dispatch down without touching a trip, so it is the
  // one verb that still moves the dispatch row directly.
  const cancelMutation = useMutation({
    mutationFn: ({ dispatch }) => updateDispatchStatus(dispatch.dispatch_id, D.CANCELLED),
    onMutate: ({ dispatch }) => setBusyId(dispatch.dispatch_id),
    onSuccess: () => {
      toast.success("Dispatch cancelled");
      setCancelling(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to cancel the dispatch"),
    onSettled: () => setBusyId(null),
  });

  const patchMutation = useMutation({
    mutationFn: ({ dispatch, patch }) => updateDispatch(dispatch.dispatch_id, patch),
    onSuccess: (_res, { patch }) => {
      toast.success(
        patch.vehicle_id
          ? "Vehicle reassigned"
          : patch.driver_id
            ? "Driver reassigned"
            : "Notes saved"
      );
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to update the dispatch"),
  });

  const counts = useMemo(
    () => ({
      scheduled: groups?.scheduled?.length || 0,
      inProgress: groups?.inProgress?.length || 0,
      completed: groups?.completed?.length || 0,
      cancelled: groups?.cancelled?.length || 0,
    }),
    [groups]
  );

  const items = useMemo(
    () => (groups?.[lane] || []).filter((d) => matches(d, search)),
    [groups, lane, search]
  );

  const stats = useMemo(
    () => [
      { label: "Scheduled", value: counts.scheduled, icon: Clock, tone: "primary", trend: "awaiting departure" },
      { label: "In Progress", value: counts.inProgress, icon: PlayCircle, tone: "warning", trend: "on the road" },
      { label: "Completed", value: counts.completed, icon: CheckCircle2, tone: "success", trend: "closed out" },
      { label: "Cancelled", value: counts.cancelled, icon: XCircle, tone: "secondary", trend: "stood down" },
    ],
    [counts]
  );

  const searching = search.trim().length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Dispatch Board"
        description="Every committed vehicle and driver, and where each trip stands."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/dispatch/calendar">
                <CalendarDays className="w-4 h-4 mr-2" />
                Calendar
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/reservations/queue">
                <Send className="w-4 h-4 mr-2" />
                Request Queue
              </Link>
            </Button>
          </div>
        }
      />

      <StatGrid cols={4}>
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </StatGrid>

      {/* Lane selector + search. Counts stay visible for every lane so the board
          still reads as a board even though one lane is shown at a time. */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Dispatch status">
          {LANES.map((l) => {
            const Icon = l.icon;
            const active = lane === l.id;
            return (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setLane(l.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? LANE_ACTIVE[l.tone]
                    : "border-border text-foreground-secondary hover:bg-hover"
                )}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {l.label}
                <span className="font-data opacity-70">{counts[l.id]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-72">
            <Search
              className="absolute left-2.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-foreground-muted"
              aria-hidden="true"
            />
            <Input
              className="pl-8"
              placeholder="Dispatch, guest, plate, driver, route…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search dispatches"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            disabled={isFetching}
            onClick={() => refetch()}
            aria-label="Refresh the board"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 w-5 h-5 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Could not load the board</p>
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
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <DispatchCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={searching ? Search : Inbox}
            title={searching ? "No dispatches match that search" : `Nothing in ${LANES.find((l) => l.id === lane)?.label}`}
            description={searching ? "Try a different term or clear the search." : LANE_EMPTY[lane]}
            action={
              searching ? (
                <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              ) : (
                <Button size="sm" asChild>
                  <Link href="/reservations/queue">
                    <Send className="w-4 h-4 mr-2" />
                    Go to the queue
                  </Link>
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {items.map((d) => (
            <DispatchCard
              key={d.dispatch_id}
              dispatch={d}
              permissions={permissions}
              isBusy={busyId === d.dispatch_id}
              onStart={(dispatch) => setOdometer({ dispatch, mode: "start" })}
              onComplete={(dispatch) => setOdometer({ dispatch, mode: "complete" })}
              onCancel={(dispatch) => setCancelling(dispatch)}
              onReassign={(dispatch, mode) => setEditing({ dispatch, mode })}
              onEditNotes={(dispatch) => setEditing({ dispatch, mode: "notes" })}
            />
          ))}
        </div>
      )}

      <DispatchEditDialog
        dispatch={editing?.dispatch}
        mode={editing?.mode}
        isPending={patchMutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(payload) => patchMutation.mutate(payload)}
      />

      <TripOdometerDialog
        dispatch={odometer?.dispatch}
        mode={odometer?.mode}
        isPending={tripMutation.isPending}
        onClose={() => setOdometer(null)}
        onSubmit={(payload) => tripMutation.mutate(payload)}
      />

      <Dialog open={!!cancelling} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this dispatch?</DialogTitle>
            <DialogDescription>
              {cancelling
                ? `${cancelling.dispatch_number || `DSP-${cancelling.dispatch_id}`} will be stood down. The vehicle and driver return to the pool. The originating request keeps its own status — reassign or re-dispatch it from the queue.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => cancelling && cancelMutation.mutate({ dispatch: cancelling })}
            >
              Cancel Dispatch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

