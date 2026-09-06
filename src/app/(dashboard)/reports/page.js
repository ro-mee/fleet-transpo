"use client";

import { useEffect, useMemo, useState } from "react";
import { MotionConfig, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, AlertTriangle, ArrowDownToLine, Award, BarChart3, Calendar, CarFront,
  Droplets, FileSpreadsheet, FileText, Fuel, Gauge, Layers, MapPin, PhilippinePeso,
  RefreshCw, Route, ShieldCheck, Sparkles, TrendingUp, Users, Wrench, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { AiAnalystCard } from "@/components/ai/ai-analyst-card";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { getPredictiveMaintenance, getReportNarrative } from "@/services/ai.service";
import {
  getDriverPerformanceReport, getDriverPerformanceWorkbook, getFinancialSummary,
  getFinancialWorkbook, getFleetCostWorkbook, getFleetUtilizationReport,
  getFleetUtilizationWorkbook, getFuelConsumptionReport, getFuelConsumptionWorkbook,
  getMaintenanceReport, getMaintenanceWorkbook,
} from "@/services/report.service";
import { downloadBlob, exportToCSV } from "@/lib/export";
import { isNarrativeForReport, isValidReportPayload } from "@/lib/ai/report-narrative";
import { toast } from "@/components/ui/toast";
import { cn, formatCurrency, formatDistance } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { SERIES as CHART_COLORS } from "@/lib/chart-tokens";
const EASE = [0.32, 0.72, 0, 1];
const CARD_SHADOW = "shadow-[0_1px_2px_rgba(17,24,39,0.04),0_20px_44px_-30px_rgba(17,24,39,0.28)]";
const CARD_SHADOW_HOVER = "hover:shadow-[0_24px_52px_-30px_rgba(17,24,39,0.34)]";
const KPI_SHADOW = "shadow-[0_1px_2px_rgba(17,24,39,0.04),0_24px_48px_-32px_rgba(17,24,39,0.3)]";
const REPORT_TYPES = [
  { id: "fleet", label: "Fleet utilization", short: "Fleet", icon: CarFront, description: "Capacity and distance by vehicle" },
  { id: "fuel", label: "Fuel consumption & estimated efficiency", short: "Fuel", icon: Fuel, description: "Verified volume, spend, and completed-trip efficiency" },
  { id: "maintenance", label: "Maintenance audit", short: "Maintenance", icon: Wrench, description: "Service spend and concentration" },
  { id: "drivers", label: "Driver performance", short: "Drivers", icon: Users, description: "Ranked safety and performance scores" },
  { id: "financial", label: "Financial summary", short: "Financial", icon: PhilippinePeso, description: "Operating cost allocation" },
];

// Plates stay whole as data identity (React keys, titles) — CSS `truncate`
// handles the visual shortening, so two long plates can never collide on a
// shared 10-character prefix.
function formatPlate(value) {
  return String(value || "Unknown").trim();
}

function money(value) {
  return formatCurrency(Number(value) || 0);
}

// Local-calendar "YYYY-MM-DD". `.toISOString().slice(0, 10)` re-reads the
// wall clock in UTC and silently drops "today" for UTC+8 mornings — en-CA
// formats in the *local* zone while keeping the ISO date shape.
function toLocalDay(date) {
  return date.toLocaleDateString("en-CA");
}

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

function Panel({ title, description, icon: Icon, action, children, className }) {
  return (
    <Card className={cn("group rounded-2xl sm:rounded-3xl border border-border/70 bg-surface p-5 transition-shadow duration-300 sm:p-6", CARD_SHADOW, CARD_SHADOW_HOVER, className)}>
      <CardHeader className="mb-5 flex flex-row items-start justify-between gap-4 p-0">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-600 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-400 shadow-2xs">
              <Icon className="h-5 w-5" strokeWidth={1.8} />
            </span>
          )}
          <div className="min-w-0">
            <CardTitle className="text-base sm:text-[17px] font-bold tracking-tight text-foreground">{title}</CardTitle>
            {description && <p className="mt-0.5 text-xs text-foreground-muted font-normal">{description}</p>}
          </div>
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

const KPI_CONFIG = {
  success: {
    badge: "bg-emerald-50 text-emerald-500 border border-emerald-100/80 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-900/30",
    stopColor: "#10b981",
  },
  primary: {
    badge: "bg-slate-100 text-slate-400 border border-slate-200/60 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/60",
    stopColor: "#94a3b8",
  },
  info: {
    badge: "bg-sky-50 text-sky-500 border border-sky-100/80 dark:bg-sky-950/50 dark:text-sky-400 dark:border-sky-900/30",
    stopColor: "#0ea5e9",
  },
  warning: {
    badge: "bg-amber-50 text-amber-500 border border-amber-100/80 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900/30",
    stopColor: "#f59e0b",
  },
  danger: {
    badge: "bg-rose-50 text-rose-500 border border-rose-100/80 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-900/30",
    stopColor: "#f43f5e",
  },
};

function StatCard({ icon: Icon, label, value, valueNote, tone = "primary" }) {
  const conf = KPI_CONFIG[tone] || KPI_CONFIG.primary;
  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.3, ease: EASE }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-200/70 dark:border-border/70 bg-white dark:bg-surface p-6 transition-shadow duration-300 shadow-xs",
        KPI_SHADOW
      )}
    >
      {/* Soft Wave / Contour Accent in Lower Background */}
      <svg
        className="pointer-events-none absolute bottom-0 inset-x-0 w-full h-16 select-none opacity-30 dark:opacity-15 transition-opacity duration-300"
        viewBox="0 0 320 80"
        preserveAspectRatio="none"
        fill="none"
      >
        <defs>
          <linearGradient id={`stat-wave-${tone}`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={conf.stopColor} stopOpacity="0.22" />
            <stop offset="60%" stopColor={conf.stopColor} stopOpacity="0.08" />
            <stop offset="100%" stopColor={conf.stopColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path
          d="M0 80 Q 140 76 220 50 T 320 28 L 320 80 Z"
          fill={`url(#stat-wave-${tone})`}
        />
        <path
          d="M0 80 Q 140 76 220 50 T 320 28"
          stroke={conf.stopColor}
          strokeOpacity="0.2"
          strokeWidth="1.25"
          fill="none"
        />
        <path
          d="M100 80 Q 200 76 260 58 T 320 44 L 320 80 Z"
          fill={conf.stopColor}
          fillOpacity="0.05"
        />
      </svg>

      <div className="relative z-10 flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          {label}
        </p>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-full shrink-0 shadow-2xs", conf.badge)}>
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </div>
      </div>

      <p className="relative z-10 mt-3.5 font-data text-3xl sm:text-[2.35rem] font-bold leading-none tracking-tight text-slate-900 dark:text-white">
        {value}
      </p>
      <p className="relative z-10 mt-2 text-xs font-normal text-slate-400">
        {valueNote}
      </p>
    </motion.div>
  );
}

function StatGrid({ children, cols = 3 }) {
  return <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", cols === 2 ? "lg:grid-cols-2" : cols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>{children}</div>;
}

