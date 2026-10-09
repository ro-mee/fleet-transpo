"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useWorkspaceAside } from "@/hooks/use-workspace-aside";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import {
  ReservationQueueTable,
  ReservationQueueTableSkeleton,
} from "@/components/reservations/reservation-queue-table";
import { DispatchPlanPanel } from "@/components/reservations/dispatch-plan-panel";
import { CopilotAvatar } from "@/components/reservations/copilot-avatar";
import { useDispatchPlan } from "@/hooks/use-dispatch-plan";
import { useRoleAccess } from "@/hooks/use-role-access";
import {
  getTransportRequests,
  cancelRequest,
  pullTransportRequests,
} from "@/services/transport.service";
import { QUEUE_TABS } from "@/lib/scheduling/queue-grouping";
import { QUEUE_FALLBACK_TAB, queueTabBadges, resolveQueueTabView } from "@/lib/scheduling/smart-default-tab";
import { describeBookingNotify } from "@/lib/integration/booking-notify";
import { cn } from "@/lib/utils";
import {
  CalendarClock,
  CalendarDays,
  CarFront,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  DownloadCloud,
  Inbox,
  LayoutGrid,
  List,
  PlayCircle,
  Search,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const REFETCH_MS = 30_000;

export function resolveCommittedRequest({ selectedRequest, committedSuccessForId, freshSelectedRequest }) {
  if (!committedSuccessForId) return selectedRequest;
  if (!freshSelectedRequest) return committedSuccessForId;

  if (Number(freshSelectedRequest.request_id) !== Number(committedSuccessForId.request_id)) {
    return committedSuccessForId;
  }
  const freshStateMatches = ['Assigned', 'In Progress', 'Completed', 'Cancelled']
    .includes(freshSelectedRequest.fleet_status);

  return freshStateMatches ? freshSelectedRequest : committedSuccessForId;
}

// `label` is the visible tab name, `plainLabel` the same name in running text
// (the empty state reads "Nothing <plainLabel>"), and `description` spells out
// the filter for the tooltip and assistive technology.
//
// The Today tab also includes overdue pickups (`pickup <= today` in Manila).
// Keep the short tab label requested for the queue; the tooltip explains its
// full scope. See QUEUE_TAB_PREDICATES in the transport-requests route.
const TAB_META = {
  today: {
    label: "Today",
    plainLabel: "today",
    description: "Pickup today or already past — the dispatcher's now.",
    icon: Inbox,
  },
  upcoming: {
    label: "Upcoming",
    plainLabel: "upcoming",
    description: "Pickup on a later day.",
    icon: CalendarClock,
  },
  assigned: {
    label: "Assigned",
    plainLabel: "assigned",
    description: "Vehicle and driver committed; waiting on the driver to start.",
    icon: CarFront,
  },
  inProgress: {
    label: "In Progress",
    plainLabel: "in progress",
    description: "A trip is running now.",
    icon: PlayCircle,
  },
  completed: {
    label: "Completed",
    plainLabel: "completed",
    description: "Finished requests.",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    plainLabel: "cancelled",
    description: "Stood-down requests.",
    icon: XCircle,
  },
};

export default function UnifiedQueuePage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const reassignmentFilter = searchParams.get("filter") === "reassignment";
  const departingSoonFilter = searchParams.get("filter") === "departing-soon";
  const queueFilter = departingSoonFilter ? "departing-soon" : reassignmentFilter ? "reassignment" : null;
  const { can } = useRoleAccess();
  // Side-by-side vs drawer keys off the measured workspace *content* width
  // (1120px = 460 aside + 24 gap + 636 queue), not the viewport: with the
  // expanded 240px sidebar a 1280px viewport leaves only ~992px usable, which
  // crushes the queue beside the Copilot. First render is false on server and
  // client alike so hydration agrees; the observer upgrades after mount.
  const workspaceRef = useRef(null);
  const isDesktop = useWorkspaceAside(workspaceRef);
  const [lockedRequest,setLockedRequest] = useState(null);
  const [completedRequest,setCompletedRequest] = useState(null);

  const [tabOverride, setTabOverride] = useState(() => departingSoonFilter ? "today" : null);
  const [page, setPage] = useState(1);
  const steerTimer = useRef(null);
  const pickTab = (id) => {
    if (lockedRequest) return;
    clearTimeout(steerTimer.current);
    setTabOverride(id);
    setPage(1);
    if (departingSoonFilter) router.replace("/reservations/queue");
  };
  // The tab this render fetches. `counts` only exist after this query resolves,
  // so this one value is computed here and re-derived (with the steering
  // decision) by resolveQueueTabView below. QUEUE_FALLBACK_TAB is the same
  // constant that function uses, so the two can never disagree.
  const fetchTab = departingSoonFilter ? "today" : tabOverride ?? QUEUE_FALLBACK_TAB;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  // Selection & responsive drawer coordination
  const [selectedRequestId, setSelectedRequestId] = useState(null);

  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const mobileDrawerOpenerRef = useRef(null);
  const mobileOpenTriggerRef = useRef(null);
  const [viewMode, setViewMode] = useState("list");

  // Dispatch copilot shared plan hook
  const planHook = useDispatchPlan({
    canRecommend: can("reservations", "recommend"),
    paused:!!lockedRequest || (!isDesktop && !isMobileDrawerOpen),
  });

  // Debounce free-text search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const permissions = useMemo(
    () => ({
      read: can("reservations", "read"),
      update: can("reservations", "update"),
      approve: can("reservations", "approve"),
      assign: can("reservations", "assign"),
      cancel: can("reservations", "cancel"),
      recommend: can("reservations", "recommend"),
    }),
    [can]
  );

  const PAGE_SIZE = 25;

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["transport-requests", "unified-queue", fetchTab, page, debouncedSearch, queueFilter],
    queryFn: () =>
      getTransportRequests({
        tab: fetchTab,
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        with_conflicts: "true",
        filter: queueFilter || undefined,
      }),
    refetchInterval: REFETCH_MS,
  });

  const requests = useMemo(()=>data?.rows || [],[data?.rows]);
  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const counts = data?.counts?.tabs || {};
  const countsReady = !isLoading && !isError;
  // One decision, made in one place: which tab may be highlighted (always the
  // fetched one — never the tab we are steering to) and whether the deferred
  // smart default still needs applying. See resolveQueueTabView.
  const { activeTab: tab, steerTo } = resolveQueueTabView({
    tabOverride: departingSoonFilter ? "today" : tabOverride,
    counts,
    countsReady,
  });
  const badges = queueTabBadges(QUEUE_TABS, counts, countsReady);

  useEffect(() => {
    if (!steerTo) return;
    steerTimer.current = setTimeout(() => setTabOverride(steerTo), 0);
    return () => clearTimeout(steerTimer.current);
  }, [steerTo]);

  // Selection handling:
  // When criteria change (tab, page, search), select the first visible row in the new result set.
  // When background polling refreshes data, preserve existing user selection.
  const queryCriteriaKey = `${fetchTab}-${page}-${debouncedSearch}-${queueFilter || ""}`;
  const [lastCriteria,setLastCriteria] = useState(queryCriteriaKey);
  if (!lockedRequest && lastCriteria !== queryCriteriaKey) {
    setLastCriteria(queryCriteriaKey);
    setSelectedRequestId(requests[0]?.request_id ?? null);
  } else if (!lockedRequest && !selectedRequestId && requests.length) {
    setSelectedRequestId(requests[0].request_id);
  }

  const freshSelectedRequest = useMemo(() => {
    if (!selectedRequestId) return requests[0] || null;
    return requests.find((r) => Number(r.request_id) === Number(selectedRequestId)) || null;
  }, [requests, selectedRequestId]);

  const selectedRequest = useMemo(() => {
    if (lockedRequest) return lockedRequest;
    return freshSelectedRequest ||
      (Number(completedRequest?.request_id) === Number(selectedRequestId) ? completedRequest : null);
  }, [freshSelectedRequest, selectedRequestId, lockedRequest, completedRequest]);

  const committedSuccessForId = Number(completedRequest?.request_id) === Number(selectedRequestId)
    ? completedRequest
    : null;
  const displayedRequest = resolveCommittedRequest({
    selectedRequest,
    committedSuccessForId,
    freshSelectedRequest,
  });

  const handleCopilotBusy=useCallback(busy=>setLockedRequest(busy ? displayedRequest : null),[displayedRequest]);

  const handleSelectRow = (r) => {
    if (lockedRequest) return;
    setSelectedRequestId(r.request_id);
    if (!isDesktop) {
      const activeElement = typeof document !== "undefined" ? document.activeElement : null;
      const rowOpener = activeElement?.hasAttribute?.("aria-pressed") ? activeElement : null;
      mobileDrawerOpenerRef.current = rowOpener ?? mobileOpenTriggerRef.current;
      setIsMobileDrawerOpen(true);
    }
  };

  // Pagination page numbers
  const pageNumbers = useMemo(() => {
    const current = Math.min(page, pageCount);
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const set = new Set([1, pageCount, current - 1, current, current + 1]);
    const ordered = [...set].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < ordered.length; i++) {
      const n = ordered[i];
      if (i > 0 && n - ordered[i - 1] > 1) out.push("…");
      out.push(n);
    }
    return out;
  }, [page, pageCount]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
    queryClient.invalidateQueries({ queryKey: ["dispatches"] });
    queryClient.invalidateQueries({ queryKey: ["dispatches-status"] });
  }, [queryClient]);

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

  const cancelMutation = useMutation({
    mutationFn: (target) => cancelRequest(target.request_id, target.reason || null),
    onMutate: (target) => setBusyId(target.request_id),
    onSuccess: (res) => {
      // Reports the actual hand-off (including a mock gateway) rather than
      // promising Booking was notified — see describeBookingNotify.
      toast.success(`Request cancelled. ${describeBookingNotify(res?.booking_notify)}`);
      setCancelTarget(null);
      invalidate();
    },
    onSettled: () => setBusyId(null),
  });

  const searching = debouncedSearch.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <HeroHeader
        icon={Inbox}
        title="Transportation Queue"
        badge="Operations"
        description="Every request and committed dispatch in one place — auto-sorted by urgency."
        actions={
          <div className="flex flex-col gap-2 min-w-0 w-full sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            {!isDesktop && selectedRequest && (
              <Button
                ref={mobileOpenTriggerRef}
                variant="outline"
                size="sm"
                onClick={event => {
                  mobileDrawerOpenerRef.current = event.currentTarget;
                  setIsMobileDrawerOpen(true);
                }}
                className="min-h-[44px] rounded-xl text-xs font-semibold pl-2 w-full sm:w-auto max-w-full"
              >
                <CopilotAvatar size="xxs" className="mr-1.5" />
                Open Copilot
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px] rounded-xl text-xs font-semibold w-full sm:w-auto max-w-full"
              asChild
            >
              <Link href="/dispatch/calendar">
                <CalendarDays className="w-4 h-4 mr-1.5" />
                Dispatch calendar
              </Link>
            </Button>
            <Button
              className={cn(heroButtonPrimaryClass, "min-h-[44px] w-full sm:w-auto max-w-full")}
              onClick={() => pullMutation.mutate()}
              disabled={pullMutation.isPending}
            >
              <DownloadCloud className="w-4 h-4 mr-2" />
              {pullMutation.isPending ? "Pulling…" : "Pull from Booking"}
            </Button>
          </div>
        }
      />

      {/* ── Filters & Search Row (Preserved Lifecycle Filters) ── */}
      <div className="flex flex-col gap-3 rounded-3xl border border-border/80 bg-surface p-3.5 sm:flex-row sm:items-center sm:justify-between shadow-xs">
        {/* Labelled filter-button group (not ARIA tabs): these switch between
            filtered queues rather than tabpanels, so they expose aria-pressed
            instead of the tablist/tab/aria-selected contract. */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Queue sections">
          {reassignmentFilter && (
            <button
              type="button"
              onClick={() => router.replace("/reservations/queue")}
              className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-full text-xs font-bold border border-red-500/40 bg-red-100/90 text-red-900 dark:bg-red-950/60 dark:text-red-200 cursor-pointer transition-colors hover:bg-red-200/90 dark:hover:bg-red-900/60"
              title="Clear reassignment filter"
            >
              <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />
              Needs reassignment
              <XCircle className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
            </button>
          )}
          {departingSoonFilter && (
            <button
              type="button"
              onClick={() => router.replace("/reservations/queue")}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-100/90 px-3 text-xs font-bold text-amber-950 transition-colors hover:bg-amber-200/90 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-900/60"
              title="Clear the next-30-minute pickup filter"
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Unassigned pickups · next 30 min ({total})
              <XCircle className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
            </button>
          )}
          {QUEUE_TABS.map((id) => {
            const meta = TAB_META[id];
            const Icon = meta.icon;
            const active = tab === id;
            // null = not loaded yet. It renders as a loading glyph and is
            // announced as "count loading" — never as "0", which claims the
            // queue is empty.
            const badge = badges[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                aria-label={
                  countsReady
                    ? `${meta.label} — ${badge} request${badge === 1 ? "" : "s"}`
                    : `${meta.label} — count loading`
                }
                title={meta.description}
                onClick={() => pickTab(id)}
                className={cn(
                  "inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full text-xs font-bold border transition-all cursor-pointer",
                  active
                    ? "bg-primary text-white dark:text-slate-950 border-primary shadow-xs"
                    : "bg-surface border-border/60 text-foreground-secondary hover:border-primary/40 hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {meta.label}
                <span className="font-data text-[11px] opacity-80" aria-hidden="true">
                  {badge == null ? "(…)" : `(${badge})`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search
              className="absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-foreground-muted"
              aria-hidden="true"
            />
            <input
              className="w-full min-h-[44px] pl-9 pr-3 rounded-xl bg-surface border border-border/80 text-xs font-medium text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-primary/60 transition-colors"
              placeholder="Guest, reference, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search the queue"
            />
          </div>

          {/* List vs Grid View Toggle */}
          <div
            className="inline-flex items-center p-1 rounded-2xl border border-border/80 bg-muted/25 shrink-0"
            role="group"
            aria-label="View layout switcher"
          >
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "px-2.5 py-1 min-h-[44px] rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer",
                viewMode === "list"
                  ? "bg-surface text-foreground shadow-2xs font-bold border border-border/60"
                  : "text-foreground-muted hover:text-foreground"
              )}
              title="List View"
              aria-label="List View"
              aria-pressed={viewMode === "list"}
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden md:inline">List</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn(
                "px-2.5 py-1 min-h-[44px] rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer",
                viewMode === "grid"
                  ? "bg-surface text-foreground shadow-2xs font-bold border border-border/60"
                  : "text-foreground-muted hover:text-foreground"
              )}
              title="Grid View"
              aria-label="Grid View"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Grid</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Two-Column Main Workspace (Queue on Left, Persistent Copilot on Right) ── */}
      {/* Stacking and the aside/drawer decision key off the measured content
          width (useWorkspaceAside), never the viewport: the observer watches
          this container, and the queue column below is the @container the
          rows respond to. Selection lives in page state, so crossing the
          threshold never loses the selected request. */}
      <div ref={workspaceRef} className={cn("flex items-start gap-6 min-w-0", isDesktop ? "flex-row" : "flex-col")}>
        {/* LEFT COLUMN: Queue Content */}
        <div className="flex-1 w-full min-w-0 space-y-4 @container" aria-busy={isLoading}>
          {isError ? (
            <div className="rounded-3xl border border-danger/30 bg-danger/5 p-4" role="alert">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 w-5 h-5 shrink-0 text-danger" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-foreground">Could not load the queue</p>
                  <p className="mt-0.5 text-xs text-foreground-secondary">{error?.message}</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                    Try again
                  </Button>
                </div>
              </div>
            </div>
          ) : isLoading ? (
            <>
              <p role="status" className="sr-only">Loading transportation requests…</p>
              <ReservationQueueTableSkeleton viewMode={viewMode} />
            </>
          ) : requests.length === 0 ? (
            <div className="rounded-3xl border border-border bg-surface">
              <EmptyState
                icon={searching ? Search : Inbox}
                title={
                  departingSoonFilter && !searching
                    ? "No unassigned pickups within 30 minutes"
                    : searching
                    ? "Nothing matches that search"
                    : `Nothing ${TAB_META[tab]?.plainLabel || "here"}`
                }
                description={
                  departingSoonFilter && !searching
                    ? "No open request is missing a vehicle or driver with pickup due from now through the next 30 minutes."
                    : searching
                    ? "Try a different term or clear the search."
                    : "Requests from Booking and active dispatches appear here. Use “Pull from Booking” to fetch new ones."
                }
                variant={searching || departingSoonFilter ? "filtered" : "waiting"}
                action={
                  searching || departingSoonFilter ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => departingSoonFilter ? router.replace("/reservations/queue") : setSearch("")}
                    >
                      {departingSoonFilter ? "Clear pickup filter" : "Clear search"}
                    </Button>
                  ) : (
                    <Button size="sm" className="min-h-[44px]" onClick={() => pullMutation.mutate()} disabled={pullMutation.isPending}>
                      <DownloadCloud className="w-4 h-4 mr-2" />
                      Pull from Booking
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <ReservationQueueTable
              requests={requests}
              selectedId={selectedRequestId}
              onSelect={handleSelectRow}
              permissions={permissions}
              onCancel={(req) => setCancelTarget(req)}
              busyId={busyId}
              getProposal={planHook.getProposal}
              bucketProposal={planHook.bucketProposal}
              viewMode={viewMode}
            />
          )}

          {/* Compact Pagination Controls */}
          {pageCount > 1 && (
            <div className="flex flex-col gap-3 rounded-3xl border border-border/80 bg-surface px-6 py-4 @sm:flex-row @sm:items-center @sm:justify-between shadow-xs">
              <span className="text-xs font-semibold text-foreground-secondary">
                Showing{" "}
                <span className="font-bold text-foreground">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}
                </span>{" "}
                of <span className="font-bold text-foreground">{total}</span> entries
              </span>
              <div className="flex items-center gap-1.5">
                <span className="mr-2 hidden text-xs font-semibold text-foreground-muted @sm:inline">
                  Page {page} of {pageCount}
                </span>
                <button
                  aria-label="First page"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors @sm:flex"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  aria-label="Previous page"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                {pageNumbers.map((pg) =>
                  typeof pg === "string" ? (
                    <span key={pg} className="px-1 text-xs text-foreground-muted">
                      …
                    </span>
                  ) : (
                    <button
                      key={pg}
                      onClick={() => setPage(pg)}
                      className={cn(
                        "flex min-h-[44px] min-w-[44px] px-2.5 items-center justify-center rounded-full text-xs font-bold border transition-colors",
                        pg === page
                          ? "bg-primary border-primary text-white dark:text-slate-950 shadow-2xs"
                          : "border-border/80 bg-surface text-foreground-secondary hover:border-primary/40 hover:text-primary"
                      )}
                    >
                      {pg}
                    </button>
                  )
                )}
                <button
                  aria-label="Next page"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page === pageCount}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  aria-label="Last page"
                  onClick={() => setPage(pageCount)}
                  disabled={page === pageCount}
                  className="hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Persistent Aside (Desktop) or Drawer (Mobile/Tablet) */}
        {permissions.recommend && (
          <DispatchPlanPanel
            selectedRequest={displayedRequest}
            onBusyChange={handleCopilotBusy}
            canAssign={permissions.assign}
            onAssigned={(result) => {
              setCompletedRequest({...displayedRequest,...result,fleet_status:"Assigned"});
              invalidate();
              planHook.setStale(true);
            }}
            planHook={planHook}
            isDesktop={isDesktop}
            isMobileDrawerOpen={isMobileDrawerOpen}
            isBusy={Boolean(lockedRequest)}
            mobileOpenerRef={mobileDrawerOpenerRef}
            mobileFallbackRef={mobileOpenTriggerRef}
            onCloseMobileDrawer={() => { if (!lockedRequest) setIsMobileDrawerOpen(false); }}
          />
        )}
      </div>

      {/* Cancellation Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        variant="danger"
        title="Cancel this request?"
        message={`Cancelling "${cancelTarget?.guest_name || cancelTarget?.reservation_number || "this request"}" also cancels any dispatch and trip already raised for it, and queues a cancellation notice for Booking. Whether that notice leaves Fleet depends on the Booking gateway being connected — the result is reported when the cancellation completes. This can't be undone.`}
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        requireReason
        reasonLabel="Reason for cancelling"
        reasonPlaceholder="e.g. Guest cancelled the booking"
        reconsiderable
        actionKey={cancelTarget?.request_id}
        workingLabel="Cancelling request..."
        onConfirm={(reason) => cancelMutation.mutateAsync({ ...(cancelTarget || {}), reason: reason || null })}
      />
    </div>
  );
}
