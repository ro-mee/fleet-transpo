"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, animate, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getFleetUtilizationReport,
  getFuelConsumptionReport,
  getFinancialSummary,
  getDriverPerformanceReport,
} from "@/services/report.service";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { getTransportRequests } from "@/services/transport.service";
import { getReportNarrative } from "@/services/ai.service";
import { AiAnalystCard } from "@/components/ai/ai-analyst-card";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn, formatCurrency, formatDistance } from "@/lib/utils";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { toCalendarDay } from "@/lib/dates";
import { exportToCSV } from "@/lib/export";
import {
  AreaChart,
  Area,
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
  Activity,
  ArrowUpRight,
  Award,
  Calendar,
  CalendarDays,
  CheckCircle2,
  PhilippinePeso,
  Download,
  Fuel,
  Layers,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react";

const PIE_COLORS = {
  Healthy: "#10b981",
  "Medium Risk": "#3b82f6",
  "High Risk": "#f59e0b",
  Critical: "#ef4444",
  Overdue: "#dc2626",
};

// The app's `@theme inline` tokens are NOT emitted as raw CSS variables, so
// `var(--success)` etc. resolve to nothing and render black. Use the design
// system's actual hex values for chart strokes/fills instead.
const CHART = {
  info: "#3b82f6",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
};

/* ── Motion language ───────────────────────────────────────────────
   One shared ease curve (same as the auth surfaces) and one set of
   entrance variants. Every reveal uses transform + opacity only, and
   MotionConfig reducedMotion="user" collapses it for reduced-motion
   users. */
const EASE = [0.32, 0.72, 0, 1];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

const VIEWPORT = { once: true, margin: "-60px" };

// Shared recharts styling — keeps every chart consistent.
const AXIS_TICK = { fontSize: 11, fill: "var(--fg-muted)", fontWeight: "600" };
const AXIS_TICK_SM = { fontSize: 10, fill: "var(--fg-muted)", fontWeight: "600" };
const GRID = { strokeDasharray: "3 3", stroke: "var(--br)", strokeOpacity: 0.55, vertical: false };

// Card shadows — one source of truth for the floating-card language.
const KPI_SHADOW = "shadow-[0_1px_2px_rgba(17,24,39,0.04),0_24px_48px_-32px_rgba(17,24,39,0.3)]";
const KPI_SHADOW_HOVER = "hover:shadow-[0_28px_56px_-32px_rgba(17,24,39,0.38)]";
const CARD_SHADOW = "shadow-[0_1px_2px_rgba(17,24,39,0.04),0_20px_44px_-30px_rgba(17,24,39,0.28)]";
const CARD_SHADOW_HOVER = "hover:shadow-[0_24px_52px_-30px_rgba(17,24,39,0.34)]";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ── Chart tooltip & tick formatting — inverted for contrast on both themes ── */
function formatCurrencyK(val) {
  const n = Number(val) || 0;
  if (n >= 1000000) return `₱${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `₱${(n / 1000).toFixed(0)}k`;
  if (n === 0) return "₱0";
  return `₱${n}`;
}

function formatLitersK(val) {
  const n = Number(val) || 0;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k L`;
  if (n === 0) return "0 L";
  return `${n} L`;
}

function tooltipValue(entry) {
  const name = (entry.name || "").toLowerCase();
  if (name.includes("cost") || name.includes("expense")) return formatCurrency(entry.value);
  if (name.includes("liters") || name.includes("volume")) return `${Number(entry.value).toLocaleString()} L`;
  return Number(entry.value).toLocaleString();
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  const costEntry = payload.find(
    (p) => (p.name || "").toLowerCase().includes("cost") || (p.name || "").toLowerCase().includes("expense")
  );
  const litersEntry = payload.find(
    (p) => (p.name || "").toLowerCase().includes("liters") || (p.name || "").toLowerCase().includes("volume")
  );
  const unitRate =
    costEntry && litersEntry && Number(litersEntry.value) > 0
      ? (Number(costEntry.value) / Number(litersEntry.value)).toFixed(2)
      : null;

  return (
    <div className="min-w-[190px] rounded-2xl bg-foreground p-4 text-surface shadow-[0_24px_60px_-24px_rgba(17,24,39,0.5)] ring-1 ring-white/10">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-60">{label}</p>
      <div className="mt-2.5 space-y-2">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2 text-xs font-medium opacity-85">
              <span className="h-2 w-2 rounded-full" style={{ background: entry.color || entry.fill }} />
              {entry.name}
            </span>
            <span className="font-data text-[13px] font-bold">{tooltipValue(entry)}</span>
          </div>
        ))}
      </div>
      {unitRate && (
        <div className="mt-2.5 flex items-center justify-between border-t border-surface/15 pt-2 text-[11px]">
          <span className="font-medium opacity-70">Unit Efficiency</span>
          <span className="font-data font-bold text-success">₱{unitRate} / L</span>
        </div>
      )}
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

