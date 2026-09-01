"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Link from "next/link";
import { getFinancialSummary, getDriverPerformanceReport, getFleetUtilizationReport, getFuelConsumptionReport, getFleetCostReport } from "@/services/report.service";
import { getAiInsights } from "@/services/ai.service";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatCurrency, getInitials, cn } from "@/lib/utils";
import { Gauge, Wallet, Fuel, Wrench, Send, Users, TrendingUp, Route, Truck, Sparkles, Brain, Award, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpRight } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { HeroHeader } from "@/components/ui/hero-header";

const money = (n) => formatCurrency(n || 0);
const ITEMS_PER_PAGE = 5;

function formatShortPlate(plate) {
  if (!plate) return "—";
  if (plate.startsWith("HARN-VS-") && plate.length > 15) {
    const parts = plate.split("-");
    const lastPart = parts[parts.length - 1];
    const shortCode = lastPart.length > 3 ? lastPart.slice(-3) : lastPart;
    return `HARN-VS-${shortCode}`;
  }
  if (plate.startsWith("HARN-CC-") && plate.length > 15) {
    const parts = plate.split("-");
    const lastPart = parts[parts.length - 1];
    const shortCode = lastPart.length > 3 ? lastPart.slice(-3) : lastPart;
    return `HARN-CC-${shortCode}`;
  }
  return plate;
}

