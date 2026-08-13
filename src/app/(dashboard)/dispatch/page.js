"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useRoleAccess } from "@/hooks/use-role-access";
import { useDepartureAlerts } from "@/hooks/use-departure-alerts";
import { useRequireRole } from "@/lib/auth/role-guard";
import {
  getDispatchesByStatus,
  updateDispatch,
  cancelDispatch,
} from "@/services/dispatch.service";
import { DISPATCH_STATUS as D } from "@/lib/constants";
import { alertMessage } from "@/lib/scheduling/departure-alerts";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";

const PAGINATED_LANES = new Set(["completed", "cancelled"]);
const PAGE_SIZE = 4;

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
  { id: "pendingReassignment", status: D.PENDING_REASSIGNMENT, label: "Pending Reassignment", icon: Inbox, tone: "danger" },
  { id: "scheduled", status: D.SCHEDULED, label: "Scheduled", icon: Clock, tone: "info" },
  { id: "inProgress", status: D.IN_PROGRESS, label: "In Progress", icon: PlayCircle, tone: "warning" },
  { id: "completed", status: D.COMPLETED, label: "Completed", icon: CheckCircle2, tone: "success" },
  { id: "cancelled", status: D.CANCELLED, label: "Cancelled", icon: XCircle, tone: "secondary" },
];

