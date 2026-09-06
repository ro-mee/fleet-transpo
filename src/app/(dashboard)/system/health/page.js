"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getSystemHealth,
  retryPushDelivery,
  reviewPushFailures,
  reviewAiFailures,
  retryIntegrationDelivery,
  runSyncNow,
} from "@/services/system-health.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";
import {
  Activity,
  RefreshCw,
  ChevronDown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

const STATE_META = {
  operational: {
    dot: "bg-emerald-500",
    badge: "bg-emerald-50/90 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60",
    label: "Operational",
  },
  attention: {
    dot: "bg-amber-500",
    badge: "bg-amber-50/90 text-amber-700 border-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
    label: "Attention",
  },
  degraded: {
    dot: "bg-rose-500",
    badge: "bg-rose-50/90 text-rose-700 border-rose-200/70 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60",
    label: "Degraded",
  },
  unknown: {
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    label: "Unknown",
  },
};

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const POST_ACTIONS = {
  "retry-push": { run: retryPushDelivery, summarize: summarizeRetry },
  "review-push": { run: reviewPushFailures, summarize: summarizeReview },
  "review-ai": { run: reviewAiFailures, summarize: summarizeReview },
  "retry-integration": { run: retryIntegrationDelivery, summarize: summarizeRetry },
  "run-sync": { run: runSyncNow, summarize: summarizeSync },
};

function summarizeRetry(res) {
  const delivered = Number(res?.delivered) || 0;
  const failed = Number(res?.still_failed) || 0;
  const retried = Number(res?.retried) || 0;
  if (retried === 0) return "Nothing left to retry.";
  return `Delivered ${delivered} of ${retried}; ${failed} still failing.`;
}

function summarizeSync(res) {
  return (
    res?.message ||
    `Synced ${res?.vehicles_synced ?? 0} vehicles, ${res?.drivers_synced ?? 0} drivers.`
  );
}

function summarizeReview(res) {
  const n = Number(res?.count) || 0;
  if (n === 0) return "Nothing left to review.";
  return `Marked ${n} failure${n === 1 ? "" : "s"} as reviewed — history kept, active count cleared.`;
}

function SampleList({ row }) {
  const sample = Array.isArray(row.sample) ? row.sample.slice(0, 3) : [];
  if (!sample.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-muted">
        Recent failures
      </p>
      {sample.map((item, i) => (
        <div
          key={item.log_id ?? item.id ?? i}
          className="rounded-xl border border-border/60 bg-surface px-3.5 py-2"
        >
          <p className="truncate text-xs font-semibold text-foreground">
            {item.event_type || item.title || `Event #${item.log_id ?? item.id ?? "?"}`}
          </p>
          {(item.error_message || item.error) && (
            <p className="mt-0.5 truncate text-[11px] text-danger font-data">
              {item.error_message || item.error}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-foreground-muted font-data">
            {formatTime(item.created_at)}
          </p>
        </div>
      ))}
    </div>
  );
}

function RowActions({ row, busyAction, onPost, onRefetch }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {(row.actions || []).map((action) => {
        const isBusy = busyAction === action.id;
        const anyBusy = busyAction != null;
        if (action.kind === "link") {
          return (
            <Link
              key={action.id}
              href={action.href}
              className="rounded-full h-9 px-4 text-xs font-semibold cursor-pointer inline-flex items-center border border-border/80 bg-surface hover:bg-muted/60 transition-colors"
            >
              {action.label}
            </Link>
          );
        }
        if (action.kind === "post") {
          return (
            <Button
              key={action.id}
              onClick={() => onPost(row, action)}
              disabled={anyBusy}
              className="rounded-full h-9 px-5 text-xs font-semibold shadow-2xs cursor-pointer"
            >
              {isBusy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              {action.label}
            </Button>
          );
        }
        return (
          <Button
            key={action.id}
            variant="outline"
            onClick={() => onRefetch(row, action)}
            disabled={anyBusy}
            className="rounded-full h-9 px-4 text-xs font-semibold cursor-pointer"
          >
            {isBusy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
            {isBusy ? "Rechecking…" : action.label}
          </Button>
        );
      })}
    </div>
  );
}

export default function SystemHealthPage() {
  useRequireRole();
  const [expanded, setExpanded] = useState(null);
  const [actionState, setActionState] = useState({});

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["system-health"],
    queryFn: getSystemHealth,
  });

  const rows = data?.rows ?? [];
  const overall = data?.overall ?? "unknown";
  const overallMeta = STATE_META[overall] || STATE_META.unknown;

  const runPostAction = async (row, action) => {
    const entry = POST_ACTIONS[action.id];
    if (!entry) return;
    setActionState((prev) => ({ ...prev, [row.id]: { busy: action.id } }));
    try {
      const res = await entry.run();
      setActionState((prev) => ({
        ...prev,
        [row.id]: { busy: false, ok: true, message: entry.summarize(res), note: "Re-checked above." },
      }));
    } catch (e) {
      setActionState((prev) => ({
        ...prev,
        [row.id]: { busy: false, ok: false, message: e?.message || "Action failed.", note: "Re-checked above." },
      }));
    } finally {
      refetch();
    }
  };

  const runRefetchAction = async (row, action) => {
    setActionState((prev) => ({ ...prev, [row.id]: { busy: action?.id ?? "recheck" } }));
    try {
      await refetch();
      const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
      setActionState((prev) => ({
        ...prev,
        [row.id]: { busy: false, ok: true, message: `Re-checked at ${time} — states above are current.`, note: null },
      }));
    } catch (e) {
      setActionState((prev) => ({
        ...prev,
        [row.id]: { busy: false, ok: false, message: e?.message || "Re-check failed.", note: null },
      }));
    }
  };

  return (
    <div className="space-y-6 pb-12 w-full">
      <HeroHeader
        icon={Activity}
        title="System Health"
        badge="Detection & Remediation"
        description="Live subsystem states with safe one-click remediation. Detection lives here; each specialized module owns its actual fix — nothing here auto-repairs destructive failures."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isFetching && "animate-spin")} />
            Refresh Health
          </Button>
        }
      />

      {isLoading ? (
        <Card className="rounded-3xl border-border/70 overflow-hidden">
          <CardContent className="p-5 space-y-3">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </CardContent>
        </Card>
      ) : isError ? (
        <Card className="rounded-3xl border-danger/25 bg-danger-bg/60 overflow-hidden">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm font-bold text-danger">System Health unavailable</p>
            <p className="text-xs text-foreground-secondary max-w-md mx-auto leading-relaxed">
              The backend or database could not be reached, so no subsystem state could be
              determined — including the database row itself. Check the deployment and try again.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-full cursor-pointer">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="rounded-3xl border-border/70 overflow-hidden">
          <EmptyState
            icon={Activity}
            title="No health signals"
            description="Subsystem probes returned nothing to display."
            variant="waiting"
            size="compact"
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge className={cn("rounded-full px-3.5 py-1 text-xs font-bold border", overallMeta.badge)}>
              <span className={cn("mr-1.5 inline-block h-2 w-2 rounded-full", overallMeta.dot)} />
              {overallMeta.label}
            </Badge>
            {data?.checked_at && (
              <span className="text-xs text-foreground-muted font-data">
                Checked {formatTime(data.checked_at)}
              </span>
            )}
          </div>

          <Card className="rounded-3xl border-border/70 overflow-hidden">
            <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
              <CardTitle className="text-sm font-bold">Subsystems</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/60">
                {rows.map((row) => {
                  const meta = STATE_META[row.state] || STATE_META.unknown;
                  const isOpen = expanded === row.id;
                  const st = actionState[row.id];
                  return (
                    <div key={row.id}>
                      <button
                        onClick={() => setExpanded(isOpen ? null : row.id)}
                        className="w-full px-6 py-4 hover:bg-muted/40 transition-all flex items-center gap-3.5 text-left cursor-pointer"
                      >
                        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", meta.dot)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-foreground tracking-tight">
                              {row.label}
                            </span>
                            <Badge className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border", meta.badge)}>
                              {meta.label}
                            </Badge>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-foreground-secondary">
                            {row.summary}
                          </span>
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-foreground-muted transition-transform",
                            isOpen && "rotate-180"
                          )}
                        />
                      </button>
                      {isOpen && (
                        <div className="border-t border-border/60 bg-muted/20 px-6 py-4 space-y-3">
                          {row.what && (
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-muted">
                                What happened
                              </p>
                              <p className="mt-1 text-[13px] text-foreground leading-relaxed">{row.what}</p>
                            </div>
                          )}
                          {row.impact && (
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-muted">
                                Impact
                              </p>
                              <p className="mt-1 text-[13px] text-foreground-secondary leading-relaxed">
                                {row.impact}
                              </p>
                            </div>
                          )}
                          {row.recommendedAction && (
                            <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
                              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-muted">
                                Recommended action
                              </p>
                              <p className="mt-1 text-[13px] font-medium text-foreground leading-relaxed">
                                {row.recommendedAction}
                              </p>
                            </div>
                          )}
                          <SampleList row={row} />
                          <RowActions
                            row={row}
                            busyAction={st?.busy ?? null}
                            onPost={runPostAction}
                            onRefetch={runRefetchAction}
                          />
                          {st && !st.busy && st.message && (
                            <p
                              className={cn(
                                "flex items-center gap-1.5 text-xs font-semibold",
                                st.ok ? "text-emerald-600 dark:text-emerald-400" : "text-danger"
                              )}
                            >
                              {st.ok ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <AlertTriangle className="h-3.5 w-3.5" />
                              )}
                              {st.note ? `${st.message} ${st.note}` : st.message}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