function formatName(name) {
  if (!name) return "Unknown Driver";
  return name
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function ExecutiveKpiPage() {
  useRequireRole();

  const [utilPage, setUtilPage] = useState(1);
  const [driverPage, setDriverPage] = useState(1);
  const [insightPage, setInsightPage] = useState(1);

  const { data: fin = {}, isLoading: finLoading, isError: finError, refetch: finRefetch } = useQuery({ queryKey: ["exec-financial"], queryFn: () => getFinancialSummary() });
  const { data: util = {}, isLoading: utilLoading, isError: utilError, refetch: utilRefetch } = useQuery({ queryKey: ["exec-utilization"], queryFn: () => getFleetUtilizationReport() });
  const { data: perf = {}, isLoading: perfLoading, isError: perfError, refetch: perfRefetch } = useQuery({ queryKey: ["exec-driver-perf"], queryFn: () => getDriverPerformanceReport() });
  const { data: fuel = {}, isLoading: fuelLoading, isError: fuelError, refetch: fuelRefetch } = useQuery({ queryKey: ["exec-fuel"], queryFn: () => getFuelConsumptionReport() });
  const { data: cost = {}, isLoading: costLoading, isError: costError, refetch: costRefetch } = useQuery({ queryKey: ["exec-cost"], queryFn: () => getFleetCostReport() });
  const { data: insightsData } = useQuery({ queryKey: ["exec-insights"], queryFn: () => getAiInsights() });

  // Banner-at-top honesty: a failed feed is announced with its own retry,
  // while every panel that still has data keeps rendering. Failures never
  // masquerade as confident zeros.
  const failedQueries = [
    { key: "financial", isError: finError, refetch: finRefetch },
    { key: "utilization", isError: utilError, refetch: utilRefetch },
    { key: "driver performance", isError: perfError, refetch: perfRefetch },
    { key: "fuel", isError: fuelError, refetch: fuelRefetch },
    { key: "cost", isError: costError, refetch: costRefetch },
  ].filter((q) => q.isError);
  const hasError = failedQueries.length > 0;

  const insights = useMemo(() => {
    if (Array.isArray(insightsData)) return insightsData;
    if (Array.isArray(insightsData?.insights)) return insightsData.insights;
    return [];
  }, [insightsData]);

  const loading = finLoading || utilLoading || perfLoading || fuelLoading || costLoading;
  // Stable fallback arrays — inline `|| []` recreates every render and makes
  // the pagination memo deps unstable.
  const utilVehicles = useMemo(() => util.byVehicle || [], [util]);
  const topDrivers = useMemo(() => perf.details || [], [perf]);

  // Pagination slicing
  const paginatedUtil = useMemo(() => {
    const start = (utilPage - 1) * ITEMS_PER_PAGE;
    return utilVehicles.slice(start, start + ITEMS_PER_PAGE);
  }, [utilVehicles, utilPage]);
  const maxUtilPages = Math.ceil(utilVehicles.length / ITEMS_PER_PAGE) || 1;

  const paginatedDrivers = useMemo(() => {
    const start = (driverPage - 1) * ITEMS_PER_PAGE;
    return topDrivers.slice(start, start + ITEMS_PER_PAGE);
  }, [topDrivers, driverPage]);
  const maxDriverPages = Math.ceil(topDrivers.length / ITEMS_PER_PAGE) || 1;

  const paginatedInsights = useMemo(() => {
    const start = (insightPage - 1) * ITEMS_PER_PAGE;
    return insights.slice(start, start + ITEMS_PER_PAGE);
  }, [insights, insightPage]);
  const maxInsightPages = Math.ceil(insights.length / ITEMS_PER_PAGE) || 1;

  const kpis = [
    { label: "Fleet Utilization", value: `${Number(util.utilization) || 0}%`, icon: Gauge, tone: "success", href: "/analytics" },
    { label: "Total Cost", value: money(fin.totalCost ?? cost.totals?.total_cost), icon: Wallet, tone: "primary", href: "/reports/cost" },
    { label: "Cost / km", value: formatCurrency(fin.costPerKm ?? cost.totals?.cost_per_km ?? 0), icon: TrendingUp, tone: "success", href: "/reports/cost" },
    { label: "Fuel Cost", value: money(fuel.totalCost), icon: Fuel, tone: "warning", href: "/fuel/analytics" },
    { label: "Maintenance Cost", value: money(fin.maintCost), icon: Wrench, tone: "danger", href: "/reports" },
    { label: "Total Trips", value: util.totalTrips ?? 0, icon: Send, tone: "info", href: "/trips" },
    { label: "Total Distance (km)", value: (Number(util.totalDistance) || 0).toLocaleString(), icon: Route, tone: "primary", href: "/tracking/history" },
    { label: "Avg Driver Score", value: perf.avgScore ?? 0, icon: Users, tone: "info", href: "/drivers/performance" },
  ];

  return (
    <div className="space-y-6 pb-12 w-full">
      <HeroHeader
        icon={Gauge}
        title="Executive KPI Center"
        badge="Management"
        description="High-level operational and financial KPIs for leadership. Real-time overview."
      />

      {hasError && (
        <div className="space-y-2" role="alert">
          {failedQueries.map((q) => (
            <QueryErrorBanner
              key={q.key}
              query={q}
              title={`Couldn't refresh the ${q.key} feed`}
              description="KPIs and panels fed by this report may be missing or stale."
            />
          ))}
        </div>
      )}

      <StatGrid cols={4} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => {
          return (
            <Link key={k.label} href={k.href || "#"} className="block rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              <StatCard icon={k.icon} label={k.label} value={loading ? "—" : k.value} tone={k.tone} interactive />
            </Link>
          );
        })}
      </StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* PANEL 1: Fleet Utilization by Vehicle */}
        <Card className="lg:col-span-1 border-0 shadow-xs rounded-3xl overflow-hidden bg-surface flex flex-col justify-between">
          <div>
            <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Truck className="w-4 h-4 text-primary" /> Fleet Utilization by Vehicle
                </CardTitle>
                <Badge variant="outline" className="text-[11px] font-medium font-data rounded-full px-2 py-0.5">
                  {utilVehicles.length} Total
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {paginatedUtil.length ? (
                <div className="divide-y divide-border/60">
                  {paginatedUtil.map((v) => (
                    <div key={v.plate} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
                          <Truck className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-foreground font-data truncate">{formatShortPlate(v.plate)}</span>
                      </div>
                      <span className="text-[11px] text-foreground-secondary font-medium font-data shrink-0 bg-muted/30 px-2 py-0.5 rounded-xl border border-border/60">
                        {v.trips} trips · {Number(v.distance || 0).toLocaleString()} km
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Route} title="No trip data" description="Utilization appears once trips are recorded." className="py-12" />
              )}
            </CardContent>
          </div>

          {/* ── Pagination Footer (System Standard) ── */}
          {utilVehicles.length > 0 && maxUtilPages > 1 && (
            <CardFooter className="flex flex-col gap-3 px-4 py-4 border-t border-border/60 bg-transparent xl:flex-row xl:items-center xl:justify-between">
              <span className="text-xs font-semibold text-foreground-secondary">
                Showing <span className="font-bold text-foreground">{(utilPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(utilPage * ITEMS_PER_PAGE, utilVehicles.length)}</span> of <span className="font-bold text-foreground">{utilVehicles.length}</span>
              </span>
              <div className="flex items-center gap-1.5">
                <span className="mr-2 hidden text-xs font-semibold text-foreground-muted sm:inline">Page {utilPage} of {maxUtilPages}</span>
                <button
                  onClick={() => setUtilPage(1)}
                  disabled={utilPage === 1}
                  className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setUtilPage((p) => Math.max(1, p - 1))}
                  disabled={utilPage === 1}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                {Array.from({ length: maxUtilPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setUtilPage(p)}
                    className={cn(
                      "flex h-8 min-w-[32px] px-2.5 items-center justify-center rounded-full text-xs font-bold border transition-colors",
                      utilPage === p
                        ? "bg-primary border-primary text-white dark:text-slate-950 shadow-2xs"
                        : "border-border/80 bg-surface text-foreground-secondary hover:border-primary/40 hover:text-primary"
                    )}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setUtilPage((p) => Math.min(maxUtilPages, p + 1))}
                  disabled={utilPage === maxUtilPages}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setUtilPage(maxUtilPages)}
                  disabled={utilPage === maxUtilPages}
                  className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </CardFooter>
          )}
        </Card>

        {/* PANEL 2: Top Drivers */}
        <Card className="lg:col-span-1 border-0 shadow-xs rounded-3xl overflow-hidden bg-surface flex flex-col justify-between">
          <div>
            <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Award className="w-4 h-4 text-warning" /> Top Performing Drivers
                </CardTitle>
                <Badge variant="outline" className="text-[11px] font-medium font-data rounded-full px-2 py-0.5">
                  {topDrivers.length} Roster
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {paginatedDrivers.length ? (
                <div className="divide-y divide-border/60">
                  {paginatedDrivers.map((d, index) => {
                    const formattedName = formatName(d.name);
                    return (
                      <div key={d.driver_id || index} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-8 w-8 shrink-0 border border-border/60">
                            <AvatarFallback className="bg-warning/10 text-warning font-bold text-xs">
                              {getInitials(formattedName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">{formattedName}</p>
                            <p className="text-[11px] text-foreground-muted font-medium font-data mt-0.5">
                              {d.total_trips} trips · On-Time {d.on_time_rate == null ? "Insufficient data" : `${(d.on_time_rate * 100).toFixed(0)}%`}
                            </p>
                          </div>
                        </div>
                        {/* Positive grammar for a leaderboard: high score = strong,
                            never the danger heat used for risk surfaces. */}
                        {d.performance_score >= 70 ? (
                          <Badge variant="success" className="shrink-0">Strong</Badge>
                        ) : d.performance_score >= 40 ? (
                          <Badge variant="warning" className="shrink-0">Developing</Badge>
                        ) : (
                          <Badge variant="info" className="shrink-0">Improving</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState icon={Users} title="No driver data" description="Driver performance appears once trips are completed." className="py-12" />
              )}
            </CardContent>
          </div>

          {/* ── Pagination Footer (System Standard) ── */}
          {topDrivers.length > 0 && maxDriverPages > 1 && (
            <CardFooter className="flex flex-col gap-3 px-4 py-4 border-t border-border/60 bg-transparent xl:flex-row xl:items-center xl:justify-between">
              <span className="text-xs font-semibold text-foreground-secondary">
                Showing <span className="font-bold text-foreground">{(driverPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(driverPage * ITEMS_PER_PAGE, topDrivers.length)}</span> of <span className="font-bold text-foreground">{topDrivers.length}</span>
              </span>
              <div className="flex items-center gap-1.5">
                <span className="mr-2 hidden text-xs font-semibold text-foreground-muted sm:inline">Page {driverPage} of {maxDriverPages}</span>
                <button
                  onClick={() => setDriverPage(1)}
                  disabled={driverPage === 1}
                  className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setDriverPage((p) => Math.max(1, p - 1))}
                  disabled={driverPage === 1}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                {Array.from({ length: maxDriverPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setDriverPage(p)}
                    className={cn(
                      "flex h-8 min-w-[32px] px-2.5 items-center justify-center rounded-full text-xs font-bold border transition-colors",
                      driverPage === p
                        ? "bg-primary border-primary text-white dark:text-slate-950 shadow-2xs"
                        : "border-border/80 bg-surface text-foreground-secondary hover:border-primary/40 hover:text-primary"
                    )}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setDriverPage((p) => Math.min(maxDriverPages, p + 1))}
                  disabled={driverPage === maxDriverPages}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setDriverPage(maxDriverPages)}
                  disabled={driverPage === maxDriverPages}
                  className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </CardFooter>
          )}
        </Card>

        {/* PANEL 3: AI Strategic Insights */}
        <Card className="lg:col-span-1 border-0 shadow-xs rounded-3xl overflow-hidden bg-surface flex flex-col justify-between">
          <div>
            <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <div className="p-1 rounded-lg bg-primary/10 text-primary border border-primary/20">
                    <Brain className="w-3.5 h-3.5" />
                  </div>
                  AI Strategic Insights
                </CardTitle>
                <Badge variant="outline" className="text-[11px] font-medium font-data rounded-full px-2.5 py-0.5 bg-surface border-border/80">
                  {insights.length} Active
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-3.5 space-y-2.5">
              {paginatedInsights.length ? (
                paginatedInsights.map((ins, i) => (
                  <Link
                    key={ins.insight_id || i}
                    href="/ai/insights"
                    className="group p-3.5 rounded-2xl border border-border/60 bg-muted/20 hover:bg-hover/80 hover:border-primary/30 transition-all flex items-start justify-between gap-3 cursor-pointer"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StatusBadge severity={(ins.severity || ins.impact || "low").toLowerCase()} className="text-[10px] px-2 py-0.5 rounded-md font-bold" />
                        <span className="text-[11px] text-foreground-secondary font-medium tracking-wide">{ins.category || "General"}</span>
                      </div>
                      <p className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors leading-snug">
                        {ins.title}
                      </p>
                      {(ins.recommendation || ins.description || ins.details) && (
                        <p className="text-[11px] text-foreground-muted line-clamp-1 font-normal">
                          {ins.recommendation || ins.description || ins.details}
                        </p>
                      )}
                    </div>
                    <div className="p-1.5 rounded-xl bg-surface border border-border/60 group-hover:border-primary/40 group-hover:bg-primary/10 group-hover:text-primary transition-all shrink-0 mt-0.5">
                      <ArrowUpRight className="w-3.5 h-3.5 text-foreground-muted group-hover:text-primary transition-colors" />
                    </div>
                  </Link>
                ))
              ) : (
                <EmptyState icon={TrendingUp} title="No insights" description="AI insights will appear here as they're generated." className="py-12" />
              )}
            </CardContent>
          </div>

          {/* ── Pagination Footer (System Standard) ── */}
          {insights.length > 0 && maxInsightPages > 1 && (
            <CardFooter className="flex flex-col gap-3 px-4 py-4 border-t border-border/60 bg-transparent xl:flex-row xl:items-center xl:justify-between">
              <span className="text-xs font-semibold text-foreground-secondary">
                Showing <span className="font-bold text-foreground">{(insightPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(insightPage * ITEMS_PER_PAGE, insights.length)}</span> of <span className="font-bold text-foreground">{insights.length}</span>
              </span>
              <div className="flex items-center gap-1.5">
                <span className="mr-2 hidden text-xs font-semibold text-foreground-muted sm:inline">Page {insightPage} of {maxInsightPages}</span>
                <button
                  onClick={() => setInsightPage(1)}
                  disabled={insightPage === 1}
                  className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setInsightPage((p) => Math.max(1, p - 1))}
                  disabled={insightPage === 1}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                {Array.from({ length: maxInsightPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setInsightPage(p)}
                    className={cn(
                      "flex h-8 min-w-[32px] px-2.5 items-center justify-center rounded-full text-xs font-bold border transition-colors",
                      insightPage === p
                        ? "bg-primary border-primary text-white dark:text-slate-950 shadow-2xs"
                        : "border-border/80 bg-surface text-foreground-secondary hover:border-primary/40 hover:text-primary"
                    )}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setInsightPage((p) => Math.min(maxInsightPages, p + 1))}
                  disabled={insightPage === maxInsightPages}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setInsightPage(maxInsightPages)}
                  disabled={insightPage === maxInsightPages}
                  className="hidden h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground-muted hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 transition-colors sm:flex"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
