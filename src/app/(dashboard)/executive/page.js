"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Fuel,
  Gauge,
  Route,
  ShieldAlert,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import {
  getDriverPerformanceReport,
  getFinancialSummary,
  getFleetUtilizationReport,
} from "@/services/report.service";
import { getIncidentSummary } from "@/services/driver.service";
import { getAiInsights } from "@/services/ai.service";
import { formatCurrency } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { CardSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { DistributionMeter } from "@/components/dashboard/role-dashboard";

const tooltipStyle = {
  background: "var(--sf)",
  border: "1px solid var(--br)",
  borderRadius: "12px",
  fontSize: "12px",
};

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

function Panel({ title, description, action, className = "", children }) {
  return (
    <Card className={`overflow-hidden rounded-[16px] border-border/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] bg-surface ${className}`}>
      <CardHeader className="border-b border-border/60 p-5 bg-hover/30">
        <div className="flex items-start justify-between gap-4">
          <div><CardTitle className="text-[15px] font-semibold tracking-tight">{title}</CardTitle>{description && <p className="mt-1 text-xs leading-relaxed text-foreground-secondary">{description}</p>}</div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

function FeedState({ query, children, errorTitle = "This data is unavailable" }) {
  if (query.isLoading) return <div className="p-5"><CardSkeleton /></div>;
  if (query.isError) return <div className="m-5 rounded-[12px] bg-danger-bg px-4 py-3 text-[13px] text-danger-700 font-medium tracking-tight" role="alert">{errorTitle}. Use Retry in the alert above.</div>;
  return children;
}

function StatusBars({ rows }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return <div className="space-y-4 p-5">{rows.map((row) => <div key={row.label} className="group"><div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="font-semibold text-foreground-secondary group-hover:text-foreground transition-colors">{row.label}</span><span className="tabular-nums font-semibold text-foreground">{row.value}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-hover ring-1 ring-inset ring-border/50 shadow-inner"><div className={`h-full rounded-full transition-all duration-700 ease-out ${row.color}`} style={{ width: `${Number(row.value) ? Math.max(3, (Number(row.value) / max) * 100) : 0}%` }} /></div></div>)}</div>;
}

export default function ExecutiveKpiPage() {
  useRequireRole();

  const financial = useQuery({ queryKey: ["exec-financial"], queryFn: () => getFinancialSummary() });
  const utilization = useQuery({ queryKey: ["exec-utilization"], queryFn: () => getFleetUtilizationReport() });
  const performance = useQuery({ queryKey: ["exec-driver-perf"], queryFn: () => getDriverPerformanceReport() });
  const incidents = useQuery({ queryKey: ["exec-incident-summary"], queryFn: () => getIncidentSummary() });
  const insightsQuery = useQuery({ queryKey: ["exec-insights"], queryFn: () => getAiInsights() });

  const fin = financial.data || {};
  const util = utilization.data || {};
  const perf = performance.data || {};
  const risk = incidents.data || {};
  const insights = useMemo(() => Array.isArray(insightsQuery.data) ? insightsQuery.data : insightsQuery.data?.insights || [], [insightsQuery.data]);
  const vehicleStatus = (util.vehicleRoster || []).reduce((acc, vehicle) => {
    const status = vehicle.vehicle_status || "Unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const statusTrips = (util.statusBreakdown || []).reduce((acc, row) => {
    acc[row.status] = Number(row.trips) || 0;
    return acc;
  }, {});
  const measuredDrivers = (perf.details || []).filter((driver) => driver.on_time_rate != null && Number(driver.total_trips) > 0);
  const measuredTrips = measuredDrivers.reduce((sum, driver) => sum + Number(driver.total_trips), 0);
  const onTimeRate = measuredTrips
    ? measuredDrivers.reduce((sum, driver) => sum + Number(driver.on_time_rate) * Number(driver.total_trips), 0) / measuredTrips
    : null;
  const costTrend = (fin.monthlyData || []).slice(-12);
  const reportLink = <Link href="/reports" className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline">Open reports <ArrowRight className="h-3.5 w-3.5" /></Link>;

  return (
    <div className="w-full space-y-6 pb-12">
      <HeroHeader
        icon={Gauge}
        title="Executive KPI Center"
        badge="Management"
        description="High-level operational and financial KPIs for leadership. Real-time overview."
      />

      {[financial, utilization, performance, incidents, insightsQuery].some((query) => query.isError) && (
        <div className="space-y-2">
          {[
            [financial, "Financial summary could not be refreshed"],
            [utilization, "Fleet utilization could not be refreshed"],
            [performance, "Driver performance could not be refreshed"],
            [incidents, "Incident risk could not be refreshed"],
            [insightsQuery, "AI insights could not be refreshed"],
          ].map(([query, title]) => <QueryErrorBanner key={title} query={query} title={title} description="Affected metrics show as unavailable; other executive data remains current." />)}
        </div>
      )}

      <StatGrid cols={6}>
        <StatCard icon={Gauge} label="Fleet in use now" value={utilization.isLoading || utilization.isError ? "—" : `${Number(util.utilization) || 0}%`} trend={utilization.isLoading || utilization.isError ? "Unavailable while utilization refreshes" : `${util.vehiclesInUse || 0} of ${util.fleetSize || 0} vehicles currently In Use`} tone="primary" />
        <StatCard icon={CheckCircle2} label="Completed trips" value={performance.isLoading || performance.isError ? "—" : perf.totalTrips || 0} trend={performance.isLoading || performance.isError ? "Unavailable while performance refreshes" : "Completed trips in the report period"} tone="success" />
        <StatCard icon={TrendingUp} label="On-time rate" value={performance.isLoading || performance.isError ? "—" : onTimeRate == null ? "—" : `${Math.round(onTimeRate * 100)}%`} trend={performance.isLoading || performance.isError ? "Unavailable while performance refreshes" : onTimeRate == null ? "Insufficient completed-trip measurements" : `${measuredTrips} measured completed trips`} tone="info" />
        <StatCard icon={Wallet} label="Recorded operating cost" value={financial.isLoading || financial.isError ? "—" : formatCurrency(fin.totalCost || 0)} trend={financial.isLoading || financial.isError ? "Unavailable while financial data refreshes" : "Fuel plus maintenance records"} tone="primary" />
        <StatCard icon={Route} label="Cost per km" value={financial.isLoading || financial.isError ? "—" : fin.totalDistance ? formatCurrency(fin.costPerKm || 0) : "—"} trend={financial.isLoading || financial.isError ? "Unavailable while financial data refreshes" : fin.totalDistance ? `${Number(fin.totalDistance).toLocaleString()} km recorded` : "No recorded distance denominator"} tone="warning" />
        <StatCard icon={ShieldAlert} label="Critical / major open" value={incidents.isLoading || incidents.isError ? "—" : risk.critical_major_open || 0} trend="Open incident severity exposure" tone="danger" />
      </StatGrid>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.7fr)]">
        <Panel title="Operating cost trend" description="Recorded fuel and maintenance costs by month; missing months are not fabricated." action={reportLink}>
          <FeedState query={financial} errorTitle="The operating cost trend is unavailable">{costTrend.length ? (
            <><div className="h-[330px] p-5" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={costTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="fuelCostArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--primary)" stopOpacity={0.24} /><stop offset="95%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient><linearGradient id="maintenanceCostArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--warning)" stopOpacity={0.22} /><stop offset="95%" stopColor="var(--warning)" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} tickFormatter={(value) => `₱${Number(value).toLocaleString()}`} width={72} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [formatCurrency(value), name === "fuelCost" ? "Fuel" : "Maintenance"]} />
                  <Area type="monotone" dataKey="fuelCost" stroke="var(--primary)" strokeWidth={2} fill="url(#fuelCostArea)" />
                  <Area type="monotone" dataKey="maintenanceCost" stroke="var(--warning)" strokeWidth={2} fill="url(#maintenanceCostArea)" />
                </AreaChart>
              </ResponsiveContainer>
            </div><table className="sr-only"><caption>Monthly recorded operating costs</caption><thead><tr><th>Month</th><th>Fuel cost</th><th>Maintenance cost</th></tr></thead><tbody>{costTrend.map((row) => <tr key={row.month}><th>{row.month}</th><td>{formatCurrency(row.fuelCost || 0)}</td><td>{formatCurrency(row.maintenanceCost || 0)}</td></tr>)}</tbody></table></>
          ) : <EmptyState icon={Wallet} title="No cost trend available" description="Monthly points appear when fuel or maintenance costs are recorded." className="py-16" />}</FeedState>
        </Panel>

        <Panel title="Fleet activity state" description="Current roster status, separate from historical trip volume." action={<Link href="/analytics" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">View analytics <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState query={utilization} errorTitle="Fleet activity state is unavailable"><DistributionMeter items={[
            { label: "In use", value: vehicleStatus["In Use"] || 0, color: "bg-primary" },
            { label: "Reserved", value: vehicleStatus.Reserved || 0, color: "bg-info" },
            { label: "Under maintenance", value: vehicleStatus["Under Maintenance"] || 0, color: "bg-warning" },
            { label: "Decommissioned", value: vehicleStatus.Decommissioned || 0, color: "bg-danger" },
          ]} /></FeedState>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Service reliability" description="Stored trip outcomes in the report period.">
          <FeedState query={utilization} errorTitle="Service reliability is unavailable"><DistributionMeter items={[
            { label: "Completed", value: statusTrips.Completed || 0, color: "bg-success" },
            { label: "Cancelled", value: statusTrips.Cancelled || 0, color: "bg-danger" },
          ]} /></FeedState>
        </Panel>
        <Panel title="Cost mix" description="Recorded components only; unrecorded trip cost is not estimated.">
          <FeedState query={financial} errorTitle="The recorded cost mix is unavailable"><div className="space-y-5 p-5"><div><p className="text-xs text-foreground-secondary">Fuel</p><p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatCurrency(fin.fuelCost || 0)}</p></div><div><p className="text-xs text-foreground-secondary">Maintenance</p><p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatCurrency(fin.maintCost || 0)}</p></div><p className="text-xs leading-relaxed text-foreground-muted">Method: {fin.methodology || "Financial report methodology unavailable."}</p></div></FeedState>
        </Panel>
        <Panel title="Operational risk" description="Current incident attention, not a historical severity forecast.">
          <FeedState query={incidents} errorTitle="Operational risk is unavailable"><StatusBars rows={[
            { label: "Open incidents", value: risk.open || 0, color: "bg-warning" },
            { label: "Critical / major", value: risk.critical_major_open || 0, color: "bg-danger" },
            { label: "Assistance open", value: risk.assistance_open || 0, color: "bg-info" },
            { label: "Maintenance pending", value: risk.maintenance_pending || 0, color: "bg-primary" },
          ]} /></FeedState>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <Panel title="Driver performance snapshot" description="Completed-trip measurements; unscored drivers remain visible without invented ratings." action={<Link href="/drivers/performance" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Full performance view <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState query={performance} errorTitle="Driver performance is unavailable">{(perf.details || []).length ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-hover text-xs text-foreground-secondary"><tr><th className="px-5 py-3 font-semibold">Driver</th><th className="px-5 py-3 font-semibold">Trips</th><th className="px-5 py-3 font-semibold">On-time</th><th className="px-5 py-3 font-semibold">Score</th><th className="px-5 py-3 font-semibold">Incidents</th></tr></thead><tbody className="divide-y divide-border/70">{perf.details.slice(0, 8).map((driver) => <tr key={driver.driver_id} className="hover:bg-hover/60"><td className="px-5 py-3 font-medium text-foreground">{driver.name}</td><td className="px-5 py-3 tabular-nums text-foreground-secondary">{driver.total_trips}</td><td className="px-5 py-3 tabular-nums text-foreground-secondary">{driver.on_time_rate == null ? "—" : `${Math.round(driver.on_time_rate * 100)}%`}</td><td className="px-5 py-3 tabular-nums text-foreground-secondary">{driver.performance_score == null ? "—" : driver.performance_score}</td><td className="px-5 py-3"><StatusBadge status={driver.incidents > 0 ? "High" : "Healthy"} entity="risk" /></td></tr>)}</tbody></table></div>
          ) : <EmptyState icon={Users} title="No driver measurements" description="Performance appears after completed trips record the required measures." className="py-14" />}</FeedState>
        </Panel>

        <Panel title="Advisory insights" description="Evidence-based records only. Insights advise; they never change fleet state." action={<Link href="/ai/insights" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open insights <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <FeedState query={insightsQuery} errorTitle="Advisory insights are unavailable">{insights.length ? <div className="divide-y divide-border/70">{insights.slice(0, 5).map((insight, index) => <Link key={insight.insight_id || index} href="/ai/insights" className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><Brain className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium text-foreground">{insight.title || "Advisory insight"}</p><StatusBadge severity={String(insight.severity || insight.impact || "low").toLowerCase()} /></div><p className="mt-1 line-clamp-2 text-xs leading-relaxed text-foreground-secondary">{insight.recommendation || insight.description || insight.details || "No supporting detail recorded"}</p></div></Link>)}</div> : <EmptyState icon={Brain} title="No active insights" description="Advisory records will appear when evidence-based analysis is available." className="py-14" />}</FeedState>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["/reports", Wallet, "Financial reports", financial.isLoading || financial.isError ? "Unavailable" : formatCurrency(fin.totalCost || 0)],
          ["/analytics", Truck, "Fleet analytics", utilization.isLoading || utilization.isError ? "Unavailable" : `${util.fleetSize || 0} vehicles`],
          ["/reports", Fuel, "Fuel and maintenance", financial.isLoading || financial.isError ? "Unavailable" : formatCurrency((fin.fuelCost || 0) + (fin.maintCost || 0))],
          ["/incidents", AlertTriangle, "Incident oversight", incidents.isLoading || incidents.isError ? "Unavailable" : `${risk.attention || 0} attention items`],
        ].map(([href, Icon, label, detail]) => <Link key={label} href={href} className="group flex min-h-16 items-center gap-3 rounded-[16px] border border-border/70 bg-surface px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all hover:bg-hover/80 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]"><Icon className="h-5 w-5 shrink-0 text-primary group-hover:scale-110 transition-transform" /><div className="min-w-0 flex-1"><p className="text-[15px] font-semibold text-foreground tracking-tight">{label}</p><p className="mt-0.5 truncate text-[13px] text-foreground-secondary">{detail}</p></div><ArrowRight className="h-5 w-5 text-foreground-muted transition-transform group-hover:text-foreground group-hover:translate-x-0.5" /></Link>)}
      </div>
    </div>
  );
}
