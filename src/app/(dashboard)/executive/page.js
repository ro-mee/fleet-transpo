"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import Link from "next/link";
import { getFinancialSummary, getDriverPerformanceReport, getFleetUtilizationReport, getFuelConsumptionReport, getFleetCostReport } from "@/services/report.service";
import { getAiInsights } from "@/services/ai.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Gauge, Wallet, Fuel, Wrench, Send, Users, TrendingUp, Route } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function ExecutiveKpiPage() {
  useRequireRole(["admin", "management"]);

  const { data: fin = {}, isLoading: finLoading } = useQuery({ queryKey: ["exec-financial"], queryFn: () => getFinancialSummary() });
  const { data: util = {}, isLoading: utilLoading } = useQuery({ queryKey: ["exec-utilization"], queryFn: () => getFleetUtilizationReport() });
  const { data: perf = {}, isLoading: perfLoading } = useQuery({ queryKey: ["exec-driver-perf"], queryFn: () => getDriverPerformanceReport() });
  const { data: fuel = {}, isLoading: fuelLoading } = useQuery({ queryKey: ["exec-fuel"], queryFn: () => getFuelConsumptionReport() });
  const { data: cost = {}, isLoading: costLoading } = useQuery({ queryKey: ["exec-cost"], queryFn: () => getFleetCostReport() });
  const { data: insightsData } = useQuery({ queryKey: ["exec-insights"], queryFn: () => getAiInsights() });

  const insights = useMemo(() => {
    if (Array.isArray(insightsData)) return insightsData;
    if (Array.isArray(insightsData?.insights)) return insightsData.insights;
    return [];
  }, [insightsData]);

  const loading = finLoading || utilLoading || perfLoading || fuelLoading || costLoading;
  const utilVehicles = util.byVehicle || [];
  const topDrivers = (perf.details || []).slice(0, 5);

  const kpis = [
    { label: "Fleet Utilization", value: `${util.utilization ?? 0}%`, icon: Gauge, tone: "success", href: "/analytics" },
    { label: "Total Cost", value: money(fin.totalCost ?? cost.totals?.total_cost), icon: Wallet, tone: "primary", href: "/reports/cost" },
    { label: "Cost / km", value: `$${Number(fin.costPerKm ?? cost.totals?.cost_per_km ?? 0).toFixed(2)}`, icon: TrendingUp, tone: "success", href: "/reports/cost" },
    { label: "Fuel Cost", value: money(fuel.totalCost), icon: Fuel, tone: "warning", href: "/fuel/analytics" },
    { label: "Maintenance Cost", value: money(fin.maintCost), icon: Wrench, tone: "danger", href: "/reports" },
    { label: "Total Trips", value: util.totalTrips ?? 0, icon: Send, tone: "info", href: "/trips" },
    { label: "Total Distance (km)", value: Number(util.totalDistance ?? 0).toLocaleString(), icon: Route, tone: "primary", href: "/tracking/history" },
    { label: "Avg Driver Score", value: perf.avgScore ?? 0, icon: Users, tone: "info", href: "/drivers/performance" },
  ];

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Gauge}
        title="Executive KPI Center"
        badge="Management"
        description="High-level operational and financial KPIs for leadership. Read-only."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Link key={k.label} href={k.href || "#"}>
              <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs hover:shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between space-y-3 h-full">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">{k.label}</span>
                  <div className={cn("p-2 rounded-xl", {
                    "bg-primary/10 text-primary": k.tone === "primary",
                    "bg-success/10 text-success": k.tone === "success",
                    "bg-warning/10 text-warning": k.tone === "warning",
                    "bg-info/10 text-info": k.tone === "info",
                    "bg-danger/10 text-danger": k.tone === "danger"
                  })}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                <div>
                  <div className="text-3xl font-black text-foreground font-data">{loading ? "..." : k.value}</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-1 border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2">Fleet Utilization by Vehicle</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {utilVehicles.length ? (
              <div className="divide-y divide-border">
                {utilVehicles.map((v) => (
                  <div key={v.plate} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="text-sm font-bold text-foreground truncate">{v.plate}</span>
                    <span className="text-sm text-foreground-muted font-medium">{v.trips} trips · {Number(v.distance).toLocaleString()} km</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Route} title="No trip data" description="Utilization appears once trips are recorded." className="py-10" />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2">Top Drivers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topDrivers.length ? (
              <div className="divide-y divide-border">
                {topDrivers.map((d) => (
                  <div key={d.driver_id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{d.name}</p>
                      <p className="text-xs text-foreground-muted font-medium">{d.total_trips} trips · on-time {(d.on_time_rate * 100).toFixed(0)}%</p>
                    </div>
                    <StatusBadge severity={d.performance_score >= 70 ? "high" : d.performance_score >= 40 ? "medium" : "low"} className="flex-shrink-0" />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Users} title="No driver data" description="Driver performance appears once trips are completed." className="py-10" />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2">AI Strategic Insights</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {insights.length ? (
              <div className="divide-y divide-border">
                {insights.slice(0, 4).map((ins, i) => (
                  <Link key={ins.insight_id || i} href="/ai/insights" className="block px-5 py-3 hover:bg-hover transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge severity={(ins.severity || ins.impact || "low").toLowerCase()} className="text-[11px]" />
                      <span className="text-xs text-foreground-muted font-medium">{ins.category || "General"}</span>
                    </div>
                    <p className="text-sm font-bold text-foreground truncate">{ins.title}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon={TrendingUp} title="No insights" description="AI insights will appear here as they're generated." className="py-10" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
