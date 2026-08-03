"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getAiInsights } from "@/services/ai.service";
import { getVehicles } from "@/services/vehicle.service";
import { getDriverStats } from "@/services/driver.service";
import { getTrips, getActiveTrips, getLatestLocations } from "@/services/trip.service";
import { getReservations } from "@/services/reservation.service";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatsGridSkeleton, CardSkeleton } from "@/components/ui/skeleton";
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
  Truck,
  CheckCircle2,
  Wrench,
  Users,
  Navigation,
  CalendarCheck,
  Send,
  TrendingUp,
  MapPin,
  BarChart3,
  Activity,
} from "lucide-react";

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

const LiveLocationsMap = dynamic(
  () => import("@/components/maps/live-locations-map"),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-hover" /> }
);

function isToday(dateString) {
  if (!dateString) return false;
  const d = new Date(dateString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function DashboardPage() {
  const { employee } = useAuth();

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });
  const { data: driverStats = {} } = useQuery({
    queryKey: ["driver-stats"],
    queryFn: () => getDriverStats(),
  });
  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: () => getTrips(),
  });
  const { data: activeTrips = [] } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 30000,
  });
  const { data: reservations = [] } = useQuery({
    queryKey: ["reservations"],
    queryFn: () => getReservations(),
  });
  const { data: locations = [], isLoading: locationsLoading } = useQuery({
    queryKey: ["latest-locations"],
    queryFn: () => getLatestLocations(),
    refetchInterval: 15000,
  });
  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => getAiInsights(),
  });

  const insights = Array.isArray(insightsData)
    ? insightsData
    : Array.isArray(insightsData?.insights)
    ? insightsData.insights
    : [];

  const available = vehicles.filter((v) => v.vehicle_status === "Available").length;
  const maintenance = vehicles.filter(
    (v) => v.vehicle_status === "Under Maintenance"
  ).length;
  const utilization = vehicles.length ? Math.round((available / vehicles.length) * 100) : 0;
  const tripsToday = trips.filter((t) => isToday(t.start_time) || isToday(t.created_at)).length;
  const pendingReservations = reservations.filter(
    (r) => (r.status || r.reservation_status || "").toLowerCase() === "pending"
  ).length;

  const kpis = [
    { label: "Total Vehicles", value: vehicles.length, icon: Truck, tone: "primary", trend: `${available} currently available` },
    { label: "Available", value: available, icon: CheckCircle2, tone: "success", trend: `${utilization}% of fleet` },
    { label: "Under Maintenance", value: maintenance, icon: Wrench, tone: "warning", trend: "needs attention" },
    { label: "Drivers on Duty", value: driverStats.total ?? 0, icon: Users, tone: "primary", trend: `${driverStats.available ?? 0} available` },
    { label: "Active Trips", value: activeTrips.length, icon: Navigation, tone: "info", trend: "in motion now" },
    { label: "Pending Reservations", value: pendingReservations, icon: CalendarCheck, tone: "warning", trend: "awaiting confirmation" },
    { label: "Trips Today", value: tripsToday, icon: Send, tone: "primary", trend: "started or scheduled today" },
    { label: "Fleet Utilization", value: `${utilization}%`, icon: TrendingUp, tone: "success", trend: "of fleet ready" },
  ];

  const reservationTrend = useMemo(() => {
    const days = 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, {
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        count: 0,
      });
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
        const driver = t.drivers?.employees
          ? `${t.drivers.employees.first_name} ${t.drivers.employees.last_name}`
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
        const start = t.start_time || t.created_at;
        const time = start
          ? new Date(start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : "—";
        return { action, detail, time, type };
      });
  }, [trips]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Welcome back${employee ? `, ${employee.first_name}` : ""}. Here's what's happening across your fleet.`}
      />

      {vehiclesLoading ? (
        <StatsGridSkeleton count={8} gridClass="md:grid-cols-2 lg:grid-cols-4" />
      ) : (
        <StatGrid cols={4}>
          {kpis.map((kpi) => (
            <StatCard key={kpi.label} {...kpi} />
          ))}
        </StatGrid>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-foreground-muted" /> Reservation Trends
            </CardTitle>
            <span className="text-xs text-foreground-muted">last 14 days</span>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              {reservationTrend.some((d) => d.count > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={reservationTrend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-foreground-muted" /> Fleet Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              {fleetStatus.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={fleetStatus}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {fleetStatus.map((entry) => (
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
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-foreground-muted" /> Live GPS Tracking
            </CardTitle>
            {!locationsLoading && (
              <span className="text-xs text-foreground-muted">
                {locations?.length ?? 0} vehicles on the map
              </span>
            )}
          </CardHeader>
          <CardContent>
            <div className="h-[280px] rounded-lg overflow-hidden bg-hover">
              {locations?.length ? (
                <LiveLocationsMap locations={locations} />
              ) : (
                <EmptyState
                  icon={MapPin}
                  title="No live locations"
                  description="Vehicle positions will appear here when active trips report GPS coordinates."
                  className="h-full py-16"
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {activities.length ? (
              <div className="divide-y divide-border">
                {activities.map((activity, i) => (
                  <div key={i} className="flex items-start gap-3 px-5 py-3 hover:bg-hover transition-colors">
                    <span
                      className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        activity.type === "success"
                          ? "bg-success"
                          : activity.type === "warning"
                          ? "bg-warning"
                          : activity.type === "danger"
                          ? "bg-danger"
                          : "bg-info"
                      }`}
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-foreground-muted" />
            <CardTitle>AI Operational Insights</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {insightsLoading ? (
              [1, 2, 3].map((n) => <CardSkeleton key={n} />)
            ) : insights.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No active insights"
                description="The fleet is operating within optimal metrics. Anomalies will surface here as they're detected."
                className="col-span-full"
              />
            ) : (
              insights.slice(0, 3).map((insight) => {
                const sev = (insight.severity || insight.impact || "low").toLowerCase();
                return (
                  <Link
                    key={insight.insight_id || insight.title}
                    href="/ai/insights"
                    className="block p-4 rounded-lg border border-border bg-surface hover:border-primary/50 hover:shadow-sm transition-all"
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
        </CardContent>
      </Card>
    </div>
  );
}
