"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
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
  Clock3,
  FileWarning,
  Fuel,
  Inbox,
  KeyRound,
  MapPin,
  Navigation,
  ShieldCheck,
  Truck,
  UserCheck,
  UserCog,
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
import { getMaintenanceRecords } from "@/services/maintenance.service";
import { getNotifications } from "@/services/notification.service";
import { getSubstituteSchedules } from "@/services/substitute-driver.service";
import { getSystemActivity } from "@/services/system.service";
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
import { isValidCoordinate } from "@/lib/gps";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { CardSkeleton, StatsGridSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { getDashboardConfig } from "@/components/dashboard/dashboard-configs";

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

function InlineEmpty({ icon = Inbox, title, description }) {
  return <EmptyState icon={icon} title={title} description={description} className="py-12" />;
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
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-foreground-secondary group-hover:text-foreground transition-colors">{row.label}</span>
            <span className="tabular-nums font-semibold text-foreground">{row.value}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-hover ring-1 ring-inset ring-border/50 shadow-inner">
            <div className={cn("h-full rounded-full transition-all duration-700 ease-out", row.color || "bg-primary")} style={{ width: `${Number(row.value) ? Math.max(3, (Number(row.value) / max) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DistributionMeter({ items }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + (Number(item.value) || 0), 0));
  return (
    <div className="space-y-5 p-5">
      <div className="flex h-3 w-full overflow-hidden rounded-full ring-1 ring-inset ring-border/50 shadow-inner bg-hover/50">
        {items.map((item) => {
          const val = Number(item.value) || 0;
          if (val === 0) return null;
          return (
            <div
              key={item.label}
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

function SystemAdminDashboard({ queries }) {
  const users = queries.users.data?.rows || [];
  const sessions = queries.sessions.data?.sessions || [];
  const notifications = queries.notifications.data || [];
  const activity = queries.activity.data || {};
  const audit = queries.audit.data || {};
  const counters = activity.counters || {};
  const activeUsers = users.filter((user) => !user.deleted_at && user.status !== "Inactive");
  const disabledUsers = users.length - activeUsers.length;
  const roleCounts = Object.entries(users.reduce((acc, user) => {
    const roleName = user.role_name || "Unassigned";
    acc[roleName] = (acc[roleName] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const failedJobs = Number(counters.integration_failed || 0) + Number(counters.automation_failed || 0);
  const unread = notifications.filter((item) => !item.is_read).length;

  if (queries.users.isLoading || queries.activity.isLoading) return <LoadingDashboard />;

  return (
    <div className="space-y-5">
      <QueryErrors items={[
        { query: queries.users, title: "Account posture could not be loaded" },
        { query: queries.sessions, title: "Your sessions could not be loaded" },
        { query: queries.activity, title: "Platform activity could not be loaded" },
        { query: queries.audit, title: "Audit activity could not be loaded" },
        { query: queries.notifications, title: "Notifications could not be loaded" },
      ]} />

      {(failedJobs > 0 || unread > 0) && (
        <div className="flex flex-col gap-3 rounded-[14px] bg-danger-bg px-5 py-4 text-danger-700 sm:flex-row sm:items-center border border-danger/20 shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-danger"></div>
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="flex-1 text-[13px] font-medium tracking-tight">
            {failedJobs > 0 ? `${failedJobs} integration or automation failure${failedJobs === 1 ? "" : "s"} in the last 24 hours.` : ""}
            {failedJobs > 0 && unread > 0 ? " " : ""}
            {unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"} need review.` : ""}
          </p>
          <Link href="/settings/ai/logs" className={linkClass}>Review system logs <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      )}

      <StatGrid cols={4}>
        <StatCard icon={UserCheck} label="Active accounts" value={queries.users.isError ? "—" : activeUsers.length} trend="Accounts currently allowed to sign in" tone="success" />
        <StatCard icon={UserCog} label="Disabled accounts" value={queries.users.isError ? "—" : disabledUsers} trend="Inactive or soft-deleted accounts" tone={disabledUsers ? "warning" : "neutral"} />
        <StatCard icon={ShieldCheck} label="Roles represented" value={queries.users.isError ? "—" : roleCounts.length} trend="Current access-role coverage" tone="primary" />
        <StatCard icon={KeyRound} label="Your active sessions" value={queries.sessions.isLoading || queries.sessions.isError ? "—" : sessions.length} trend="Web and mobile sessions for this account" tone="info" />
      </StatGrid>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.75fr)]">
        <Panel title="Platform activity" description="Newest integration and automation events; failures stay visible instead of being counted as success." action={<Link href="/settings/ai/logs" className={linkClass}>Open logs <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.activity} errorTitle="Platform activity is unavailable">{(activity.recent || []).length ? (
            <div className="divide-y divide-border/70">
              {activity.recent.slice(0, 8).map((item) => {
                const eventStatus = String(item.status || "").toLowerCase();
                const health = eventStatus === "failed" ? "Critical" : ["processed", "success"].includes(eventStatus) ? "Healthy" : "Medium";
                const needsPulse = health === "Critical";
                return (
                <Row
                  key={`${item.source}-${item.id}`}
                  icon={item.source === "integration" ? Activity : Brain}
                  title={`${item.source === "integration" ? "Integration" : "Automation"} · ${item.type || "Event"}`}
                  detail={item.error_message || item.detail || "No additional detail recorded"}
                  meta={formatDateTime(item.created_at)}
                  status={health}
                  entity="risk"
                  pulse={needsPulse ? "danger" : undefined}
                />
              );})}
            </div>
          ) : <InlineEmpty icon={Activity} title="No platform events recorded" description="Integration and automation activity will appear here." />}</FeedState>
        </Panel>

        <Panel title="Account posture" description="Role distribution across all employee accounts.">
          <FeedState queries={queries.users} errorTitle="Account posture is unavailable">{roleCounts.length ? (
            <div className="divide-y divide-border/70">
              {roleCounts.map(([name, count]) => (
                <Row key={name} icon={Users} title={name.replace(/_/g, " ")} detail={`${count} account${count === 1 ? "" : "s"}`} />
              ))}
            </div>
          ) : <InlineEmpty icon={Users} title="No accounts found" description="Create an employee account to establish role coverage." />}</FeedState>
        </Panel>
      </div>

      <Panel title="Recent security and change audit" description="Actor, action, target and timestamp from the immutable audit trail." action={<Link href="/system/audit" className={linkClass}>Open full audit <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <FeedState queries={queries.audit} errorTitle="Audit activity is unavailable">{(audit.logs || []).length ? (
          <div className="divide-y divide-border/70">
            {audit.logs.slice(0, 8).map((item) => (
              <Row
                key={item.log_id}
                icon={ShieldCheck}
                title={`${item.action || "Changed"} · ${item.resource || "resource"}${item.resource_id ? ` #${item.resource_id}` : ""}`}
                detail={[item.first_name, item.last_name].filter(Boolean).join(" ") || item.email || "System process"}
                meta={formatDateTime(item.created_at)}
              />
            ))}
          </div>
        ) : <InlineEmpty icon={ShieldCheck} title="No audit events recorded" description="Tracked system changes will appear here." />}</FeedState>
      </Panel>

      <LinkRail items={[
        { label: "Manage users", href: "/settings/users", icon: UserCog },
        { label: "API and integrations", href: "/settings/api", icon: KeyRound },
        { label: "Notification center", href: "/notifications", icon: Bell },
        { label: "Audit log", href: "/system/audit", icon: ShieldCheck },
      ]} />
    </div>
  );
}

