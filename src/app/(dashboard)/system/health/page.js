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
  Server,
  Database,
  Radio,
  BellRing,
  Sparkles,
  ShieldCheck,
  Clock,
  HardDrive,
  MapPin,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
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

const SUBSYSTEM_ICONS = {
  "app-runtime": Server,
  database: Database,
  integrations: Radio,
  push: BellRing,
  ai: Sparkles,
  auth: ShieldCheck,
  sync: Clock,
  storage: HardDrive,
  maps: MapPin,
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

// ----------------------------------------------------------------------
// Recharts Tooltips
// ----------------------------------------------------------------------
function CustomReliabilityTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-xl border border-border/80 bg-surface/95 p-3 shadow-xl backdrop-blur-xs text-xs space-y-1.5">
      <p className="font-bold text-foreground mb-1">{label}</p>
      {payload.map((item) => (
        <div key={item.dataKey} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: item.color || item.fill }}
            />
            <span className="text-foreground-secondary capitalize">{item.name}</span>
          </div>
          <span className="font-bold font-data text-foreground tabular-nums">
            {item.value}
            {item.dataKey === "availability" ? "%" : item.dataKey === "latency" ? " ms" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function CustomErrorTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
  return (
    <div className="rounded-xl border border-border/80 bg-surface/95 p-3 shadow-xl backdrop-blur-xs text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-1 mb-1">
        <span className="font-bold text-foreground">{label}</span>
        <span className="font-bold font-data text-foreground tabular-nums">
          {total} total failure{total === 1 ? "" : "s"}
        </span>
      </div>
      {payload.map((item) => {
        if (!item.value) return null;
        return (
          <div key={item.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: item.fill || item.color }}
              />
              <span className="text-foreground-secondary capitalize">{item.name}</span>
            </div>
            <span className="font-bold font-data text-foreground tabular-nums">
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function SystemHealthPage() {
  useRequireRole();
  const [timeframe, setTimeframe] = useState("24h");
  const [chartMetric, setChartMetric] = useState("both"); // "both", "availability", "latency"
  const [expanded, setExpanded] = useState(null);
  const [actionState, setActionState] = useState({});

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["system-health", timeframe],
    queryFn: () => getSystemHealth(timeframe),
    refetchInterval: 45000,
  });

  const rows = data?.rows ?? [];
  const overall = data?.overall ?? "unknown";
  const overallMeta = STATE_META[overall] || STATE_META.unknown;
  const kpis = data?.kpis ?? {
    availability: null,
    dbLatencyCurrent: null,
    dbLatencyAvg: null,
    dbLatencyP95: null,
    dbLatencyPeak: null,
    pushSuccessRate: null,
    activeIncidents: 0,
  };
  const charts = data?.charts ?? { reliabilityTrend: [], errorDistribution: [] };
  const incidents = data?.incidents ?? [];

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
    <div className="space-y-6 pb-16 w-full">
      {/* Hero Header with Timeframe and Refresh Controls */}
      <HeroHeader
        icon={Activity}
        title="System Health & Reliability"
        badge="Platform Command Center"
        description="Real-time telemetry, availability trends, subsystem status, and safe remediation routing for Super Admin and IT infrastructure."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-2xl border border-border/80 bg-surface p-1 shadow-2xs">
              {["24h", "7d", "30d"].map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={cn(
                    "rounded-xl px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer",
                    timeframe === tf
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "text-foreground-secondary hover:text-foreground"
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>

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
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-3xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            <Skeleton className="xl:col-span-7 h-80 rounded-3xl" />
            <Skeleton className="xl:col-span-5 h-80 rounded-3xl" />
          </div>
          <Skeleton className="h-64 w-full rounded-3xl" />
        </div>
      ) : isError ? (
        <Card className="rounded-3xl border-danger/25 bg-danger-bg/60 overflow-hidden">
          <CardContent className="p-8 text-center space-y-3">
            <ShieldAlert className="h-10 w-10 text-danger mx-auto" />
            <p className="text-base font-bold text-danger">System Health Telemetry Unavailable</p>
            <p className="text-xs text-foreground-secondary max-w-md mx-auto leading-relaxed">
              The backend or database could not be reached to gather subsystem signals and telemetry.
              Check network status or host deployment credentials, then retry.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-full cursor-pointer">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry Health Probes
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2.5">
              <Badge className={cn("rounded-full px-3.5 py-1 text-xs font-bold border", overallMeta.badge)}>
                <span className={cn("mr-1.5 inline-block h-2 w-2 rounded-full", overallMeta.dot)} />
                Platform {overallMeta.label}
              </Badge>
              {data?.checked_at && (
                <span className="text-xs text-foreground-muted font-data">
                  Telemetry snapshot checked at {formatTime(data.checked_at)}
                </span>
              )}
            </div>
            <div className="text-[11px] font-semibold text-foreground-muted flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live 45s Polling Active
            </div>
          </div>

          {/* Top 5 KPI Stat Cards Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3.5">
            {/* 1. Sampled Availability */}
            <Card className="rounded-3xl border-border/70 bg-surface p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
                   Sampled Availability
                </span>
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 border border-emerald-100 dark:border-emerald-900/40">
                  <Activity className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-foreground font-data tabular-nums">
                    {kpis.availability == null ? "—" : `${kpis.availability}%`}
                  </span>
                </div>
                <p className="text-[11px] text-foreground-muted mt-0.5">
                  Sampled health checks over {timeframe.toUpperCase()}
                </p>
              </div>
            </Card>

            {/* 2. API Error Rate */}
            <Card className="rounded-3xl border-border/70 bg-surface p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
                   App Errors
                </span>
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-500 border border-sky-100 dark:border-sky-900/40">
                  <Server className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-foreground font-data tabular-nums">
                    {kpis.appErrorsCount ?? "—"}
                  </span>
                </div>
                <p className="text-[11px] text-foreground-muted mt-0.5">
                  Recorded over {timeframe.toUpperCase()}
                </p>
              </div>
            </Card>

            {/* 3. Database Performance */}
            <Card className="rounded-3xl border-border/70 bg-surface p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
                  DB Response
                </span>
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 border border-indigo-100 dark:border-indigo-900/40">
                  <Database className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-foreground font-data tabular-nums">
                    {kpis.dbLatencyCurrent == null ? "—" : `${kpis.dbLatencyCurrent} ms`}
                  </span>
                  <span className="text-[11px] font-semibold text-foreground-muted font-data">
                    P95 {kpis.dbLatencyP95 == null ? "—" : `${kpis.dbLatencyP95}ms`}
                  </span>
                </div>
                <p className="text-[11px] text-foreground-muted mt-0.5">
                  Avg {kpis.dbLatencyAvg == null ? "—" : `${kpis.dbLatencyAvg}ms`} · Peak {kpis.dbLatencyPeak == null ? "—" : `${kpis.dbLatencyPeak}ms`}
                </p>
              </div>
            </Card>

            {/* 4. Push Success Rate */}
            <Card className="rounded-3xl border-border/70 bg-surface p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
                  Push Delivery
                </span>
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-500 border border-amber-100 dark:border-amber-900/40">
                  <BellRing className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-foreground font-data tabular-nums">
                    {kpis.pushSuccessRate == null ? "—" : `${kpis.pushSuccessRate}%`}
                  </span>
                </div>
                <p className="text-[11px] text-foreground-muted mt-0.5">
                  {kpis.pushTotal == null ? "Outbox telemetry unavailable" : kpis.pushTotal ? `${kpis.pushDelivered} sent of ${kpis.pushTotal} queued` : "No pushes in this period"}
                </p>
              </div>
            </Card>

            {/* 5. Active Incidents */}
            <Card className="rounded-3xl border-border/70 bg-surface p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
                  Active Incidents
                </span>
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-xl border",
                    kpis.activeIncidents > 0
                      ? "bg-rose-50 dark:bg-rose-950/40 text-rose-500 border-rose-200 dark:border-rose-900/40"
                      : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 border-emerald-100 dark:border-emerald-900/40"
                  )}
                >
                  <ShieldAlert className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "text-2xl font-extrabold font-data tabular-nums",
                      kpis.activeIncidents > 0 ? "text-danger" : "text-foreground"
                    )}
                  >
                    {kpis.activeIncidents}
                  </span>
                  <span className="text-[11px] font-semibold text-foreground-muted">
                    {kpis.activeIncidents === 0
                      ? "None active"
                      : `${kpis.activeIncidents === 1 ? "1 item" : `${kpis.activeIncidents} items`} need triage`}
                  </span>
                </div>
                <p className="text-[11px] text-foreground-muted mt-0.5">
                  Across 9 technical subsystems
                </p>
              </div>
            </Card>
          </div>

          {/* Charts Row: System Reliability Trend (~7 cols) & Errors / Failures Over Time (~5 cols) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
            {/* Chart 1: System Reliability & Latency Trend */}
            <Card className="xl:col-span-7 rounded-3xl border-border/70 bg-surface p-5 sm:p-6 shadow-xs flex flex-col justify-between">
              <CardContent className="p-0 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-foreground tracking-tight">
                      System Reliability Trend
                    </h3>
                    <p className="text-xs text-foreground-secondary mt-0.5">
                      Sampled health state & DB response latency over {timeframe.toUpperCase()}
                    </p>
                  </div>
                  <div className="inline-flex items-center rounded-2xl border border-border/80 bg-muted/30 p-1">
                    <button
                      onClick={() => setChartMetric("both")}
                      className={cn(
                        "rounded-xl px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer",
                        chartMetric === "both"
                          ? "bg-surface text-foreground shadow-2xs"
                          : "text-foreground-secondary hover:text-foreground"
                      )}
                    >
                      Combined
                    </button>
                    <button
                      onClick={() => setChartMetric("availability")}
                      className={cn(
                        "rounded-xl px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer",
                        chartMetric === "availability"
                          ? "bg-surface text-foreground shadow-2xs"
                          : "text-foreground-secondary hover:text-foreground"
                      )}
                    >
                      Availability %
                    </button>
                    <button
                      onClick={() => setChartMetric("latency")}
                      className={cn(
                        "rounded-xl px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer",
                        chartMetric === "latency"
                          ? "bg-surface text-foreground shadow-2xs"
                          : "text-foreground-secondary hover:text-foreground"
                      )}
                    >
                      Latency (ms)
                    </button>
                  </div>
                </div>

                {kpis.availability == null && kpis.dbLatencyAvg == null && (
                  <p className="text-xs text-foreground-muted">No measured health samples in this period.</p>
                )}
                <div className="h-64 sm:h-72 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={charts.reliabilityTrend}
                      margin={{ top: 12, right: 12, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="availGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f030" vertical={false} />
                      <XAxis
                        dataKey="label"
                        stroke="#94a3b8"
                        fontSize={10}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f050" }}
                        dy={6}
                      />
                      <YAxis
                        yAxisId="avail"
                        domain={chartMetric === "latency" ? [0, "auto"] : [0, 100]}
                        stroke="#94a3b8"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                        orientation="left"
                      />
                      {chartMetric === "both" && (
                        <YAxis
                          yAxisId="lat"
                          domain={[0, (dataMax) => Math.max(150, Math.ceil((dataMax || 150) * 1.3))]}
                          stroke="#94a3b8"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                          orientation="right"
                        />
                      )}
                      <Tooltip content={<CustomReliabilityTooltip />} />

                      {(chartMetric === "both" || chartMetric === "availability") && (
                        <Area
                          yAxisId="avail"
                          type="monotone"
                          dataKey="availability"
                          name="Availability"
                          stroke="#10b981"
                          strokeWidth={2.5}
                          fillOpacity={1}
                          fill="url(#availGradient)"
                        />
                      )}
                      {(chartMetric === "both" || chartMetric === "latency") && (
                        <Area
                          yAxisId={chartMetric === "both" ? "lat" : "avail"}
                          type="monotone"
                          dataKey="latency"
                          name="DB Latency"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          fillOpacity={chartMetric === "latency" ? 1 : 0.05}
                          fill={chartMetric === "latency" ? "url(#latencyGradient)" : "#3b82f6"}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-6 pt-1 text-xs font-semibold text-foreground-secondary">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <span>Sampled availability (%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                    <span>Database Latency (ms) — Current {kpis.dbLatencyCurrent == null ? "—" : `${kpis.dbLatencyCurrent}ms`}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Chart 2: Subsystem Errors & Failures Breakdown */}
            <Card className="xl:col-span-5 rounded-3xl border-border/70 bg-surface p-5 sm:p-6 shadow-xs flex flex-col justify-between">
              <CardContent className="p-0 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-foreground tracking-tight">
                    Errors & Failures Over Time
                  </h3>
                  <p className="text-xs text-foreground-secondary mt-0.5">
                    Categorized volume across technical subsystems ({timeframe.toUpperCase()})
                  </p>
                </div>

                <div className="h-64 sm:h-72 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={charts.errorDistribution}
                      margin={{ top: 12, right: 12, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f030" vertical={false} />
                      <XAxis
                        dataKey="label"
                        stroke="#94a3b8"
                        fontSize={10}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f050" }}
                        dy={6}
                      />
                      <YAxis
                        stroke="#94a3b8"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                        domain={[0, (dataMax) => Math.max(5, Math.ceil((dataMax || 5) * 1.25))]}
                      />
                      <Tooltip content={<CustomErrorTooltip />} />
                      <Bar dataKey="appErrors" name="Application" stackId="a" fill="#f43f5e" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="integrationErrors" name="Integration" stackId="a" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="pushErrors" name="Push Queue" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="aiErrors" name="AI Services" stackId="a" fill="#06b6d4" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="authErrors" name="Authentication" stackId="a" fill="#64748b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-4 pt-1 text-[11px] font-semibold text-foreground-secondary">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#f43f5e]" />
                    <span>App</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#8b5cf6]" />
                    <span>Integration</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
                    <span>Push</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#06b6d4]" />
                    <span>AI</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#64748b]" />
                    <span>Auth</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Active Incidents Section */}
          <Card className="rounded-3xl border-border/70 bg-surface overflow-hidden shadow-2xs">
            <CardHeader className="py-4 px-6 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="h-4 w-4 text-foreground-muted" />
                <CardTitle className="text-sm font-bold tracking-tight">Active Platform Incidents</CardTitle>
              </div>
              <Badge className="rounded-full text-[10px] font-bold px-2 py-0.5">
                {incidents.length} Active
              </Badge>
            </CardHeader>
            <CardContent className="p-5">
              {incidents.length === 0 ? (
                <div className="flex items-center gap-4 py-2 px-1">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 border border-emerald-100 dark:border-emerald-900/40">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Zero Active Incidents</p>
                    <p className="text-xs text-foreground-muted mt-0.5">
                      All 9 platform subsystems are operating normally within specified thresholds.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {incidents.map((inc) => (
                    <div
                      key={inc.id}
                      className={cn(
                        "rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all",
                        inc.severity === "critical"
                          ? "border-rose-200/80 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20"
                          : "border-amber-200/80 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20"
                      )}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={cn(
                              "rounded-full text-[10px] font-bold uppercase tracking-wider",
                              inc.severity === "critical"
                                ? "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                            )}
                          >
                            {inc.severity}
                          </Badge>
                          <span className="text-xs font-bold text-foreground">{inc.subsystem}</span>
                        </div>
                        <p className="text-xs font-semibold text-foreground tracking-tight">{inc.title}</p>
                        {inc.impact && (
                          <p className="text-[11px] text-foreground-secondary leading-relaxed">{inc.impact}</p>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {inc.actions?.[0] && (
                          <Button
                            size="sm"
                            onClick={() => {
                              const targetRow = rows.find((r) => r.id === inc.subsystemId);
                              if (targetRow) {
                                if (inc.actions[0].kind === "post") runPostAction(targetRow, inc.actions[0]);
                                else if (inc.actions[0].kind === "refetch") runRefetchAction(targetRow, inc.actions[0]);
                              }
                            }}
                            className="rounded-full h-8 px-4 text-xs font-semibold shadow-2xs"
                          >
                            {inc.actions[0].label}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setExpanded(inc.subsystemId)}
                          className="rounded-full h-8 px-3 text-xs font-semibold"
                        >
                          Details
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subsystems Registry Table */}
          <Card className="rounded-3xl border-border/70 bg-surface overflow-hidden shadow-2xs">
            <CardHeader className="py-4 px-6 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold tracking-tight">Platform Subsystems Registry</CardTitle>
                <p className="text-xs text-foreground-muted mt-0.5">
                  Live detection signals, diagnostic breakdown, and safe one-click remediation
                </p>
              </div>
              <Badge variant="outline" className="rounded-full text-xs font-semibold">
                {rows.length} Subsystems Monitored
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/60">
                {rows.map((row) => {
                  const meta = STATE_META[row.state] || STATE_META.unknown;
                  const isOpen = expanded === row.id;
                  const st = actionState[row.id];
                  const IconComp = SUBSYSTEM_ICONS[row.id] || Activity;

                  return (
                    <div key={row.id}>
                      <button
                        onClick={() => setExpanded(isOpen ? null : row.id)}
                        className="w-full px-6 py-4 hover:bg-muted/40 transition-all flex items-center gap-3.5 text-left cursor-pointer"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-muted/60 text-foreground border border-border/60 shadow-2xs">
                          <IconComp className="h-4 w-4" />
                        </div>

                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-foreground tracking-tight">
                              {row.label}
                            </span>
                            <Badge className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border", meta.badge)}>
                              <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", meta.dot)} />
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
                        <div className="border-t border-border/60 bg-muted/20 px-6 py-4 space-y-3.5">
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
                                "flex items-center gap-1.5 text-xs font-semibold pt-1",
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
