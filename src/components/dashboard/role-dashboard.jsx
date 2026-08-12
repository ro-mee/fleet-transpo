"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  BarChart3,
  Activity,
  MapPin,
  TrendingUp,
  Bell,
  Inbox,
  ChevronRight,
  Truck,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { getAiInsights } from "@/services/ai.service";
import { getVehicles } from "@/services/vehicle.service";
import { getDriverStats } from "@/services/driver.service";
import { getTrips, getActiveTrips, getLatestLocations } from "@/services/trip.service";
import { getTransportRequests } from "@/services/transport.service";
import { getNotifications } from "@/services/notification.service";
import { getAuditLogs } from "@/services/audit.service";
import { getSystemActivity } from "@/services/system.service";
import { getUvvrpPolicy } from "@/services/settings.service";
import { isRestricted } from "@/lib/uvvrp/policy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatsGridSkeleton, CardSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getDashboardConfig } from "@/components/dashboard/dashboard-configs";

const tooltipStyle = {
  background: "var(--sf)",
  border: "1px solid var(--br)",
  borderRadius: "8px",
  fontSize: "12px",
};

const PIE_COLORS = {
  Available: "#10b981",
  "In Use": "#f59e0b",
  "Under Maintenance": "#ef4444",
  "Out of Service": "#ef4444",
  "Registration Expired": "#ef4444",
  Unknown: "#9ca3af",
};

const OPEN_STATUSES = ["pending", "under review", "approved", "scheduled", "assigned", "in progress"];

const LiveLocationsMap = dynamic(
  () => import("@/components/maps/live-locations-map"),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-hover" /> }
);

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + formatTime(value);
}