/* ── KPI cards ────────────────────────────────────────────────────── */
const KPI_TONES = {
  success: { deltaText: "text-success", glow: "from-success/15" },
  primary: { deltaText: "text-foreground-secondary", glow: "from-primary/10" },
  info: { deltaText: "text-info", glow: "from-info/15" },
  danger: { deltaText: "text-warning", glow: "from-danger/15" },
};

function KpiCard({ label, value, delta, deltaIcon = false, context, tone }) {
  const t = KPI_TONES[tone] || KPI_TONES.primary;
  return (
    <motion.div
      variants={item}
      className={cn(
        "group relative overflow-hidden rounded-[1.6rem] bg-surface p-6 ring-1 ring-black/[0.04] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 dark:ring-white/[0.06]",
        KPI_SHADOW,
        KPI_SHADOW_HOVER
      )}
    >
      {/* Tonal glow washing down from the top edge */}
      <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent", t.glow)} />
      <p className="relative text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-muted">{label}</p>
      <div className="relative mt-3.5 flex items-end justify-between gap-3">
        <p className="font-data text-[2.1rem] font-bold leading-none tracking-tight text-foreground">{value}</p>
        <span className={cn("flex shrink-0 items-center gap-0.5 pb-1 font-data text-xs font-bold", t.deltaText)}>
          {deltaIcon && <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.25} />}
          {delta}
        </span>
      </div>
      <p className="relative mt-2.5 text-[11px] font-medium text-foreground-secondary">{context}</p>
    </motion.div>
  );
}

/* ── Chart card shell ────────────────────────────────────────────── */
function ChartCard({ icon: Icon, iconTone, title, subtitle, actions, className, children }) {
  return (
    <motion.div
      variants={item}
      className={cn(
        "group rounded-[1.75rem] border border-border/70 bg-surface p-5 transition-shadow duration-500 sm:p-6",
        CARD_SHADOW,
        CARD_SHADOW_HOVER,
        className
      )}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-none", iconTone)}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-bold tracking-tight text-foreground">{title}</h3>
            {subtitle && <p className="mt-0.5 truncate text-xs font-medium text-foreground-muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center">{actions}</div>}
      </header>
      {children}
    </motion.div>
  );
}