function AdminDashboard({ queries }) {
  const vehicles = queries.vehicles.data || [];
  const drivers = queries.driverStats.data || {};
  const requests = queries.reservations.data || [];
  const dispatches = queries.dispatches.data || {};
  const maintenance = queries.maintenance.data || [];
  const incidents = queries.incidents.data || {};
  const documents = queries.documents.data || { items: [], totals: {} };
  const fuel = queries.fuelRequests.data || { rows: [], counts: {} };
  const openRequests = requests.filter((request) => !["Completed", "Cancelled"].includes(request.fleet_status));
  const completedToday = (dispatches.completed || []).filter((dispatch) => isToday(dispatch.updated_at || dispatch.scheduled_arrival)).length;
  const activeMaintenance = maintenance.filter((item) => ["Scheduled", "In Progress"].includes(item.status));
  const vehicleCounts = vehicles.reduce((acc, vehicle) => {
    const status = vehicle.vehicle_status || "Unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const attention = [
    { label: "Incident attention queue", value: queries.incidents.isLoading || queries.incidents.isError ? "—" : Number(incidents.attention || 0), sortValue: Number(incidents.attention || 0), href: "/incidents", icon: AlertTriangle },
    { label: "Pending reassignment", value: queries.dispatches.isError ? "—" : (dispatches.pendingReassignment || []).length, sortValue: (dispatches.pendingReassignment || []).length, href: "/dispatch", icon: Navigation },
    { label: "Expired / 30-day documents", value: queries.documents.isLoading || queries.documents.isError ? "—" : Number(documents.totals?.expired || 0) + Number(documents.totals?.expiring30 || 0), sortValue: Number(documents.totals?.expired || 0) + Number(documents.totals?.expiring30 || 0), href: "/fleet/documents", icon: FileWarning },
    { label: "Active maintenance work", value: queries.maintenance.isLoading || queries.maintenance.isError ? "—" : activeMaintenance.length, sortValue: activeMaintenance.length, href: "/maintenance", icon: Wrench },
    { label: "Pending fuel requests", value: queries.fuelRequests.isLoading || queries.fuelRequests.isError ? "—" : Number(fuel.counts?.pending || 0), sortValue: Number(fuel.counts?.pending || 0), href: "/fuel", icon: Fuel },
  ].sort((a, b) => b.sortValue - a.sortValue);

  if (queries.vehicles.isLoading || queries.dispatches.isLoading || queries.reservations.isLoading) return <LoadingDashboard />;

  return (
    <div className="space-y-5">
      <QueryErrors items={[
        { query: queries.vehicles, title: "Fleet status could not be loaded" },
        { query: queries.driverStats, title: "Driver status could not be loaded" },
        { query: queries.reservations, title: "Request volume could not be loaded" },
        { query: queries.dispatches, title: "Dispatch progress could not be loaded" },
        { query: queries.maintenance, title: "Maintenance attention could not be loaded" },
        { query: queries.incidents, title: "Incident attention could not be loaded" },
        { query: queries.documents, title: "Document compliance could not be loaded" },
        { query: queries.fuelRequests, title: "Fuel requests could not be loaded" },
      ]} />

      <Panel title="Operational attention" description="Exceptions that may block service, ordered by current volume." action={<Link href="/notifications" className={linkClass}>Notification center <ArrowRight className="h-3.5 w-3.5" /></Link>} className="border-danger/20 ring-1 ring-danger/10">
        <div className="grid divide-y divide-border/70 md:grid-cols-5 md:divide-x md:divide-y-0 bg-danger/5">
          {attention.map((item) => {
            const hasIssues = item.value !== "—" && item.value > 0;
            return (
              <Link key={item.label} href={item.href} className="group flex flex-col items-center justify-center gap-2 p-5 transition-all hover:bg-hover/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                <div className="relative">
                  <item.icon className={cn("h-5 w-5 transition-transform group-hover:scale-110", item.value === "—" ? "text-foreground-muted" : hasIssues ? "text-danger" : "text-success")} />
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
        <StatCard icon={Inbox} label="Open requests" value={queries.reservations.isError ? "—" : openRequests.length} trend="Not completed or cancelled" tone="warning" />
        <StatCard icon={CalendarClock} label="Scheduled dispatches" value={queries.dispatches.isError ? "—" : (dispatches.scheduled || []).length} trend="Committed and waiting to depart" tone="info" />
        <StatCard icon={Navigation} label="Trips in progress" value={queries.dispatches.isError ? "—" : (dispatches.inProgress || []).length} trend="Currently underway" tone="primary" />
        <StatCard icon={CheckCircle2} label="Completed today" value={queries.dispatches.isError ? "—" : completedToday} trend="Dispatches finished today" tone="success" />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Fleet health" description="Current vehicle statuses; this is an operational overview, not a dispatch eligibility check." action={<Link href="/fleet/vehicles" className={linkClass}>Fleet register <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.vehicles} errorTitle="Fleet health is unavailable"><DistributionMeter items={[
            { label: "Available", value: vehicleCounts.Available || 0, color: "bg-success" },
            { label: "Reserved", value: vehicleCounts.Reserved || 0, color: "bg-info" },
            { label: "In use", value: vehicleCounts["In Use"] || 0, color: "bg-primary" },
            { label: "Under maint.", value: vehicleCounts["Under Maintenance"] || 0, color: "bg-warning" },
            { label: "Decommissioned", value: vehicleCounts.Decommissioned || 0, color: "bg-danger" },
          ]} /></FeedState>
        </Panel>
        <Panel title="Workforce coverage" description="Driver status across the whole operation." action={<Link href="/drivers" className={linkClass}>Driver roster <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.driverStats} errorTitle="Driver coverage is unavailable"><DistributionMeter items={[
            { label: "Available", value: drivers.available || 0, color: "bg-success" },
            { label: "On trip", value: drivers.onTrip || 0, color: "bg-primary" },
            { label: "Off duty", value: drivers.offDuty || 0, color: "bg-border" },
            { label: "On leave", value: drivers.onLeave || 0, color: "bg-info" },
            { label: "Suspended", value: drivers.suspended || 0, color: "bg-danger" },
          ]} /></FeedState>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
        <Panel title="Maintenance and incident pressure" description="The newest active maintenance records alongside incident severity totals." action={<Link href="/maintenance" className={linkClass}>Open maintenance <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.maintenance} errorTitle="Maintenance attention is unavailable">{activeMaintenance.length ? (
            <div className="divide-y divide-border/70">
              {activeMaintenance.slice(0, 6).map((item) => (
                <Row key={item.maintenance_id} icon={Wrench} title={`${item.vehicles?.plate_number || "Vehicle"} · ${item.maintenance_type || "Maintenance"}`} detail={item.description || `Scheduled ${formatDateTime(item.maintenance_date)}`} status={item.status} entity="maintenance" />
              ))}
            </div>
          ) : <InlineEmpty icon={Wrench} title="No active maintenance work" description="Scheduled or in-progress records will appear here." />}</FeedState>
        </Panel>
        <Panel title="Incident risk" description="Counts from the current incident attention summary.">
          <FeedState queries={queries.incidents} errorTitle="Incident risk is unavailable"><StatusBars rows={[
            { label: "Open", value: incidents.open || 0, color: "bg-warning" },
            { label: "Critical / major open", value: incidents.critical_major_open || 0, color: "bg-danger" },
            { label: "Assistance open", value: incidents.assistance_open || 0, color: "bg-info" },
            { label: "Maintenance pending", value: incidents.maintenance_pending || 0, color: "bg-primary" },
          ]} /></FeedState>
        </Panel>
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
      ]} />

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
        ) : <InlineEmpty icon={UserCheck} title="No active pairings" description="Assign designated drivers before planning normal vehicle coverage." />}</FeedState>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Maintenance pressure" description="Active work ordered by the API’s current maintenance date." action={<Link href="/maintenance" className={linkClass}>Maintenance register <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.maintenance} errorTitle="Maintenance pressure is unavailable">{activeMaintenance.length ? <div className="divide-y divide-border/70">{activeMaintenance.slice(0, 6).map((item) => <Row key={item.maintenance_id} icon={Wrench} title={`${item.vehicles?.plate_number || "Vehicle"} · ${item.maintenance_type || "Maintenance"}`} detail={item.description || "No work description recorded"} meta={formatDateTime(item.maintenance_date)} status={item.status} entity="maintenance" />)}</div> : <InlineEmpty icon={Wrench} title="No active maintenance work" description="Scheduled and in-progress work will appear here." />}</FeedState>
        </Panel>
        <Panel title="Upcoming fleet schedule" description="Nearest scheduled departures and reassignment exceptions." action={<Link href="/dispatch" className={linkClass}>Dispatch board <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState queries={queries.dispatches} errorTitle="The fleet schedule is unavailable">{nextDispatches.length ? <div className="divide-y divide-border/70">{nextDispatches.map((item) => <Row key={item.dispatch_id} icon={CalendarClock} title={`${item.vehicles?.plate_number || "Unassigned vehicle"} · ${item.transportation_requests?.guest_name || item.routes?.route_name || "Scheduled service"}`} detail={`${item.transportation_requests?.pickup_location || item.origin_location?.location_name || "Pickup unrecorded"} → ${item.transportation_requests?.dropoff_location || item.destination_location?.location_name || "Destination unrecorded"}`} meta={formatDateTime(item.scheduled_departure)} status={item.status} entity="dispatch" href={`/dispatch/${item.dispatch_id}`} />)}</div> : <InlineEmpty icon={CalendarClock} title="No upcoming dispatches" description="Scheduled departures will appear here." />}</FeedState>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Document compliance" description="All expired and near-expiry records."><FeedState queries={queries.documents} errorTitle="Document compliance is unavailable"><DistributionMeter items={[{ label: "Expired", value: documents.totals?.expired || 0, color: "bg-danger" }, { label: "Due in 30 days", value: documents.totals?.expiring30 || 0, color: "bg-warning" }, { label: "Due in 31–90 days", value: documents.totals?.expiring90 || 0, color: "bg-info" }]} /></FeedState></Panel>
        <Panel title="Workforce exceptions" description="Approved leave and substitute coverage today."><FeedState queries={[queries.leave, queries.substitutes]} errorTitle="Workforce exceptions are unavailable"><DistributionMeter items={[{ label: "Approved leave", value: approvedLeave, color: "bg-warning" }, { label: "Substitute schedules", value: substitutes.length, color: "bg-info" }, { label: "Uncovered pairings", value: pairRows.length - readyPairs, color: "bg-danger" }]} /></FeedState></Panel>
        <Panel title="Fuel request status" description="Current request workflow volume."><FeedState queries={queries.fuelRequests} errorTitle="Fuel request status is unavailable"><DistributionMeter items={[{ label: "Pending", value: fuel.counts?.pending || 0, color: "bg-warning" }, { label: "Approved", value: fuel.counts?.approved || 0, color: "bg-info" }, { label: "Fulfilled", value: fuel.counts?.fulfilled || 0, color: "bg-success" }]} /></FeedState></Panel>
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
  const validLocations = (queries.locations.data || []).filter((location) => isValidCoordinate(location?.latitude, location?.longitude));
  const queue = [...queueGroups.today, ...queueGroups.upcoming].sort(compareByPriority).slice(0, 10);
  const reviewCount = queueGroups.today.length + queueGroups.upcoming.filter((request) => request.derived_priority === "Overdue").length;
  const timeline = [...queueGroups.today, ...queueGroups.assigned, ...queueGroups.upcoming]
    .sort((a, b) => new Date(a.pickup_datetime) - new Date(b.pickup_datetime))
    .slice(0, 6);
  const activeTrips = dispatches.inProgress || [];
  const pendingReassignment = dispatches.pendingReassignment || [];
  const availableVehicles = vehicles.filter((vehicle) => vehicle.vehicle_status === "Available").length;

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

      <StatGrid cols={4}>
        <StatCard icon={Inbox} label="Needs dispatch review" value={queries.reservations.isError ? "—" : reviewCount} trend="Today and overdue, priority-sorted" tone="warning" />
        <StatCard icon={CalendarClock} label="Assigned next" value={queries.reservations.isError ? "—" : queueGroups.assigned.length} trend="Committed requests waiting to start" tone="info" />
        <StatCard icon={Navigation} label="Trips in progress" value={queries.dispatches.isError ? "—" : activeTrips.length} trend="Active dispatches" tone="primary" />
        <StatCard icon={CheckCircle2} label="Current resource pulse" value={queries.vehicles.isLoading || queries.driverStats.isLoading || queries.vehicles.isError || queries.driverStats.isError ? "—" : `${availableVehicles} / ${drivers.available || 0}`} trend="Available vehicles / drivers; final choices are window-validated" tone="success" />
      </StatGrid>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.7fr)]">
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
          ) : <InlineEmpty icon={Inbox} title="No requests awaiting dispatch" description="New and upcoming requests will appear here in priority order." />}</FeedState>
        </Panel>

        <Panel title="Pickup timeline" description="Nearest active pickup windows across today and upcoming work.">
          <FeedState queries={queries.reservations} errorTitle="The pickup timeline is unavailable">{timeline.length ? <div className="divide-y divide-border/70">{timeline.map((request) => <Row key={request.request_id} icon={Clock3} title={request.guest_name || request.reservation_number || `Request #${request.request_id}`} detail={request.pickup_location || "Pickup unrecorded"} meta={formatDateTime(request.pickup_datetime)} status={request.fleet_status} entity="reservation" href={`/reservations/${request.request_id}`} />)}</div> : <InlineEmpty icon={Clock3} title="No pickups scheduled" description="Scheduled pickup windows will appear here." />}</FeedState>
        </Panel>
      </div>

      <Panel title="Trips in motion" description="Current assignment, route and latest GPS freshness from the dispatch feed." action={<Link href="/trips" className={linkClass}>Trips hub <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <FeedState queries={queries.dispatches} errorTitle="Active trips are unavailable">{activeTrips.length ? <div className="divide-y divide-border/70">{activeTrips.slice(0, 6).map((dispatch) => {
          const driverName = [dispatch.drivers?.first_name, dispatch.drivers?.last_name].filter(Boolean).join(" ") || "Driver unrecorded";
          const route = dispatch.transportation_requests;
          return <Row key={dispatch.dispatch_id} icon={Navigation} title={`${dispatch.vehicles?.plate_number || "Vehicle unrecorded"} · ${driverName}`} detail={`${route?.pickup_location || dispatch.origin_location?.location_name || "Pickup unrecorded"} → ${route?.dropoff_location || dispatch.destination_location?.location_name || "Destination unrecorded"}`} meta={dispatch.latest_location?.recorded_at ? `GPS ${formatTime(dispatch.latest_location.recorded_at)}` : "No GPS"} status={dispatch.latest_trip?.trip_status || dispatch.status} entity={dispatch.latest_trip ? "trip" : "dispatch"} href={`/dispatch/${dispatch.dispatch_id}`} />;
        })}</div> : <InlineEmpty icon={Navigation} title="No trips in progress" description="Active dispatches will appear here." />}</FeedState>
      </Panel>

      <Panel title="Live operations map" description="Latest valid GPS positions for active fleet tracking." action={<Link href="/tracking/live-map" className={linkClass}>Full map <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <FeedState queries={queries.locations} errorTitle="Live GPS positions are unavailable">{validLocations.length ? <div className="h-[420px]"><LiveLocationsMap locations={validLocations} /></div> : <InlineEmpty icon={MapPin} title="No valid GPS positions" description="Map markers appear only when a valid latitude and longitude are recorded." />}</FeedState>
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
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => getVehicles(), enabled: enabled("vehicles") });
  const drivers = useQuery({ queryKey: ["drivers", "dashboard"], queryFn: () => getDrivers(), enabled: enabled("drivers") });
  const driverStats = useQuery({ queryKey: ["driver-stats"], queryFn: getDriverStats, enabled: enabled("driverStats") });
  const reservations = useQuery({ queryKey: ["transport-requests"], queryFn: () => getTransportRequests(), enabled: enabled("reservations"), refetchInterval: enabled("reservations") ? 30000 : false });
  const dispatches = useQuery({ queryKey: ["dispatches-by-status"], queryFn: getDispatchesByStatus, enabled: enabled("dispatches"), refetchInterval: enabled("dispatches") ? 30000 : false });
  const locations = useQuery({ queryKey: ["latest-locations"], queryFn: getLatestLocations, enabled: enabled("locations"), refetchInterval: enabled("locations") ? 15000 : false });
  const assignments = useQuery({ queryKey: ["driver-assignments"], queryFn: () => getDriverAssignments(), enabled: enabled("assignments") });
  const substitutes = useQuery({ queryKey: ["substitute-schedules", today], queryFn: () => getSubstituteSchedules({ date: today }), enabled: enabled("substitutes") });
  const leave = useQuery({ queryKey: ["driver-leave-requests"], queryFn: () => getDriverLeaveRequests(), enabled: enabled("leave") });
  const maintenance = useQuery({ queryKey: ["maintenance-records", "dashboard"], queryFn: () => getMaintenanceRecords(), enabled: enabled("maintenance") });
  const incidents = useQuery({ queryKey: ["incident-summary"], queryFn: () => getIncidentSummary(), enabled: enabled("incidents") });
  const documents = useQuery({ queryKey: ["expiring-documents"], queryFn: getExpiringDocuments, enabled: enabled("documents") });
  const fuelRequests = useQuery({ queryKey: ["fuel-requests"], queryFn: () => getFuelRequests(), enabled: enabled("fuelRequests") });

  const queueGroups = useMemo(() => groupQueue(reservations.data || []), [reservations.data]);

  const queries = { users, sessions, notifications, audit, activity, vehicles, drivers, driverStats, reservations, dispatches, locations, assignments, substitutes, leave, maintenance, incidents, documents, fuelRequests };

  return (
    <div className="space-y-6">
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
    </div>
  );
}
