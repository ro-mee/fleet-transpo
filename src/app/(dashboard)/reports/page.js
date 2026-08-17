"use client";

import { useMemo, useState } from "react";
import { MotionConfig, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, ArrowDownToLine, Award, BarChart3, Calendar, CarFront,
  CircleDollarSign, Droplets, FileSpreadsheet, Fuel, Gauge, PhilippinePeso,
  Layers, ShieldCheck, Sparkles, TrendingUp, Users, Wrench, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { AiAnalystCard } from "@/components/ai/ai-analyst-card";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { getPredictiveMaintenance, getReportNarrative } from "@/services/ai.service";
import {
  getDriverPerformanceReport, getFinancialSummary, getFleetUtilizationReport,
  getFuelConsumptionReport, getMaintenanceReport,
} from "@/services/report.service";
import { exportToCSV } from "@/lib/export";
import { cn, formatCurrency, formatDistance } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";

const CHART_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
const EASE = [0.32, 0.72, 0, 1];
const CARD_SHADOW = "shadow-[0_1px_2px_rgba(17,24,39,0.04),0_20px_44px_-30px_rgba(17,24,39,0.28)]";
const CARD_SHADOW_HOVER = "hover:shadow-[0_24px_52px_-30px_rgba(17,24,39,0.34)]";
const KPI_SHADOW = "shadow-[0_1px_2px_rgba(17,24,39,0.04),0_24px_48px_-32px_rgba(17,24,39,0.3)]";
const REPORT_TYPES = [
  { id: "fleet", label: "Fleet utilization", short: "Fleet", icon: CarFront, description: "Capacity and distance by vehicle" },
  { id: "fuel", label: "Fuel consumption", short: "Fuel", icon: Fuel, description: "Volume, spend, and monthly movement" },
  { id: "maintenance", label: "Maintenance audit", short: "Maintenance", icon: Wrench, description: "Service spend and concentration" },
  { id: "drivers", label: "Driver performance", short: "Drivers", icon: Users, description: "Ranked safety and performance scores" },
  { id: "financial", label: "Financial summary", short: "Financial", icon: PhilippinePeso, description: "Operating cost allocation" },
];

function formatPlate(value) {
  const text = String(value || "Unknown").trim();
  return text.length > 13 ? `${text.slice(0, 10)}...` : text;
}

function money(value) {
  return formatCurrency(Number(value) || 0);
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
    <Card className={cn("group rounded-[1.75rem] border border-border/70 bg-surface p-5 transition-shadow duration-500 sm:p-6", CARD_SHADOW, CARD_SHADOW_HOVER, className)}>
      <CardHeader className="mb-5 flex flex-row items-start justify-between gap-4 p-0">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-none"><Icon className="h-[18px] w-[18px]" strokeWidth={1.75} /></span>}
          <div className="min-w-0"><CardTitle className="text-[15px] font-bold tracking-tight">{title}</CardTitle>{description && <p className="mt-0.5 text-xs font-medium text-foreground-muted">{description}</p>}</div>
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

const KPI_TONES = {
  success: "from-success/15 text-success",
  primary: "from-primary/10 text-foreground-secondary",
  info: "from-info/15 text-info",
  warning: "from-warning/15 text-warning",
  danger: "from-danger/15 text-danger",
};

function StatCard({ icon: Icon, label, value, valueNote, tone = "primary" }) {
  return <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.45, ease: EASE }} className={cn("group relative overflow-hidden rounded-[1.6rem] bg-surface p-6 ring-1 ring-black/[0.04] dark:ring-white/[0.06]", KPI_SHADOW)}><div className={cn("pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent", KPI_TONES[tone]?.split(" ")[0])} /><div className="relative flex items-start justify-between gap-3"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-muted">{label}</p><Icon className={cn("h-4 w-4", KPI_TONES[tone]?.split(" ")[1])} strokeWidth={1.75} /></div><p className="relative mt-3.5 font-data text-[2.1rem] font-bold leading-none tracking-tight text-foreground">{value}</p><p className="relative mt-2.5 text-[11px] font-medium text-foreground-secondary">{valueNote}</p></motion.div>;
}

function StatGrid({ children, cols = 3 }) {
  return <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", cols === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3")}>{children}</div>;
}

