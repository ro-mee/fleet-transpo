"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import Link from "next/link";
import { getFinancialSummary, getDriverPerformanceReport, getFleetUtilizationReport, getFuelConsumptionReport, getFleetCostReport } from "@/services/report.service";
import { getAiInsights } from "@/services/ai.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { Gauge, Wallet, Fuel, Wrench, Send, Users, TrendingUp, Route } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

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
      <PageHeader title="Executive KPI Center" description="High-level operational and financial KPIs for leadership. Read-only." />

      {loading ? (
        <StatsGridSkeleton count={8} gridClass="md:grid-cols-2 lg:grid-cols-4" />
      ) : (
        <StatGrid cols={4}>
          {kpis.map((k) => (
            <StatCard key={k.label} icon={k.icon} label={k.label} value={k.value} tone={k.tone} href={k.href} />
          ))}
        </StatGrid>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Fleet Utilization by Vehicle</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {utilVehicles.length ? (
              <div className="divide-y divide-border">
                {utilVehicles.map((v) => (
                  <div key={v.plate} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="text-sm text-foreground truncate">{v.plate}</span>
                    <span className="text-sm text-foreground-muted">{v.trips} trips · {Number(v.distance).toLocaleString()} km</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Route} title="No trip data" description="Utilization appears once trips are recorded." className="py-10" />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Top Drivers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topDrivers.length ? (
              <div className="divide-y divide-border">
                {topDrivers.map((d) => (
                  <div key={d.driver_id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                      <p className="text-xs text-foreground-muted">{d.total_trips} trips · on-time {(d.on_time_rate * 100).toFixed(0)}%</p>
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

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">AI Strategic Insights</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {insights.length ? (
              <div className="divide-y divide-border">
                {insights.slice(0, 4).map((ins, i) => (
                  <Link key={ins.insight_id || i} href="/ai/insights" className="block px-5 py-3 hover:bg-hover transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge severity={(ins.severity || ins.impact || "low").toLowerCase()} className="text-[11px]" />
                      <span className="text-xs text-foreground-muted">{ins.category || "General"}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground truncate">{ins.title}</p>
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