const LANE_EMPTY = {
  pendingReassignment: "No dispatches pending reassignment.",
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
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // { dispatch, mode }
  const [cancelling, setCancelling] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busyId, setBusyId] = useState(null);

  // Reset page whenever the active lane or search term changes
  const switchLane = (id) => { setLane(id); setPage(1); };
  const changeSearch = (val) => { setSearch(val); setPage(1); };

  // Resolved once and passed down so the card stays presentational. Each verb
  // matches the role list its endpoint enforces (scripts/verify-rbac.mjs asserts
  // the two layers agree) — hiding a button is convenience, not the boundary.
  const permissions = useMemo(
    () => ({
      dispatchRead: can("dispatch", "read"),
      dispatchUpdate: can("dispatch", "update"),
      reservationsRead: can("reservations", "read"),
      tripsRead: can("trips", "read"),
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

  // Cancelling stands the dispatch down without touching a trip, so it is the
  // one verb that still moves the dispatch row directly.
  const cancelMutation = useMutation({
    mutationFn: ({ dispatch, reason }) => cancelDispatch(dispatch.dispatch_id, reason),
    onMutate: ({ dispatch }) => setBusyId(dispatch.dispatch_id),
    onSuccess: () => {
      toast.success("Dispatch cancelled");
      setCancelling(null);
      setCancelReason("");
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to cancel the dispatch"),
    onSettled: () => setBusyId(null),
  });

  const patchMutation = useMutation({
    mutationFn: ({ dispatch, patch }) => updateDispatch(dispatch.dispatch_id, patch),
    onSuccess: (_res, { patch }) => {
      toast.success(
        patch.vehicle_id && patch.driver_id
          ? "Dispatch reassigned"
          : patch.vehicle_id
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
      pendingReassignment: groups?.pendingReassignment?.length || 0,
      scheduled: groups?.scheduled?.length || 0,
      inProgress: groups?.inProgress?.length || 0,
      completed: groups?.completed?.length || 0,
      cancelled: groups?.cancelled?.length || 0,
    }),
    [groups]
  );

  // Warnings are evaluated over every lane that can still depart, not the
  // selected one — a dispatcher reviewing Completed must not go blind to a car
  // that is ten minutes from leaving with nobody on it. Search is excluded for
  // the same reason.
  const alertable = useMemo(
    () => [...(groups?.pendingReassignment || []), ...(groups?.scheduled || [])],
    [groups]
  );
  const { byId: alertsById, count: alertCount, alerts } = useDepartureAlerts(alertable);

  // Per-lane tally, so a chip can carry the warning even when its lane is closed.
  const alertsByLane = useMemo(() => {
    const tally = {};
    for (const { dispatch: d } of alerts) {
      const key = d.status === D.PENDING_REASSIGNMENT ? "pendingReassignment" : "scheduled";
      tally[key] = (tally[key] || 0) + 1;
    }
    return tally;
  }, [alerts]);

  const allItems = useMemo(
    () => (groups?.[lane] || []).filter((d) => matches(d, search)),
    [groups, lane, search]
  );

  const isPaginated = PAGINATED_LANES.has(lane);
  const totalPages = isPaginated ? Math.max(1, Math.ceil(allItems.length / PAGE_SIZE)) : 1;
  const safePage = Math.min(page, totalPages);
  const items = isPaginated
    ? allItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
    : allItems;

  const stats = useMemo(
    () => [
      {
        label: "Pending Reassignment",
        value: counts.pendingReassignment,
        icon: Inbox,
        tone: "danger",
        trend: "needs urgent action",
        active: lane === "pendingReassignment",
        onClick: () => switchLane("pendingReassignment"),
      },
      {
        label: "Scheduled",
        value: counts.scheduled,
        icon: Clock,
        tone: "primary",
        trend: "awaiting departure",
        active: lane === "scheduled",
        onClick: () => switchLane("scheduled"),
      },
      {
        label: "In Progress",
        value: counts.inProgress,
        icon: PlayCircle,
        tone: "warning",
        trend: "on the road",
        active: lane === "inProgress",
        onClick: () => switchLane("inProgress"),
      },
      {
        label: "Completed",
        value: counts.completed,
        icon: CheckCircle2,
        tone: "success",
        trend: "closed out",
        active: lane === "completed",
        onClick: () => switchLane("completed"),
      },
      {
        label: "Cancelled",
        value: counts.cancelled,
        icon: XCircle,
        tone: "secondary",
        trend: "stood down",
        active: lane === "cancelled",
        onClick: () => switchLane("cancelled"),
      },
    ],
    [counts, lane]
  );

  const searching = search.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <HeroHeader
        icon={Send}
        title="Dispatch Operations Board"
        badge="Live Fleet Control"
        description="Real-time dispatch scheduling, trip management, and driver assignment board."
        actions={
          <>
            <Button variant="outline" asChild className={cn(heroButtonOutlineClass)}>
              <Link href="/dispatch/calendar">
                <CalendarDays className="w-4 h-4 mr-2" />
                Calendar
              </Link>
            </Button>
            <Button variant="outline" asChild className={cn(heroButtonOutlineClass)}>
              <Link href="/reservations/queue">
                <Send className="w-4 h-4 mr-2" />
                Request Queue
              </Link>
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={isFetching}
              onClick={() => refetch()}
              className={cn(heroButtonOutlineClass)}
              aria-label="Refresh the board"
            >
              <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
            </Button>
          </>
        }
      />

      {/* KPI Cards */}
      <StatGrid cols={5}>
        {stats.map((s) => {
          return <StatCard key={s.label} {...s} />;
        })}
      </StatGrid>

      {/* Departure warnings — the one thing on this board that is time-critical,
          so it sits above the lanes and stays put regardless of which lane is
          open or what is typed in the search box. */}
      {alertCount > 0 && (
        <div className="rounded-2xl border border-danger/30 bg-danger/6 p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">
                {alertCount === 1
                  ? "1 dispatch is departing without a full assignment"
                  : `${alertCount} dispatches are departing without a full assignment`}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {alerts.slice(0, 4).map(({ dispatch: d, alert }) => (
                  <button
                    key={d.dispatch_id}
                    type="button"
                    onClick={() => {
                      setSearch("");
                      switchLane(
                        d.status === D.PENDING_REASSIGNMENT ? "pendingReassignment" : "scheduled"
                      );
                    }}
                    className="text-xs font-semibold text-foreground-secondary hover:text-danger transition-colors cursor-pointer"
                  >
                    <span className="font-data">
                      {d.dispatch_number || `DSP-${d.dispatch_id}`}
                    </span>
                    <span className="ml-1.5 text-foreground-muted">{alertMessage(alert)}</span>
                  </button>
                ))}
                {alerts.length > 4 && (
                  <span className="text-xs text-foreground-muted">
                    +{alerts.length - 4} more
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lane selector + search. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Dispatch status">
          {LANES.map((l) => {
            const LaneIcon = l.icon;
            const active = lane === l.id;
            const laneAlerts = alertsByLane[l.id] || 0;
            return (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => switchLane(l.id)}
                className={cn(
                  'flex items-center gap-2 px-4 h-9 rounded-full text-xs font-bold border transition-all cursor-pointer',
                  active
                    ? LANE_ACTIVE[l.tone]
                    : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40'
                )}
              >
                <LaneIcon className="w-3.5 h-3.5" aria-hidden="true" />
                {l.label} ({counts[l.id]})
                {laneAlerts > 0 && (
                  <span
                    className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
                    title={`${laneAlerts} departing without a full assignment`}
                  >
                    {laneAlerts}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="bg-surface border border-border/80 rounded-2xl px-3 flex items-center gap-2 sm:w-72">
          <Search className="w-4 h-4 text-foreground-muted shrink-0" aria-hidden="true" />
          <Input
            className="border-0 bg-transparent focus-visible:ring-0 px-0 h-9"
            placeholder="Dispatch, guest, plate, driver, route…"
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            aria-label="Search dispatches"
          />
        </div>
      </div>

      {isError ? (
        <div className="rounded-3xl border border-danger/30 bg-danger/5 p-4">
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
        <div className="rounded-3xl border border-border bg-surface">
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
        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {items.map((d) => (
                <DispatchCard
                  key={d.dispatch_id}
                  dispatch={d}
                  permissions={permissions}
                  isBusy={busyId === d.dispatch_id}
                  alert={alertsById.get(d.dispatch_id) || null}
                  onCancel={(dispatch) => setCancelling(dispatch)}
                  onReassign={(dispatch, mode) => setEditing({ dispatch, mode })}
                  onEditNotes={(dispatch) => setEditing({ dispatch, mode: "notes" })}
                />
              ))}
            </div>

            {/* Pagination footer — only for Completed / Cancelled lanes */}
            {isPaginated && totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border/50 pt-4 mt-2">
                <span className="text-xs text-foreground-muted font-medium">
                  Showing{" "}
                  <span className="font-bold text-foreground">
                    {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, allItems.length)}
                  </span>{" "}
                  of <span className="font-bold text-foreground">{allItems.length}</span>
                </span>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={cn(
                        "h-8 w-8 rounded-full text-xs font-bold border transition-all cursor-pointer flex items-center justify-center",
                        p === safePage
                          ? "bg-primary text-white border-primary shadow-sm"
                          : "bg-surface border-border/60 text-foreground-secondary hover:border-primary/60 hover:text-foreground"
                      )}
                    >
                      {p}
                    </button>
                  ))}

                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <DispatchEditDialog
        dispatch={editing?.dispatch}
        mode={editing?.mode}
        isPending={patchMutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(payload) => patchMutation.mutate(payload)}
      />

      <Dialog open={!!cancelling} onOpenChange={(open) => { if (!open) { setCancelling(null); setCancelReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this dispatch?</DialogTitle>
            <DialogDescription>
              {cancelling
                ? `${cancelling.dispatch_number || `DSP-${cancelling.dispatch_id}`} will be stood down. The vehicle and driver return to the pool. The originating request keeps its own status — reassign or re-dispatch it from the queue.`
                : ""}
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
            <Button variant="outline" onClick={() => { setCancelling(null); setCancelReason(""); }}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending || cancelReason.trim().length === 0}
              onClick={() => cancelling && cancelMutation.mutate({ dispatch: cancelling, reason: cancelReason.trim() })}
            >
              {cancelMutation.isPending ? "Cancelling…" : "Cancel Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