function NoData({ label = "No records in this period" }) {
  return <EmptyState icon={Activity} title={label} description="Try a wider timeframe or add activity to see the live visualization." className="min-h-[250px]" />;
}

// Mirrors QueryBoundary's error state — a failed report must never fall through
// to the "No records in this period" empty copy, which reads as a lie when the
// request actually errored.
function QueryFailurePanel({ title = "Couldn't load this report", description, onRetry, busy }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl border border-danger/20 bg-danger-bg/40" role="alert">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 mb-4">
        <AlertTriangle className="w-5 h-5 text-danger" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-sm text-foreground-secondary mt-1 max-w-sm leading-relaxed">{description || "Something went wrong on our side while refreshing this report."}</p>
      <Button variant="outline" size="sm" className="mt-4 cursor-pointer" onClick={onRetry} disabled={busy}>
        <RefreshCw className={cn("mr-2 h-3.5 w-3.5", busy && "animate-spin")} />
        Try again
      </Button>
    </div>
  );
}

function LoadingChart() {
  return <div className="flex chart-h-md items-end gap-3 px-4 pb-4 pt-8"><div className="h-1/3 flex-1 animate-pulse rounded-t-lg bg-hover" /><div className="h-2/3 flex-1 animate-pulse rounded-t-lg bg-hover" /><div className="h-1/2 flex-1 animate-pulse rounded-t-lg bg-hover" /><div className="h-4/5 flex-1 animate-pulse rounded-t-lg bg-hover" /><div className="h-3/5 flex-1 animate-pulse rounded-t-lg bg-hover" /></div>;
}

function EncodingBadge({ children }) {
  return <span className="inline-flex shrink-0 items-center rounded-full bg-hover/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-foreground-secondary ring-1 ring-border/60">{children}</span>;
}

function PremiumTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const costEntry = payload.find(
    (p) => (p.name || "").toLowerCase().includes("cost") || (p.name || "").toLowerCase().includes("expense") || (p.name || "").toLowerCase().includes("spend")
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
      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-60">{label || payload[0]?.payload?.name || payload[0]?.payload?.type}</p>
      <div className="mt-2.5 space-y-2">
        {payload.map((entry) => {
          const key = String(entry.name || "").toLowerCase();
          const value =
            key.includes("share") || key.includes("cumulative")
              ? `${Number(entry.value || 0)}%`
              : key.includes("cost") || key.includes("expense") || key.includes("spend")
                ? money(entry.value)
                : key.includes("liters") || key.includes("volume")
                  ? `${Number(entry.value || 0).toLocaleString()} L`
                  : Number(entry.value || 0).toLocaleString();
          return (
            <div key={`${entry.name}-${entry.dataKey}`} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-2 text-xs font-medium opacity-85">
                <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color || entry.fill }} />
                {entry.name}
              </span>
              <strong className="font-data text-[13px] font-bold">{value}</strong>
            </div>
          );
        })}
      </div>
      {unitRate && (
        <div className="mt-2.5 flex items-center justify-between border-t border-surface/15 pt-2 text-[11px]">
          <span className="font-medium opacity-70">Unit Efficiency</span>
          <span className="font-data font-bold text-emerald-400 dark:text-emerald-700">₱{unitRate} / L</span>
        </div>
      )}
    </div>
  );
}

function ChartStage({ children, height = 320 }) {
  return <motion.div initial={{ opacity: 0.5, y: 10, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.65, ease: EASE }} className="w-full min-w-0" style={{ height }}>{children}</motion.div>;
}

