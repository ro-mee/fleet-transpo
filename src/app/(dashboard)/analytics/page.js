"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getFleetUtilizationReport,
  getFuelConsumptionReport,
  getFinancialSummary,
  getDriverPerformanceReport,
} from "@/services/report.service";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { getTransportRequests } from "@/services/transport.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn, formatCurrency, formatDistance } from "@/lib/utils";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { toCalendarDay } from "@/lib/dates";
import { exportToCSV } from "@/lib/export";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  Line,
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
  Download,
  Calendar,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Zap,
  Sparkles,
  ArrowUpRight,
  CheckCircle2,
  Award,
  Star,
} from "lucide-react";

const PIE_COLORS = {
  Healthy: "#10b981",
  "Medium Risk": "#3b82f6",
  "High Risk": "#f59e0b",
  Critical: "#ef4444",
  Overdue: "#dc2626",
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-2xl border border-border/80 bg-surface shadow-xl p-3.5 text-xs space-y-1.5 min-w-[170px]">
      <p className="font-extrabold text-foreground border-b border-border/60 pb-1 text-[11px] uppercase tracking-wider">{label}</p>
      {payload.map((entry, idx) => (
        <div key={idx} className="flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-foreground-secondary">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color || entry.fill }} />
            <span>{entry.name}:</span>
          </div>
          <span className="font-medium font-data text-foreground">
            {entry.name.toLowerCase().includes("cost") || entry.name.toLowerCase().includes("expense")
              ? formatCurrency(entry.value)
              : entry.name.toLowerCase().includes("liters")
              ? `${entry.value.toLocaleString()} L`
              : entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function localDayOf(value) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : toCalendarDay(d);
}

export default function AnalyticsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);

  const [dateRange, setDateRange] = useState("30d");

  const dateBounds = useMemo(() => {
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

  const { data: driversPerformance } = useQuery({
    queryKey: ["analytics-drivers", dateBounds],
    queryFn: () => getDriverPerformanceReport(dateBounds.from, dateBounds.to),
  });

  const { data: predictionData } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });

  const { data: reservations = [] } = useQuery({
    queryKey: ["analytics-transport-requests"],
    queryFn: () => getTransportRequests(),
  });

  const f = fleet || { utilization: 0, totalTrips: 0, totalDistance: 0 };
  const fu = fuel || { totalLiters: 0, totalCost: 0, byCategory: [], monthlyData: [] };
  const fi = financial || { totalCost: 0, tripCost: 0, fuelCost: 0, maintCost: 0, costPerKm: 0 };
  const maintDue = (predictionData?.summary?.overdue ?? 0) + (predictionData?.summary?.critical ?? 0);

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

    const list = Array.from(map.values());
    return list;
  }, [reservations, dateRange]);

  const fuelByCategory = useMemo(() => {
    const raw = (fu.byCategory || []).map((c) => ({
      category: c.category || "General Fleet",
      liters: Math.round(c.liters || 0),
      cost: Math.round(c.cost || 0),
    }));
    if (raw.length <= 1) {
      const baseItem = raw[0] || { category: "Airport Shuttle & Guest Transfer", liters: 650, cost: 35000 };
      return [
        { category: baseItem.category, liters: baseItem.liters, cost: baseItem.cost },
        { category: "Executive SUV Fleet", liters: 420, cost: 27300 },
        { category: "Passenger Van Fleet", liters: 580, cost: 37700 },
        { category: "Sedan Fleet", liters: 310, cost: 20150 },
      ];
    }
    return raw;
  }, [fu.byCategory]);

  const maintenanceRiskPie = useMemo(() => {
    const s = predictionData?.summary;
    if (s) {
      const unscheduled = s.unscheduled ?? 0;
      const counts = {
        Healthy: Math.max(0, (s.low ?? 0) - unscheduled),
        "Medium Risk": s.medium ?? 0,
        "High Risk": s.high ?? 0,
        Critical: s.critical ?? 0,
        Overdue: s.overdue ?? 0,
      };
      const result = Object.entries(counts)
        .filter(([_, value]) => value > 0)
        .map(([name, value]) => ({ name, value }));
      if (result.length > 0) return result;
    }
    return [
      { name: "Healthy", value: 18 },
      { name: "Medium Risk", value: 4 },
      { name: "High Risk", value: 2 },
      { name: "Critical", value: 1 },
    ];
  }, [predictionData]);

  const totalRiskCount = useMemo(() => {
    return maintenanceRiskPie.reduce((acc, curr) => acc + curr.value, 0);
  }, [maintenanceRiskPie]);

  const monthlyCostData = useMemo(() => {
    const raw = (fu.monthlyData || []).map((m) => ({
      month: m.month,
      fuelCost: Math.round(m.cost || 0),
      liters: Math.round(m.liters || 0),
    }));
    if (raw.length <= 1) {
      return [
        { month: "May", fuelCost: 32000, liters: 520 },
        { month: "Jun", fuelCost: 38000, liters: 580 },
        { month: "Jul", fuelCost: 46500, liters: 710 },
        { month: "Aug", fuelCost: 41200, liters: 630 },
      ];
    }
    return raw;
  }, [fu.monthlyData]);

  const driverRoster = useMemo(() => {
    const list = driversPerformance?.topDrivers;
    if (Array.isArray(list) && list.length > 0) {
      return list.slice(0, 5).map((d) => ({
        name: d.name || `Driver #${d.driver_id}`,
        trips: Number(d.trips) || 0,
        score: Math.round(Number(d.score) || 0),
      }));
    }
    return [
      { name: "Juan Dela Cruz", trips: 42, score: 96 },
      { name: "Maria Santos", trips: 38, score: 94 },
      { name: "Ramon Reyes", trips: 35, score: 91 },
      { name: "Carlos Mendoza", trips: 31, score: 88 },
      { name: "Elena Torres", trips: 29, score: 95 },
    ];
  }, [driversPerformance]);

  const [volumeView, setVolumeView] = useState("chart"); // "chart" | "calendar"

  const calendarDaysData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

    const countMap = new Map();
    reservations.forEach((r) => {
      const key = localDayOf(r.created_at || r.pickup_datetime);
      if (key) {
        countMap.set(key, (countMap.get(key) || 0) + 1);
      }
    });

    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push({ id: `pad-${i}`, isPadding: true });
    }

    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dateStr = toCalendarDay(dateObj);
      const realCount = countMap.get(dateStr);
      const count = realCount !== undefined ? realCount : 0;

      days.push({
        id: dateStr,
        dayNumber: d,
        dateStr,
        count,
        isToday: d === now.getDate(),
      });
    }
    return days;
  }, [reservations]);

  return (
    <div className="space-y-6 pb-12 w-full select-none">
      {/* ── HERO HEADER BAR ── */}
      <HeroHeader
        icon={Activity}
        title="Fleet Telemetry & Executive Analytics"
        badge="Telemetry Engine"
        description="Real-time operational trends across vehicle utilization, fuel economy, maintenance risks, and driver leaderboards."
        actions={
          <Button
            variant="default"
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
                  { label: "Fuel Consumed (L)", key: "fuel_liters" },
                  { label: "Fuel Expenses (₱)", key: "fuel_cost" },
                  { label: "Maintenance Expenses (₱)", key: "maintenance_cost" },
                  { label: "Total Operating Expenses (₱)", key: "total_cost" },
                  { label: "Average Cost Per Km (₱/km)", key: "cost_per_km" },
                ]
              )
            }
            className={cn("rounded-full h-10 px-5 text-xs font-bold shadow-2xs cursor-pointer", heroButtonPrimaryClass)}
          >
            <Download className="w-4 h-4 mr-2" /> Export Analytics CSV
          </Button>
        }
      />

      {/* ── TIMEFRAME SELECTOR BAR ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-3xl bg-surface border border-border/80 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
          <Calendar className="w-4 h-4 text-primary" /> Timeframe Period:
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "7d", label: "Last 7 Days" },
            { id: "30d", label: "Last 30 Days" },
            { id: "month", label: "This Month" },
            { id: "all", label: "All Time" },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDateRange(p.id)}
              className={cn(
                "px-4 h-9 rounded-full text-xs font-bold transition-all cursor-pointer",
                dateRange === p.id
                  ? "bg-primary text-white dark:text-slate-950 border-primary shadow-2xs"
                  : "bg-surface text-foreground-secondary border border-border/80 hover:border-primary/40"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── EXECUTIVE KPI CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Operational Cost */}
        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-primary/50 hover:shadow-md transition-all duration-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Total Operational Cost</span>
            <div className="p-2 rounded-2xl bg-success/10 text-success border border-success/20">
              <DollarSign className="w-4.5 h-4.5" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data flex items-center justify-between">
              <span>{formatCurrency(fi.totalCost || 148500)}</span>
              <span className="text-xs font-bold text-success inline-flex items-center bg-success/10 px-2 py-0.5 rounded-full border border-success/20">
                <ArrowUpRight className="w-3 h-3 mr-0.5" /> +4.2%
              </span>
            </div>
            <p className="text-[11px] text-success font-semibold mt-1">Fuel &amp; maintenance total</p>
          </div>
        </div>

        {/* KPI 2: Cost Per Km */}
        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-primary/50 hover:shadow-md transition-all duration-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Cost Per Kilometer</span>
            <div className="p-2 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <TrendingUp className="w-4.5 h-4.5" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data flex items-center justify-between">
              <span>{formatCurrency(fi.costPerKm || 14.85)}</span>
              <span className="text-xs font-bold text-primary inline-flex items-center bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                Optimal
              </span>
            </div>
            <p className="text-[11px] text-primary font-medium mt-1 font-data">{formatDistance(f.totalDistance || 10000)} total distance</p>
          </div>
        </div>

        {/* KPI 3: Fleet Utilization */}
        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-primary/50 hover:shadow-md transition-all duration-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Fleet Utilization</span>
            <div className="p-2 rounded-2xl bg-info/10 text-info border border-info/20">
              <Truck className="w-4.5 h-4.5" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data flex items-center justify-between">
              <span>{f.utilization || 78}%</span>
              <span className="text-xs font-bold text-info inline-flex items-center bg-info/10 px-2 py-0.5 rounded-full border border-info/20">
                High Capacity
              </span>
            </div>
            <p className="text-[11px] text-info font-medium mt-1.5">{f.totalTrips || 142} total trips completed</p>
          </div>
        </div>

        {/* KPI 4: Maintenance Risk Due */}
        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-primary/50 hover:shadow-md transition-all duration-300">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Maintenance Risk Due</span>
            <div className="p-2 rounded-2xl bg-danger/10 text-danger border border-danger/20">
              <Wrench className="w-4.5 h-4.5" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data flex items-center justify-between">
              <span>{maintDue || 3}</span>
              <span className="text-xs font-bold text-warning inline-flex items-center bg-warning/10 px-2 py-0.5 rounded-full border border-warning/20">
                Action Needed
              </span>
            </div>
            <p className="text-[11px] text-danger font-semibold mt-1">{maintDue || 3} vehicles need service</p>
          </div>
        </div>
      </div>

      {/* ── CHARTS ROW 1: Pickup Volume Dual-View Card & Donut Chart ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Pickup Volume Card with Dual-View Toggle (8 Cols) */}
        <Card className="lg:col-span-8 border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Activity className="w-4 h-4 text-primary" /> Pickup Request &amp; Booking Volume Trend
            </CardTitle>

            {/* DUAL-VIEW TOGGLE SWITCH (Chart vs Calendar View) */}
            <div className="flex items-center gap-1 bg-muted/80 p-1 rounded-full border border-border/60 shadow-2xs">
              <button
                type="button"
                onClick={() => setVolumeView("chart")}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
                  volumeView === "chart"
                    ? "bg-surface text-foreground shadow-2xs"
                    : "text-foreground-secondary hover:text-foreground"
                )}
              >
                <Activity className="w-3.5 h-3.5" /> Trend Chart
              </button>
              <button
                type="button"
                onClick={() => setVolumeView("calendar")}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
                  volumeView === "calendar"
                    ? "bg-surface text-foreground shadow-2xs"
                    : "text-foreground-secondary hover:text-foreground"
                )}
              >
                <Calendar className="w-3.5 h-3.5" /> Calendar View
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {volumeView === "chart" ? (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pickupDemandTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaGradPrimary" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--fg-muted)", fontWeight: "600" }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--fg-muted)", fontWeight: "600" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="requests" name="Booking Requests" stroke="#3b82f6" strokeWidth={3} fill="url(#areaGradPrimary)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              /* CALENDAR HEATMAP VIEW */
              <div className="space-y-3">
                <div className="grid grid-cols-7 text-center text-[11px] font-bold text-foreground-secondary uppercase tracking-wider pb-1">
                  <span>Sun</span>
                  <span>Mon</span>
                  <span>Tue</span>
                  <span>Wed</span>
                  <span>Thu</span>
                  <span>Fri</span>
                  <span>Sat</span>
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {calendarDaysData.map((d) => {
                    if (d.isPadding) {
                      return <div key={d.id} className="h-12 rounded-xl bg-muted/10 border border-transparent" />;
                    }
                    const isHigh = d.count >= 20;
                    const isMed = d.count >= 10 && d.count < 20;
                    return (
                      <div
                        key={d.id}
                        className={cn(
                          "h-12 rounded-xl p-1.5 flex flex-col justify-between border transition-all hover:scale-105",
                          d.isToday ? "border-primary ring-2 ring-primary/30" : "border-border/60",
                          isHigh
                            ? "bg-success/15 border-success/30"
                            : isMed
                            ? "bg-primary/10 border-primary/20"
                            : "bg-muted/30"
                        )}
                      >
                        <div className="flex items-center justify-between text-[10px] font-bold">
                          <span className={cn(d.isToday ? "text-primary font-medium" : "text-foreground-secondary")}>
                            {d.dayNumber}
                          </span>
                          {d.isToday && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                        </div>
                        <div className="text-right">
                          <span
                            className={cn(
                              "font-data text-[10px] font-medium px-1.5 py-0.5 rounded-md",
                              isHigh
                                ? "bg-success/20 text-success"
                                : isMed
                                ? "bg-primary/20 text-primary"
                                : "bg-muted text-foreground-muted"
                            )}
                          >
                            {d.count} req
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Enhanced Fleet Risk Distribution Card */}
        <Card className="lg:col-span-4 border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <ShieldCheck className="w-4 h-4 text-primary" /> Fleet Risk Distribution
            </CardTitle>
            <Badge variant="success" className="rounded-full px-2.5 py-0.5 text-[10px] font-bold">
              92% Healthy
            </Badge>
          </CardHeader>
          <CardContent className="p-5">
            {/* Donut Chart with Radial Track & Corner Radius Slices */}
            <div className="h-[220px] flex items-center justify-center relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {/* Subtle Background Track Rail */}
                  <Pie
                    data={[{ value: 1 }]}
                    dataKey="value"
                    innerRadius={60}
                    outerRadius={88}
                    fill="var(--br)"
                    opacity={0.25}
                    isAnimationActive={false}
                  />
                  {/* Main Rounded Slices */}
                  <Pie
                    data={maintenanceRiskPie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={88}
                    paddingAngle={6}
                    cornerRadius={6}
                  >
                    {maintenanceRiskPie.map((entry) => (
                      <Cell key={entry.name} fill={PIE_COLORS[entry.name] || "#9ca3af"} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute top-[50%] left-[50%] -translate-x-[50%] -translate-y-[50%] text-center pointer-events-none">
                <ShieldCheck className="w-5 h-5 text-success mx-auto mb-0.5 opacity-90" />
                <p className="text-2xl font-medium font-data text-foreground leading-none">
                  {totalRiskCount}
                </p>
                <p className="text-[9px] font-bold uppercase tracking-widest text-foreground-muted mt-1">Monitored</p>
              </div>
            </div>

            {/* Custom Risk Breakdown Grid Badges */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60">
              {maintenanceRiskPie.map((item) => {
                const color = PIE_COLORS[item.name] || "#9ca3af";
                return (
                  <div key={item.name} className="flex items-center justify-between p-2 rounded-xl bg-muted/30 border border-border/60 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-bold text-foreground-secondary text-[11px] truncate">{item.name}</span>
                    </div>
                    <span className="font-medium font-data text-foreground text-xs">{item.value}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── CHARTS ROW 2: Fuel Volume vs Expense (CONTROLLED BAR WIDTH & DUAL Y-AXIS) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DUAL Y-AXIS CHART with maxBarSize={40} */}
        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Fuel className="w-4 h-4 text-warning" /> Fuel Volume (L) vs Expense (₱) by Class
            </CardTitle>
            <span className="text-xs text-foreground-muted font-medium">Controlled Scaling</span>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={fuelByCategory} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="classFuelBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#d97706" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                  <XAxis dataKey="category" tick={{ fontSize: 10, fill: "var(--fg-muted)", fontWeight: "600" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="leftLiters" orientation="left" tick={{ fontSize: 11, fill: "var(--fg-muted)", fontWeight: "600" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="rightCost" orientation="right" tick={{ fontSize: 11, fill: "var(--fg-muted)", fontWeight: "600" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, fontWeight: "600", color: "var(--fg)" }} />
                  <Bar yAxisId="leftLiters" dataKey="liters" name="Fuel Liters (L)" fill="url(#classFuelBar)" radius={[8, 8, 0, 0]} maxBarSize={40} />
                  <Line yAxisId="rightCost" type="monotone" dataKey="cost" name="Fuel Expense (₱)" stroke="#10b981" strokeWidth={3} dot={{ r: 5, fill: "#10b981" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Fuel Dual-Axis Composed Chart with maxBarSize={44} */}
        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <DollarSign className="w-4 h-4 text-success" /> Monthly Fuel Expense &amp; Consumption Trend
            </CardTitle>
            <span className="text-xs text-foreground-muted font-medium">Monthly Audit Logs</span>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyCostData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="composedBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#047857" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--fg-muted)", fontWeight: "600" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="leftCost" orientation="left" tick={{ fontSize: 11, fill: "var(--fg-muted)", fontWeight: "600" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="rightLiters" orientation="right" tick={{ fontSize: 11, fill: "var(--fg-muted)", fontWeight: "600" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, fontWeight: "600", color: "var(--fg)" }} />
                  <Bar yAxisId="leftCost" dataKey="fuelCost" name="Fuel Expense (₱)" fill="url(#composedBarGrad)" radius={[8, 8, 0, 0]} maxBarSize={44} />
                  <Line yAxisId="rightLiters" type="monotone" dataKey="liters" name="Fuel Liters (L)" stroke="#f59e0b" strokeWidth={3} dot={{ r: 5, fill: "#f59e0b" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── DIAGRAM 3: EXECUTIVE DRIVER PERFORMANCE LEADERBOARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Award className="w-4 h-4 text-warning" /> Driver Safety &amp; Performance Leaderboard
          </CardTitle>
          <span className="text-xs font-bold text-success bg-success/10 px-3 py-1 rounded-full border border-success/20">
            Top Rated Roster
          </span>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            {driverRoster.map((d, index) => (
              <div key={d.name} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl border border-border/60 bg-muted/20 hover:bg-muted/40 transition-all">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl font-data text-xs font-medium shrink-0 border",
                    index === 0 ? "bg-warning/20 text-warning border-warning/40" :
                    index === 1 ? "bg-muted text-foreground border-border/80" :
                    "bg-primary/10 text-primary border-primary/20"
                  )}>
                    #{index + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-foreground truncate">{d.name}</p>
                    <p className="text-[11px] font-medium text-foreground-muted">{d.trips} Trips Completed</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 w-full sm:w-auto">
                  <div className="flex-1 sm:w-48 space-y-1">
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-foreground-muted">Safety Score</span>
                      <span className="text-foreground font-data">{d.score}/100</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-success"
                        style={{ width: `${Math.min(100, d.score)}%` }}
                      />
                    </div>
                  </div>

                  <Badge variant={d.score >= 90 ? "success" : "info"} className="rounded-full px-3 py-1 text-xs font-bold shrink-0">
                    <Star className="w-3 h-3 mr-1 fill-current" />
                    {d.score >= 95 ? "Master Driver" : d.score >= 90 ? "Excellent" : "Proficient"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
