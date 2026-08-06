"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  getFleetUtilizationReport,
  getFuelConsumptionReport,
  getFinancialSummary,
  getDriverPerformanceReport,
} from "@/services/report.service";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { getReservations } from "@/services/reservation.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { formatCurrency, formatDistance } from "@/lib/utils";
import { toCalendarDay } from "@/lib/dates";
import { exportToCSV } from "@/lib/export";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  BarChart3,
  Activity,
  Truck,
  Fuel,
  DollarSign,
  Wrench,
  Clock,
  Download,
  Calendar,
  ShieldCheck,
  TrendingUp,
  UserCheck,
} from "lucide-react";

const tooltipStyle = {
  background: "var(--sf)",
  border: "1px solid var(--br)",
  borderRadius: "8px",
  fontSize: "12px",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
};

const PIE_COLORS = {
  Healthy: "#10b981",
  "Medium Risk": "#3b82f6",
  "High Risk": "#f59e0b",
  Critical: "#ef4444",
  Overdue: "#dc2626",
  // Deliberately grey rather than a heat colour: a vehicle with no schedule has
  // no risk level, and giving it one would invent a finding.
  "No Schedule": "#94a3b8",
};

/**
 * Buckets a timestamp into the LOCAL calendar day.
 *
 * created_at is a timestamptz that arrives as a UTC instant string, so slicing
 * its first ten characters buckets by the UTC day — which at UTC+8 is one day
 * behind for anything created before 08:00 local. The day labels on this chart
 * are local days, so the keys have to be too.
 */
function localDayOf(value) {
  if (!value) return null;
  const s = String(value);
  // A bare calendar day carries no instant to convert; take it as written.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : toCalendarDay(d);
}

