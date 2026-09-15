"use client";

import { useMemo, useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import {
  ReservationQueueTable,
  ReservationQueueTableSkeleton,
} from "@/components/reservations/reservation-queue-table";
import { DispatchPlanPanel } from "@/components/reservations/dispatch-plan-panel";
import { useDispatchPlan } from "@/hooks/use-dispatch-plan";
import { useRoleAccess } from "@/hooks/use-role-access";
import {
  getTransportRequests,
  cancelRequest,
  pullTransportRequests,
} from "@/services/transport.service";
import { QUEUE_TABS } from "@/lib/scheduling/queue-grouping";
import { smartQueueTab } from "@/lib/scheduling/smart-default-tab";
import { cn } from "@/lib/utils";
import {
  CalendarClock,
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
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const REFETCH_MS = 30_000;

const TAB_META = {
  today: { label: "Today", icon: Inbox },
  upcoming: { label: "Upcoming", icon: CalendarClock },
  assigned: { label: "Assigned", icon: CarFront },
  inProgress: { label: "In Progress", icon: PlayCircle },
  completed: { label: "Completed", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", icon: XCircle },
};

const desktopQuery = "(min-width: 1280px)";
const subscribeDesktop = notify => {
  const mq=window.matchMedia(desktopQuery);
  mq.addEventListener("change",notify);
  return ()=>mq.removeEventListener("change",notify);
};
function useIsDesktop() {
  return useSyncExternalStore(subscribeDesktop,()=>window.matchMedia(desktopQuery).matches,()=>true);
}

export default function UnifiedQueuePage() {
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  const isDesktop = useIsDesktop();
  const [lockedRequest,setLockedRequest] = useState(null);
  const [completedRequest,setCompletedRequest] = useState(null);

  const [tabOverride, setTabOverride] = useState(null);
  const [page, setPage] = useState(1);
  const steerTimer = useRef(null);
  const pickTab = (id) => {
    if (lockedRequest) return;
    clearTimeout(steerTimer.current);
    setTabOverride(id);
    setPage(1);
  };
  const fetchTab = tabOverride ?? "today";
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  // Selection & responsive drawer coordination
  const [selectedRequestId, setSelectedRequestId] = useState(null);

  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
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
    queryKey: ["transport-requests", "unified-queue", fetchTab, page, debouncedSearch],
    queryFn: () =>
      getTransportRequests({
        tab: fetchTab,
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        with_conflicts: "true",
      }),
    refetchInterval: REFETCH_MS,
  });

  const requests = useMemo(()=>data?.rows || [],[data?.rows]);
  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const counts = data?.counts?.tabs || {};
  const countsReady = !isLoading && !isError;
  const smartTab = smartQueueTab(counts, { ready: countsReady });
  const tab = tabOverride ?? smartTab;

  useEffect(() => {
    if (tabOverride || !countsReady) return;
    if (smartTab === "today") return;
    steerTimer.current = setTimeout(() => setTabOverride(smartTab), 0);
    return () => clearTimeout(steerTimer.current);
  }, [tabOverride, countsReady, smartTab]);

  // Selection handling:
  // When criteria change (tab, page, search), select the first visible row in the new result set.
  // When background polling refreshes data, preserve existing user selection.
  const queryCriteriaKey = `${fetchTab}-${page}-${debouncedSearch}`;
  const [lastCriteria,setLastCriteria] = useState(queryCriteriaKey);
  if (!lockedRequest && lastCriteria !== queryCriteriaKey) {
    setLastCriteria(queryCriteriaKey);
    setSelectedRequestId(requests[0]?.request_id ?? null);
  } else if (!lockedRequest && !selectedRequestId && requests.length) {
    setSelectedRequestId(requests[0].request_id);
  }

  const selectedRequest = useMemo(() => {
    if (lockedRequest) return lockedRequest;
    if (!selectedRequestId) return requests[0] || null;
    return (
      requests.find((r) => Number(r.request_id) === Number(selectedRequestId)) ||
      (Number(completedRequest?.request_id) === Number(selectedRequestId) ? completedRequest : null)
    );
  }, [requests, selectedRequestId, lockedRequest, completedRequest]);

  const handleCopilotBusy=useCallback(busy=>setLockedRequest(busy ? selectedRequest : null),[selectedRequest]);

  const handleSelectRow = (r) => {
    if (lockedRequest) return;
    setSelectedRequestId(r.request_id);
    if (!isDesktop) setIsMobileDrawerOpen(true);
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
    onSuccess: () => {
      toast.success("Request cancelled — Booking will be notified");
      setCancelTarget(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to cancel request"),
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
          <div className="flex items-center gap-2">
            {!isDesktop && selectedRequest && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsMobileDrawerOpen(true)}
                className="h-9 rounded-xl text-xs font-semibold pl-2"
              >
                <div className="w-5 h-5 rounded-full overflow-hidden shrink-0 mr-1.5 border border-emerald-500/30 bg-emerald-500/10 shadow-2xs">
                  <img src="/images/copilot-avatar.png" alt="Copilot" className="w-full h-full object-cover select-none pointer-events-none" />
                </div>
                Open Copilot
              </Button>
            )}
            <Button
              className={cn(heroButtonPrimaryClass)}
              onClick={() => pullMutation.mutate()}
              disabled={pullMutation.isPending}
            >
              <DownloadCloud className="w-4 h-4 mr-2" />
              {pullMutation.isPending ? "Pulling…" : "Pull from Booking"}
            </Button>
          </div>
        }
      />

      {/* ── Filters & Search Row (Preserved Lifecycle Tabs) ── */}
      <div className="flex flex-col gap-3 rounded-3xl border border-border/80 bg-surface p-3.5 sm:flex-row sm:items-center sm:justify-between shadow-xs">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Queue sections">
          {QUEUE_TABS.map((id) => {
            const meta = TAB_META[id];
            const Icon = meta.icon;
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => pickTab(id)}
                className={cn(
                  "inline-flex items-center gap-2 px-4 h-8 rounded-full text-xs font-bold border transition-all cursor-pointer",
                  active
                    ? "bg-primary text-white dark:text-slate-950 border-primary shadow-xs"
                    : "bg-surface border-border/60 text-foreground-secondary hover:border-primary/40 hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {meta.label}
                <span className="font-data text-[11px] opacity-80">({counts[id] || 0})</span>
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
              className="w-full h-9 pl-9 pr-3 rounded-xl bg-surface border border-border/80 text-xs font-medium text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-primary/60 transition-colors"
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
                "px-2.5 py-1 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer",
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
                "px-2.5 py-1 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer",
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
      <div className="flex flex-col xl:flex-row items-start gap-6">
        {/* LEFT COLUMN: Queue Content */}
        <div className="flex-1 w-full min-w-0 space-y-4">
          {isError ? (
            <div className="rounded-3xl border border-danger/30 bg-danger/5 p-4">
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
            <ReservationQueueTableSkeleton viewMode={viewMode} />
          ) : requests.length === 0 ? (
            <div className="rounded-3xl border border-border bg-surface">
              <EmptyState
                icon={searching ? Search : Inbox}
                title={
                  searching
                    ? "Nothing matches that search"
                    : `Nothing ${TAB_META[tab]?.label.toLowerCase() || "here"}`
                }
                description={
                  searching
                    ? "Try a different term or clear the search."
                    : "Requests from Booking and active dispatches appear here. Use “Pull from Booking” to fetch new ones."
                }
                variant={searching ? "filtered" : "waiting"}
                action={
                  searching ? (
                    <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                      Clear search
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
            <div className="flex flex-col gap-3 rounded-3xl border border-border/80 bg-surface px-6 py-4 sm:flex-row sm:items-center sm:justify-between shadow-xs">
              <span className="text-xs font-semibold text-foreground-secondary">
                Showing{" "}
                <span className="font-bold text-foreground">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}
                </span>{" "}
                of <span className="font-bold text-foreground">{total}</span> entries
              </span>
              <div className="flex items-center gap-1.5">
                <span className="mr-2 hidden text-xs font-semibold text-foreground-muted sm:inline">
                  Page {page} of {pageCount}
                </span>
                <button
                  aria-label="First page"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  aria-label="Previous page"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                        "flex h-8 min-w-[32px] px-2.5 items-center justify-center rounded-full text-xs font-bold border transition-colors",
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
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  aria-label="Last page"
                  onClick={() => setPage(pageCount)}
                  disabled={page === pageCount}
                  className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
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
            selectedRequest={selectedRequest}
            onBusyChange={handleCopilotBusy}
            canAssign={permissions.assign}
            onAssigned={(result) => {
              setCompletedRequest({...selectedRequest,...result,fleet_status:"Assigned"});
              invalidate();
              planHook.setStale(true);
            }}
            planHook={planHook}
            isDesktop={isDesktop}
            isMobileDrawerOpen={isMobileDrawerOpen}
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
        message={`Cancelling "${cancelTarget?.guest_name || cancelTarget?.reservation_number || "this request"}" also cancels any dispatch and trip already raised for it, and notifies Booking. This can't be undone.`}
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        requireReason
        reasonLabel="Reason for cancelling"
        reasonPlaceholder="e.g. Guest cancelled the booking"
        loading={cancelMutation.isPending}
        onConfirm={(reason) =>
          cancelMutation.mutate({ ...(cancelTarget || {}), reason: reason || null })
        }
      />
    </div>
  );
}