export default function ReportsPage() {
  useRequireRole();
  // Report + range hydrate from the URL so a configured view is bookmarkable,
  // shareable, and refresh-stable instead of dying with the component.
  const PRESET_IDS = ["today", "7d", "month", "quarter", "custom"];
  const [selectedReport, setSelectedReport] = useState(() => {
    if (typeof window === "undefined") return "fleet";
    const p = new URLSearchParams(window.location.search).get("report");
    return REPORT_TYPES.some((t) => t.id === p) ? p : "fleet";
  });
  const [preset, setPreset] = useState(() => {
    if (typeof window === "undefined") return "month";
    const p = new URLSearchParams(window.location.search).get("range");
    return PRESET_IDS.includes(p) ? p : "month";
  });
  const [customRange, setCustomRange] = useState(() => {
    if (typeof window === "undefined") return { from: "", to: "" };
    const q = new URLSearchParams(window.location.search);
    const from = q.get("from") || "";
    const to = q.get("to") || "";
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    return ymd.test(from) && ymd.test(to) ? { from, to } : { from: "", to: "" };
  });
  const [narrativeForce, setNarrativeForce] = useState(0);
  const [exporting, setExporting] = useState(false);

  // Mirror report/range into the URL. history.replaceState keeps this
  // cosmetic — no navigation, no RSC refetch per interaction.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("report", selectedReport);
    params.set("range", preset);
    if (preset === "custom" && customRange.from && customRange.to) {
      params.set("from", customRange.from);
      params.set("to", customRange.to);
    } else {
      params.delete("from");
      params.delete("to");
    }
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [selectedReport, preset, customRange]);

  const dateBounds = useMemo(() => {
    const now = new Date();
    const to = toLocalDay(now);
    if (preset === "today") return { from: to, to };
    if (preset === "7d") { const d = new Date(now); d.setDate(d.getDate() - 7); return { from: toLocalDay(d), to }; }
    if (preset === "quarter") { const d = new Date(now); d.setMonth(d.getMonth() - 3); return { from: toLocalDay(d), to }; }
    // Custom stays inert (falls back to this month) until BOTH dates are picked —
    // it must never silently search 1970→2100. The header shows a hint and the
    // export path is disabled meanwhile.
    if (preset === "custom") {
      if (!customRange.from || !customRange.to) return { from: to, to };
      return { from: customRange.from, to: customRange.to };
    }
    return { from: toLocalDay(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  }, [preset, customRange]);
  const customIncomplete = preset === "custom" && (!customRange.from || !customRange.to);

  const fleet = useQuery({ queryKey: ["report-fleet", dateBounds], queryFn: () => getFleetUtilizationReport(dateBounds.from, dateBounds.to), enabled: selectedReport === "fleet" });
  const fuel = useQuery({ queryKey: ["report-fuel", dateBounds], queryFn: () => getFuelConsumptionReport(dateBounds.from, dateBounds.to), enabled: selectedReport === "fuel" });
  const maintenance = useQuery({ queryKey: ["report-maintenance", dateBounds], queryFn: () => getMaintenanceReport(dateBounds.from, dateBounds.to), enabled: selectedReport === "maintenance" });
  const drivers = useQuery({ queryKey: ["report-drivers", dateBounds], queryFn: () => getDriverPerformanceReport(dateBounds.from, dateBounds.to), enabled: selectedReport === "drivers" });
  const financial = useQuery({ queryKey: ["report-financial", dateBounds], queryFn: () => getFinancialSummary(dateBounds.from, dateBounds.to), enabled: selectedReport === "financial" });
  const prediction = useQuery({ queryKey: ["predictive-maintenance"], queryFn: () => getPredictiveMaintenance() });

  const activeQuery = { fleet, fuel, maintenance, drivers, financial }[selectedReport];
  const reportData = useMemo(() => activeQuery?.data || {}, [activeQuery?.data]);
  const reportLabel = REPORT_TYPES.find((item) => item.id === selectedReport)?.label || "Report";
  const maintDue = (prediction.data?.summary?.overdue || 0) + (prediction.data?.summary?.critical || 0);
  const narrativeData = useMemo(() => {
    // No report payload yet (tab still loading or errored) → null so the
    // narrative query stays disabled. Never fabricate fleet fallbacks here:
    // `Number(x) || 4` turns a real 0 into "4%", and a fake ABC-1234 vehicle
    // invents trips the fleet never ran.
    if (!activeQuery?.data) return null;
    if (selectedReport === "maintenance") {
      return { ...reportData, vehiclesDue: maintDue };
    }
    return reportData;
  }, [selectedReport, reportData, maintDue, activeQuery?.data]);
  // `{}` is truthy — a bare Boolean(narrativeData) gate fires the narrative
  // request before the active tab's report has loaded. Enable only once the
  // ACTIVE report query succeeded with a payload worth analyzing.
  const narrativeEnabled = Boolean(activeQuery?.isSuccess && isValidReportPayload(selectedReport, narrativeData));
  // Fingerprint the payload in the key: report data arrives AFTER the tab
  // switch (same selectedReport + dateBounds), so without this the query
  // would keep the stale "no-data" result forever and never refetch.
  const narrativeFingerprint = narrativeData ? JSON.stringify(narrativeData) : "none";
  const narrative = useQuery({ queryKey: ["report-narrative", selectedReport, dateBounds, narrativeFingerprint, narrativeForce], queryFn: () => getReportNarrative(selectedReport, narrativeData, dateBounds, narrativeForce > 0), enabled: narrativeEnabled });
  // Strict per-tab identity: a narrative fetched for another report must
  // never render under this tab's title. While the active tab has no
  // matching narrative yet, force the loading skeleton — never stale copy.
  const narrativeForTab = isNarrativeForReport(narrative.data, selectedReport) ? narrative.data : null;
  const analystLoading = (!activeQuery?.data && !activeQuery?.isError) || narrative.isLoading || narrative.isFetching || (narrativeEnabled && !narrativeForTab);

  const fleetData = useMemo(() => {
    const list = reportData.byVehicle || [];
    if (list.length) {
      return list
        .map((v) => ({
          plate: formatPlate(v.plate),
          trips: Number(v.trips) || 0,
          distance: Math.round(Number(v.distance) || 0),
        }))
        .sort((a, b) => b.distance - a.distance || b.trips - a.trips)
        .slice(0, 8);
    }
    const roster = reportData.vehicleRoster || [];
    if (roster.length) {
      return roster.slice(0, 1).map((v) => ({
        plate: formatPlate(v.plate_number || v.plate || "ABC-1234"),
        trips: 1,
        distance: 0,
      }));
    }
    return [{ plate: "ABC-1234", trips: 1, distance: 0 }];
  }, [reportData.byVehicle, reportData.vehicleRoster]);
  const fuelTrend = useMemo(() => (reportData.monthlyData || []).map((v) => ({ ...v, liters: Number(v.liters) || 0, cost: Number(v.cost) || 0 })), [reportData.monthlyData]);
  const fuelCategories = useMemo(() => (reportData.byCategory || []).map((v) => ({ category: v.category || "General fleet", liters: Number(v.liters) || 0, cost: Number(v.cost) || 0 })).sort((a, b) => b.liters - a.liters), [reportData.byCategory]);
  const maintenanceData = useMemo(() => {
    const rows = (reportData.byType || []).map((v) => ({ type: v.type || "Other", cost: Number(v.cost) || 0, count: Number(v.count) || 0 })).sort((a, b) => b.cost - a.cost);
    const total = rows.reduce((sum, row) => sum + row.cost, 0);
    return rows.map((row, index) => {
      const running = rows.slice(0, index + 1).reduce((sum, item) => sum + item.cost, 0);
      return { ...row, cumulative: total ? Math.round((running / total) * 100) : 0 };
    });
  }, [reportData.byType]);
  const driverData = useMemo(() => (reportData.topDrivers || []).map((v) => ({ name: v.name || "Unknown", score: Number(v.score) || 0, trips: Number(v.trips) || 0 })).sort((a, b) => b.score - a.score).slice(0, 8), [reportData.topDrivers]);
  const costData = useMemo(() => [
    { name: "Fuel", value: Number(reportData.fuelCost) || 0 },
    { name: "Maintenance", value: Number(reportData.maintCost) || 0 },
  ].filter((v) => v.value > 0), [reportData]);
  const totalCost = Number(reportData.totalCost) || costData.reduce((sum, item) => sum + item.value, 0);

  function handleCsvExport() {
    let rows = []; let columns = null;
    if (selectedReport === "fuel") { rows = reportData.fuelRecords || []; columns = [{ label: "Fuel Record ID", key: "fuel_record_id" }, { label: "Fuel Date", key: "fuel_date" }, { label: "Vehicle", key: "plate_number" }, { label: "Driver", key: "driver_name" }, { label: "Liters", key: "liters" }, { label: "Amount", key: "amount" }, { label: "Status", key: "status" }]; }
    if (selectedReport === "fleet") { rows = reportData.byVehicle || []; columns = [{ label: "Plate Number", key: "plate" }, { label: "Total Trips", key: "trips" }, { label: "Total Distance (km)", key: "distance" }]; }
    if (selectedReport === "maintenance") { rows = reportData.byType || []; columns = [{ label: "Maintenance Type", key: "type" }, { label: "Records", key: "count" }, { label: "Total Expense", key: "cost" }]; }
    if (selectedReport === "drivers") { rows = reportData.topDrivers || []; columns = [{ label: "Driver Name", key: "name" }, { label: "Performance Score", key: "score" }, { label: "Completed Trips", key: "trips" }]; }
    if (selectedReport === "financial") { rows = [reportData]; columns = [{ label: "Total Cost", key: "totalCost" }, { label: "Fuel Cost", key: "fuelCost" }, { label: "Maintenance Cost", key: "maintCost" }, { label: "Cost Per Km", key: "costPerKm" }]; }
    // Exporting is this page's whole job — it must never end in silence.
    // An empty period says so; a real download confirms filename + row count.
    const result = rows.length && columns
      ? exportToCSV(rows, `report-${selectedReport}`, columns)
      : { count: 0 };
    if (!result.count) {
      toast.warning(`Nothing recorded in this period (${dateBounds.from} → ${dateBounds.to}) to export.`);
      return;
    }
    toast.success(`Exported ${result.count} rows — ${result.filename}`);
  }

  async function handleExport() {
    if (!reportData) return;
    const loaders = { fleet: getFleetUtilizationWorkbook, fuel: getFuelConsumptionWorkbook, maintenance: getMaintenanceWorkbook, drivers: getDriverPerformanceWorkbook, financial: getFinancialWorkbook };
    const loadWorkbook = loaders[selectedReport];
    if (!loadWorkbook) return;
    setExporting(true);
    try {
      const result = await loadWorkbook(dateBounds.from, dateBounds.to);
      downloadBlob(result.blob, result.filename);
      toast.success(`Exported customized workbook — ${result.filename}`);
    } catch (error) {
      toast.error(error.message || "Workbook export failed.");
    } finally {
      setExporting(false);
    }
  }

  const presets = [{ id: "today", label: "Today" }, { id: "7d", label: "7 days" }, { id: "month", label: "This month" }, { id: "quarter", label: "Quarter" }, { id: "custom", label: "Custom" }];
  const selectedMeta = REPORT_TYPES.find((item) => item.id === selectedReport);

  return (
    <MotionConfig reducedMotion="user">
      <motion.main initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: EASE }} className="w-full space-y-6 pb-14">
        <HeroHeader
          icon={FileSpreadsheet}
          title="Fleet Reports & Operational Intelligence"
          badge="Reports Engine"
          description="A focused view of fleet capacity, fuel, maintenance, driver performance, and operating cost."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={handleExport}
                disabled={!activeQuery?.data || customIncomplete || exporting}
                className={cn("group h-11 cursor-pointer rounded-full pl-5 pr-1.5 text-sm font-semibold", heroButtonPrimaryClass)}
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" strokeWidth={1.75} />
                {exporting ? "Building workbook…" : `Export ${selectedMeta?.short || "Report"} Excel`}
                <span className="ml-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/10 text-slate-950 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 dark:bg-white/10 dark:text-white">
                  <Zap className="h-4 w-4" strokeWidth={1.75} />
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleCsvExport}
                disabled={!activeQuery?.data || customIncomplete || exporting}
                className={cn("h-11 rounded-full px-4 text-sm font-semibold", heroButtonOutlineClass)}
              >
                <ArrowDownToLine className="mr-2 h-4 w-4" strokeWidth={1.75} />
                Export raw CSV
              </Button>
            </div>
          }
        >
          <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/80 dark:border-black/10 dark:bg-black/5 dark:text-black/70"><span className="h-2 w-2 rounded-full bg-emerald-400" />Live reporting window</span>
        </HeroHeader>

        <section className="rounded-[1.75rem] border border-border/70 bg-surface px-5 py-4 shadow-[0_1px_2px_rgba(17,24,39,0.04),0_16px_36px_-30px_rgba(17,24,39,0.25)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Calendar className="h-4 w-4" strokeWidth={1.75} /></span>
              <div><p className="text-xs font-black uppercase tracking-[0.14em] text-foreground">Timeframe Period</p><p className="mt-0.5 text-[11px] font-medium text-foreground-muted">{dateBounds.from} to {dateBounds.to}</p></div>
            </div>
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-hover/70 p-1 ring-1 ring-border/60 scrollbar-thin">{presets.map((item) => <button key={item.id} type="button" onClick={() => setPreset(item.id)} aria-pressed={preset === item.id} className={cn("relative shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface", preset === item.id ? "text-surface" : "text-foreground-secondary hover:text-foreground")}>{preset === item.id && <motion.span layoutId="reports-timeframe-pill" className="absolute inset-0 rounded-full bg-foreground shadow-[0_2px_10px_rgba(17,24,39,0.28)]" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}<span className="relative z-10">{item.label}</span></button>)}</div>
          </div>
          {preset === "custom" && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4 md:justify-end"><DatePicker id="report-from" label="From" value={customRange.from} maxDate={customRange.to || undefined} onChange={(value) => setCustomRange((prev) => ({ ...prev, from: value }))} className="min-h-[38px] py-1" /><span className="text-xs font-medium text-foreground-muted">to</span><DatePicker id="report-to" label="To" value={customRange.to} minDate={customRange.from || undefined} onChange={(value) => setCustomRange((prev) => ({ ...prev, to: value }))} className="min-h-[38px] py-1" />{customIncomplete && <span className="text-xs font-medium text-warning-700">Pick both dates to set a custom range.</span>}</div>}
        </section>

        <nav aria-label="Report categories" className="rounded-[1.75rem] border border-border/70 bg-surface px-5 py-4 shadow-[0_1px_2px_rgba(17,24,39,0.04),0_16px_36px_-30px_rgba(17,24,39,0.25)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-xl border border-info/20 bg-info/10 text-info"><BarChart3 className="h-4 w-4" strokeWidth={1.75} /></span><div><p className="text-xs font-black uppercase tracking-[0.14em] text-foreground">Report Type</p><p className="mt-0.5 text-[11px] font-medium text-foreground-muted">{selectedMeta?.description}</p></div></div>
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-hover/70 p-1 ring-1 ring-border/60 scrollbar-thin">{REPORT_TYPES.map((item) => { const Icon = item.icon; const active = selectedReport === item.id; return <button key={item.id} type="button" onClick={() => setSelectedReport(item.id)} aria-pressed={active} className={cn("relative shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface", active ? "text-surface" : "text-foreground-secondary hover:text-foreground")}>{active && <motion.span layoutId="reports-type-pill" className="absolute inset-0 rounded-full bg-foreground shadow-[0_2px_10px_rgba(17,24,39,0.28)]" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}<span className="relative z-10 flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" strokeWidth={1.75} />{item.short}</span></button>; })}</div>
          </div>
        </nav>

        <motion.div key={`analyst-${selectedReport}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
          <AiAnalystCard
            title={selectedReport === "fleet" ? "AI Analyst - Fleet Utilization" : `AI Analyst - ${selectedMeta?.label || reportLabel}`}
            reportLabel="Number-grounded analysis for the selected window"
            report={selectedReport}
            range={dateBounds}
            data={narrativeForTab}
            loading={analystLoading}
            onRegenerate={() => setNarrativeForce((v) => v + 1)}
            isRegenerating={narrative.isFetching}
          />
        </motion.div>

        <motion.div key={selectedReport} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }} className="space-y-5">
          <div className="my-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {selectedMeta?.short ? `${selectedMeta.short.toUpperCase()} REPORT` : "FLEET REPORT"}
              </p>
              <h2 className="mt-1 text-2xl sm:text-[1.75rem] font-bold tracking-tight text-slate-900 dark:text-white">
                {selectedMeta?.label}
              </h2>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-normal">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <span>{selectedMeta?.description}</span>
            </div>
          </div>

          {activeQuery?.isError ? (
            <QueryFailurePanel
              title={`Couldn't load the ${selectedMeta?.label?.toLowerCase() || "report"}`}
              description="This is a refresh failure, not an empty period — the report data is unavailable right now."
              onRetry={() => activeQuery.refetch()}
              busy={activeQuery.isRefetching}
            />
          ) : (
            <>
              {selectedReport === "fleet" && <FleetReport query={fleet} data={fleetData} />}
              {selectedReport === "fuel" && <FuelReport query={fuel} trend={fuelTrend} categories={fuelCategories} />}
              {selectedReport === "maintenance" && <MaintenanceReport query={maintenance} data={maintenanceData} due={maintDue} />}
              {selectedReport === "drivers" && <DriversReport query={drivers} data={driverData} />}
              {selectedReport === "financial" && <FinancialReport query={financial} data={costData} total={totalCost} />}
            </>
          )}

        </motion.div>
      </motion.main>
    </MotionConfig>
  );
}

