"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import {
  ReservationCard,
  ReservationCardSkeleton,
} from "@/components/reservations/reservation-card";
import { AiAssignDialog } from "@/components/reservations/ai-assign-dialog";
import { useRoleAccess } from "@/hooks/use-role-access";
import {
  getTransportRequests,
  cancelRequest,
  pullTransportRequests,
  setRequestFlags,
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
  PlayCircle,
  Search,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// The unified Transportation Queue — the merged dispatcher workspace.
//
// Replaces the split Request Queue + Dispatch Board with one surface. Five tabs
// (Today / Upcoming / In Progress / Completed / Cancelled) are derived from each
// request's fleet_status and pickup time, and every active tab is auto-sorted by
// derived_priority (the priority engine's output — never a human choice). The
// same AI-assisted assign / manual assign / cancel dialogs back the whole surface.
const REFETCH_MS = 30_000;

const TAB_META = {
  today: { label: "Today", icon: Inbox },
  upcoming: { label: "Upcoming", icon: CalendarClock },
  assigned: { label: "Assigned", icon: CarFront },
  inProgress: { label: "In Progress", icon: PlayCircle },
  completed: { label: "Completed", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", icon: XCircle },
};

const TAB_ACTIVE = {
  primary: "border-info bg-info/10 text-info",
  warning: "border-warning bg-warning/10 text-warning",
  success: "border-success bg-success/10 text-success",
  secondary: "border-border bg-hover text-foreground",
};

export default function UnifiedQueuePage() {
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  // Smart default without render-phase or effect-phase pitfalls: the query
  // always fetches a concrete tab (override, else Today); counts from any
  // completed fetch then steer the *override* once via a deferred update, so
  // the query key follows on the next render. Manual tab clicks win outright.
  const [tabOverride, setTabOverride] = useState(null); // tab id | null
  const [page, setPage] = useState(1);
  const steerTimer = useRef(null);
  const pickTab = (id) => {
    clearTimeout(steerTimer.current);
    setTabOverride(id);
    setPage(1);
  };
  const fetchTab = tabOverride ?? "today";
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [assigning, setAssigning] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // Cancel is a consequential action (it cancels linked dispatches/trips and
  // notifies Booking), so it always routes through a confirm dialog that
  // captures a reason for the audit trail.
  const [cancelTarget, setCancelTarget] = useState(null);

  // Debounce the free-text search so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const permissions = useMemo(
    () => ({
      update: can("reservations", "update"),
      approve: can("reservations", "approve"),
      assign: can("reservations", "assign"),
      cancel: can("reservations", "cancel"),
    }),
    [can]
  );

  const PAGE_SIZE = 25;

  // One query for the active tab. The server buckets + counts every tab and
  // returns only this tab's page of cards, so a 30s poll never ships hundreds
  // of Completed rows just to show the Today lane. Conflicts are advisory and
  // opt-in; the queue renders them as chips, assignment enforces them.
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

  const requests = data?.rows || [];
  const total = data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const counts = data?.counts?.tabs || {};
  // Displayed tab: user pick wins; otherwise Today while loading, else the
  // first non-empty tab in work order (archive tabs never greet).
  const countsReady = !isLoading && !isError;
  const smartTab = smartQueueTab(counts, { ready: countsReady });
  const tab = tabOverride ?? smartTab;

  useEffect(() => {
    if (tabOverride || !countsReady) return;
    if (smartTab === "today") return;
    steerTimer.current = setTimeout(() => setTabOverride(smartTab), 0);
    return () => clearTimeout(steerTimer.current);
  }, [tabOverride, countsReady, smartTab]);

  // Compact page-number list with ellipses, mirroring the DataTable footer.
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
  const tabTone = (id) => {
    if (id === "inProgress") return "warning";
    if (id === "completed") return "success";
    if (id === "cancelled") return "secondary";
    return "primary";
  };

  const TONE_MAP = {
    primary:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   icon: 'bg-slate-500/15 text-slate-500',   dot: 'bg-slate-500',   text: 'text-slate-600 dark:text-slate-400' },
    success:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'bg-emerald-500/15 text-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
    warning:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   icon: 'bg-amber-500/15 text-amber-500',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400' },
    danger:    { bg: 'bg-red-500/10',     border: 'border-red-500/30',     icon: 'bg-red-500/15 text-red-500',       dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400' },
    info:      { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    icon: 'bg-blue-500/15 text-blue-500',     dot: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400' },
    secondary: { bg: 'bg-zinc-500/10',    border: 'border-zinc-500/30',    icon: 'bg-zinc-500/15 text-zinc-500',     dot: 'bg-zinc-500',    text: 'text-zinc-600 dark:text-zinc-400' },
  };

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <HeroHeader
        icon={Inbox}
        title="Transportation Queue"
        badge="Operations"
        description="Every request and committed dispatch in one place — auto-sorted by urgency."
        actions={
          <Button className={cn(heroButtonPrimaryClass)} onClick={() => pullMutation.mutate()} disabled={pullMutation.isPending}>
            <DownloadCloud className="w-4 h-4 mr-2" />
            {pullMutation.isPending ? "Pulling…" : "Pull from Booking"}
          </Button>
        }
      />

      {/* ── KPI Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(() => {
          const t = TONE_MAP.primary;
          return (
            <button
              type="button"
              onClick={() => pickTab("today")}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                tab === "today"
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-primary/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Today</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><Inbox className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{counts.today}</div>
              </div>
            </button>
          );
        })()}

        {(() => {
          const t = TONE_MAP.info;
          return (
            <button
              type="button"
              onClick={() => pickTab("upcoming")}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                tab === "upcoming"
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-info/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Upcoming</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><CalendarClock className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{counts.upcoming}</div>
              </div>
            </button>
          );
        })()}

        {(() => {
          const t = TONE_MAP.warning;
          return (
            <button
              type="button"
              onClick={() => pickTab("inProgress")}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                tab === "inProgress"
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-warning/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">In Progress</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><PlayCircle className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{counts.inProgress}</div>
              </div>
            </button>
          );
        })()}

        {(() => {
          const t = TONE_MAP.info;
          return (
            <button
              type="button"
              onClick={() => pickTab("assigned")}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                tab === "assigned"
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-info/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Assigned</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><CarFront className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{counts.assigned}</div>
              </div>
            </button>
          );
        })()}
      </div>

      {/* ── Filters & Search Row ── */}
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
                <span className="font-data text-[11px] opacity-80">({counts[id]})</span>
              </button>
            );
          })}
        </div>

        <div className="relative flex-1 sm:max-w-xs">
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
      </div>

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
        <div className="space-y-3">
          <ReservationCardSkeleton />
          <ReservationCardSkeleton />
          <ReservationCardSkeleton />
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-3xl border border-border bg-surface">
          <EmptyState
            icon={searching ? Search : Inbox}
            title={
              searching
                ? "Nothing matches that search"
                : `Nothing ${TAB_META[tab].label.toLowerCase()}`
            }
            description={
              searching
                ? "Try a different term or clear the search."
                : "Requests from Booking and active dispatches appear here. Use “Pull from Booking” to fetch new ones."
            }
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
        <div className="space-y-3">
          {requests.map((r) => (
            <ReservationCard
              key={r.request_id}
              request={r}
              permissions={permissions}
              isBusy={busyId === r.request_id}
              onCancel={(req) => setCancelTarget(req)}
              onAssign={(req) => setAssigning(req)}
            />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex flex-col gap-3 rounded-3xl border border-border/80 bg-surface px-6 py-4 sm:flex-row sm:items-center sm:justify-between shadow-xs">
          <span className="text-xs font-semibold text-foreground-secondary">
            Showing <span className="font-bold text-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</span> of <span className="font-bold text-foreground">{total}</span> entries
          </span>
          <div className="flex items-center gap-1.5">
            <span className="mr-2 hidden text-xs font-semibold text-foreground-muted sm:inline">Page {page} of {pageCount}</span>
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
                <span key={pg} className="px-1 text-xs text-foreground-muted">…</span>
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

      <AiAssignDialog
        key={assigning?.request_id || "assign-workspace"}
        request={assigning}
        isOpen={Boolean(assigning)}
        onClose={() => setAssigning(null)}
        canAssign={permissions.assign}
        alreadyAssigned={Boolean(assigning?.vehicle_id && assigning?.driver_id)}
        onAssigned={() => {
          setAssigning(null);
          invalidate();
        }}
      />

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
