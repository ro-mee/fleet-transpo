"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  setRequestFlags,
} from "@/services/transport.service";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { groupQueue, QUEUE_TABS } from "@/lib/scheduling/queue-grouping";
import { cn } from "@/lib/utils";
import {
  CalendarClock,
  CheckCircle2,
  DownloadCloud,
  Inbox,
  PlayCircle,
  Search,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";

// The unified Transportation Queue — the merged dispatcher workspace.
//
// Replaces the split Request Queue + Dispatch Board with one surface. Five tabs
// (Today / Upcoming / In Progress / Completed / Cancelled) are derived from each
// request's fleet_status and pickup time, and every active tab is auto-sorted by
// derived_priority (the priority engine's output — never a human choice). The
// same review / approve / reject / assign dialogs back the whole surface.
const REFETCH_MS = 30_000;

const TAB_META = {
  today: { label: "Today", icon: Inbox },
  upcoming: { label: "Upcoming", icon: CalendarClock },
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

const isReviewable = (status) => status === L.PENDING || status === L.UNDER_REVIEW;

export default function UnifiedQueuePage() {
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  const [tab, setTab] = useState("today");
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [assigning, setAssigning] = useState(null);
  const [assignError, setAssignError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const permissions = useMemo(
    () => ({
      update: can("reservations", "update"),
      approve: can("reservations", "approve"),
      assign: can("reservations", "assign"),
      cancel: can("reservations", "cancel"),
    }),
    [can]
  );

  // One query for the whole queue. Conflicts are advisory and opt-in; the
  // queue renders them as chips, assignment enforces them.
  const {
    data: requests = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["transport-requests", "unified-queue"],
    queryFn: () => getTransportRequests({ with_conflicts: "true" }),
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

  const flagsMutation = useMutation({
    mutationFn: ({ request, isVip, isEmergency }) =>
      setRequestFlags(request.request_id, { isVip, isEmergency }),
    onSuccess: (_res, { request }) => {
      toast.success("Flags updated — priority recomputed");
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to update flags"),
  });

  // Group into the five tabs, each auto-sorted by derived_priority.
  const grouped = useMemo(() => groupQueue(requests), [requests]);

  const counts = useMemo(() => {
    const c = {};
    for (const k of QUEUE_TABS) c[k] = grouped[k]?.length || 0;
    return c;
  }, [grouped]);

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = grouped[tab] || [];
    if (!term) return list;
    return list.filter((r) =>
      [r.guest_name, r.reservation_number, r.booking_reference, r.pickup_location, r.dropoff_location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [grouped, tab, search]);

  const activeCount = counts.today + counts.upcoming + counts.inProgress;
  const searching = search.trim().length > 0;
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
              onClick={() => setTab("today")}
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
              onClick={() => setTab("upcoming")}
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
              onClick={() => setTab("inProgress")}
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
          const t = TONE_MAP.primary;
          return (
            <div className="relative p-4 rounded-3xl border-2 border-border/60 bg-surface text-left flex flex-col justify-between gap-3 select-none overflow-hidden">
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Active Total</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><TriangleAlert className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{activeCount}</div>
              </div>
            </div>
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
                onClick={() => setTab(id)}
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
      ) : items.length === 0 ? (
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
          {items.map((r) => (
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