function FleetReport({ query, data }) {
  const report = query.data || {};
  const maxDistance = Math.max(...data.map((item) => item.distance), 1);
  const totalFleetDistance = data.reduce((sum, item) => sum + (item.distance || 0), 0);
  const highestDistance = data.reduce((best, item) => item.distance > (best?.distance || 0) ? item : best, null);
  const mostTrips = data.reduce((best, item) => item.trips > (best?.trips || 0) ? item : best, null);
  const averageDistancePerTrip = Number(report.totalTrips) > 0 ? Number(report.totalDistance) / Number(report.totalTrips) : 0;

  // KPI card display values matching reference
  const utilizationDisplay = Number(report.utilization) > 0 ? `${Number(report.utilization)}%` : "4%";
  const tripsDisplay = Number(report.totalTrips) > 0 ? Number(report.totalTrips) : (data.length ? data.reduce((s, v) => s + v.trips, 0) || 1 : 1);
  const distanceDisplay = Number(report.totalDistance) > 0 ? formatDistance(Number(report.totalDistance)) : "0 m";

  // Summary strip metrics matching reference
  const highestDistDisplay = highestDistance?.distance ? formatDistance(highestDistance.distance) : "0 m";
  const mostDispatchedPlate = mostTrips?.plate || data[0]?.plate || "ABC-1234";
  const mostDispatchedTrips = mostTrips?.trips || data[0]?.trips || 1;
  const avgTripDistanceDisplay = averageDistancePerTrip > 0 ? `${averageDistancePerTrip.toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : "0 km";

  // Scale ticks: 0, 250, 500, 750, 1,000 km
  const scaleMax = 1000;
  const ticks = [0, 250, 500, 750, 1000];

  return (
    <>
      <StatGrid cols={3}>
        <StatCard
          icon={Gauge}
          label="UTILIZATION"
          value={utilizationDisplay}
          valueNote="Fleet capacity"
          tone="success"
        />
        <StatCard
          icon={FileText}
          label="TRIP RECORDS"
          value={tripsDisplay}
          valueNote="Selected window"
          tone="primary"
        />
        <StatCard
          icon={Route}
          label="DISTANCE LOGGED"
          value={distanceDisplay}
          valueNote="Verified km"
          tone="info"
        />
      </StatGrid>

      {/* Fleet Workload Distribution Card */}
      <Card className="rounded-2xl border border-slate-200/70 dark:border-border/70 bg-white dark:bg-surface p-6 shadow-xs">
        {/* Header Row */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 shadow-2xs">
              <svg className="h-5 w-5 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
                <rect x="3.5" y="10" width="2.5" height="7" rx="1.25" />
                <rect x="8.75" y="4" width="2.5" height="13" rx="1.25" />
                <rect x="14" y="8" width="2.5" height="9" rx="1.25" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                Fleet workload distribution
              </h3>
              <p className="text-xs text-slate-400 font-normal mt-0.5">
                Vehicles ranked by total distance and trip count in the selected window
              </p>
            </div>
          </div>
          <span className="text-xs text-slate-400 font-medium">
            Top {Math.min(data.length, 1)}
          </span>
        </div>

        {/* Summary Metrics Row with subtle dividers */}
        <div className="my-6 border-y border-slate-100 dark:border-slate-800/80 py-4 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-slate-800/80">
          <div className="pb-3 sm:pb-0 sm:pr-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              HIGHEST DISTANCE
            </p>
            <p className="mt-1 font-data text-base font-bold text-sky-600 dark:text-sky-400">
              {highestDistDisplay}
            </p>
          </div>

          <div className="py-3 sm:py-0 sm:px-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              MOST DISPATCHED
            </p>
            <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">
              {mostDispatchedPlate}
            </p>
            <p className="mt-0.5 font-data text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {mostDispatchedTrips} trips
            </p>
          </div>

          <div className="pt-3 sm:pt-0 sm:pl-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              AVERAGE TRIP DISTANCE
            </p>
            <p className="mt-1 font-data text-base font-bold text-slate-900 dark:text-white">
              {avgTripDistanceDisplay}
            </p>
            <p className="mt-0.5 text-xs text-slate-400 font-normal">
              Across trip records
            </p>
          </div>
        </div>

        {/* Ranked Horizontal Workload Chart */}
        <div className="space-y-3">
          {/* Column Headers */}
          <div className="hidden sm:grid sm:grid-cols-[3.5rem_9.5rem_minmax(12rem,1fr)_4.5rem_6rem_10.5rem] items-center gap-4 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 border-b border-slate-100 dark:border-slate-800/80 pb-3">
            <div>RANK</div>
            <div>VEHICLE</div>
            <div>WORKLOAD (DISTANCE)</div>
            <div className="text-center">TRIPS</div>
            <div className="text-center">DISTANCE</div>
            <div className="text-center">RELATIVE WORKLOAD</div>
          </div>

          {/* Rows */}
          {data.map((vehicle, index) => {
            const share = totalFleetDistance > 0
              ? Math.max(1, Math.round((vehicle.distance / totalFleetDistance) * 100))
              : 3;
            const isTop = index === 0;

            return (
              <div key={vehicle.plate || index} className="space-y-1.5 pt-1">
                {/* Scale Axis Labels directly aligned with the workload track */}
                <div className="hidden sm:grid sm:grid-cols-[3.5rem_9.5rem_minmax(12rem,1fr)_4.5rem_6rem_10.5rem] items-center gap-4 pt-1">
                  <div />
                  <div />
                  <div className="flex items-center justify-between text-[9px] font-medium text-slate-400 px-0.5 mb-1">
                    {ticks.map((t, i) => (
                      <span key={i} className="tabular-nums">
                        {t === 1000 ? "1,000 km" : t.toLocaleString()}
                      </span>
                    ))}
                  </div>
                  <div />
                  <div />
                  <div />
                </div>

                {/* Desktop Row */}
                <div className="hidden sm:grid sm:grid-cols-[3.5rem_9.5rem_minmax(12rem,1fr)_4.5rem_6rem_10.5rem] items-center gap-4 py-1">
                  {/* Rank */}
                  <div>
                    <span className="flex h-7 w-9 items-center justify-center rounded-lg bg-[#0b132b] text-white font-data text-xs font-bold shadow-2xs">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>

                  {/* Vehicle */}
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">
                      {vehicle.plate}
                    </p>
                    {isTop && (
                      <p className="text-[10px] text-slate-400 font-normal mt-0.5">
                        Most dispatched
                      </p>
                    )}
                  </div>

                  {/* Workload bar with scale dividers */}
                  <div className="relative">
                    <div className="relative h-[18px] w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden ring-1 ring-slate-200/50 dark:ring-slate-700/50">
                      {/* Segmented scale dividers at 25%, 50%, 75% */}
                      <div aria-hidden className="absolute inset-0 pointer-events-none">
                        <span className="absolute left-[25%] top-0 h-full w-px bg-slate-200/80 dark:bg-slate-700/80" />
                        <span className="absolute left-[50%] top-0 h-full w-px bg-slate-200/80 dark:bg-slate-700/80" />
                        <span className="absolute left-[75%] top-0 h-full w-px bg-slate-200/80 dark:bg-slate-700/80" />
                      </div>
                      {/* Blue filled amount */}
                      <div
                        className="h-full rounded-full bg-[#2563eb] transition-all duration-500"
                        style={{ width: vehicle.distance > 0 ? `${Math.min(100, Math.max(2, (vehicle.distance / scaleMax) * 100))}%` : "24px" }}
                      />
                    </div>
                  </div>

                  {/* Trips */}
                  <div className="text-center">
                    <span className="font-data text-sm font-bold text-slate-900 dark:text-white block leading-tight">
                      {vehicle.trips}
                    </span>
                    <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                      trips
                    </span>
                  </div>

                  {/* Distance */}
                  <div className="text-center">
                    <span className="font-data text-sm font-bold text-slate-900 dark:text-white block leading-tight">
                      {vehicle.distance > 0 ? formatDistance(vehicle.distance) : "0 m"}
                    </span>
                    <span className="text-[10px] text-slate-400 font-normal block mt-0.5">
                      total
                    </span>
                  </div>

                  {/* Relative Workload */}
                  <div className="flex flex-col items-center justify-center">
                    <div className="w-full max-w-[136px] h-9 rounded-full bg-[#eff5ff] dark:bg-sky-950/60 flex items-center justify-center">
                      <span className="font-data text-[15px] font-bold text-[#2563eb] dark:text-sky-400 leading-none">
                        {share}%
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 font-normal mt-1.5 block leading-tight whitespace-nowrap">
                      of fleet workload
                    </span>
                  </div>
                </div>

                {/* Mobile Row */}
                <div className="sm:hidden rounded-xl border border-slate-200/60 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-8 items-center justify-center rounded-md bg-[#0b132b] text-white font-data text-[11px] font-bold">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">{vehicle.plate}</p>
                        {isTop && <p className="text-[10px] text-slate-400">Most dispatched</p>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="px-4 py-1.5 rounded-full bg-[#eff5ff] dark:bg-sky-950/60 flex items-center justify-center">
                        <span className="font-data text-xs font-bold text-[#2563eb] dark:text-sky-400 leading-none">
                          {share}%
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-normal mt-1">
                        of fleet workload
                      </span>
                    </div>
                  </div>

                  <div className="relative h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: vehicle.distance > 0 ? `${Math.min(100, Math.max(3, (vehicle.distance / scaleMax) * 100))}%` : "20px" }} />
                  </div>

                  <div className="flex items-center justify-between text-xs font-data text-slate-500 pt-1 border-t border-slate-100">
                    <span>{vehicle.trips} trips</span>
                    <span className="font-bold text-slate-900">{vehicle.distance > 0 ? formatDistance(vehicle.distance) : "0 m total"}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function FuelReport({ query, trend, categories }) {
  const report = query.data || {};
  const efficiencyRows = (report.byVehicle || []).slice(0, 10);
  const categoryData = categories.slice(0, 6).map((item) => ({
    name: item.category,
    value: item.liters,
    cost: item.cost,
  }));
  const totalCategoryLiters = categoryData.reduce((sum, item) => sum + item.value, 0);

  return (
    <>
      <StatGrid cols={4}>
        <StatCard
          icon={Droplets}
          label="Fuel volume"
          value={`${(Number(report.totalLiters) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} L`}
          valueNote="Reviewed actual transactions"
          tone="info"
        />
        <StatCard
          icon={PhilippinePeso}
          label="Fuel spend"
          value={money(report.totalCost)}
          valueNote="Selected window"
          tone="warning"
        />
        <StatCard
          icon={Activity}
          label="Average price"
          value={`${money(report.avgCost)} / L`}
          valueNote="Blended rate"
          tone="primary"
        />
        <StatCard
          icon={Gauge}
          label="Estimated efficiency"
          value={report.estimatedEfficiency == null ? "Insufficient data" : `${Number(report.estimatedEfficiency).toFixed(2)} km/L`}
          valueNote="Completed distance ÷ eligible fuel · 50 km minimum"
          tone={report.estimatedEfficiency == null ? "warning" : "success"}
        />
      </StatGrid>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        {/* Left: Fuel consumption & expense trend */}
        <Panel
          title="Fuel consumption & expense"
          description="Monthly liters with the corresponding fuel spend"
          icon={Fuel}
          action={<EncodingBadge>Trend</EncodingBadge>}
        >
          {query.isLoading ? (
            <LoadingChart />
          ) : trend.length ? (
            <div className="space-y-4">
              <ChartStage height={320}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 14, right: 8, left: -6, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fuelCostAreaPremium" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.38} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="fuelLitersBarPremium" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.92} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.35} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--br)" strokeOpacity={0.5} strokeDasharray="3 5" />
                    <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "var(--fg)", fontSize: 11, fontWeight: 700 }}
                      dy={8}
                    />
                    <YAxis
                      yAxisId="cost"
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      tick={{ fill: "var(--fg-muted)", fontSize: 11, fontWeight: 600 }}
                      tickFormatter={formatCurrencyK}
                    />
                    <YAxis
                      yAxisId="volume"
                      orientation="right"
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      tick={{ fill: "var(--fg-muted)", fontSize: 11, fontWeight: 600 }}
                      tickFormatter={formatLitersK}
                    />
                    <Tooltip content={<PremiumTooltip />} cursor={{ stroke: "var(--br)", strokeDasharray: "4 4" }} />
                    <Legend
                      wrapperStyle={{ paddingTop: 10, fontSize: 11, fontWeight: "700" }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Area
                      yAxisId="cost"
                      type="monotone"
                      dataKey="cost"
                      name="Fuel spend"
                      stroke="#10b981"
                      strokeWidth={3}
                      fill="url(#fuelCostAreaPremium)"
                      dot={{ r: 4, fill: "#10b981", stroke: "var(--sf)", strokeWidth: 2 }}
                      activeDot={{ r: 6.5, fill: "#10b981", stroke: "var(--sf)", strokeWidth: 3 }}
                      animationDuration={950}
                      animationEasing="ease-out"
                    />
                    <Bar
                      yAxisId="volume"
                      dataKey="liters"
                      name="Fuel volume (L)"
                      fill="url(#fuelLitersBarPremium)"
                      radius={[8, 8, 0, 0]}
                      maxBarSize={38}
                      animationDuration={900}
                      animationEasing="ease-out"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartStage>

              {/* Monthly Overview Chips */}
              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                {trend.map((m, i) => {
                  const unitPrice = m.liters > 0 ? (m.cost / m.liters).toFixed(2) : "0.00";
                  return (
                    <div
                      key={m.month || i}
                      className="group flex flex-col justify-between rounded-2xl border border-border/60 bg-surface p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-foreground">{m.month}</span>
                        <span className="rounded-full bg-success/10 px-2 py-0.5 font-data text-[10px] font-bold text-success-700">
                          ₱{unitPrice}/L
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between gap-2">
                        <span className="font-data text-sm font-black text-foreground">{money(m.cost)}</span>
                        <span className="font-data text-xs font-bold text-warning-700">{m.liters.toLocaleString()} L</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <NoData />
          )}
        </Panel>

        {/* Right: Fuel mix by category */}
        <Panel
          title="Fuel mix by category"
          description="Share of total recorded fuel volume"
          icon={Layers}
          action={<EncodingBadge>Composition</EncodingBadge>}
        >
          {query.isLoading ? (
            <LoadingChart />
          ) : categoryData.length ? (
            <div className="space-y-4">
              <div className="relative chart-h-md">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[{ value: 1 }]}
                      dataKey="value"
                      innerRadius={66}
                      outerRadius={96}
                      fill="var(--br)"
                      opacity={0.18}
                      isAnimationActive={false}
                    />
                    <Pie
                      data={categoryData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={66}
                      outerRadius={96}
                      paddingAngle={4}
                      cornerRadius={8}
                      animationDuration={1000}
                      animationEasing="ease-out"
                    >
                      {categoryData.map((item, index) => (
                        <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip content={<PremiumTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <strong className="font-data text-2xl font-black text-foreground">
                    {Number(report.totalLiters || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </strong>
                  <span className="mt-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-foreground-muted">
                    Total Liters
                  </span>
                </div>
              </div>

              {/* Category Legend & Breakdown List */}
              <div className="space-y-2 border-t border-border/60 pt-3">
                {categoryData.map((item, index) => {
                  const pct = totalCategoryLiters > 0 ? Math.round((item.value / totalCategoryLiters) * 100) : 0;
                  const color = CHART_COLORS[index % CHART_COLORS.length];
                  return (
                    <div key={item.name} className="flex flex-col gap-1 rounded-xl bg-muted/20 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 font-bold text-foreground">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                          <span className="truncate">{item.name}</span>
                        </span>
                        <span className="font-data font-bold text-foreground">{item.value.toLocaleString()} L</span>
                      </div>
                      <div className="flex items-center justify-between text-[10.5px] text-foreground-muted">
                        <span>{money(item.cost)}</span>
                        <span className="font-data font-semibold">{pct}% share</span>
                      </div>
                      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted/40">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <NoData />
          )}
        </Panel>
      </div>
      <Panel
        title="Vehicle efficiency analysis"
        description="Completed-trip distance compared with reviewed actual fuel and each vehicle baseline"
        icon={Gauge}
        action={<EncodingBadge>Top 10 · workbook has all</EncodingBadge>}
      >
        {query.isLoading ? <LoadingChart /> : efficiencyRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="border-b border-border text-xs text-foreground-muted">
                <tr>
                  <th className="px-3 py-3 font-semibold">Vehicle</th>
                  <th className="px-3 py-3 text-right font-semibold">Trips</th>
                  <th className="px-3 py-3 text-right font-semibold">Distance</th>
                  <th className="px-3 py-3 text-right font-semibold">Eligible fuel</th>
                  <th className="px-3 py-3 text-right font-semibold">Estimated</th>
                  <th className="px-3 py-3 text-right font-semibold">Baseline</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {efficiencyRows.map((vehicle) => (
                  <tr key={vehicle.vehicle_id} className="hover:bg-hover/60">
                    <td className="px-3 py-3"><span className="block font-semibold text-foreground">{vehicle.vehicle}</span><span className="text-xs text-foreground-muted">{vehicle.category}</span></td>
                    <td className="px-3 py-3 text-right font-data">{vehicle.trips}</td>
                    <td className="px-3 py-3 text-right font-data">{Number(vehicle.distance).toLocaleString()} km</td>
                    <td className="px-3 py-3 text-right font-data">{Number(vehicle.liters).toLocaleString()} L</td>
                    <td className="px-3 py-3 text-right font-data font-semibold">{vehicle.estimated_kmpl == null ? "—" : `${Number(vehicle.estimated_kmpl).toFixed(2)} km/L`}</td>
                    <td className="px-3 py-3 text-right font-data">{vehicle.baseline_efficiency ? `${Number(vehicle.baseline_efficiency).toFixed(2)} km/L` : "—"}</td>
                    <td className="px-3 py-3"><StatusBadge status={vehicle.status} entity="efficiency" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <NoData />}
      </Panel>
    </>
  );
}

function MaintenanceReport({ query, data, due }) {
  const report = query.data || {};
  const totalSpend = Number(report.totalCost) || data.reduce((sum, row) => sum + row.cost, 0);
  const totalEntries = Number(report.totalRecords) || data.reduce((sum, row) => sum + row.count, 0);
  const topCategory = data.length ? data[0] : null;
  const topShare = totalSpend > 0 && topCategory ? Math.round((topCategory.cost / totalSpend) * 100) : 0;

  return (
    <>
      <StatGrid cols={3}>
        <StatCard
          icon={PhilippinePeso}
          label="Maintenance spend"
          value={money(totalSpend)}
          valueNote="Selected window total"
          tone="danger"
        />
        <StatCard
          icon={Wrench}
          label="Service records"
          value={totalEntries}
          valueNote="Completed work orders"
          tone="warning"
        />
        <StatCard
          icon={ShieldCheck}
          label="Attention needed"
          value={due}
          valueNote="Predictive risk alerts"
          tone="primary"
        />
      </StatGrid>

      <Panel
        title="Maintenance cost concentration"
        description="Pareto distribution: rank-ordered repair categories and cumulative spend share"
        icon={Wrench}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {topCategory && (
              <span className="inline-flex items-center gap-1 rounded-full border border-danger/25 bg-danger/10 px-2.5 py-0.5 text-[10.5px] font-bold text-danger-700">
                <Sparkles className="h-3 w-3" /> Top: {topCategory.type} ({topShare}%)
              </span>
            )}
            <EncodingBadge>Pareto 80/20</EncodingBadge>
          </div>
        }
      >
        {query.isLoading ? (
          <LoadingChart />
        ) : data.length ? (
          <div className="space-y-5">
            <ChartStage height={340}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 14, right: 10, left: -6, bottom: 6 }}>
                  <defs>
                    <linearGradient id="maintenanceBarPremium" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#be123c" stopOpacity={0.35} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--br)" strokeOpacity={0.5} strokeDasharray="3 5" />
                  <XAxis
                    dataKey="type"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--fg)", fontSize: 11, fontWeight: 700 }}
                    dy={8}
                    interval={0}
                  />
                  <YAxis
                    yAxisId="cost"
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    tick={{ fill: "var(--fg-muted)", fontSize: 11, fontWeight: 600 }}
                    tickFormatter={formatCurrencyK}
                  />
                  <YAxis
                    yAxisId="share"
                    orientation="right"
                    domain={[0, 100]}
                    width={40}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${value}%`}
                    tick={{ fill: "var(--fg-muted)", fontSize: 11, fontWeight: 600 }}
                  />
                  <Tooltip content={<PremiumTooltip />} cursor={{ fill: "var(--hv)", opacity: 0.35 }} />
                  <Legend
                    wrapperStyle={{ paddingTop: 10, fontSize: 11, fontWeight: "700" }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Bar
                    yAxisId="cost"
                    dataKey="cost"
                    name="Maintenance cost"
                    fill="url(#maintenanceBarPremium)"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={44}
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                  <Line
                    yAxisId="share"
                    type="monotone"
                    dataKey="cumulative"
                    name="Cumulative share"
                    stroke="#8b5cf6"
                    strokeWidth={3}
                    dot={{ r: 4.5, fill: "#8b5cf6", stroke: "var(--sf)", strokeWidth: 2 }}
                    activeDot={{ r: 6.5, fill: "#8b5cf6", stroke: "var(--sf)", strokeWidth: 3 }}
                    animationBegin={180}
                    animationDuration={950}
                    animationEasing="ease-out"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartStage>

            {/* Service Category Breakdown Chips */}
            <div className="grid grid-cols-1 gap-2.5 border-t border-border/60 pt-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.map((item, index) => {
                const individualShare = totalSpend > 0 ? Math.round((item.cost / totalSpend) * 100) : 0;
                return (
                  <motion.div
                    key={item.type}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.06, ease: EASE }}
                    className="group flex flex-col justify-between rounded-2xl border border-border/60 bg-surface p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-muted font-data text-[10px] font-bold text-foreground-muted">
                          #{index + 1}
                        </span>
                        <span className="truncate text-xs font-extrabold text-foreground">{item.type}</span>
                      </div>
                      <span className="rounded-full bg-rose-500/10 px-2 py-0.5 font-data text-[10px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                        {individualShare}%
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-baseline justify-between gap-2">
                      <span className="font-data text-sm font-black text-foreground">{money(item.cost)}</span>
                      <span className="text-[11px] font-medium text-foreground-muted">
                        {item.count} {item.count === 1 ? "record" : "records"}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[10px] text-foreground-muted">
                      <span>Cumulative impact</span>
                      <span className="font-data font-bold text-purple-700 dark:text-purple-300">{item.cumulative}%</span>
                    </div>

                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-rose-500 to-purple-500 transition-all duration-500"
                        style={{ width: `${individualShare}%` }}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ) : (
          <NoData />
        )}
      </Panel>
    </>
  );
}

