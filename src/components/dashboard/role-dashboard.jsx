"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Brain,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Fuel,
  Inbox,
  MapPin,
  Navigation,
  ShieldCheck,
  Truck,
  UserCheck,
  Users,
  Wrench,
} from "lucide-react";
import { getAuditLogs } from "@/services/audit.service";
import { getDispatchesByStatus } from "@/services/dispatch.service";
import {
  getDriverLeaveRequests,
  getDrivers,
  getDriverStats,
  getIncidentSummary,
} from "@/services/driver.service";
import { getDriverAssignments } from "@/services/driver-assignment.service";
import { getFuelRequests } from "@/services/fuel.service";
import { getDriverPerformanceReport, getFleetUtilizationReport } from "@/services/report.service";
import { getMaintenanceRecords } from "@/services/maintenance.service";
import { getNotifications } from "@/services/notification.service";
import { getSubstituteSchedules } from "@/services/substitute-driver.service";
import { getSystemActivity } from "@/services/system.service";
import { getSystemHealth } from "@/services/system-health.service";
import { getLatestLocations } from "@/services/trip.service";
import { getRecommendation, getTransportRequests } from "@/services/transport.service";
import { getExpiringDocuments, getVehicles } from "@/services/vehicle.service";
import { apiFetch } from "@/lib/api/client";
import {
  isDriverUnavailableFor,
  NON_DISPATCHABLE_VEHICLE_STATUSES,
  resolveSubstituteForDate,
} from "@/lib/ai/pair-scoring";
import { compareByPriority, groupQueue } from "@/lib/scheduling/queue-grouping";
import { tripProgress } from "@/lib/scheduling/trip-progress";
import { isValidCoordinate } from "@/lib/gps";
import { cn } from "@/lib/utils";
import { CHART_COLORS } from "@/lib/chart-tokens";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { CardSkeleton, StatsGridSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDashboardConfig } from "@/components/dashboard/dashboard-configs";
import {
  RequestPipelineCard,
  DocumentComplianceCard,
  MaintenancePressureCard,
  IncidentRiskCard,
} from "@/components/dashboard/operations-cards";
import {
  SystemUsageOverviewCard,
  SystemHealthCard,
  AccountPostureCard,
  RecentSystemActivitiesCard,
  RecentErrorsCard,
  RecentSecurityAuditCard,
} from "@/components/dashboard/system-admin-cards";

const LiveLocationsMap = dynamic(
  () => import("@/components/maps/live-locations-map"),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-hover" /> }
);