export default function AnalyticsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);

  const [dateRange, setDateRange] = useState("30d"); // '7d' | '30d' | 'month' | 'all'
  const [activeKpi, setActiveKpi] = useState("all");

  const dateBounds = useMemo(() => {
    // toCalendarDay, not toISOString().substring(0, 10): the latter re-reads a
    // local Date in UTC, so at UTC+8 every bound lands a day early and the
    // report silently queries the wrong window.
    const now = new Date();
    const toStr = toCalendarDay(now);
    if (dateRange === "7d") {
      const fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 7);
      return { from: toCalendarDay(fromDate), to: toStr };
    }
    if (dateRange === "month") {
      const fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toCalendarDay(fromDate), to: toStr };
    }
    if (dateRange === "all") {
      return { from: "1970-01-01", to: "2100-01-01" };
    }
    // Default 30d
    const fromDate = new Date(now);
    fromDate.setDate(now.getDate() - 30);
    return { from: toCalendarDay(fromDate), to: toStr };
  }, [dateRange]);

  const { data: fleet } = useQuery({
    queryKey: ["analytics-fleet", dateBounds],
    queryFn: () => getFleetUtilizationReport(dateBounds.from, dateBounds.to),
  });

  const { data: fuel } = useQuery({
    queryKey: ["analytics-fuel", dateBounds],
    queryFn: () => getFuelConsumptionReport(dateBounds.from, dateBounds.to),
  });

  const { data: financial } = useQuery({
    queryKey: ["analytics-financial", dateBounds],
    queryFn: () => getFinancialSummary(dateBounds.from, dateBounds.to),
  });

  // No `= []` default: this endpoint answers with an object
  // ({ totalDrivers, avgScore, topDrivers }), and an array default only
  // disguised the shape mismatch that kept the chart below empty.
  const { data: driversPerformance } = useQuery({
    queryKey: ["analytics-drivers", dateBounds],
    queryFn: () => getDriverPerformanceReport(dateBounds.from, dateBounds.to),
  });

  const { data: predictionData } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });

  const { data: reservations = [] } = useQuery({
    queryKey: ["analytics-reservations"],
    queryFn: () => getReservations(),
  });

  const f = fleet || { utilization: 0, totalTrips: 0, totalDistance: 0 };
  const fu = fuel || { totalLiters: 0, totalCost: 0, byCategory: [], monthlyData: [] };
  const fi = financial || { totalCost: 0, tripCost: 0, fuelCost: 0, maintCost: 0, costPerKm: 0 };
  // Server-precomputed, same summary the predictive page reads.
  const maintDue = (predictionData?.summary?.overdue ?? 0) + (predictionData?.summary?.critical ?? 0);

  // 1. Pickup Demand Trend (Recharts AreaChart)
  const pickupDemandTrend = useMemo(() => {
    const days = dateRange === "7d" ? 7 : 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = toCalendarDay(d);
      map.set(key, {
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        requests: 0,
      });
    }
    reservations.forEach((r) => {
      const key = localDayOf(r.created_at || r.pickup_datetime);
      if (key && map.has(key)) map.get(key).requests += 1;
    });
    return Array.from(map.values());
  }, [reservations, dateRange]);

  // 2. Fuel Usage by Vehicle Category (Recharts BarChart)
  const fuelByCategory = useMemo(() => {
    return (fu.byCategory || []).map((c) => ({
      category: c.category || "General Fleet",
      liters: Math.round(c.liters || 0),
      cost: Math.round(c.cost || 0),
    }));
  }, [fu.byCategory]);

  // 3. Maintenance Risk Breakdown (Recharts PieChart)
  const maintenanceRiskPie = useMemo(() => {
    // One vocabulary with the predictive page: "Healthy" means the low band with
    // the unscheduled vehicles taken out, medium gets its own slice instead of
    // being swept in, and vehicles nobody has scheduled are named as such. When
    // this chart merged three states into one word, the same fleet read as 100%
    // healthy here and as five separate tiles there.
    const s = predictionData?.summary;
    if (!s) return [];
    const unscheduled = s.unscheduled ?? 0;
    const counts = {
      Healthy: Math.max(0, (s.low ?? 0) - unscheduled),
      "Medium Risk": s.medium ?? 0,
      "High Risk": s.high ?? 0,
      Critical: s.critical ?? 0,
      Overdue: s.overdue ?? 0,
      "No Schedule": unscheduled,
    };
    return Object.entries(counts)
      .filter(([_, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [predictionData]);

  // 4. Monthly Fuel Expense (Recharts BarChart)
  const monthlyCostData = useMemo(() => {
    // Fuel only. This series is built from `fuelrecords` by
    // /api/reports/fuel-consumption, so it can only carry fuel. A second bar
    // here used to plot `fuelCost * 0.35` as "Maintenance" — a constant nobody
    // measured, drawn in the same units as the real bar beside it, which made
    // an invented number indistinguishable from a recorded one. There is no
    // monthly maintenance series to swap in: /api/reports/maintenance returns
    // `monthlyData: []` unconditionally. Build that aggregate first, then this
    // chart can honestly stack the two.
    return (fu.monthlyData || []).map((m) => ({
      month: m.month,
      fuelCost: Math.round(m.cost || 0),
    }));
  }, [fu.monthlyData]);

  // 5. Driver Performance Breakdown (Recharts BarChart)
  const driverPerformanceChartData = useMemo(() => {
    // /api/reports/driver-performance responds with an object, not an array,
    // and the ranked drivers live under `topDrivers`. Reading the response
    // itself meant Array.isArray was always false, so this chart rendered its
    // empty state no matter how many trips the fleet had completed.
    //
    // The fields are `name`, `trips`, and `score` (driver_stats.performance_score,
    // the average smooth_driving_score over completed trips). The previous
    // mapping read driver_name / completed_trips / on_time_rate — none of which
    // this endpoint returns — so the on-time bar fell through to a literal 95
    // for every driver. trips.on_time_completion does exist and is indexed, so
    // a real on-time rate is computable; it just has to be added to the
    // driver_stats view and the endpoint before it can be charted.
    const list = driversPerformance?.topDrivers;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 6).map((d) => ({
      driver: d.name || `Driver #${d.driver_id}`,
      completed: Number(d.trips) || 0,
      score: Math.round(Number(d.score) || 0),
    }));
  }, [driversPerformance]);

  const kpis = [
    {
      label: "Total Operational Cost",
      value: formatCurrency(fi.totalCost),
      icon: DollarSign,
      tone: "success",
      trend: "fuel & maintenance",
      active: activeKpi === "cost",
      onClick: () => setActiveKpi((k) => (k === "cost" ? "all" : "cost")),
    },
    {
      label: "Cost Per Kilometer",
      value: formatCurrency(fi.costPerKm),
      icon: TrendingUp,
      tone: "primary",
      trend: `${formatDistance(f.totalDistance)} total`,
      active: activeKpi === "costPerKm",
      onClick: () => setActiveKpi((k) => (k === "costPerKm" ? "all" : "costPerKm")),
    },
    {
      label: "Fleet Utilization",
      value: `${f.utilization}%`,
      icon: Truck,
      tone: "info",
      trend: `${f.totalTrips} total trips`,
      active: activeKpi === "utilization",
      onClick: () => setActiveKpi((k) => (k === "utilization" ? "all" : "utilization")),
    },
    {
      label: "Maintenance Risk Due",
      value: maintDue,
      icon: Wrench,
      tone: maintDue > 0 ? "danger" : "success",
      trend: `${maintDue} vehicles need service`,
      active: activeKpi === "maintenance",
      onClick: () => setActiveKpi((k) => (k === "maintenance" ? "all" : "maintenance")),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Page Header & Controls ── */}
      <PageHeader
        eyebrow="Insights"
        title="Fleet Analytics & Executive Reports"
        description="Real-time operational trends across vehicle utilization, fuel economy, maintenance risks, and cost efficiency."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportToCSV(
                  [
                    {
                      utilization: `${f.utilization}%`,
                      total_distance_km: f.totalDistance,
                      total_trips: f.totalTrips,
                      fuel_liters: fu.totalLiters,
                      fuel_cost: fu.totalCost,
                      maintenance_cost: fi.maintCost,
                      total_cost: fi.totalCost,
                      cost_per_km: fi.costPerKm,
                    },
                  ],
                  "fleet-analytics-summary",
                  [
                    { label: "Utilization Rate", key: "utilization" },
                    { label: "Total Distance (km)", key: "total_distance_km" },
                    { label: "Total Trips", key: "total_trips" },
                    { label: "Fuel Liters (L)", key: "fuel_liters" },
                    { label: "Fuel Cost (₱)", key: "fuel_cost" },
                    { label: "Maintenance Cost (₱)", key: "maintenance_cost" },
                    { label: "Total Cost (₱)", key: "total_cost" },
                    { label: "Cost Per Km (₱/km)", key: "cost_per_km" },
                  ]
                )
              }
            >
              <Download className="w-4 h-4 mr-2" />
              Export Report CSV
            </Button>
          </div>
        }
      />

      {/* ── Date Range Filter Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-surface border border-border">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground-secondary">
          <Calendar className="w-4 h-4 text-primary" /> Timeframe Period:
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={dateRange === "7d" ? "default" : "outline"}
            size="xs"
            className="h-8 text-xs px-3"
            onClick={() => setDateRange("7d")}
          >
            Last 7 Days
          </Button>
          <Button
            variant={dateRange === "30d" ? "default" : "outline"}
            size="xs"
            className="h-8 text-xs px-3"
            onClick={() => setDateRange("30d")}
          >
            Last 30 Days
          </Button>
          <Button
            variant={dateRange === "month" ? "default" : "outline"}
            size="xs"
            className="h-8 text-xs px-3"
            onClick={() => setDateRange("month")}
          >
            This Month
          </Button>
          <Button
            variant={dateRange === "all" ? "default" : "outline"}
            size="xs"
            className="h-8 text-xs px-3"
            onClick={() => setDateRange("all")}
          >
            All Time
          </Button>
        </div>
      </div>

      {/* ── Executive KPI Cards ── */}
      <StatGrid cols={4}>
        {kpis.map((kpi) => (
          <StatCard key={kpi.label} {...kpi} />
        ))}
      </StatGrid>

      {/* ── CHARTS ROW 1: Booking Demand Trend & Fuel Usage by Class ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recharts AreaChart: Booking & Pickup Demand Trend (2 Cols) */}
        <Card className="lg:col-span-2 border border-border shadow-xs">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Pickup Request &amp; Booking Volume Trend
            </CardTitle>
            <span className="text-xs text-foreground-muted">Daily pickup request volume</span>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {pickupDemandTrend.some((d) => d.requests > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pickupDemandTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="requestsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="requests" name="Requests" stroke="var(--primary)" strokeWidth={2.5} fill="url(#requestsGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={BarChart3} title="No pickup request activity" description="Activity will render here as transportation bookings arrive." className="py-16" />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recharts PieChart: Fleet Maintenance Risk Breakdown (1 Col) */}
        <Card className="border border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" /> Fleet Risk Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {maintenanceRiskPie.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={maintenanceRiskPie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={85}
                      paddingAngle={3}
                    >
                      {maintenanceRiskPie.map((entry) => (
                        <Cell key={entry.name} fill={PIE_COLORS[entry.name] || "#9ca3af"} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={Wrench} title="No risk data available" description="Fleet maintenance predictions will populate this risk distribution." className="py-16" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── CHARTS ROW 2: Fuel Consumption by Category & Monthly Cost Breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recharts BarChart: Fuel Usage & Expense by Category */}
        <Card className="border border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Fuel className="w-4 h-4 text-warning" /> Fuel Consumption by Vehicle Class
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {fuelByCategory.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fuelByCategory} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                    <XAxis dataKey="category" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="liters" name="Fuel Liters (L)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="cost" name="Cost (₱)" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={Fuel} title="No fuel records by class" description="Approved fuel logs will populate consumption per vehicle category." className="py-16" />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recharts Stacked BarChart: Monthly Cost Allocation */}
        <Card className="border border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-success" /> Monthly Fuel Expense
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {monthlyCostData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyCostData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="fuelCost" name="Fuel Expenses (₱)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={DollarSign} title="No fuel records" description="Monthly fuel expenses will populate as fuel claims are processed." className="py-16" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── CHARTS ROW 3: Driver Performance & Trip Completion Rate ── */}
      <Card className="border border-border shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-info" /> Driver Trip Completion &amp; Driving Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[260px]">
            {driverPerformanceChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={driverPerformanceChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                  <XAxis dataKey="driver" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="completed" name="Completed Trips" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="score" name="Driving Score" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={UserCheck} title="No driver performance metrics" description="Driver metrics will populate as trips are completed across shifts." className="py-16" />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