export function RoleDashboard({ role, employee }) {
  const router = useRouter();
  const config = getDashboardConfig(role);
  const q = config.queries || [];

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
    enabled: q.includes("vehicles"),
  });
  const { data: driverStats = {} } = useQuery({
    queryKey: ["driver-stats"],
    queryFn: () => getDriverStats(),
    enabled: q.includes("driverStats"),
  });
  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: () => getTrips(),
    enabled: q.includes("trips"),
  });
  const { data: activeTrips = [] } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    enabled: q.includes("activeTrips"),
    refetchInterval: q.includes("activeTrips") ? 30000 : undefined,
  });
  const { data: reservations = [] } = useQuery({
    queryKey: ["transport-requests"],
    queryFn: () => getTransportRequests(),
    enabled: q.includes("reservations"),
  });
  const { data: locations = [] } = useQuery({
    queryKey: ["latest-locations"],
    queryFn: () => getLatestLocations(),
    enabled: q.includes("locations"),
    refetchInterval: q.includes("locations") ? 15000 : undefined,
  });
  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => getAiInsights(),
    enabled: q.includes("insights"),
  });
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getNotifications(),
    enabled: q.includes("notifications"),
  });
  const { data: uvvrpPolicy } = useQuery({
    queryKey: ["uvvrp-policy"],
    queryFn: getUvvrpPolicy,
  });
  const { data: auditData } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => getAuditLogs({ limit: 200 }),
    enabled: q.includes("audit"),
  });
  const { data: activityData } = useQuery({
    queryKey: ["system-activity"],
    queryFn: () => getSystemActivity(),
    enabled: q.includes("activity"),
  });

  const insights = useMemo(() => {
    if (Array.isArray(insightsData)) return insightsData;
    if (Array.isArray(insightsData?.insights)) return insightsData.insights;
    return [];
  }, [insightsData]);

  const restrictedPlates = useMemo(() => {
    const set = new Set();
    if (!uvvrpPolicy?.enabled) return set;
    vehicles.forEach((v) => {
      if (v.plate_number && isRestricted(v.plate_number, uvvrpPolicy, new Date())) set.add(v.plate_number);
    });
    return set;
  }, [uvvrpPolicy, vehicles]);

  const stats = useMemo(() => {
    const available = vehicles.filter((v) => v.vehicle_status === "Available" && !restrictedPlates.has(v.plate_number)).length;
    const maintenance = vehicles.filter((v) => v.vehicle_status === "Under Maintenance").length;
    const utilization = vehicles.length ? Math.round((available / vehicles.length) * 100) : 0;
    const tripsToday = trips.filter((t) => isToday(t.start_time) || isToday(t.created_at)).length;
    const statusLower = (r) => (r.fleet_status || "").toLowerCase();
    const openRequests = reservations.filter((r) => OPEN_STATUSES.includes(statusLower(r))).length;
    const todayRequests = reservations.filter((r) => isToday(r.pickup_datetime) || isToday(r.created_at)).length;
    return {
      totalVehicles: vehicles.length,
      available,
      maintenance,
      utilization: `${utilization}%`,
      driversOnDuty: driverStats.total ?? 0,
      driversAvailable: driverStats.available ?? 0,
      activeTrips: activeTrips.length,
      tripsToday,
      openRequests,
      todayRequests,
      unreadNotifications: notifications.filter((n) => !n.is_read).length,
      integrationOk: activityData?.counters?.integration_ok ?? 0,
      integrationFailed: activityData?.counters?.integration_failed ?? 0,
      automationOk: activityData?.counters?.automation_ok ?? 0,
      automationFailed: activityData?.counters?.automation_failed ?? 0,
      notifications24h: activityData?.counters?.notifications_24h ?? 0,
      auditTotal: auditData?.total ?? 0,
    };
  }, [vehicles, driverStats, trips, activeTrips, reservations, notifications, activityData, auditData, restrictedPlates]);

  const reservationTrend = useMemo(() => {
    const days = 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), count: 0 });
    }
    reservations.forEach((r) => {
      const created = r.created_at || r.reservation_date;
      if (!created) return;
      const key = created.slice(0, 10);
      if (map.has(key)) map.get(key).count += 1;
    });
    return Array.from(map.values());
  }, [reservations]);

  const fleetStatus = useMemo(() => {
    const counts = {};
    vehicles.forEach((v) => {
      const s = v.vehicle_status || "Unknown";
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [vehicles]);

  const activities = useMemo(() => {
    return [...trips]
      .filter((t) => t.start_time || t.created_at)
      .sort((a, b) => new Date(b.start_time || b.created_at) - new Date(a.start_time || a.created_at))
      .slice(0, 6)
      .map((t) => {
        const plate = t.vehicles?.plate_number || "—";
        const driver = t.drivers
          ? `${t.drivers.first_name || ""} ${t.drivers.last_name || ""}`.trim() || null
          : null;
        const status = (t.trip_status || "").toLowerCase();
        let action;
        let type = "info";
        if (status === "completed") { action = `Trip #${t.trip_id} completed`; type = "success"; }
        else if (status === "cancelled") { action = `Trip #${t.trip_id} cancelled`; type = "danger"; }
        else if (status === "en route") { action = `Trip #${t.trip_id} en route`; type = "warning"; }
        else if (status) { action = `Trip #${t.trip_id} ${status}`; }
        else { action = `Trip #${t.trip_id} scheduled`; }
        const detail = driver ? `${plate} · ${driver}` : plate;
        return { action, detail, time: formatTime(t.start_time || t.created_at), type };
      });
  }, [trips]);

  const queueItems = useMemo(() => {
    return reservations
      .filter((r) => OPEN_STATUSES.includes((r.fleet_status || "").toLowerCase()))
      .sort((a, b) => new Date(b.pickup_datetime || b.created_at || 0) - new Date(a.pickup_datetime || a.created_at || 0))
      .slice(0, 6);
  }, [reservations]);

  const availableVehicles = useMemo(
    () => vehicles.filter((v) => v.vehicle_status === "Available").slice(0, 8),
    [vehicles]
  );

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={BarChart3}
        title={config.title}
        badge={role ? role.replace(/_/g, " ").toUpperCase() : "DASHBOARD"}
        description={`Welcome${employee ? `, ${employee.first_name}` : ""}. ${config.description}`}
      />

      {vehiclesLoading && q.includes("vehicles") ? (
        <StatsGridSkeleton count={config.kpis.length} gridClass="md:grid-cols-2 lg:grid-cols-4" />
      ) : (
        <StatGrid cols={Math.min(config.kpis.length, 4)}>
          {config.kpis.map((kpi) => (
            <StatCard
              key={kpi.label}
              icon={kpi.icon}
              label={kpi.label}
              value={stats[kpi.stat] ?? "—"}
              tone={kpi.tone}
              trend={kpi.trend}
              onClick={kpi.href ? () => router.push(kpi.href) : undefined}
            />
          ))}
        </StatGrid>
      )}

      {config.quickActions?.length > 0 && (
        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Activity className="w-4 h-4 text-primary" /> Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3">
              {config.quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="inline-flex items-center gap-2 rounded-3xl border border-border/80 bg-surface px-4 py-2.5 text-xs font-bold text-foreground hover:border-primary/50 hover:bg-hover/50 hover:shadow-xs transition-all"
                >
                  <action.icon className="h-4 w-4 text-primary" />
                  {action.label}
                  <ChevronRight className="h-3.5 w-3.5 text-foreground-muted" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {config.sections.map((section, idx) => {
          const key = `${section.type}-${idx}`;
          return (
            <div
              key={key}
              className={cn(
                section.span === 2 && "lg:col-span-2",
                section.span === 3 && "lg:col-span-3"
              )}
            >
              <DashboardSection
                section={section.type}
                data={{
                  reservationTrend,
                  fleetStatus,
                  locations,
                  activities,
                  queueItems,
                  availableVehicles,
                  restrictedPlates,
                  notifications,
                  insights,
                  insightsLoading,
                  activityRecent: activityData?.recent ?? [],
                  auditLogs: auditData?.logs ?? [],
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, extra, flush = false }) {
  return (
    <Card className="h-full border-0 shadow-xs rounded-3xl overflow-hidden flex flex-col">
      <CardHeader className="flex-row items-center justify-between pb-3.5 border-b border-border/60 bg-muted/20">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </CardTitle>
        {extra}
      </CardHeader>
      <CardContent className={cn(flush ? "p-0" : "p-5", "flex-1")}>{children}</CardContent>
    </Card>
  );
}

function DashboardSection({ section, data }) {
  switch (section) {
    case "area":
      return (
        <SectionCard title="Reservation Trends" icon={BarChart3} extra={<span className="text-xs text-foreground-muted">last 14 days</span>}>
          <div className="h-[260px]">
            {data.reservationTrend.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height="100%" debounce={200}>
                <AreaChart data={data.reservationTrend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={2} fill="url(#trendFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No reservations yet"
                description="Reservation activity will appear here once bookings start coming in."
                className="py-16"
              />
            )}
          </div>
        </SectionCard>
      );
    case "pie":
      return (
        <SectionCard title="Fleet Status" icon={Activity}>
          <div className="h-[260px]">
            {data.fleetStatus.length ? (
              <ResponsiveContainer width="100%" height="100%" debounce={200}>
                <PieChart>
                  <Pie data={data.fleetStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2}>
                    {data.fleetStatus.map((entry) => (
                      <Cell key={entry.name} fill={PIE_COLORS[entry.name] || "#9ca3af"} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={Activity}
                title="No vehicles tracked"
                description="Add vehicles to your fleet to see status distribution."
                className="py-16"
              />
            )}
          </div>
        </SectionCard>
      );
    case "map":
      return (
        <SectionCard title="Live GPS Tracking" icon={MapPin} extra={<span className="text-xs text-foreground-muted">{data.locations.length} vehicles on the map</span>}>
          <div className="h-[280px] rounded-lg overflow-hidden bg-hover">
            {data.locations.length ? (
              <LiveLocationsMap locations={data.locations} />
            ) : (
              <EmptyState
                icon={MapPin}
                title="No live locations"
                description="Vehicle positions will appear here when active trips report GPS coordinates."
                className="h-full py-16"
              />
            )}
          </div>
        </SectionCard>
      );
    case "activity":
      return (
        <SectionCard title="Recent Activity" icon={Activity} flush>
          {data.activities.length ? (
            <div className="divide-y divide-border">
              {data.activities.map((activity, i) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3 hover:bg-hover transition-colors">
                  <span
                    className={cn(
                      "mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0",
                      activity.type === "success" ? "bg-success"
                        : activity.type === "warning" ? "bg-warning"
                        : activity.type === "danger" ? "bg-danger"
                        : "bg-info"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{activity.action}</p>
                    <p className="text-xs text-foreground-muted truncate">{activity.detail}</p>
                  </div>
                  <span className="text-[11px] text-foreground-muted flex-shrink-0">{activity.time}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Activity}
              title="No activity yet"
              description="Recent trips will show up here as they start."
              className="py-16"
            />
          )}
        </SectionCard>
      );
    case "queue":
      return (
        <SectionCard
          title="Open Requests"
          icon={Inbox}
          flush
          extra={
            <Link href="/reservations/queue" className="text-xs font-medium text-primary hover:underline">
              View queue →
            </Link>
          }
        >
          {data.queueItems.length ? (
            <div className="divide-y divide-border">
              {data.queueItems.map((r) => (
                <Link
                  key={r.request_id}
                  href={`/reservations/${r.request_id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-hover transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {r.guest_name || r.reservation_number || `Request #${r.request_id}`}
                    </p>
                    <p className="text-xs text-foreground-muted truncate">
                      {r.pickup_location || r.route_name || r.service_types?.service_name || ""}
                      {r.pickup_datetime ? ` · ${formatDateTime(r.pickup_datetime)}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={r.fleet_status} entity="reservation" className="flex-shrink-0" />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Inbox}
              title="No open requests"
              description="New guest requests will appear here as they're created."
              className="py-16"
            />
          )}
        </SectionCard>
      );
    case "availability":
      return (
        <SectionCard
          title="Fleet Availability"
          icon={CheckCircle2}
          flush
          extra={data.restrictedPlates?.size ? (
            <span className="text-[11px] font-medium text-danger">{data.restrictedPlates.size} coding-restricted today</span>
          ) : undefined}
        >
          {data.availableVehicles.length ? (
            <div className="divide-y divide-border">
              {data.availableVehicles.map((v) => {
                const restricted = data.restrictedPlates?.has(v.plate_number);
                return (
                  <div key={v.vehicle_id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success">
                        <Truck className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{v.plate_number}</p>
                        <p className="text-xs text-foreground-muted truncate">
                          {v.vehiclecategories?.category_name || v.vehicle_type || v.model || ""}
                        </p>
                      </div>
                    </div>
                    {restricted ? (
                      <StatusBadge severity="danger" className="flex-shrink-0">Coding Restricted</StatusBadge>
                    ) : (
                      <StatusBadge status={v.vehicle_status} entity="vehicle" className="flex-shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="No vehicles available"
              description="All vehicles are currently in use or under maintenance."
              className="py-16"
            />
          )}
        </SectionCard>
      );
    case "notifications":
      return (
        <SectionCard
          title="Notifications"
          icon={Bell}
          flush
          extra={
            <Link href="/notifications" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          }
        >
          {data.notifications.length ? (
            <div className="divide-y divide-border">
              {data.notifications.slice(0, 5).map((n) => (
                <div key={n.notification_id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 bg-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{n.title}</p>
                    <p className="text-xs text-foreground-muted truncate">{n.message}</p>
                  </div>
                  <span className="text-[11px] text-foreground-muted flex-shrink-0">{formatTime(n.sent_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Bell}
              title="No notifications"
              description="You're all caught up."
              className="py-16"
            />
          )}
        </SectionCard>
      );
    case "activity":
      return (
        <SectionCard
          title="Platform Activity"
          icon={Activity}
          extra={
            <Link href="/settings/ai/logs" className="text-xs font-medium text-primary hover:underline">
              View logs →
            </Link>
          }
        >
          {data.activityRecent.length ? (
            <div className="divide-y divide-border">
              {data.activityRecent.map((item) => {
                const ok = (item.status || "").toLowerCase() !== "failed";
                return (
                  <div key={`${item.source}-${item.id}`} className="flex items-start gap-3 px-5 py-3">
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0",
                        ok ? "bg-success" : "bg-danger"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        <span className="font-medium capitalize">{item.source}</span> · {item.type}
                      </p>
                      <p className="text-xs text-foreground-muted truncate">
                        {item.detail || item.status}
                        {item.error_message ? ` — ${item.error_message}` : ""}
                      </p>
                    </div>
                    <span className="text-[11px] text-foreground-muted flex-shrink-0">{formatTime(item.created_at)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Activity}
              title="No recent platform activity"
              description="Integration and automation events will appear here."
              className="py-16"
            />
          )}
        </SectionCard>
      );
    case "audit":
      return (
        <SectionCard
          title="Recent Audit Activity"
          icon={ShieldCheck}
          extra={
            <Link href="/system/audit" className="text-xs font-medium text-primary hover:underline">
              Open audit log →
            </Link>
          }
        >
          {data.auditLogs.length ? (
            <div className="divide-y divide-border">
              {data.auditLogs.slice(0, 8).map((log) => (
                <div key={log.log_id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 bg-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">
                      <span className="font-medium capitalize">{log.action}</span> {log.resource}
                      {log.resource_id != null ? ` #${log.resource_id}` : ""}
                    </p>
                    <p className="text-xs text-foreground-muted truncate">
                      {log.first_name && log.last_name ? `${log.first_name} ${log.last_name}` : log.email || "system"}
                    </p>
                  </div>
                  <span className="text-[11px] text-foreground-muted flex-shrink-0">{formatTime(log.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="No audit entries"
              description="Tracked mutations will appear here as they happen."
              className="py-16"
            />
          )}
        </SectionCard>
      );
    case "insights":
      return (
        <SectionCard title="AI Operational Insights" icon={TrendingUp}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.insightsLoading ? (
              [1, 2, 3].map((n) => <CardSkeleton key={n} />)
            ) : data.insights.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No active insights"
                description="The operation is within optimal metrics. Anomalies will surface here as they're detected."
                className="col-span-full"
              />
            ) : (
              data.insights.slice(0, 3).map((insight) => {
                const sev = (insight.severity || insight.impact || "low").toLowerCase();
                return (
                  <Link
                    key={insight.insight_id || insight.title}
                    href="/ai/insights"
                    className="block p-4 rounded-3xl border border-border bg-surface hover:border-primary/50 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <StatusBadge severity={sev} className="text-[11px]" />
                      <span className="text-xs text-foreground-muted">{insight.category || "General"}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground mb-1">{insight.title}</h4>
                    <p className="text-xs text-foreground-secondary leading-relaxed">
                      {insight.summary || insight.description}
                    </p>
                    <p className="text-xs font-medium text-primary mt-2">View in AI Insights →</p>
                  </Link>
                );
              })
            )}
          </div>
        </SectionCard>
      );
    default:
      return null;
  }
}