/* ── Segmented toggle (pill with sliding indicator) ──────────────── */
function SegmentedToggle({ value, onChange, layoutId, options }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-hover/70 p-1 ring-1 ring-border/60">
      {options.map((opt) => {
        const active = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              "relative cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
              active ? "text-foreground" : "text-foreground-muted hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-surface shadow-[0_1px_4px_rgba(17,24,39,0.18)] ring-1 ring-border/50"
                transition={{ type: "spring", stiffness: 480, damping: 38 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Timeframe segmented control ─────────────────────────────────── */
function TimeframeControl({ value, onChange }) {
  const options = [
    { id: "7d", label: "7 Days" },
    { id: "30d", label: "30 Days" },
    { id: "month", label: "This Month" },
    { id: "all", label: "All Time" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-full bg-hover/70 p-1 ring-1 ring-border/60">
      {options.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            aria-pressed={active}
            className={cn(
              "relative cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
              active ? "text-surface" : "text-foreground-secondary hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId="timeframe-pill"
                className="absolute inset-0 rounded-full bg-foreground shadow-[0_2px_10px_rgba(17,24,39,0.28)]"
                transition={{ type: "spring", stiffness: 480, damping: 38 }}
              />
            )}
            <span className="relative z-10">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function AnalyticsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);
  const reducedMotion = useReducedMotion();

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

  // AI Analyst narrative — one consolidated snapshot across all executive KPIs.
  const narrativeData = useMemo(
    () => ({
      utilization: f.utilization,
      totalTrips: f.totalTrips,
      totalDistance: f.totalDistance,
      totalLiters: fu.totalLiters,
      totalCost: fi.totalCost || fi.fuelCost,
      tripCost: fi.tripCost,
      fuelCost: fi.fuelCost,
      maintCost: fi.maintCost,
      costPerKm: fi.costPerKm,
      maintDue,
      avgScore: driversPerformance?.avgScore ?? 0,
    }),
    [f, fu, fi, driversPerformance, maintDue]
  );

  const [narrativeForce, setNarrativeForce] = useState(0);

  const { data: narrative, isLoading: narrativeLoading, isFetching: narrativeFetching } = useQuery({
    queryKey: ["report-narrative", "analytics", dateBounds, narrativeForce],
    queryFn: () => getReportNarrative("analytics", narrativeData, dateBounds, narrativeForce > 0),
  });

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
    return (fu.byCategory || []).map((c) => ({
      category: c.category || "General Fleet",
      liters: Math.round(c.liters || 0),
      cost: Math.round(c.cost || 0),
    }));
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
    return [];
  }, [predictionData]);

  const totalRiskCount = useMemo(() => {
    return maintenanceRiskPie.reduce((acc, curr) => acc + curr.value, 0);
  }, [maintenanceRiskPie]);

  const monthlyCostData = useMemo(() => {
    return (fu.monthlyData || []).map((m) => ({
      month: m.month,
      fuelCost: Math.round(m.cost || 0),
      liters: Math.round(m.liters || 0),
    }));
  }, [fu.monthlyData]);

  const driverRoster = useMemo(() => {
    const list = driversPerformance?.topDrivers;
    if (Array.isArray(list) && list.length > 0) {
      return list.slice(0, 5).map((d) => ({
        id: d.driver_id,
        name: d.name || `Driver #${d.driver_id}`,
        trips: Number(d.trips) || 0,
        score: Math.round(Number(d.score) || 0),
      }));
    }
    return [];
  }, [driversPerformance]);

  const [volumeView, setVolumeView] = useState("chart"); // "chart" | "calendar"

  const calendarData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthTotalDays = new Date(year, month, 0).getDate();

    const countMap = new Map();
    let totalMonthlyRequests = 0;
    let activeDays = 0;
    reservations.forEach((r) => {
      const key = localDayOf(r.created_at || r.pickup_datetime);
      if (key) {
        countMap.set(key, (countMap.get(key) || 0) + 1);
      }
    });

    let maxCount = 0;
    let peakDayNum = null;

    const days = [];
    // Previous month ghost days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const prevNum = prevMonthTotalDays - i;
      days.push({
        id: `prev-${prevNum}`,
        dayNumber: prevNum,
        isPadding: true,
      });
    }

    // Current month days
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dateStr = toCalendarDay(dateObj);
      const realCount = countMap.get(dateStr) || 0;
      totalMonthlyRequests += realCount;
      if (realCount > 0) activeDays += 1;
      if (realCount > maxCount) {
        maxCount = realCount;
        peakDayNum = d;
      }

      days.push({
        id: dateStr,
        dayNumber: d,
        dateStr,
        dateObj,
        count: realCount,
        isToday: d === now.getDate(),
        weekday: dateObj.toLocaleString("en-US", { weekday: "short" }),
      });
    }

    // Trailing days for grid completion
    const remainingSlots = (7 - (days.length % 7)) % 7;
    for (let nextD = 1; nextD <= remainingSlots; nextD++) {
      days.push({
        id: `next-${nextD}`,
        dayNumber: nextD,
        isPadding: true,
      });
    }

    const avgDaily = totalDaysInMonth > 0 ? (totalMonthlyRequests / totalDaysInMonth).toFixed(1) : "0.0";

    return {
      days,
      monthName,
      totalMonthlyRequests,
      activeDays,
      maxCount: Math.max(maxCount, 1),
      peakDayNum,
      avgDaily,
    };
  }, [reservations]);

  // Donut center count-up.
  const [riskCount, setRiskCount] = useState(0);
  useEffect(() => {
    if (reducedMotion) {
      setRiskCount(totalRiskCount);
      return;
    }
    const controls = animate(0, totalRiskCount, {
      duration: 1.1,
      ease: EASE,
      onUpdate: (v) => setRiskCount(Math.round(v)),
    });
    return () => controls.stop();
  }, [totalRiskCount, reducedMotion]);

  // Unique gradient ids per chart instance.
  const rawId = useId().replace(/:/g, "");
  const areaGradId = `${rawId}-area`;
  const fuelCostGradId = `${rawId}-fuelCost`;
  const fuelLitersGradId = `${rawId}-fuelLiters`;
  const monthlyCostAreaGradId = `${rawId}-monthlyCost`;
  const monthlyLitersBarGradId = `${rawId}-monthlyLiters`;

  const totalFuelCategoryStats = useMemo(() => {
    const totalCost = fuelByCategory.reduce((acc, c) => acc + (Number(c.cost) || 0), 0);
    const totalLiters = fuelByCategory.reduce((acc, c) => acc + (Number(c.liters) || 0), 0);
    const avgRate = totalLiters > 0 ? (totalCost / totalLiters).toFixed(2) : "0.00";
    return { totalCost, totalLiters, avgRate };
  }, [fuelByCategory]);

  const monthlyFuelStats = useMemo(() => {
    const totalCost = monthlyCostData.reduce((acc, m) => acc + (Number(m.fuelCost) || 0), 0);
    const totalLiters = monthlyCostData.reduce((acc, m) => acc + (Number(m.liters) || 0), 0);
    const latest = monthlyCostData[monthlyCostData.length - 1];
    const prev = monthlyCostData.length >= 2 ? monthlyCostData[monthlyCostData.length - 2] : null;
    const momChange =
      prev && prev.fuelCost > 0
        ? (((latest.fuelCost - prev.fuelCost) / prev.fuelCost) * 100).toFixed(1)
        : null;
    return { totalCost, totalLiters, momChange, latest, prev };
  }, [monthlyCostData]);

  const kpis = [
    {
      label: "Total Operational Cost",
      value: formatCurrency(fi.totalCost || 0),
      tone: "success",
      context: "Fuel & maintenance total",
    },
    {
      label: "Cost Per Kilometer",
      value: formatCurrency(fi.costPerKm || 0),
      tone: "primary",
      context: `${formatDistance(f.totalDistance || 0)} total distance`,
    },
    {
      label: "Fleet Utilization",
      value: `${f.utilization || 0}%`,
      tone: "info",
      context: `${f.totalTrips || 0} total trips completed`,
    },
    {
      label: "Maintenance Risk Due",
      value: maintDue || 0,
      tone: maintDue > 0 ? "danger" : "success",
      delta: maintDue > 0 ? "Action Needed" : null,
      context: `${maintDue || 0} vehicles need service`,
    },
  ];

  const driverRowVariant = {
    hidden: { opacity: 0, y: 16 },
    show: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE, delay: i * 0.06 } }),
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative w-full select-none space-y-6 pb-16">
        {/* Ambient background orbs — decorative, painted behind the cards */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] overflow-hidden">
          <div className="absolute -top-24 right-[6%] h-80 w-80 rounded-full bg-primary/[0.05] blur-3xl" />
          <div className="absolute left-[24%] top-16 h-72 w-72 rounded-full bg-info/[0.06] blur-3xl" />
          <div className="absolute right-[38%] top-40 h-64 w-64 rounded-full bg-success/[0.05] blur-3xl" />
        </div>

        {/* ── HERO HEADER BAR ── */}
        <motion.div variants={item} initial="hidden" animate="show" className="relative">
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
                className={cn(
                  "group h-11 cursor-pointer rounded-full pl-5 pr-1.5 text-xs font-bold shadow-2xs",
                  heroButtonPrimaryClass
                )}
              >
                <Download className="mr-2 h-4 w-4" strokeWidth={1.75} />
                Export Analytics CSV
                <span className="ml-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-black transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 dark:bg-white/10 dark:text-white">
                  <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
                </span>
              </Button>
            }
          >
            <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/80 dark:border-black/10 dark:bg-black/5 dark:text-slate-600">
              <span className="relative flex h-2 w-2">
                <motion.span
                  className="absolute inline-flex h-full w-full rounded-full bg-emerald-400"
                  animate={{ scale: [1, 2.6], opacity: [0.5, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Live Telemetry
            </span>
          </HeroHeader>
        </motion.div>

        {/* ── TIMEFRAME SELECTOR ── */}
        <motion.div variants={item} initial="hidden" animate="show" className="relative">
          <div className="flex flex-col gap-4 rounded-[1.75rem] border border-border/70 bg-surface px-5 py-4 shadow-[0_1px_2px_rgba(17,24,39,0.04),0_16px_36px_-30px_rgba(17,24,39,0.25)] md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <Calendar className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-foreground">Timeframe Period</p>
                <p className="mt-0.5 text-[11px] font-medium text-foreground-muted">
                  {dateBounds.from} → {dateBounds.to}
                </p>
              </div>
            </div>
            <TimeframeControl value={dateRange} onChange={setDateRange} />
          </div>
        </motion.div>

        {/* ── AI ANALYST NARRATIVE (Tier 1) ── */}
        <motion.div variants={item} initial="hidden" whileInView="show" viewport={VIEWPORT}>
          <AiAnalystCard
            title="AI Analyst · Executive Telemetry"
            reportLabel="Consolidated analysis of utilization, cost-per-km, and maintenance risk"
            loading={narrativeLoading || narrativeFetching}
            data={narrative}
            onRegenerate={() => setNarrativeForce((n) => n + 1)}
            isRegenerating={narrativeFetching}
          />
        </motion.div>

        {/* ── EXECUTIVE KPI CARDS ── */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={VIEWPORT}
          className="relative grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4"
        >
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </motion.div>

        {/* ── CHARTS ROW 1: Pickup Volume & Fleet Risk ── */}
        <div className="relative grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          {/* Pickup Volume — large area chart with dual view toggle */}
          <ChartCard
            className="lg:col-span-7"
            icon={Activity}
            iconTone="bg-info/10 text-info border-info/20"
            title="Pickup Request & Booking Volume"
            subtitle="Requests per day across the selected period"
            actions={
              <SegmentedToggle
                value={volumeView}
                onChange={setVolumeView}
                layoutId="volume-view-pill"
                options={[
                  { value: "chart", icon: Activity, label: "Trend" },
                  { value: "calendar", icon: Calendar, label: "Calendar" },
                ]}
              />
            }
          >
            <AnimatePresence mode="wait" initial={false}>
              {volumeView === "chart" ? (
                <motion.div
                  key="chart"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="h-[300px]"
                >
                  <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    {/* Keyed by timeframe so switching ranges visibly re-draws the series */}
                    <AreaChart key={dateRange} data={pickupDemandTrend} margin={{ top: 10, right: 6, left: -8, bottom: 0 }}>
                      <defs>
                        <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART.info} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={CHART.info} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...GRID} />
                      <XAxis
                        dataKey="date"
                        tick={AXIS_TICK}
                        axisLine={false}
                        tickLine={false}
                        dy={8}
                        interval="preserveStartEnd"
                        minTickGap={24}
                      />
                      <YAxis
                        allowDecimals={false}
                        width={38}
                        tick={AXIS_TICK}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--br)", strokeWidth: 1, strokeDasharray: "4 4" }} />
                      <Area
                        type="monotone"
                        dataKey="requests"
                        name="Booking Requests"
                        stroke={CHART.info}
                        strokeWidth={2.5}
                        fill={`url(#${areaGradId})`}
                        dot={false}
                        activeDot={{ r: 6, strokeWidth: 2, stroke: "var(--sf)" }}
                        animationDuration={reducedMotion ? 0 : 900}
                        animationEasing="ease-out"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </motion.div>
              ) : (
                /* CALENDAR HEATMAP VIEW */
                <motion.div
                  key="calendar"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="space-y-3 pt-0.5"
                >
                  {/* Calendar Top Context & Metrics Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-info/10 text-info ring-1 ring-info/20">
                        <CalendarDays className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-xs font-extrabold tracking-tight text-foreground">
                        {calendarData.monthName}
                      </span>
                      <span className="text-[11px] font-medium text-foreground-muted">
                        • {calendarData.totalMonthlyRequests} total bookings
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {calendarData.peakDayNum && calendarData.maxCount > 1 && (
                        <div className="flex items-center gap-1 rounded-full bg-info/10 px-2.5 py-0.5 text-[10.5px] font-bold text-info ring-1 ring-info/25">
                          <Sparkles className="h-3 w-3" />
                          <span>Peak: Day {calendarData.peakDayNum} ({calendarData.maxCount} req)</span>
                        </div>
                      )}
                      <div className="rounded-full bg-muted/40 px-2.5 py-0.5 text-[10.5px] font-medium text-foreground-muted">
                        Avg: <strong className="font-bold text-foreground">{calendarData.avgDaily}</strong>/day
                      </div>
                    </div>
                  </div>

                  {/* Weekday Header Row */}
                  <div className="grid grid-cols-7 gap-1.5 text-center text-[10.5px] font-extrabold uppercase tracking-widest text-foreground-muted">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <div key={day} className="rounded-lg border border-border/40 bg-muted/15 py-1">
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Calendar 7-Column Heatmap Grid */}
                  <div className="grid grid-cols-7 gap-1.5">
                    {calendarData.days.map((d) => {
                      if (d.isPadding) {
                        return (
                          <div
                            key={d.id}
                            className="flex min-h-[52px] flex-col justify-between rounded-xl border border-dashed border-border/25 bg-muted/5 p-1.5 opacity-25 select-none"
                          >
                            <span className="text-[10px] font-medium text-foreground-muted">{d.dayNumber}</span>
                          </div>
                        );
                      }

                      const ratio = d.count / calendarData.maxCount;
                      const isZero = d.count === 0;
                      const isPeak = d.count > 0 && d.count === calendarData.maxCount && d.count >= 5;
                      const isHigh = !isZero && !isPeak && (ratio >= 0.6 || d.count >= 8);
                      const isMed = !isZero && !isPeak && !isHigh && (ratio >= 0.25 || d.count >= 3);
                      const isLow = !isZero && !isPeak && !isHigh && !isMed;

                      return (
                        <div
                          key={d.id}
                          className={cn(
                            "group relative flex min-h-[52px] flex-col justify-between rounded-xl border p-1.5 select-none transition-all duration-200",
                            "ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-1 hover:shadow-md hover:z-20",
                            d.isToday ? "ring-2 ring-primary border-primary shadow-xs" : "",
                            isPeak
                              ? "border-info/60 bg-gradient-to-br from-info/25 via-info/15 to-primary/10 text-foreground ring-1 ring-info/35 shadow-xs hover:border-info"
                              : isHigh
                                ? "border-info/40 bg-info/15 text-foreground hover:bg-info/25 hover:border-info/60"
                                : isMed
                                  ? "border-info/25 bg-info/10 text-foreground hover:bg-info/20 hover:border-info/40"
                                  : isLow
                                    ? "border-info/15 bg-info/5 text-foreground hover:bg-info/15 hover:border-info/30"
                                    : "border-border/60 bg-surface hover:bg-hover hover:border-border text-foreground-muted"
                          )}
                        >
                          {/* Top Row: Day number + Today / Peak indicators */}
                          <div className="flex items-center justify-between text-[10.5px]">
                            <span
                              className={cn(
                                "font-bold",
                                d.isToday
                                  ? "rounded-md bg-primary px-1.5 py-0.2 text-[10px] font-black text-surface"
                                  : isZero
                                    ? "text-foreground-muted/70 font-medium"
                                    : "text-foreground font-extrabold"
                              )}
                            >
                              {d.dayNumber}
                            </span>
                            {isPeak ? (
                              <span className="flex items-center gap-0.5 text-[8.5px] font-black uppercase tracking-wider text-info bg-info/20 px-1 py-0.2 rounded-full">
                                <Sparkles className="h-2.5 w-2.5 text-info" />
                              </span>
                            ) : d.isToday ? (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                            ) : null}
                          </div>

                          {/* Bottom Row: Count Pill with dynamic badges */}
                          <div className="text-right">
                            {d.count > 0 ? (
                              <span
                                className={cn(
                                  "font-data text-[10px] rounded-md px-1.5 py-0.5 transition-colors",
                                  isPeak
                                    ? "bg-info font-black text-white shadow-xs"
                                    : isHigh
                                      ? "bg-info/25 text-info font-bold ring-1 ring-info/30"
                                      : isMed
                                        ? "bg-info/20 text-info font-bold"
                                        : "bg-info/10 text-info font-semibold"
                                )}
                              >
                                {d.count} <span className="text-[8.5px] opacity-80">req</span>
                              </span>
                            ) : (
                              <span className="font-data text-[9.5px] text-foreground-muted/40 font-medium pr-1">
                                -
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bottom Legend */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/40 text-[11px] text-foreground-muted px-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium">
                      <span className="h-2 w-2 rounded-full bg-primary" /> Current Day Indicator
                    </span>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-foreground-muted">Heatmap:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-foreground-muted">0</span>
                        <div className="h-3.5 w-3.5 rounded border border-border/60 bg-surface" />
                        <div className="h-3.5 w-3.5 rounded border border-info/15 bg-info/5" />
                        <div className="h-3.5 w-3.5 rounded border border-info/25 bg-info/10" />
                        <div className="h-3.5 w-3.5 rounded border border-info/40 bg-info/20" />
                        <div className="h-3.5 w-3.5 rounded border border-info/60 bg-info/35" />
                        <span className="text-[10px] font-bold text-info">Peak</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </ChartCard>

          {/* Fleet Risk Distribution — donut with animated count-up */}
          <ChartCard
            className="lg:col-span-5"
            icon={ShieldCheck}
            iconTone="bg-success/10 text-success border-success/20"
            title="Fleet Risk Distribution"
            subtitle="Predictive maintenance exposure by tier"
            actions={
              <Badge variant="success" className="rounded-full px-2.5 py-0.5 text-[10px] font-bold">
                92% Healthy
              </Badge>
            }
          >
            <div className="relative flex h-[230px] items-center justify-center">
              <ResponsiveContainer width="100%" height="100%" debounce={200}>
                <PieChart>
                  {/* Subtle background track */}
                  <Pie
                    data={[{ value: 1 }]}
                    dataKey="value"
                    innerRadius={64}
                    outerRadius={92}
                    fill="var(--br)"
                    opacity={0.25}
                    isAnimationActive={false}
                  />
                  {/* Rounded animated slices */}
                  <Pie
                    data={maintenanceRiskPie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={64}
                    outerRadius={92}
                    paddingAngle={5}
                    cornerRadius={7}
                    animationDuration={reducedMotion ? 0 : 1000}
                    animationEasing="ease-out"
                  >
                    {maintenanceRiskPie.map((entry) => (
                      <Cell key={entry.name} fill={PIE_COLORS[entry.name] || "#9ca3af"} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                <div className="relative mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-full border border-success/20 bg-success/10 text-success">
                  <motion.span
                    className="absolute inset-0 rounded-full border border-success/40"
                    animate={{ scale: [1, 1.45], opacity: [0.6, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                  />
                  <CheckCircle2 className="relative h-[18px] w-[18px]" strokeWidth={1.75} />
                </div>
                <p className="font-data text-4xl font-bold leading-none tracking-tight text-foreground">{riskCount}</p>
                <p className="mt-1.5 text-[9px] font-black uppercase tracking-[0.22em] text-foreground-muted">Monitored</p>
              </div>
            </div>

            {/* Risk legend */}
            <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
              {maintenanceRiskPie.map((item) => {
                const color = PIE_COLORS[item.name] || "#9ca3af";
                const pct = Math.round((item.value / totalRiskCount) * 100);
                return (
                  <div key={item.name} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground-secondary">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                      <span className="truncate">{item.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 font-data">
                      <span className="font-bold text-foreground">{item.value}</span>
                      <span className="text-[10px] font-semibold text-foreground-muted">{pct}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </ChartCard>
        </div>

        {/* ── CHARTS ROW 2: Fuel Volume vs Expense & Monthly Trend ── */}
        <div className="relative grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {/* Fuel Volume vs Expense by Class */}
          <ChartCard
            icon={Fuel}
            iconTone="bg-warning/10 text-warning border-warning/20"
            title="Fuel Volume vs Expense by Class"
            subtitle="Liters consumed vs ₱ spend across vehicle categories"
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-warning/25 bg-warning/10 px-2.5 py-0.5 text-[10.5px] font-bold text-warning">
                  <Fuel className="h-3 w-3" /> {totalFuelCategoryStats.totalLiters.toLocaleString()} L
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2.5 py-0.5 text-[10.5px] font-bold text-success">
                  {formatCurrency(totalFuelCategoryStats.totalCost)}
                </span>
              </div>
            }
          >
            <div className="space-y-4">
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                  <ComposedChart key={dateRange} data={fuelByCategory} margin={{ top: 14, right: 8, left: -6, bottom: 0 }}>
                    <defs>
                      <linearGradient id={fuelCostGradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.success} stopOpacity={0.95} />
                        <stop offset="100%" stopColor={CHART.success} stopOpacity={0.35} />
                      </linearGradient>
                      <linearGradient id={fuelLitersGradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.warning} stopOpacity={0.95} />
                        <stop offset="100%" stopColor={CHART.warning} stopOpacity={0.35} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...GRID} />
                    <XAxis
                      dataKey="category"
                      tick={AXIS_TICK_SM}
                      axisLine={false}
                      tickLine={false}
                      dy={8}
                      interval={0}
                    />
                    <YAxis
                      yAxisId="leftCost"
                      orientation="left"
                      width={48}
                      tick={AXIS_TICK}
                      tickFormatter={formatCurrencyK}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="rightLiters"
                      orientation="right"
                      width={44}
                      tick={AXIS_TICK}
                      tickFormatter={formatLitersK}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--hv)", opacity: 0.35 }} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, fontWeight: "700", paddingTop: 8 }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Bar
                      yAxisId="leftCost"
                      dataKey="cost"
                      name="Fuel Expense (₱)"
                      fill={`url(#${fuelCostGradId})`}
                      radius={[8, 8, 0, 0]}
                      maxBarSize={36}
                      animationDuration={reducedMotion ? 0 : 800}
                      animationEasing="ease-out"
                    />
                    <Bar
                      yAxisId="rightLiters"
                      dataKey="liters"
                      name="Fuel Volume (L)"
                      fill={`url(#${fuelLitersGradId})`}
                      radius={[8, 8, 0, 0]}
                      maxBarSize={36}
                      animationDuration={reducedMotion ? 0 : 800}
                      animationEasing="ease-out"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Category Breakdown Chips */}
              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                {fuelByCategory.map((c, i) => {
                  const pct =
                    totalFuelCategoryStats.totalCost > 0
                      ? Math.round((c.cost / totalFuelCategoryStats.totalCost) * 100)
                      : 0;
                  const unitPrice = c.liters > 0 ? (c.cost / c.liters).toFixed(2) : "0.00";
                  return (
                    <div
                      key={c.category || i}
                      className="group flex flex-col justify-between rounded-2xl border border-border/60 bg-surface p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-xs font-bold text-foreground">{c.category}</span>
                        <span className="rounded-full bg-muted/60 px-2 py-0.5 font-data text-[10px] font-bold text-foreground-muted">
                          {pct}% share
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between gap-2">
                        <div>
                          <span className="font-data text-sm font-black text-foreground">
                            {formatCurrency(c.cost)}
                          </span>
                          <span className="ml-1.5 font-data text-[11px] font-semibold text-warning">
                            {c.liters.toLocaleString()} L
                          </span>
                        </div>
                        <span className="font-data text-[10.5px] font-bold text-foreground-muted">
                          ₱{unitPrice}/L
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-success to-warning transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </ChartCard>

          {/* Monthly Fuel Expense & Consumption */}
          <ChartCard
            icon={PhilippinePeso}
            iconTone="bg-success/10 text-success border-success/20"
            title="Monthly Fuel Expense & Consumption"
            subtitle="Historical cost trajectory and volumetric consumption"
            actions={
              monthlyFuelStats.momChange ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold",
                    Number(monthlyFuelStats.momChange) >= 0
                      ? "border border-danger/20 bg-danger/10 text-danger"
                      : "border border-success/20 bg-success/10 text-success"
                  )}
                >
                  <TrendingUp className="h-3 w-3" />
                  {Number(monthlyFuelStats.momChange) >= 0
                    ? `+${monthlyFuelStats.momChange}%`
                    : `${monthlyFuelStats.momChange}%`}{" "}
                  MoM
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2.5 py-0.5 text-[10.5px] font-bold text-success">
                  {formatCurrency(monthlyFuelStats.totalCost)}
                </span>
              )
            }
          >
            <div className="space-y-4">
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%" debounce={200}>
                  <ComposedChart key={dateRange} data={monthlyCostData} margin={{ top: 14, right: 8, left: -6, bottom: 0 }}>
                    <defs>
                      <linearGradient id={monthlyCostAreaGradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.success} stopOpacity={0.38} />
                        <stop offset="100%" stopColor={CHART.success} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id={monthlyLitersBarGradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.warning} stopOpacity={0.92} />
                        <stop offset="100%" stopColor={CHART.warning} stopOpacity={0.35} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...GRID} />
                    <XAxis
                      dataKey="month"
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      dy={8}
                      interval={0}
                    />
                    <YAxis
                      yAxisId="leftCost"
                      orientation="left"
                      width={48}
                      tick={AXIS_TICK}
                      tickFormatter={formatCurrencyK}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="rightLiters"
                      orientation="right"
                      width={44}
                      tick={AXIS_TICK}
                      tickFormatter={formatLitersK}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      cursor={{ stroke: "var(--br)", strokeWidth: 1, strokeDasharray: "4 4" }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11, fontWeight: "700", paddingTop: 8 }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Area
                      yAxisId="leftCost"
                      type="monotone"
                      dataKey="fuelCost"
                      name="Fuel Expense (₱)"
                      stroke={CHART.success}
                      strokeWidth={3}
                      fill={`url(#${monthlyCostAreaGradId})`}
                      dot={{ r: 4, fill: CHART.success, strokeWidth: 2, stroke: "var(--sf)" }}
                      activeDot={{ r: 6, fill: CHART.success, strokeWidth: 2, stroke: "var(--sf)" }}
                      animationDuration={reducedMotion ? 0 : 800}
                      animationEasing="ease-out"
                    />
                    <Bar
                      yAxisId="rightLiters"
                      dataKey="liters"
                      name="Fuel Volume (L)"
                      fill={`url(#${monthlyLitersBarGradId})`}
                      radius={[8, 8, 0, 0]}
                      maxBarSize={36}
                      animationDuration={reducedMotion ? 0 : 800}
                      animationEasing="ease-out"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly Overview Chips */}
              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                {monthlyCostData.map((m, i) => {
                  const unitPrice = m.liters > 0 ? (m.fuelCost / m.liters).toFixed(2) : "0.00";
                  return (
                    <div
                      key={m.month || i}
                      className="group flex flex-col justify-between rounded-2xl border border-border/60 bg-surface p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-foreground">{m.month}</span>
                        <span className="rounded-full bg-success/10 px-2 py-0.5 font-data text-[10px] font-bold text-success">
                          ₱{unitPrice}/L
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between gap-2">
                        <span className="font-data text-sm font-black text-foreground">
                          {formatCurrency(m.fuelCost)}
                        </span>
                        <span className="font-data text-xs font-bold text-warning">
                          {m.liters.toLocaleString()} L
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </ChartCard>
        </div>

        {/* ── DRIVER SAFETY & PERFORMANCE LEADERBOARD ── */}
        <ChartCard
          icon={Award}
          iconTone="bg-warning/10 text-warning border-warning/20"
          title="Driver Safety & Performance Leaderboard"
          subtitle="Top-rated roster by composite safety score"
          actions={
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[11px] font-bold text-success">
              <Star className="h-3 w-3 fill-current" strokeWidth={1.75} /> Top Rated Roster
            </span>
          }
        >
          <div className="space-y-3">
            {driverRoster.map((d, index) => (
              <motion.div
                key={d.id ?? index}
                variants={driverRowVariant}
                custom={index}
                className={cn(
                  "group flex flex-col gap-3 rounded-2xl border border-border/60 bg-surface p-3.5 pl-4 transition-all duration-300 hover:-translate-y-px hover:border-primary/30 hover:bg-hover/40 sm:flex-row sm:items-center sm:justify-between",
                  index === 0 && "border-warning/25 bg-gradient-to-r from-warning/[0.05] to-transparent"
                )}
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <div
                    className={cn(
                      "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border font-data text-sm font-bold",
                      index === 0
                        ? "border-warning/40 bg-gradient-to-br from-warning/25 to-warning/5 text-warning"
                        : index === 1
                          ? "border-border/70 bg-hover text-foreground"
                          : "border-primary/25 bg-primary/10 text-primary"
                    )}
                  >
                    {index + 1}
                    {index === 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-warning text-white shadow-sm">
                        <Award className="h-3 w-3" fill="currentColor" strokeWidth={1.75} />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-extrabold text-foreground">{d.name}</p>
                    <p className="mt-0.5 text-[11px] font-medium text-foreground-muted">{d.trips} Trips Completed</p>
                  </div>
                </div>

                <div className="flex w-full items-center gap-4 sm:w-auto">
                  <div className="flex-1 space-y-1.5 sm:w-48">
                    <div className="flex justify-between text-[11px] font-bold">
                      <span className="text-foreground-muted">Safety Score</span>
                      <span className="font-data text-foreground">{d.score}/100</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
                      <motion.div
                        className="h-full origin-left rounded-full bg-gradient-to-r from-primary to-success"
                        style={{ width: `${Math.min(100, d.score)}%` }}
                        initial={{ scaleX: 0 }}
                        whileInView={{ scaleX: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.9, ease: EASE, delay: 0.15 + index * 0.05 }}
                      />
                    </div>
                  </div>

                  <Badge variant={d.score >= 90 ? "success" : "info"} className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold">
                    <Star className="mr-1 h-3 w-3 fill-current" strokeWidth={1.75} />
                    {d.score >= 95 ? "Master Driver" : d.score >= 90 ? "Excellent" : "Proficient"}
                  </Badge>
                </div>
              </motion.div>
            ))}
          </div>
        </ChartCard>
      </div>
    </MotionConfig>
  );
}