const linkClass =
  "inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === localDateKey();
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${formatTime(value)}`;
}

function LivePulseBeacon({ status = "primary" }) {
  const colors = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
  };
  const colorClass = colors[status] || colors.primary;
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", colorClass)}></span>
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", colorClass)}></span>
    </span>
  );
}

function Panel({ title, description, action, className, children }) {
  return (
    <Card className={cn("overflow-hidden rounded-2xl border-border/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] bg-surface", className)}>
      <CardHeader className="gap-1 border-b border-border/60 p-5 bg-hover/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-[15px] font-semibold text-foreground tracking-tight">{title}</CardTitle>
            {description && <p className="mt-1 text-xs leading-relaxed text-foreground-secondary">{description}</p>}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

function InlineEmpty({ icon = Inbox, title, description, variant, action }) {
  return <EmptyState icon={icon} title={title} description={description} variant={variant} action={action} size="compact" />;
}

function QueryErrors({ items }) {
  const failed = items.filter((item) => item.query?.isError);
  if (!failed.length) return null;
  return (
    <div className="space-y-2">
      {failed.map((item) => (
        <QueryErrorBanner
          key={item.title}
          query={item.query}
          title={item.title}
          description={item.description || "This panel is unavailable; other dashboard data remains current."}
        />
      ))}
    </div>
  );
}

function FeedState({ queries, errorTitle = "This data is unavailable", children }) {
  const feeds = Array.isArray(queries) ? queries : [queries];
  if (feeds.some((query) => query?.isLoading)) return <div className="p-5"><CardSkeleton /></div>;
  if (feeds.some((query) => query?.isError)) {
    return <div className="m-5 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700" role="alert">{errorTitle}. Use Retry in the alert above.</div>;
  }
  return children;
}

function Row({ icon: Icon, title, detail, meta, status, entity, href, pulse }) {
  const content = (
    <>
      {Icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-hover border border-border/50 text-foreground-secondary shadow-sm transition-colors group-hover:bg-surface group-hover:border-border">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1 py-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[15px] font-semibold text-foreground tracking-tight leading-snug line-clamp-2">{title}</p>
          {meta && <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-foreground-muted mt-0.5">{meta}</span>}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {status && <StatusBadge status={status} entity={entity} className="shrink-0" />}
          {detail && <p className="text-[13px] text-foreground-secondary leading-snug truncate">{detail}</p>}
        </div>
      </div>
      {pulse && <LivePulseBeacon status={pulse} />}
      {href && <ArrowRight className="h-4 w-4 shrink-0 text-foreground-muted group-hover:text-foreground group-hover:translate-x-0.5 transition-all ml-1" />}
    </>
  );
  const classes = "group flex min-h-16 items-center gap-3 px-5 py-3 transition-colors";
  return href ? (
    <Link href={href} className={cn(classes, "hover:bg-hover/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary")}>
      {content}
    </Link>
  ) : (
    <div className={cn(classes, "hover:bg-hover/40")}>{content}</div>
  );
}

function StatusBars({ rows }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return (
    <div className="space-y-4 p-5">
      {rows.map((row) => (
        <div key={row.label} className="group">
          <div className="mb-1.5 flex items-center gap-2.5 text-xs">
            {row.icon && (
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border shadow-sm transition-transform group-hover:scale-105", row.chip || "border-border/60 bg-hover text-foreground-secondary")}>
                <row.icon className="h-3.5 w-3.5" />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground-secondary group-hover:text-foreground transition-colors">{row.label}</span>
            <span className="tabular-nums text-base font-bold tracking-tight text-foreground">{row.value}</span>
          </div>
          <div className={cn("h-2.5 overflow-hidden rounded-full bg-hover ring-1 ring-inset ring-border/50 shadow-inner", row.icon && "ml-9")}>
            <div className={cn("h-full rounded-full transition-all duration-700 ease-out", row.color || "bg-primary")} style={{ width: `${Number(row.value) ? Math.max(3, (Number(row.value) / max) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DistributionMeter({ items }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + (Number(item.value) || 0), 0));
  const summary = items.map((item) => `${item.label}: ${item.value}`).join(", ");
  return (
    <div className="space-y-5 p-5">
      <div className="flex h-3 w-full overflow-hidden rounded-full ring-1 ring-inset ring-border/50 shadow-inner bg-hover/50" role="img" aria-label={`Distribution — ${summary}`}>
        {items.map((item) => {
          const val = Number(item.value) || 0;
          if (val === 0) return null;
          return (
            <div
              key={item.label}
              aria-hidden="true"
              className={cn("h-full transition-all duration-700 ease-out border-r border-surface/20 last:border-r-0", item.color)}
              style={{ width: `${(val / total) * 100}%` }}
              title={`${item.label}: ${val}`}
            />
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="group flex items-center justify-between gap-3 text-[13px]">
            <div className="flex items-center gap-2">
              <span className={cn("h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-border/20 shadow-sm transition-transform group-hover:scale-110", item.color)} />
              <span className="font-semibold tracking-tight text-foreground-secondary group-hover:text-foreground transition-colors">{item.label}</span>
            </div>
            <span className="tabular-nums font-bold text-foreground">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Part-to-whole viz for true partitions (fleet statuses sum to the fleet,
// driver statuses sum to the roster). Donut + center total + text legend, so
// no information lives in color alone. Hex fills come from chart-tokens.js —
// recharts SVG cannot consume Tailwind classes. Overlapping counts (incident
// risk) must NOT use this; they keep StatusBars.
const REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const donutTooltipStyle = {
  background: "var(--sf)",
  border: "1px solid var(--br)",
  borderRadius: "12px",
  fontSize: "12px",
};

export function DonutMeter({ items, totalLabel, exceptions = [], exceptionsHref }) {
  const data = items.map((item) => ({ ...item, value: Number(item.value) || 0 }));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const summary = data.map((item) => `${item.label}: ${item.value}`).join(", ");
  const shown = exceptions.slice(0, 3).map((item) =>
    typeof item === "string" ? { label: item, detail: "" } : item
  );
  const hidden = exceptions.length - shown.length;
  return (
    <div className="p-5" role="img" aria-label={`${totalLabel} distribution — ${summary}`}>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
      <div className="relative h-40 w-40 shrink-0" aria-hidden="true">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                contentStyle={donutTooltipStyle}
                formatter={(value, name) => [`${value} · ${total > 0 ? Math.round((Number(value) / total) * 100) : 0}%`, name]}
              />
              <Pie
                data={data.filter((item) => item.value > 0)}
                dataKey="value"
                nameKey="label"
                innerRadius="70%"
                outerRadius="95%"
                paddingAngle={3}
                cornerRadius={5}
                strokeWidth={0}
                isAnimationActive={!REDUCED_MOTION}
              >
                {data.filter((item) => item.value > 0).map((item) => (
                  <Cell key={item.label} fill={item.fill || CHART_COLORS.neutral} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full rounded-full ring-8 ring-inset ring-hover" />
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{total}</p>
          <p className="mt-0.5 max-w-20 text-center text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">{totalLabel}</p>
        </div>
      </div>
      <div className="grid w-full flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-1">
        {data.map((item) => (
          <div key={item.label} className="group flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm transition-transform group-hover:scale-110" style={{ background: item.fill || CHART_COLORS.neutral }} />
              <span className="truncate font-semibold tracking-tight text-foreground-secondary group-hover:text-foreground transition-colors">{item.label}</span>
            </div>
            <span className="tabular-nums font-bold text-foreground">{item.value}</span>
          </div>
        ))}
        </div>
      </div>
      {shown.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="Blocked details">
          {shown.map((item) => (
            <Link key={`${item.label}-${item.detail}`} href={exceptionsHref} className="inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-danger/10 px-2.5 py-1 text-[11px] tabular-nums transition-colors hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">
              <span className="font-bold text-danger-700">{item.label}</span>
              {item.detail && <span className="font-medium text-danger-700/70">{item.detail}</span>}
            </Link>
          ))}
          {hidden > 0 && (
            <Link href={exceptionsHref} className="rounded-full border border-border/60 bg-hover px-2.5 py-1 text-[11px] font-semibold text-foreground-secondary tabular-nums transition-colors hover:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              +{hidden} more
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function LinkRail({ items }) {
  return (
    <nav aria-label="Dashboard shortcuts" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(({ label, href, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex min-h-14 items-center gap-3 rounded-[14px] border border-border/70 bg-surface px-4 text-sm font-semibold text-foreground tracking-tight shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all hover:bg-hover/80 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Icon className="h-4 w-4 text-primary group-hover:scale-110 transition-transform" />
          <span className="flex-1">{label}</span>
          <ArrowRight className="h-4 w-4 text-foreground-muted transition-transform group-hover:text-foreground group-hover:translate-x-0.5" />
        </Link>
      ))}
    </nav>
  );
}

function LoadingDashboard() {
  return (
    <div className="space-y-5" aria-busy="true">
      <StatsGridSkeleton count={4} />
      <div className="grid gap-5 lg:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>
    </div>
  );
}

const ROLE_COLORS = {
  Unassigned: "#38bdf8",
  driver: "#a855f7",
  "fleet manager": "#f87171",
  dispatcher: "#fb7185",
  admin: "#2563eb",
  management: "#c084fc",
  "system admin": "#f59e0b",
};
const COLOR_PALETTE = ["#38bdf8", "#a855f7", "#f87171", "#fb7185", "#2563eb", "#c084fc", "#f59e0b", "#10b981", "#64748b"];

function SystemAdminDashboard({ queries }) {
  const users = queries.users?.data?.rows;
  const counters = queries.activity?.data?.counters;
  const integrationRecent = queries.activity?.data?.recent;
  const auditLogs = queries.audit?.data?.logs;

  const userList = users || [];
  const activeUsers = userList.filter((user) => !user.deleted_at && user.status !== "Inactive");
  const disabledUsers = userList.length - activeUsers.length;
  const disabledRows = userList
    .filter((user) => user.deleted_at || user.status === "Inactive")
    .slice(0, 3)
    .map((user) => [user.first_name, user.last_name].filter(Boolean).join(" ") || user.role_name || user.email || `Account #${user.employee_id}`);
  const disabledExtra = Math.max(0, disabledUsers - disabledRows.length);

  const roleList = useMemo(() => {
    if (!users?.length) return [];
    const counts = users.reduce((acc, user) => {
      const roleName = (user.role_name || "Unassigned").replace(/_/g, " ");
      acc[roleName] = (acc[roleName] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], index) => ({
        name,
        count,
        color: ROLE_COLORS[name] || COLOR_PALETTE[index % COLOR_PALETTE.length],
      }));
  }, [users]);

  const formattedAudit = useMemo(() => {
    if (!auditLogs?.length) return [];
    return auditLogs.slice(0, 4).map((item) => {
      const isSecurity =
        String(item.action || "").toLowerCase().includes("login") ||
        String(item.action || "").toLowerCase().includes("auth") ||
        String(item.resource || "").toLowerCase().includes("auth");
      return {
        id: item.log_id,
        type: isSecurity ? "security" : "user",
        event: `${item.action || "Changed"} · ${item.resource || "resource"}${item.resource_id ? ` #${item.resource_id}` : ""}`,
        actor: [item.first_name, item.last_name].filter(Boolean).join(" ") || item.email || "System process",
        time: item.created_at ? formatDateTime(item.created_at) : "Recent",
      };
    });
  }, [auditLogs]);

  const pushErrors = queries.activity?.data?.pushErrors;
  const liveActivities = queries.activity?.data?.activities;
  const liveServices = queries.activity?.data?.services;
  const liveUsage = queries.activity?.data?.usage;

  // Dashboard ↔ module connection: the System Health card renders the SAME
  // 7-row model as /system/health (mapped to the card's { name, status }
  // shape; the module owns remediation, the card only links to it). While
  // the health query is loading or errored, fall back to the legacy
  // activity.services array so the card never blocks the dashboard.
  const HEALTH_STATE_LABEL = { operational: "Operational", attention: "Attention", degraded: "Degraded", unknown: "Unknown" };
  const healthRows = queries.health?.data?.rows;
  const healthServices =
    Array.isArray(healthRows) && healthRows.length
      ? healthRows.map((r) => ({ name: r.label, status: HEALTH_STATE_LABEL[r.state] || "Unknown", uptime: "" }))
      : undefined;

  const formattedErrors = useMemo(() => {
    const failedEvents = (integrationRecent || []).filter((item) => String(item.status).toLowerCase() === "failed");
    const pushFailed = Number(counters?.push_failed || 0);
    const integrationFailed = Number(counters?.integration_failed || 0);
    const loginFailed = Number(counters?.login_failed_24h || 0);
    const hasPushErrors = (pushErrors || []).length > 0;

    if (!failedEvents.length && !pushFailed && !loginFailed && !integrationFailed && !hasPushErrors) {
      return [];
    }
    const list = [];
    if (pushFailed > 0 || hasPushErrors) {
      list.push({
        id: "err-push",
        severity: "CRITICAL",
        title: "Push notification delivery failed",
        occurrences: pushFailed || pushErrors?.length || 0,
        lastSeen: pushErrors?.[0]?.created_at ? formatDateTime(pushErrors[0].created_at) : "Recent",
      });
    }
    if (integrationFailed > 0) {
      list.push({
        id: "err-integration",
        severity: "ERROR",
        title: "Integration sync failed",
        occurrences: integrationFailed,
        lastSeen: "Recent",
      });
    }
    if (loginFailed > 0) {
      list.push({
        id: "err-login",
        severity: "WARNING",
        title: "Failed sign-in attempts detected",
        occurrences: loginFailed,
        lastSeen: "Last 24h",
      });
    }
    failedEvents.slice(0, 4 - list.length).forEach((ev, idx) => {
      list.push({
        id: `err-ev-${ev.id || idx}`,
        severity: "ERROR",
        title: ev.error_message || `${ev.type || "Integration"} event failed`,
        occurrences: 1,
        lastSeen: "Recent",
      });
    });
    return list;
  }, [counters, integrationRecent, pushErrors]);

  const formattedActivities = useMemo(() => {
    if (!integrationRecent?.length) return [];
    const toneMap = {
      failed: "red",
      error: "red",
      processed: "green",
      success: "green",
      inbound: "blue",
      outbound: "purple",
      pending: "teal",
    };
    return integrationRecent.slice(0, 5).map((item) => {
      const statusKey = String(item.status || item.type || "").toLowerCase();
      return {
        time: item.created_at ? formatTime(item.created_at) : "Just now",
        user: item.source === "integration" ? "API System" : "System",
        initials: "SY",
        action: item.status === "processed" ? "Success" : item.status === "failed" ? "Failed" : item.type || "Event",
        actionTone: toneMap[statusKey] || "blue",
        module: item.source_system || item.detail || "Integration",
        details: item.error_message || item.detail || `Processed ${item.type || "event"}`,
      };
    });
  }, [integrationRecent]);

  if (queries.users?.isLoading || queries.activity?.isLoading) return <LoadingDashboard />;

  return (
    <div className="space-y-5">
      <QueryErrors items={[
        { query: queries.users, title: "Account posture could not be loaded" },
        { query: queries.sessions, title: "Your sessions could not be loaded" },
        { query: queries.activity, title: "Platform activity could not be loaded" },
        { query: queries.health, title: "System health could not be loaded" },
        { query: queries.audit, title: "Audit activity could not be loaded" },
        { query: queries.notifications, title: "Notifications could not be loaded" },
      ]} />

      {/* Top Row: System Usage Overview (~1.3fr) | System Health (1fr) | Account Posture (1fr) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr_1fr] gap-5 items-stretch">
        <SystemUsageOverviewCard data={liveUsage || []} />
        <SystemHealthCard services={healthServices ?? liveServices ?? []} />
        <AccountPostureCard
          roles={roleList}
          totalAccounts={userList.length}
          disabledRoles={disabledRows}
          disabledExtra={disabledExtra}
        />
      </div>

      {/* Bottom Row: Recent System Activities (~1.3fr) | Recent Errors (1fr) | Recent Security and Change Audit (1fr) */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr_1fr] gap-5 items-stretch">
        <RecentSystemActivitiesCard activities={liveActivities?.length ? liveActivities : formattedActivities} />
        <RecentErrorsCard errors={formattedErrors} />
        <RecentSecurityAuditCard logs={formattedAudit} />
      </div>
    </div>
  );
}

function AdminDashboard({ queries }) {
  const requests = queries.reservations.data || [];
  const dispatches = queries.dispatches.data || {};
  const maintenance = queries.maintenance.data || [];
  const incidents = queries.incidents.data || {};
  const documents = queries.documents.data || { items: [], totals: {} };
  const fuel = queries.fuelRequests.data || { rows: [], counts: {} };
  const openRequests = requests.filter((request) => !["Completed", "Cancelled"].includes(request.fleet_status));
  const completedToday = (dispatches.completed || []).filter((dispatch) => isToday(dispatch.updated_at || dispatch.scheduled_arrival)).length;
  const activeMaintenance = maintenance.filter((item) => ["Scheduled", "In Progress"].includes(item.status));
  const attention = [
    { label: "Incident attention queue", value: queries.incidents.isLoading || queries.incidents.isError ? "—" : Number(incidents.attention || 0), sortValue: Number(incidents.attention || 0), href: "/incidents", icon: AlertTriangle },
    { label: "Pending reassignment", value: queries.dispatches.isError ? "—" : (dispatches.pendingReassignment || []).length, sortValue: (dispatches.pendingReassignment || []).length, href: "/dispatch", icon: Navigation },
    { label: "Expired / 30-day documents", value: queries.documents.isLoading || queries.documents.isError ? "—" : Number(documents.totals?.expired || 0) + Number(documents.totals?.expiring30 || 0), sortValue: Number(documents.totals?.expired || 0) + Number(documents.totals?.expiring30 || 0), href: "/fleet/documents", icon: FileWarning },
    { label: "Active maintenance work", value: queries.maintenance.isLoading || queries.maintenance.isError ? "—" : activeMaintenance.length, sortValue: activeMaintenance.length, href: "/maintenance", icon: Wrench },
    { label: "Pending fuel requests", value: queries.fuelRequests.isLoading || queries.fuelRequests.isError ? "—" : Number(fuel.counts?.pending || 0), sortValue: Number(fuel.counts?.pending || 0), href: "/fuel", icon: Fuel },
  ].sort((a, b) => b.sortValue - a.sortValue);
  // Calm-when-clear: the strip only wears the danger treatment while at least
  // one exception cell holds a real count. Unknown ("—") counts never trigger
  // either state — they render neutral until their feed resolves.
  const attentionIssues = attention.some((item) => item.value !== "—" && item.value > 0);
  const attentionClear = attention.every((item) => item.value === 0);
  const attentionTone = attentionIssues ? "danger" : attentionClear ? "success" : "neutral";

  if (queries.dispatches.isLoading || queries.reservations.isLoading) return <LoadingDashboard />;

  return (
    <div className="space-y-5">
      <QueryErrors items={[
        { query: queries.reservations, title: "Request volume could not be loaded" },
        { query: queries.dispatches, title: "Dispatch progress could not be loaded" },
        { query: queries.maintenance, title: "Maintenance attention could not be loaded" },
        { query: queries.incidents, title: "Incident attention could not be loaded" },
        { query: queries.documents, title: "Document compliance could not be loaded" },
        { query: queries.fuelRequests, title: "Fuel requests could not be loaded" },
      ]} />

      <Panel title="Operational attention" description={attentionTone === "success" ? "No exceptions need action. Counts rise here the moment something blocks service." : "Exceptions that may block service, ordered by current volume."} action={<Link href="/notifications" className={linkClass}>Notification center <ArrowRight className="h-3.5 w-3.5" /></Link>} className={attentionTone === "danger" ? "border-danger/20 ring-1 ring-danger/10" : attentionTone === "success" ? "border-success/25" : undefined}>
        <div className={cn("grid divide-y divide-border/70 md:grid-cols-5 md:divide-x md:divide-y-0", attentionTone === "danger" ? "bg-danger/5" : attentionTone === "success" ? "bg-success/5" : "bg-hover/40")}>
          {attention.map((item) => {
            const hasIssues = item.value !== "—" && item.value > 0;
            const unknown = item.value === "—";
            return (
              <Link key={item.label} href={item.href} aria-label={`${item.label}: ${unknown ? "unavailable" : item.value}`} className="group flex flex-col items-center justify-center gap-2 p-5 transition-all hover:bg-hover/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                <div className="relative">
                  <span className={cn("flex h-10 w-10 items-center justify-center rounded-2xl border shadow-sm transition-transform group-hover:scale-105", unknown ? "border-border/60 bg-hover text-foreground-muted" : hasIssues ? "border-danger/25 bg-danger/10 text-danger" : "border-success/25 bg-success/10 text-success-700")}>
                    <item.icon className="h-5 w-5" />
                  </span>
                  {hasIssues && <span className="absolute -top-1 -right-1 flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75"></span><span className="relative inline-flex h-2 w-2 rounded-full bg-danger"></span></span>}
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{item.value}</p>
                  <p className="mt-1 text-[11px] font-medium leading-snug text-foreground-secondary">{item.label}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </Panel>

      <StatGrid cols={4}>
        <StatCard icon={Inbox} label="Open requests" value={queries.reservations.isError ? "—" : openRequests.length} trend="Not completed or cancelled" tone="warning" href="/reservations/queue" />
        <StatCard icon={CalendarClock} label="Scheduled dispatches" value={queries.dispatches.isError ? "—" : (dispatches.scheduled || []).length} trend="Committed and waiting to depart" tone="info" href="/dispatch" />
        <StatCard icon={Navigation} label="Trips in progress" value={queries.dispatches.isError ? "—" : (dispatches.inProgress || []).length} trend="Currently underway" tone="primary" href="/trips" />
        <StatCard icon={CheckCircle2} label="Completed today" value={queries.dispatches.isError ? "—" : completedToday} trend="Dispatches finished today" tone="success" href="/trips" />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <RequestPipelineCard requests={requests} query={queries.reservations} linkClass={linkClass} />
        <DocumentComplianceCard documents={documents} query={queries.documents} linkClass={linkClass} />
        <MaintenancePressureCard maintenance={activeMaintenance.length > 0 ? activeMaintenance : maintenance} query={queries.maintenance} linkClass={linkClass} />
        <IncidentRiskCard incidents={incidents} query={queries.incidents} />
      </div>

      <LinkRail items={[
        { label: "Operations reports", href: "/reports", icon: BarChart3 },
        { label: "Incident center", href: "/incidents", icon: AlertTriangle },
        { label: "Fuel operations", href: "/fuel", icon: Fuel },
        { label: "AI insights", href: "/ai/insights", icon: Brain },
      ]} />
    </div>
  );
}

function FleetManagerDashboard({ queries }) {
  const vehicles = queries.vehicles.data || [];
  const drivers = queries.drivers.data || [];
  const assignments = queries.assignments.data?.assignments || [];
  const substitutes = queries.substitutes.data?.schedules || [];
  const leave = queries.leave.data || [];
  const maintenance = queries.maintenance.data || [];
  const documents = queries.documents.data || { items: [], totals: {} };
  const fuel = queries.fuelRequests.data || { counts: {} };
  const dispatches = queries.dispatches.data || {};
  const today = localDateKey();
  const driverById = new Map(drivers.map((driver) => [Number(driver.driver_id), driver]));
  const vehicleById = new Map(vehicles.map((vehicle) => [Number(vehicle.vehicle_id), vehicle]));
  const blockedVehicles = new Set(NON_DISPATCHABLE_VEHICLE_STATUSES);
  const pairRows = assignments.map((assignment) => {
    const driver = driverById.get(Number(assignment.driver_id));
    const vehicle = vehicleById.get(Number(assignment.vehicle_id));
    const driverUnavailable = isDriverUnavailableFor(driver, new Date()).unavailable;
    const substituteId = resolveSubstituteForDate(assignment.vehicle_id, today, substitutes);
    const substitute = substituteId ? driverById.get(substituteId) : null;
    const vehicleBlocked = blockedVehicles.has(vehicle?.vehicle_status);
    const coverage = vehicleBlocked
      ? "Vehicle blocked"
      : driverUnavailable && substitute
        ? "Substitute covering"
        : driverUnavailable
          ? "Driver unavailable"
          : "Current pair";
    return { assignment, driver, vehicle, substitute, coverage };
  });
  const readyPairs = pairRows.filter((row) => row.coverage === "Current pair" || row.coverage === "Substitute covering").length;
  const activeMaintenance = maintenance.filter((item) => ["Scheduled", "In Progress"].includes(item.status));
  const approvedLeave = leave.filter((item) => item.status === "Approved").length;
  const readyVehicles = vehicles.filter((vehicle) => !blockedVehicles.has(vehicle?.vehicle_status)).length;
  const readinessGaps = (vehicles.length - readyVehicles) + (pairRows.length - readyPairs);
  const utilizationRows = [...((queries.utilization.data || {}).byVehicle || [])]
    .sort((a, b) => (Number(a.trips) || 0) - (Number(b.trips) || 0))
    .slice(0, 4);
  const workloadRows = [...((queries.driverPerformance.data || {}).details || [])]
    .sort((a, b) => (Number(b.total_trips) || 0) - (Number(a.total_trips) || 0))
    .slice(0, 4);
  const nextDispatches = [...(dispatches.pendingReassignment || []), ...(dispatches.scheduled || [])].slice(0, 5);

  if (queries.vehicles.isLoading || queries.drivers.isLoading || queries.assignments.isLoading) return <LoadingDashboard />;

  return (
    <div className="space-y-5">
      <QueryErrors items={[
        { query: queries.vehicles, title: "Vehicle readiness could not be loaded" },
        { query: queries.drivers, title: "Driver readiness could not be loaded" },
        { query: queries.assignments, title: "Driver–vehicle pairings could not be loaded" },
        { query: queries.substitutes, title: "Substitute coverage could not be loaded" },
        { query: queries.leave, title: "Leave coverage could not be loaded" },
        { query: queries.maintenance, title: "Maintenance data could not be loaded" },
        { query: queries.documents, title: "Compliance documents could not be loaded" },
        { query: queries.fuelRequests, title: "Fuel requests could not be loaded" },
        { query: queries.dispatches, title: "Upcoming schedules could not be loaded" },
        { query: queries.utilization, title: "Vehicle utilization could not be loaded" },
        { query: queries.driverPerformance, title: "Driver workload could not be loaded" },
      ]} />

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface px-5 py-4 shadow-xs sm:flex-row sm:items-center" role="status">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm", readinessGaps === 0 ? "border-success/25 bg-success/10 text-success-700" : "border-warning/25 bg-warning/10 text-warning-700")}>
          {readinessGaps === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        </span>
        <p className="flex-1 text-[13px] font-medium tracking-tight text-foreground">
          {readyVehicles} of {vehicles.length} vehicles ready · {readyPairs} of {pairRows.length} pairings covered
          <span className="text-foreground-secondary">{approvedLeave > 0 ? ` · ${approvedLeave} on approved leave` : " · full attendance"}</span>
        </p>
        <Link href="/dispatch/availability" className={linkClass}>Availability board <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>

      <StatGrid cols={4}>
        <StatCard icon={Truck} label="Vehicles in fleet" value={queries.vehicles.isError ? "—" : vehicles.length} trend="All active vehicle records" tone="primary" />
        <StatCard icon={ClipboardCheck} label="Covered pairings today" value={queries.assignments.isError || queries.drivers.isError || queries.vehicles.isError ? "—" : readyPairs} valueNote={queries.assignments.isError ? undefined : `of ${pairRows.length}`} trend="Current-status coverage only; dispatch validates each requested window" tone="success" />
        <StatCard icon={Wrench} label="Maintenance attention" value={queries.maintenance.isLoading || queries.maintenance.isError ? "—" : activeMaintenance.length} trend="Scheduled or in-progress work" tone="warning" />
        <StatCard icon={FileWarning} label="Compliance due ≤30d" value={queries.documents.isLoading || queries.documents.isError ? "—" : Number(documents.totals?.expired || 0) + Number(documents.totals?.expiring30 || 0)} trend="Expired and near-expiry documents" tone="danger" />
      </StatGrid>

      <Panel title="Driver–vehicle coverage" description="Designated pairings and today’s substitute coverage. Final eligibility remains window-aware at dispatch." action={<Link href="/fleet/assignments" className={linkClass}>Manage pairings <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <FeedState queries={[queries.vehicles, queries.drivers, queries.assignments, queries.substitutes]} errorTitle="Driver–vehicle coverage is unavailable">{pairRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm border-collapse">
              <thead className="bg-hover/60 text-[11px] uppercase tracking-wider text-foreground-secondary border-b border-border/60">
                <tr><th className="px-5 py-4 font-semibold">Vehicle</th><th className="px-5 py-4 font-semibold">Designated driver</th><th className="px-5 py-4 font-semibold">Driver status</th><th className="px-5 py-4 font-semibold">Today’s coverage</th></tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {pairRows.slice(0, 10).map(({ assignment, driver, vehicle, substitute, coverage }) => {
                  const hasIssue = coverage !== "Current pair" && coverage !== "Substitute covering";
                  return (
                  <tr key={assignment.assignment_id} className="group hover:bg-hover/40 transition-colors">
                    <td className="px-5 py-4"><p className="font-semibold tabular-nums text-foreground">{vehicle?.plate_number || assignment.plate_number || "Unrecorded plate"}</p><StatusBadge status={vehicle?.vehicle_status || assignment.vehicle_status || "Unknown"} entity="vehicle" className="mt-1" /></td>
                    <td className="px-5 py-4 font-medium text-foreground">{[driver?.employees?.first_name || assignment.first_name, driver?.employees?.last_name || assignment.last_name].filter(Boolean).join(" ") || `Driver #${assignment.driver_id}`}</td>
                    <td className="px-5 py-4"><StatusBadge status={driver?.driver_status || "Unknown"} entity="driver" /></td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {hasIssue && <LivePulseBeacon status={coverage === "Vehicle blocked" ? "danger" : "warning"} />}
                        <StatusBadge status={coverage === "Current pair" || coverage === "Substitute covering" ? "Healthy" : coverage === "Vehicle blocked" ? "Critical" : "High"} entity="risk" />
                      </div>
                      <p className="mt-1.5 text-xs text-foreground-secondary">{substitute ? `Covered by ${[substitute.employees?.first_name, substitute.employees?.last_name].filter(Boolean).join(" ") || `driver #${substitute.driver_id}`}` : coverage}</p>
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        ) : <InlineEmpty icon={UserCheck} title="No active pairings" description="Assign designated drivers before planning normal vehicle coverage." variant="first-run" action={<Button variant="outline" size="sm" asChild><Link href="/fleet/assignments">Open assignments</Link></Button>} />}</FeedState>
      </Panel>

      <Panel title="Utilization & workload" description="Lightest-used vehicles against hardest-working drivers in the report period — rebalance before fatigue or neglect becomes a failure." action={<Link href="/reports" className={linkClass}>Open reports <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <FeedState queries={[queries.utilization, queries.driverPerformance]} errorTitle="Utilization and workload are unavailable">
          <div className="grid gap-0 sm:grid-cols-2 sm:divide-x sm:divide-border/70">
            <div className="divide-y divide-border/40">
              {utilizationRows.length ? utilizationRows.map((row) => (
                <Row key={row.vehicle_id || row.plate} icon={Truck} title={row.plate || row.vehicle || "Vehicle"} detail={`${Number(row.trips) || 0} trips · ${Number(row.distance || 0).toLocaleString()} km`} meta="lightest use" />
              )) : <InlineEmpty icon={Truck} title="No utilization data yet" description="Vehicle trip volume will appear here once trips complete." variant="waiting" />}
            </div>
            <div className="divide-y divide-border/40 border-t border-border/40 sm:border-t-0">
              {workloadRows.length ? workloadRows.map((row) => (
                <Row key={row.driver_id} icon={Users} title={row.name || `Driver #${row.driver_id}`} detail={`${Number(row.total_trips) || 0} trips · ${Number(row.total_distance || 0).toLocaleString()} km`} meta="heaviest load" />
              )) : <InlineEmpty icon={Users} title="No workload data yet" description="Driver trip volume will appear here once trips complete." variant="waiting" />}
            </div>
          </div>
        </FeedState>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Maintenance pressure" description="Active work ordered by the API’s current maintenance date." action={<Link href="/maintenance" className={linkClass}>Maintenance register <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.maintenance} errorTitle="Maintenance pressure is unavailable">{activeMaintenance.length ? <div className="divide-y divide-border/70">{activeMaintenance.slice(0, 6).map((item) => <Row key={item.maintenance_id} icon={Wrench} title={`${item.vehicles?.plate_number || "Vehicle"} · ${item.maintenance_type || "Maintenance"}`} detail={item.description || "No work description recorded"} meta={formatDateTime(item.maintenance_date)} status={item.status} entity="maintenance" />)}</div> : <InlineEmpty icon={Wrench} title="No active maintenance work" description="New work orders will appear here once maintenance is scheduled." variant="waiting" />}</FeedState>
        </Panel>
        <Panel title="Upcoming fleet schedule" description="Nearest scheduled departures and reassignment exceptions." action={<Link href="/dispatch" className={linkClass}>Dispatch board <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.dispatches} errorTitle="The fleet schedule is unavailable">{nextDispatches.length ? <div className="divide-y divide-border/70">{nextDispatches.map((item) => <Row key={item.dispatch_id} icon={CalendarClock} title={`${item.vehicles?.plate_number || "Unassigned vehicle"} · ${item.transportation_requests?.guest_name || item.routes?.route_name || "Scheduled service"}`} detail={`${item.transportation_requests?.pickup_location || item.origin_location?.location_name || "Pickup unrecorded"} → ${item.transportation_requests?.dropoff_location || item.destination_location?.location_name || "Destination unrecorded"}`} meta={formatDateTime(item.scheduled_departure)} status={item.status} entity="dispatch" href={`/dispatch/${item.dispatch_id}`} />)}</div> : <InlineEmpty icon={CalendarClock} title="No upcoming dispatches" description="Scheduled departures will appear here once requests are assigned." variant="waiting" />}</FeedState>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Document compliance" description="All expired and near-expiry records." action={<Link href="/fleet/documents" className={linkClass}>Compliance register <ArrowRight className="h-3.5 w-3.5" /></Link>}><FeedState queries={queries.documents} errorTitle="Document compliance is unavailable"><DonutMeter totalLabel="flagged" items={[{ label: "Expired", value: documents.totals?.expired || 0, fill: CHART_COLORS.danger }, { label: "Due in 30 days", value: documents.totals?.expiring30 || 0, fill: CHART_COLORS.warning }, { label: "Due in 31–90 days", value: documents.totals?.expiring90 || 0, fill: CHART_COLORS.info }]} /></FeedState></Panel>
        <Panel title="Workforce exceptions" description="Approved leave and substitute coverage today." action={<Link href="/drivers/leave" className={linkClass}>Leave coverage <ArrowRight className="h-3.5 w-3.5" /></Link>}><FeedState queries={[queries.leave, queries.substitutes]} errorTitle="Workforce exceptions are unavailable"><DonutMeter totalLabel="cases" items={[{ label: "Approved leave", value: approvedLeave, fill: CHART_COLORS.warning }, { label: "Substitute schedules", value: substitutes.length, fill: CHART_COLORS.info }, { label: "Uncovered pairings", value: pairRows.length - readyPairs, fill: CHART_COLORS.danger }]} /></FeedState></Panel>
        <Panel title="Fuel request status" description="Current request workflow volume." action={<Link href="/fuel" className={linkClass}>Fuel operations <ArrowRight className="h-3.5 w-3.5" /></Link>}><FeedState queries={queries.fuelRequests} errorTitle="Fuel request status is unavailable"><DonutMeter totalLabel="requests" items={[{ label: "Pending", value: fuel.counts?.pending || 0, fill: CHART_COLORS.warning }, { label: "Approved", value: fuel.counts?.approved || 0, fill: CHART_COLORS.info }, { label: "Fulfilled", value: fuel.counts?.fulfilled || 0, fill: CHART_COLORS.success }]} /></FeedState></Panel>
      </div>

      <LinkRail items={[
        { label: "Vehicle register", href: "/fleet/vehicles", icon: Truck },
        { label: "Driver roster", href: "/drivers", icon: Users },
        { label: "Leave coverage", href: "/drivers/leave", icon: CalendarClock },
        { label: "Fuel operations", href: "/fuel", icon: Fuel },
      ]} />
    </div>
  );
}

function DispatcherDashboard({ queries, queueGroups }) {
  const requests = queries.reservations.data || [];
  const dispatches = queries.dispatches.data || {};
  const vehicles = queries.vehicles.data || [];
  const drivers = queries.driverStats.data || {};
  const driverRoster = queries.drivers.data || [];
  const blockedPlates = vehicles
    .filter((vehicle) => ["Under Maintenance", "Decommissioned"].includes(vehicle.vehicle_status))
    .map((vehicle) => ({
      label: vehicle.plate_number || `Vehicle #${vehicle.vehicle_id}`,
      detail: vehicle.vehicle_status === "Decommissioned" ? "retired" : "maintenance",
    }))
    .filter((item) => Boolean(item.label));
  const blockedDrivers = driverRoster
    .filter((driver) => ["Suspended", "On Leave"].includes(driver.driver_status))
    .map((driver) => ({
      label: [driver.employees?.first_name, driver.employees?.last_name].filter(Boolean).join(" ") || `Driver #${driver.driver_id}`,
      detail: driver.driver_status === "Suspended" ? "suspended" : "on leave",
    }))
    .filter((item) => Boolean(item.label));
  const validLocations = (queries.locations.data || []).filter((location) => isValidCoordinate(location?.latitude, location?.longitude));
  // Active rescue missions (open incidents with a fleet responder assigned) —
  // rendered on the same operations map so a rescue is visible even with zero
  // live trips, exactly like the guest-transport flow.
  const rescues = Array.isArray(queries.rescues?.data) ? queries.rescues.data : [];
  const queue = [...queueGroups.today, ...queueGroups.upcoming].sort(compareByPriority).slice(0, 10);
  const reviewCount = queueGroups.today.length + queueGroups.upcoming.filter((request) => request.derived_priority === "Overdue").length;
  const activeTrips = dispatches.inProgress || [];
  const pendingReassignment = dispatches.pendingReassignment || [];
  // Action-zone derivations — all client-side from the already-polled feeds.
  // Queue rows carry nested vehicles/drivers objects (null when unassigned).
  // The clock lives in state and ticks every 60s so countdowns stay live
  // without re-rendering on every frame (same cadence as use-departure-alerts).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const minsUntil = (value) => {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? Math.round((t - nowMs) / 60000) : null;
  };
  const queuePool = [...queueGroups.today, ...queueGroups.upcoming];
  const unassignedQueue = queuePool.filter((request) => !request.vehicles || !request.drivers);
  const scheduledList = dispatches.scheduled || [];
  const departingRequests = unassignedQueue.filter((request) => {
    const mins = minsUntil(request.pickup_datetime);
    return mins != null && mins <= 30;
  });
  const departingDispatches = scheduledList.filter((dispatch) => {
    const mins = minsUntil(dispatch.scheduled_departure);
    return mins != null && mins <= 30;
  });
  const delayedTrips = activeTrips.filter((dispatch) => tripProgress(dispatch).overdue === true);
  const dispatchAttention = [
    { label: "Need assignment", value: unassignedQueue.length, href: "/reservations/queue", icon: Inbox },
    { label: "Unassigned · departing ≤30 min", value: departingRequests.length, href: "/reservations/queue", icon: CalendarClock },
    { label: "Need reassignment", value: pendingReassignment.length, href: "/dispatch", icon: Navigation },
    { label: "Delayed trips", value: delayedTrips.length, href: "/trips", icon: AlertTriangle },
  ];
  const dispatchTone = dispatchAttention.some((item) => item.value > 0) ? "danger" : "success";
  const nextDepartures = [
    ...scheduledList.map((dispatch) => ({
      key: `d-${dispatch.dispatch_id}`,
      time: dispatch.scheduled_departure,
      title: `${dispatch.vehicles?.plate_number || "Unassigned vehicle"} · ${[dispatch.drivers?.first_name, dispatch.drivers?.last_name].filter(Boolean).join(" ") || "Unassigned driver"}`,
      detail: `${dispatch.transportation_requests?.pickup_location || dispatch.origin_location?.location_name || "Pickup unrecorded"} → ${dispatch.transportation_requests?.dropoff_location || dispatch.destination_location?.location_name || "Destination unrecorded"}`,
      href: `/dispatch/${dispatch.dispatch_id}`,
      assigned: Boolean(dispatch.vehicle_id && dispatch.driver_id),
      smartMatch: false,
    })),
    ...unassignedQueue.map((request) => ({
      key: `r-${request.request_id}`,
      time: request.pickup_datetime,
      title: request.guest_name || request.reservation_number || `Request #${request.request_id}`,
      detail: `${request.passenger_count || 1} passenger${Number(request.passenger_count) === 1 ? "" : "s"} · ${request.pickup_location || "Pickup unrecorded"} → ${request.dropoff_location || "Destination unrecorded"}`,
      href: `/reservations/${request.request_id}`,
      assigned: false,
      smartMatch: Boolean(request.ai_vehicle_recommendation || request.ai_driver_recommendation),
    })),
  ]
    .filter((item) => minsUntil(item.time) != null)
    .sort((a, b) => new Date(a.time) - new Date(b.time))
    .slice(0, 6);
  const vehicleCounts = vehicles.reduce((acc, vehicle) => {
    const status = vehicle.vehicle_status || "Unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  if (queries.reservations.isLoading || queries.dispatches.isLoading) return <LoadingDashboard />;

  return (
    <div className="space-y-5">
      <QueryErrors items={[
        { query: queries.reservations, title: "The transportation queue could not be loaded" },
        { query: queries.dispatches, title: "Dispatch status could not be loaded" },
        { query: queries.vehicles, title: "Vehicle status could not be loaded" },
        { query: queries.driverStats, title: "Driver status could not be loaded" },
        { query: queries.locations, title: "Live GPS positions could not be loaded" },
      ]} />

      {pendingReassignment.length > 0 && (
        <Link href="/dispatch" className="flex items-center gap-3 rounded-2xl bg-danger-bg px-5 py-4 text-danger-700 transition-colors hover:bg-danger-bg/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">
          <AlertTriangle className="h-5 w-5 shrink-0" /><span className="flex-1 text-sm font-semibold">{pendingReassignment.length} dispatch{pendingReassignment.length === 1 ? " needs" : "es need"} reassignment now.</span><ArrowRight className="h-4 w-4" />
        </Link>
      )}

      <Panel title="Needs attention now" description={dispatchTone === "success" ? "Nothing needs action. New unassigned, overdue, or delayed work lands here first." : "Actionable right now — everything else on this page can wait."} className={dispatchTone === "danger" ? "border-danger/20 ring-1 ring-danger/10" : "border-success/25"}>
        <div className={cn("grid grid-cols-2 divide-x divide-border/70 lg:grid-cols-4", dispatchTone === "danger" ? "bg-danger/5" : "bg-success/5")}>
          {dispatchAttention.map((item) => {
            const hasIssues = item.value > 0;
            return (
              <Link key={item.label} href={item.href} aria-label={`${item.label}: ${item.value}`} className="group flex flex-col items-center justify-center gap-2 p-5 transition-all hover:bg-hover/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                <div className="relative">
                  <span className={cn("flex h-10 w-10 items-center justify-center rounded-2xl border shadow-sm transition-transform group-hover:scale-105", hasIssues ? "border-danger/25 bg-danger/10 text-danger" : "border-success/25 bg-success/10 text-success-700")}>
                    <item.icon className="h-5 w-5" />
                  </span>
                  {hasIssues && <span className="absolute -top-1 -right-1 flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75"></span><span className="relative inline-flex h-2 w-2 rounded-full bg-danger"></span></span>}
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{item.value}</p>
                  <p className="mt-1 text-[11px] font-medium leading-snug text-foreground-secondary">{item.label}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </Panel>

      <StatGrid cols={4}>
        <StatCard icon={Inbox} label="Needs dispatch review" value={queries.reservations.isError ? "—" : reviewCount} trend="Today and overdue, priority-sorted" tone="warning" />
        <StatCard icon={CalendarClock} label="Assigned next" value={queries.reservations.isError ? "—" : queueGroups.assigned.length} trend="Committed requests waiting to start" tone="info" />
        <StatCard icon={Navigation} label="Trips in progress" value={queries.dispatches.isError ? "—" : activeTrips.length} trend="Active dispatches" tone="primary" />
        <StatCard icon={CheckCircle2} label="Departing ≤30 min" value={queries.dispatches.isError || queries.reservations.isError ? "—" : departingDispatches.length + departingRequests.length} trend="Runs and pickups leaving within the half hour" tone="info" href="/dispatch" />
      </StatGrid>

      <Panel title="Next departures" description="Assigned runs and unassigned requests in time order — countdowns, assignment state, and Smart-match availability." action={<Link href="/reservations/queue" className={linkClass}>Open queue <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <FeedState queries={[queries.reservations, queries.dispatches]} errorTitle="Next departures are unavailable">{nextDepartures.length ? (
          <div className="divide-y divide-border/40">
            {nextDepartures.map((item) => {
              const mins = minsUntil(item.time);
              const sev = mins == null ? null : mins <= 10 ? "danger" : mins <= 30 ? "warning" : "info";
              const countdown = mins == null ? null : mins <= 0
                ? { label: mins === 0 ? "Due now" : `Overdue ${Math.abs(mins)}m`, severity: "danger" }
                : mins <= 10 ? { label: `In ${mins} min`, severity: "danger" }
                : mins <= 30 ? { label: `In ${mins} min`, severity: "warning" }
                : { label: `In ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`}`, severity: "info" };
              const RowIcon = item.assigned ? Navigation : item.smartMatch ? Brain : AlertTriangle;
              return (
                <Link key={item.key} href={item.href} className={cn("group grid gap-3 px-5 py-4 transition-colors hover:bg-hover/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center", sev === "danger" ? "bg-danger/5" : sev === "warning" ? "bg-warning/5" : "")}>
                  <div>
                    <p className={cn("text-[15px] font-semibold tabular-nums tracking-tight", sev === "danger" ? "text-danger-700" : sev === "warning" ? "text-warning-700" : "text-foreground")}>{formatTime(item.time)}</p>
                    <p className="mt-0.5 text-xs text-foreground-secondary">{formatDateTime(item.time).split(" · ")[0]}</p>
                  </div>
                  <div className="flex min-w-0 items-start gap-3 py-1">
                    <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border shadow-sm transition-transform group-hover:scale-105", item.assigned ? "border-primary/20 bg-primary/10 text-primary" : item.smartMatch ? "border-info/25 bg-info/10 text-info" : "border-warning/25 bg-warning/10 text-warning-700")}>
                      <RowIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-foreground tracking-tight leading-snug line-clamp-2">{item.title}</p>
                      <p className="mt-0.5 text-[13px] text-foreground-secondary leading-snug line-clamp-2">{item.detail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {countdown && <StatusBadge severity={countdown.severity}>{countdown.label}</StatusBadge>}
                    {item.smartMatch && <StatusBadge severity="info">Smart match</StatusBadge>}
                    {!item.assigned && !item.smartMatch && <StatusBadge severity="warning">Unassigned</StatusBadge>}
                    <ArrowRight className="h-5 w-5 ml-1 text-foreground-muted transition-transform group-hover:text-foreground group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : <InlineEmpty icon={CalendarClock} title="No upcoming departures" description="Scheduled runs and unassigned pickups will appear here once trips are scheduled." variant="waiting" />}</FeedState>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Fleet health" description="Point-in-time vehicle statuses. Dispatch eligibility stays window-aware — confirm on the availability board." action={<Link href="/dispatch/availability" className={linkClass}>Resource availability <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.vehicles} errorTitle="Fleet health is unavailable"><DonutMeter totalLabel="vehicles" exceptions={blockedPlates} exceptionsHref="/dispatch/availability" items={[
            { label: "Available", value: vehicleCounts.Available || 0, fill: CHART_COLORS.success },
            { label: "In use", value: vehicleCounts["In Use"] || 0, fill: CHART_COLORS.info },
            { label: "Reserved", value: vehicleCounts.Reserved || 0, fill: CHART_COLORS.neutral },
            { label: "Under maint.", value: vehicleCounts["Under Maintenance"] || 0, fill: CHART_COLORS.warning },
            { label: "Decommissioned", value: vehicleCounts.Decommissioned || 0, fill: CHART_COLORS.danger },
          ]} /></FeedState>
        </Panel>
        <Panel title="Workforce coverage" description="Driver status across the operation right now." action={<Link href="/dispatch/availability" className={linkClass}>Resource availability <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={[queries.driverStats, queries.drivers]} errorTitle="Driver coverage is unavailable"><DonutMeter totalLabel="drivers" exceptions={blockedDrivers} exceptionsHref="/dispatch/availability" items={[
            { label: "Available", value: drivers.available || 0, fill: CHART_COLORS.success },
            { label: "On trip", value: drivers.onTrip || 0, fill: CHART_COLORS.info },
            { label: "Off duty", value: drivers.offDuty || 0, fill: CHART_COLORS.neutral },
            { label: "On leave", value: drivers.onLeave || 0, fill: CHART_COLORS.warning },
            { label: "Suspended", value: drivers.suspended || 0, fill: CHART_COLORS.danger },
          ]} /></FeedState>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Priority transportation queue" description="Overdue first, then Critical → High → Medium → Normal → Future; ties use the earliest pickup." action={<Link href="/reservations/queue" className={linkClass}>Open queue <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.reservations} errorTitle="The priority queue is unavailable">{queue.length ? (
            <div className="divide-y divide-border/40">
              {queue.map((request) => (
                <Link key={request.request_id} href={`/reservations/${request.request_id}`} className="group grid gap-4 px-5 py-4 transition-colors hover:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
                  <div><p className="text-[15px] font-semibold tabular-nums text-foreground tracking-tight">{formatTime(request.pickup_datetime)}</p><p className="mt-0.5 text-xs text-foreground-secondary">{formatDateTime(request.pickup_datetime).split(" · ")[0]}</p></div>
                  <div className="min-w-0 py-1"><p className="text-[15px] font-semibold text-foreground tracking-tight leading-snug line-clamp-2">{request.guest_name || request.reservation_number || `Request #${request.request_id}`}</p><p className="mt-0.5 text-[13px] text-foreground-secondary leading-snug line-clamp-2">{request.pickup_location || "Pickup unrecorded"} → {request.dropoff_location || "Destination unrecorded"}</p></div>
                  <div className="flex items-center gap-2"><StatusBadge status={request.derived_priority || "Future"} entity="priority" />{(request.is_vip || request.is_emergency) && <StatusBadge severity="danger">{request.is_emergency ? "Emergency" : "VIP"}</StatusBadge>}<ArrowRight className="h-5 w-5 ml-1 text-foreground-muted transition-transform group-hover:text-foreground group-hover:translate-x-0.5" /></div>
                </Link>
              ))}
            </div>
          ) : <InlineEmpty icon={Inbox} title="Queue is clear" description="New and upcoming requests will appear here in priority order." variant="relief" />}</FeedState>
        </Panel>

        <Panel title="Trips in motion" description="Current assignment, route and latest GPS freshness from the dispatch feed." action={<Link href="/trips" className={linkClass}>Trips hub <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.dispatches} errorTitle="Active trips are unavailable">{activeTrips.length ? <div className="divide-y divide-border/70">{activeTrips.slice(0, 6).map((dispatch) => {
            const driverName = [dispatch.drivers?.first_name, dispatch.drivers?.last_name].filter(Boolean).join(" ") || "Driver unrecorded";
            const route = dispatch.transportation_requests;
            return <Row key={dispatch.dispatch_id} icon={Navigation} title={`${dispatch.vehicles?.plate_number || "Vehicle unrecorded"} · ${driverName}`} detail={`${route?.pickup_location || dispatch.origin_location?.location_name || "Pickup unrecorded"} → ${route?.dropoff_location || dispatch.destination_location?.location_name || "Destination unrecorded"}`} meta={dispatch.latest_location?.recorded_at ? `GPS ${formatTime(dispatch.latest_location.recorded_at)}` : "No GPS"} status={dispatch.latest_trip?.trip_status || dispatch.status} entity={dispatch.latest_trip ? "trip" : "dispatch"} href={`/dispatch/${dispatch.dispatch_id}`} />;
          })}</div> : <InlineEmpty icon={Navigation} title="No trips in progress" description="Active dispatches will appear here once drivers start their trips." variant="waiting" />}</FeedState>
        </Panel>
      </div>

      <Panel title="Live operations map" description="Latest valid GPS positions for active fleet tracking and rescue missions." action={<Link href="/tracking/live-map" className={linkClass}>Full map <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <FeedState queries={[queries.locations, queries.rescues]} errorTitle="Live GPS positions are unavailable">{validLocations.length || rescues.length ? <div className="h-[420px]"><LiveLocationsMap locations={validLocations} responders={rescues} /></div> : <InlineEmpty icon={MapPin} title="No live positions" description="Map markers appear once trips enter the tracking window with valid coordinates." variant="waiting" />}</FeedState>
      </Panel>
    </div>
  );
}

export function RoleDashboard({ role, employee }) {
  const config = getDashboardConfig(role);
  const enabled = (name) => config.queries.includes(name);
  const today = localDateKey();

  const users = useQuery({ queryKey: ["dashboard-users"], queryFn: () => apiFetch("/api/settings/users"), enabled: enabled("users") });
  const sessions = useQuery({ queryKey: ["dashboard-sessions"], queryFn: () => apiFetch("/api/auth/sessions"), enabled: enabled("sessions") });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => getNotifications(), enabled: enabled("notifications") });
  const audit = useQuery({ queryKey: ["audit-logs", "dashboard"], queryFn: () => getAuditLogs({ limit: 30 }), enabled: enabled("audit") });
  const activity = useQuery({ queryKey: ["system-activity"], queryFn: getSystemActivity, enabled: enabled("activity"), refetchInterval: enabled("activity") ? 60000 : false });
  const health = useQuery({ queryKey: ["system-health"], queryFn: getSystemHealth, enabled: enabled("health"), refetchInterval: enabled("health") ? 60000 : false });
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => getVehicles(), enabled: enabled("vehicles") });
  const drivers = useQuery({ queryKey: ["drivers", "dashboard"], queryFn: () => getDrivers(), enabled: enabled("drivers") });
  const driverStats = useQuery({ queryKey: ["driver-stats"], queryFn: getDriverStats, enabled: enabled("driverStats") });
  const reservations = useQuery({ queryKey: ["transport-requests"], queryFn: () => getTransportRequests(), enabled: enabled("reservations"), refetchInterval: enabled("reservations") ? 30000 : false });
  const dispatches = useQuery({ queryKey: ["dispatches-by-status"], queryFn: getDispatchesByStatus, enabled: enabled("dispatches"), refetchInterval: enabled("dispatches") ? 30000 : false });
  const locations = useQuery({ queryKey: ["latest-locations"], queryFn: getLatestLocations, enabled: enabled("locations"), refetchInterval: enabled("locations") ? 15000 : false });
  // Rescue missions ride along with the live-map panel: a dispatched fleet
  // responder should show on the dispatcher's operations map even with zero
  // active trips. Keyed identically to the full live-map page's query.
  const rescues = useQuery({ queryKey: ["active-rescues"], queryFn: () => apiFetch("/api/incidents/responders/active"), enabled: enabled("locations"), refetchInterval: enabled("locations") ? 30000 : false });
  const assignments = useQuery({ queryKey: ["driver-assignments"], queryFn: () => getDriverAssignments(), enabled: enabled("assignments") });
  const substitutes = useQuery({ queryKey: ["substitute-schedules", today], queryFn: () => getSubstituteSchedules({ date: today }), enabled: enabled("substitutes") });
  const leave = useQuery({ queryKey: ["driver-leave-requests"], queryFn: () => getDriverLeaveRequests(), enabled: enabled("leave") });
  const maintenance = useQuery({ queryKey: ["maintenance-records", "dashboard"], queryFn: () => getMaintenanceRecords(), enabled: enabled("maintenance") });
  const incidents = useQuery({ queryKey: ["incident-summary"], queryFn: () => getIncidentSummary(), enabled: enabled("incidents") });
  const documents = useQuery({ queryKey: ["expiring-documents"], queryFn: getExpiringDocuments, enabled: enabled("documents") });
  const fuelRequests = useQuery({ queryKey: ["fuel-requests"], queryFn: () => getFuelRequests(), enabled: enabled("fuelRequests") });
  const utilization = useQuery({ queryKey: ["fleet-utilization"], queryFn: () => getFleetUtilizationReport(), enabled: enabled("utilization") });
  const driverPerformance = useQuery({ queryKey: ["driver-performance"], queryFn: () => getDriverPerformanceReport(), enabled: enabled("driverPerformance") });

  const queueGroups = useMemo(() => groupQueue(reservations.data || []), [reservations.data]);

  const queries = { users, sessions, notifications, audit, activity, health, vehicles, drivers, driverStats, reservations, dispatches, locations, rescues, assignments, substitutes, leave, maintenance, incidents, documents, fuelRequests, utilization, driverPerformance };

  // One authored entrance moment for the whole dashboard: a single gentle
  // fade-up on mount (reduced-motion collapses it via MotionConfig).
  return (
    <PageEntrance className="space-y-6">
      <HeroHeader
        icon={BarChart3}
        title={config.title}
        badge={role ? role.replace(/_/g, " ").toUpperCase() : "DASHBOARD"}
        description={`Welcome${employee ? `, ${employee.first_name}` : ""}. ${config.description}`}
      />

      {role === "system_admin" && <SystemAdminDashboard queries={queries} />}
      {role === "admin" && <AdminDashboard queries={queries} />}
      {role === "fleet_manager" && <FleetManagerDashboard queries={queries} />}
      {role === "dispatcher" && <DispatcherDashboard queries={queries} queueGroups={queueGroups} />}
    </PageEntrance>
  );
}
