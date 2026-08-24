"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ConflictBlock } from "@/components/reservations/conflict-block";
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
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GalleryVerticalEnd,
  Inbox,
  PlayCircle,
  RefreshCw,
  Search,
  Users,
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
  { id: "all", label: "All", icon: GalleryVerticalEnd, tone: "secondary" },
  { id: "pendingReassignment", status: D.PENDING_REASSIGNMENT, label: "Pending Reassignment", icon: Inbox, tone: "danger" },
  { id: "scheduled", status: D.SCHEDULED, label: "Scheduled", icon: Clock, tone: "info" },
  { id: "inProgress", status: D.IN_PROGRESS, label: "In Progress", icon: PlayCircle, tone: "warning" },
  { id: "completed", status: D.COMPLETED, label: "Completed", icon: CheckCircle2, tone: "success" },
  { id: "cancelled", status: D.CANCELLED, label: "Cancelled", icon: XCircle, tone: "secondary" },
];

const LANE_EMPTY = {
  all: "No dispatches yet.",
  pendingReassignment: "No dispatches pending reassignment.",
  scheduled: "Nothing scheduled. Approved requests appear here once dispatched from the queue.",
  inProgress: "Nothing in motion right now.",
  completed: "No completed dispatches yet.",
  cancelled: "No cancelled dispatches.",
};

const LANE_ACTIVE = {
  danger: "bg-danger text-white shadow-sm",
  info: "bg-info text-white shadow-sm",
  warning: "bg-warning text-white shadow-sm",
  success: "bg-success text-white shadow-sm",
  secondary: "bg-foreground text-surface shadow-sm",
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
  // Blocking findings from a rejected reassignment PATCH, kept visible above
  // the lanes until dismissed — a toast alone disappears too fast for a
  // dispatcher mid-decision.
  const [lastReassignConflicts, setLastReassignConflicts] = useState(null);

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
      setLastReassignConflicts(null);
      invalidate();
    },
    onError: (e, { patch }) => {
      // The server answers a blocked reassignment with a rich message (document
      // windows, number coding, double-booking) and — for structured bodies —
      // the blocking conflicts themselves. Structured findings stay pinned in an
      // inline alert above the lanes; everything else rides the toast.
      const conflicts = Array.isArray(e?.data?.conflicts) ? e.data.conflicts : [];
      const isReassign = patch?.vehicle_id !== undefined || patch?.driver_id !== undefined;
      if (conflicts.length > 0) {
        setLastReassignConflicts(conflicts);
        toast.error(e.message || "Reassignment blocked");
      } else if (isReassign) {
        toast.error(`Reassignment blocked: ${e.message || "the pair was rejected"}`);
      } else {
        toast.error(e.message || "Failed to update the dispatch");
      }
    },
  });

  const counts = useMemo(
    () => ({
      all: Object.values(groups || {}).flat().length,
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
    () => (lane === "all" ? Object.values(groups || {}).flat() : groups?.[lane] || []).filter((d) => matches(d, search)),
    [groups, lane, search]
  );

  const isPaginated = PAGINATED_LANES.has(lane);
  const totalPages = isPaginated ? Math.max(1, Math.ceil(allItems.length / PAGE_SIZE)) : 1;
  const safePage = Math.min(page, totalPages);
  const items = isPaginated
    ? allItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
    : allItems;

  const searching = search.trim().length > 0;

  return (
    <div className="space-y-6">
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
            <Button variant="outline" asChild className={cn(heroButtonOutlineClass)}>
              <Link href="/dispatch/availability">
                <Users className="w-4 h-4 mr-2" />
                Check availability
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

      <section className="rounded-2xl border border-border/70 bg-surface p-4 shadow-xs">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-hover/70 p-1" role="tablist" aria-label="Dispatch status">
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
                    "flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
                    active
                      ? LANE_ACTIVE[l.tone]
                      : "text-foreground-secondary hover:bg-surface hover:text-foreground"
                  )}
                >
                  <LaneIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {l.label}
                  <span className={cn(
                    "flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 font-data text-[10px]",
                    active ? "bg-white/20 text-current" : "bg-surface text-foreground"
                  )}>
                    {counts[l.id]}
                  </span>
                  {laneAlerts > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white" title={`${laneAlerts} departing without a full assignment`}>
                      {laneAlerts}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <label className="flex h-10 items-center gap-2 rounded-xl border border-border/80 bg-surface px-3 xl:w-80">
            <Search className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden="true" />
            <span className="sr-only">Search dispatches</span>
            <Input
              className="h-9 border-0 bg-transparent px-0 focus-visible:ring-0"
              placeholder="Search dispatch, plate, driver…"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
            />
          </label>
        </div>
      </section>

      {/* Reassignment blockers — persistent until dismissed, so the reason a
          pair was rejected survives the toast and stays visible while the
          dispatcher picks another lane or another pair. */}
      {lastReassignConflicts?.length > 0 && (
        <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <ConflictBlock conflicts={lastReassignConflicts} className="flex-1 min-w-0" />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setLastReassignConflicts(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

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
        <div className="space-y-3">
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
        </div>
      )}

      <DispatchEditDialog
        dispatch={editing?.dispatch}
        mode={editing?.mode}
        isPending={patchMutation.isPending}
        error={editing?.mode === "assign" ? patchMutation.error : null}
        onClose={() => { patchMutation.reset(); setEditing(null); }}
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