function NoData({ label = "No records in this period" }) {
  return <EmptyState icon={Activity} title={label} description="Try a wider timeframe or add activity to see the live visualization." className="min-h-[250px]" />;
}

function LoadingChart() {
  return <div className="flex h-[280px] items-end gap-3 px-4 pb-4 pt-8"><div className="h-1/3 flex-1 animate-pulse rounded-t-lg bg-hover" /><div className="h-2/3 flex-1 animate-pulse rounded-t-lg bg-hover" /><div className="h-1/2 flex-1 animate-pulse rounded-t-lg bg-hover" /><div className="h-4/5 flex-1 animate-pulse rounded-t-lg bg-hover" /><div className="h-3/5 flex-1 animate-pulse rounded-t-lg bg-hover" /></div>;
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
          <span className="font-data font-bold text-success">₱{unitRate} / L</span>
        </div>
      )}
    </div>
  );
}

function ChartStage({ children, height = 320 }) {
  return <motion.div initial={{ opacity: 0.5, y: 10, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.65, ease: EASE }} className="w-full min-w-0" style={{ height }}>{children}</motion.div>;
}

export default function ReportsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);
  const [selectedReport, setSelectedReport] = useState("fleet");
  const [preset, setPreset] = useState("month");
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [narrativeForce, setNarrativeForce] = useState(0);

  const dateBounds = useMemo(() => {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    if (preset === "today") return { from: to, to };
    if (preset === "7d") { const d = new Date(now); d.setDate(d.getDate() - 7); return { from: d.toISOString().slice(0, 10), to }; }
    if (preset === "quarter") { const d = new Date(now); d.setMonth(d.getMonth() - 3); return { from: d.toISOString().slice(0, 10), to }; }
    if (preset === "custom") return { from: customRange.from || "1970-01-01", to: customRange.to || "2100-01-01" };
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10), to };
  }, [preset, customRange]);

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
  const narrativeData = selectedReport === "maintenance" ? { ...reportData, vehiclesDue: maintDue } : reportData;
  const narrative = useQuery({ queryKey: ["report-narrative", selectedReport, dateBounds, narrativeForce], queryFn: () => getReportNarrative(selectedReport, narrativeData, dateBounds, narrativeForce > 0), enabled: Boolean(narrativeData) });

  const fleetData = useMemo(() => (reportData.byVehicle || []).map((v) => ({ plate: formatPlate(v.plate), trips: Number(v.trips) || 0, distance: Math.round(Number(v.distance) || 0) })).sort((a, b) => b.distance - a.distance).slice(0, 8), [reportData.byVehicle]);
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

  function handleExport() {
    let rows = []; let columns = null;
    if (selectedReport === "fleet") { rows = reportData.byVehicle || []; columns = [{ label: "Plate Number", key: "plate" }, { label: "Total Trips", key: "trips" }, { label: "Total Distance (km)", key: "distance" }]; }
    if (selectedReport === "fuel") { rows = reportData.monthlyData || []; columns = [{ label: "Month", key: "month" }, { label: "Liters (L)", key: "liters" }, { label: "Total Cost", key: "cost" }]; }
    if (selectedReport === "maintenance") { rows = reportData.byType || []; columns = [{ label: "Maintenance Type", key: "type" }, { label: "Records", key: "count" }, { label: "Total Expense", key: "cost" }]; }
    if (selectedReport === "drivers") { rows = reportData.topDrivers || []; columns = [{ label: "Driver Name", key: "name" }, { label: "Performance Score", key: "score" }, { label: "Completed Trips", key: "trips" }]; }
    if (selectedReport === "financial") { rows = [reportData]; columns = [{ label: "Total Cost", key: "totalCost" }, { label: "Fuel Cost", key: "fuelCost" }, { label: "Maintenance Cost", key: "maintCost" }, { label: "Cost Per Km", key: "costPerKm" }]; }
    if (rows.length && columns) exportToCSV(rows, `report-${selectedReport}`, columns);
  }

  const presets = [{ id: "today", label: "Today" }, { id: "7d", label: "7 days" }, { id: "month", label: "This month" }, { id: "quarter", label: "Quarter" }, { id: "custom", label: "Custom" }];
  const selectedMeta = REPORT_TYPES.find((item) => item.id === selectedReport);

  return (
    <MotionConfig reducedMotion="user">
    <motion.main initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: EASE }} className="w-full space-y-6 pb-14">
      <HeroHeader icon={FileSpreadsheet} title="Fleet Reports & Operational Intelligence" badge="Reports Engine" description="A focused view of fleet capacity, fuel, maintenance, driver performance, and operating cost." actions={<Button onClick={handleExport} disabled={!activeQuery?.data} className={cn("group h-11 cursor-pointer rounded-full pl-5 pr-1.5 text-xs font-bold shadow-2xs", heroButtonPrimaryClass)}><ArrowDownToLine className="mr-2 h-4 w-4" strokeWidth={1.75} />Export Report CSV<span className="ml-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-black transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 dark:bg-white/10 dark:text-white"><Zap className="h-4 w-4" strokeWidth={1.75} /></span></Button>}>
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
        {preset === "custom" && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4 md:justify-end"><DatePicker id="report-from" label="From" value={customRange.from} onChange={(value) => setCustomRange((prev) => ({ ...prev, from: value }))} className="min-h-[38px] py-1" /><span className="text-xs font-medium text-foreground-muted">to</span><DatePicker id="report-to" label="To" value={customRange.to} onChange={(value) => setCustomRange((prev) => ({ ...prev, to: value }))} className="min-h-[38px] py-1" /></div>}
      </section>

      <nav aria-label="Report categories" className="rounded-[1.75rem] border border-border/70 bg-surface px-5 py-4 shadow-[0_1px_2px_rgba(17,24,39,0.04),0_16px_36px_-30px_rgba(17,24,39,0.25)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-xl border border-info/20 bg-info/10 text-info"><BarChart3 className="h-4 w-4" strokeWidth={1.75} /></span><div><p className="text-xs font-black uppercase tracking-[0.14em] text-foreground">Report Type</p><p className="mt-0.5 text-[11px] font-medium text-foreground-muted">{selectedMeta?.description}</p></div></div>
          <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-hover/70 p-1 ring-1 ring-border/60 scrollbar-thin">{REPORT_TYPES.map((item) => { const Icon = item.icon; const active = selectedReport === item.id; return <button key={item.id} type="button" onClick={() => setSelectedReport(item.id)} aria-pressed={active} className={cn("relative shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface", active ? "text-surface" : "text-foreground-secondary hover:text-foreground")}>{active && <motion.span layoutId="reports-type-pill" className="absolute inset-0 rounded-full bg-foreground shadow-[0_2px_10px_rgba(17,24,39,0.28)]" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}<span className="relative z-10 flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" strokeWidth={1.75} />{item.short}</span></button>; })}</div>
        </div>
      </nav>

      <motion.div key={`analyst-${selectedReport}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
        <AiAnalystCard title={`AI analyst - ${reportLabel}`} reportLabel="Number-grounded analysis for the selected window" data={narrative.data} loading={narrative.isLoading || narrative.isFetching} onRegenerate={() => setNarrativeForce((v) => v + 1)} isRegenerating={narrative.isFetching} />
      </motion.div>

      <motion.div key={selectedReport} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }} className="space-y-5">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{selectedMeta?.short} report</p><h2 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-foreground">{selectedMeta?.label}</h2></div><p className="text-xs text-foreground-muted">{selectedMeta?.description}</p></div>

        {selectedReport === "fleet" && <FleetReport query={fleet} data={fleetData} />}
        {selectedReport === "fuel" && <FuelReport query={fuel} trend={fuelTrend} categories={fuelCategories} />}
        {selectedReport === "maintenance" && <MaintenanceReport query={maintenance} data={maintenanceData} due={maintDue} />}
        {selectedReport === "drivers" && <DriversReport query={drivers} data={driverData} />}
        {selectedReport === "financial" && <FinancialReport query={financial} data={costData} total={totalCost} />}

      </motion.div>
    </motion.main>
    </MotionConfig>
  );
}

function FleetReport({ query, data }) {
  const report = query.data || {};
  const maxDistance = Math.max(...data.map((item) => item.distance), 1);
  const highestDistance = data.reduce((best, item) => item.distance > (best?.distance || 0) ? item : best, null);
  const mostTrips = data.reduce((best, item) => item.trips > (best?.trips || 0) ? item : best, null);
  const averageDistancePerTrip = Number(report.totalTrips) > 0 ? Number(report.totalDistance) / Number(report.totalTrips) : 0;
  return (
    <>
      <StatGrid cols={3}>
        <StatCard icon={Gauge} label="Utilization" value={`${Number(report.utilization) || 0}%`} valueNote="Fleet capacity" tone="success" />
        <StatCard icon={Zap} label="Completed trips" value={Number(report.totalTrips) || 0} valueNote="Selected window" tone="primary" />
        <StatCard icon={Activity} label="Distance logged" value={formatDistance(Number(report.totalDistance) || 0)} valueNote="Verified km" tone="info" />
      </StatGrid>
      <Panel title="Fleet workload lanes" description="A custom view of relative distance load with exact trip and kilometer totals" icon={BarChart3} action={<span className="text-xs text-foreground-muted">Top {Math.min(data.length, 8)}</span>}>
        {query.isLoading ? <LoadingChart /> : data.length ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 border-b border-border/60 pb-5 sm:grid-cols-3">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-muted">Highest distance</p><p className="mt-1.5 truncate text-sm font-bold text-foreground">{highestDistance?.plate}</p><p className="mt-0.5 font-data text-xs font-semibold text-info">{formatDistance(highestDistance?.distance || 0)}</p></div>
              <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-muted">Most dispatched</p><p className="mt-1.5 truncate text-sm font-bold text-foreground">{mostTrips?.plate}</p><p className="mt-0.5 font-data text-xs font-semibold text-success">{mostTrips?.trips || 0} trips</p></div>
              <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-muted">Average trip distance</p><p className="mt-1.5 font-data text-sm font-bold text-foreground">{averageDistancePerTrip.toLocaleString(undefined, { maximumFractionDigits: 1 })} km</p><p className="mt-0.5 text-xs font-medium text-foreground-muted">Across completed trips</p></div>
            </div>
            <div className="space-y-2.5">
              {data.map((vehicle, index) => {
                const share = Math.max(3, Math.round((vehicle.distance / maxDistance) * 100));
                return (
                  <motion.div key={vehicle.plate} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.42, delay: Math.min(index * 0.055, 0.32), ease: EASE }} className="group grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors duration-300 hover:bg-hover/60 sm:grid-cols-[2.25rem_7rem_minmax(0,1fr)_6.5rem]">
                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl font-data text-[11px] font-bold", index === 0 ? "bg-primary text-surface" : "bg-hover text-foreground-secondary")}>{String(index + 1).padStart(2, "0")}</span>
                    <div className="hidden min-w-0 sm:block"><p className="truncate text-xs font-bold text-foreground">{vehicle.plate}</p><p className="mt-0.5 text-[10px] font-medium text-foreground-muted">{share}% of peak distance</p></div>
                    <div className="min-w-0">
                      <div className="mb-1.5 flex items-center justify-between gap-3 sm:hidden"><p className="truncate text-xs font-bold text-foreground">{vehicle.plate}</p><span className="font-data text-[10px] font-semibold text-foreground-muted">{share}% peak</span></div>
                      <div className="relative h-8 overflow-hidden rounded-xl bg-hover ring-1 ring-border/40">
                        <div aria-hidden className="absolute inset-0 flex justify-between px-[20%]"><i className="h-full w-px bg-border/50" /><i className="h-full w-px bg-border/50" /><i className="h-full w-px bg-border/50" /><i className="h-full w-px bg-border/50" /></div>
                        <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.75, delay: 0.12 + Math.min(index * 0.05, 0.3), ease: EASE }} className={cn("absolute inset-y-1 left-1 origin-left rounded-lg", index === 0 ? "bg-gradient-to-r from-primary to-info" : "bg-gradient-to-r from-info/55 to-info")} style={{ width: `calc(${share}% - 0.25rem)` }} />
                        <span className="absolute inset-y-0 right-2 flex items-center font-data text-[10px] font-bold text-foreground">{vehicle.distance.toLocaleString()} km</span>
                      </div>
                    </div>
                    <div className="col-start-2 flex items-center justify-between gap-2 sm:col-start-auto sm:justify-end"><span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground-muted sm:hidden">Completed trips</span><span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 font-data text-[11px] font-bold text-success"><Zap className="h-3 w-3" strokeWidth={1.75} />{vehicle.trips} trips</span></div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ) : <NoData />}
      </Panel>
    </>
  );
}

function FuelReport({ query, trend, categories }) {
  const report = query.data || {};
  const categoryData = categories.slice(0, 6).map((item) => ({
    name: item.category,
    value: item.liters,
    cost: item.cost,
  }));
  const totalCategoryLiters = categoryData.reduce((sum, item) => sum + item.value, 0);

  return (
    <>
      <StatGrid cols={3}>
        <StatCard
          icon={Droplets}
          label="Fuel volume"
          value={`${(Number(report.totalLiters) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} L`}
          valueNote="Recorded liters"
          tone="info"
        />
        <StatCard
          icon={CircleDollarSign}
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
                        <span className="rounded-full bg-success/10 px-2 py-0.5 font-data text-[10px] font-bold text-success">
                          ₱{unitPrice}/L
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between gap-2">
                        <span className="font-data text-sm font-black text-foreground">{money(m.cost)}</span>
                        <span className="font-data text-xs font-bold text-warning">{m.liters.toLocaleString()} L</span>
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
              <div className="relative h-[240px]">
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
          icon={CircleDollarSign}
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
              <span className="inline-flex items-center gap-1 rounded-full border border-danger/25 bg-danger/10 px-2.5 py-0.5 text-[10.5px] font-bold text-danger">
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
                      <span className="rounded-full bg-rose-500/10 px-2 py-0.5 font-data text-[10px] font-bold text-rose-500 dark:bg-rose-500/20">
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
                      <span className="font-data font-bold text-purple-500">{item.cumulative}%</span>
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
  return <><StatGrid cols={3}><StatCard icon={PhilippinePeso} label="Operating cost" value={money(report.totalCost || total)} valueNote="Fuel + maintenance" tone="primary" /><StatCard icon={Fuel} label="Fuel allocation" value={money(report.fuelCost)} valueNote="Recorded spend" tone="warning" /><StatCard icon={Wrench} label="Maintenance allocation" value={money(report.maintCost)} valueNote="Recorded spend" tone="danger" /></StatGrid><div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]"><Panel title="Operating cost allocation" description="Fuel and maintenance share of recorded operating spend" icon={PhilippinePeso} action={<EncodingBadge>Composition</EncodingBadge>}>{query.isLoading ? <LoadingChart /> : data.length ? <div className="relative h-[310px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ value: 1 }]} dataKey="value" innerRadius={76} outerRadius={108} fill="var(--br)" opacity={0.22} isAnimationActive={false} /><Pie data={data} dataKey="value" nameKey="name" innerRadius={76} outerRadius={108} paddingAngle={5} cornerRadius={9} animationDuration={1000} animationEasing="ease-out">{data.map((item, index) => <Cell key={item.name} fill={CHART_COLORS[index]} stroke="none" />)}</Pie><Tooltip content={<PremiumTooltip />} /></PieChart></ResponsiveContainer><motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.55, delay: 0.3, ease: EASE }} className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="font-data text-2xl font-bold text-foreground">{money(total)}</strong><span className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-muted">Total cost</span></motion.div></div> : <NoData />}</Panel><Panel title="Cost detail" description="Exact values and operational efficiency" icon={FileSpreadsheet}>{data.length ? <div className="space-y-3">{data.map((item, index) => { const pct = total ? Math.round((item.value / total) * 100) : 0; return <motion.div key={item.name} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.42, delay: index * 0.09, ease: EASE }} className="flex items-center justify-between gap-4 rounded-2xl bg-hover/55 px-4 py-4"><div className="flex min-w-0 items-center gap-3"><span className="h-10 w-2 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[index] }} /><div><p className="text-sm font-bold text-foreground">{item.name}</p><p className="mt-0.5 text-[10px] font-semibold text-foreground-muted">{pct}% of recorded operating cost</p></div></div><p className="shrink-0 font-data text-base font-bold text-foreground">{money(item.value)}</p></motion.div>; })}<div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/60 pt-5"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-muted">Cost per kilometer</p><p className="mt-1.5 font-data text-lg font-bold text-foreground">{money(report.costPerKm)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-muted">Distance covered</p><p className="mt-1.5 font-data text-lg font-bold text-foreground">{formatDistance(report.totalDistance || 0)}</p></div></div></div> : <NoData />}</Panel></div></>;
}