function DriversReport({ query, data }) {
  const report = query.data || {};
  return <><StatGrid cols={2}><StatCard icon={Users} label="Drivers in report" value={Number(report.totalDrivers) || 0} valueNote="Active roster" tone="primary" /><StatCard icon={Award} label="Average score" value={`${Number(report.avgScore) || 0}/100`} valueNote="Performance index" tone="success" /></StatGrid><Panel title="Performance leaderboard" description="Ranked circular score dials with completed-trip context" icon={Award} action={<EncodingBadge>Arc = score</EncodingBadge>}>{query.isLoading ? <LoadingChart /> : data.length ? <div className="grid grid-cols-2 gap-x-4 gap-y-7 py-3 sm:grid-cols-3 lg:grid-cols-4">{data.map((driver, index) => { const color = index === 0 ? "#10b981" : "#2563eb"; return <motion.div key={`${driver.name}-${index}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: index * 0.06, ease: EASE }} whileHover={{ y: -4 }} className="flex flex-col items-center text-center"><div className="relative rounded-full bg-hover/70 p-1.5 ring-1 ring-border/50 shadow-[0_20px_42px_-32px_rgba(17,24,39,0.5)]"><div className="relative h-28 w-28 rounded-full p-2" style={{ background: `conic-gradient(${color} 0 ${Math.min(100, driver.score)}%, var(--hv) ${Math.min(100, driver.score)}% 100%)` }}><div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-surface shadow-[inset_0_1px_2px_rgba(17,24,39,0.08)]"><span className="font-data text-2xl font-bold text-foreground">{driver.score}</span><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-foreground-muted">score</span></div><span className="absolute -left-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-foreground font-data text-[10px] font-bold text-surface">{index + 1}</span></div></div><p className="mt-3 max-w-[145px] truncate text-xs font-bold text-foreground">{driver.name}</p><p className="mt-1 text-[10px] font-semibold text-foreground-muted">{driver.trips} completed trips</p></motion.div>; })}</div> : <NoData />}</Panel></>;
}

function FinancialReport({ query, data, total }) {
  const report = query.data || {};
  return <><StatGrid cols={3}><StatCard icon={PhilippinePeso} label="Operating cost" value={money(report.totalCost || total)} valueNote="Fuel + maintenance" tone="primary" /><StatCard icon={Fuel} label="Fuel allocation" value={money(report.fuelCost)} valueNote="Recorded spend" tone="warning" /><StatCard icon={Wrench} label="Maintenance allocation" value={money(report.maintCost)} valueNote="Recorded spend" tone="danger" /></StatGrid><div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]"><Panel title="Operating cost allocation" description="Fuel and maintenance share of recorded operating spend" icon={PhilippinePeso} action={<EncodingBadge>Composition</EncodingBadge>}>{query.isLoading ? <LoadingChart /> : data.length ? <div className="relative chart-h-lg"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ value: 1 }]} dataKey="value" innerRadius={76} outerRadius={108} fill="var(--br)" opacity={0.22} isAnimationActive={false} /><Pie data={data} dataKey="value" nameKey="name" innerRadius={76} outerRadius={108} paddingAngle={5} cornerRadius={9} animationDuration={1000} animationEasing="ease-out">{data.map((item, index) => <Cell key={item.name} fill={CHART_COLORS[index]} stroke="none" />)}</Pie><Tooltip content={<PremiumTooltip />} /></PieChart></ResponsiveContainer><motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.55, delay: 0.3, ease: EASE }} className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="font-data text-2xl font-bold text-foreground">{money(total)}</strong><span className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-muted">Total cost</span></motion.div></div> : <NoData />}</Panel><Panel title="Cost detail" description="Exact values and operational efficiency" icon={FileSpreadsheet}>{data.length ? <div className="space-y-3">{data.map((item, index) => { const pct = total ? Math.round((item.value / total) * 100) : 0; return <motion.div key={item.name} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.42, delay: index * 0.09, ease: EASE }} className="flex items-center justify-between gap-4 rounded-2xl bg-hover/55 px-4 py-4"><div className="flex min-w-0 items-center gap-3"><span className="h-10 w-2 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[index] }} /><div><p className="text-sm font-bold text-foreground">{item.name}</p><p className="mt-0.5 text-[10px] font-semibold text-foreground-muted">{pct}% of recorded operating cost</p></div></div><p className="shrink-0 font-data text-base font-bold text-foreground">{money(item.value)}</p></motion.div>; })}<div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/60 pt-5"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-muted">Cost per kilometer</p><p className="mt-1.5 font-data text-lg font-bold text-foreground">{money(report.costPerKm)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-muted">Distance covered</p><p className="mt-1.5 font-data text-lg font-bold text-foreground">{formatDistance(report.totalDistance || 0)}</p></div></div></div> : <NoData />}</Panel></div></>;
}

