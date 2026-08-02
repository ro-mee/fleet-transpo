"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { getFleetUtilizationReport, getFuelConsumptionReport, getFinancialSummary } from "@/services/report.service";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { formatCurrency, formatDistance } from "@/lib/utils";
import {
  BarChart3, Activity,
  Truck, Fuel, DollarSign, Wrench, MapPin, Clock,
} from "lucide-react";

export default function AnalyticsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);
  const { data: fleet } = useQuery({
    queryKey: ["analytics-fleet"],
    queryFn: () => getFleetUtilizationReport(),
  });

  const { data: fuel } = useQuery({
    queryKey: ["analytics-fuel"],
    queryFn: () => getFuelConsumptionReport(),
  });

  const { data: financial } = useQuery({
    queryKey: ["analytics-financial"],
    queryFn: () => getFinancialSummary(),
  });

  const { data: predictions = [] } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });

  const f = fleet || { utilization: 0, totalTrips: 0, totalDistance: 0 };
  const fu = fuel || { totalLiters: 0, totalCost: 0, monthlyData: [] };
  const fi = financial || { totalCost: 0, tripCost: 0, fuelCost: 0, maintCost: 0, costPerKm: 0 };
  const maintDue = predictions.filter((p) => p.risk === "overdue" || p.risk === "critical").length;

  const maxMonthlyLiters = fu.monthlyData.length ? Math.max(...fu.monthlyData.map((m) => m.liters)) : 0;

  const utilTone = f.utilization > 75 ? "success" : f.utilization > 50 ? "warning" : "danger";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title="Analytics"
        description="Operational trends across fleet utilization, fuel, and cost."
      />

      <StatGrid cols={4}>
        <StatCard
          icon={Truck}
          label="Total Distance"
          value={formatDistance(f.totalDistance)}
          tone="primary"
          trend={`${f.utilization}% fleet utilization`}
        />
        <StatCard
          icon={Fuel}
          label="Fuel Cost"
          value={formatCurrency(fu.totalCost)}
          tone="warning"
        />
        <StatCard
          icon={DollarSign}
          label="Total Cost"
          value={formatCurrency(fi.totalCost)}
          tone="success"
        />
        <StatCard
          icon={Wrench}
          label="Maintenance Cost"
          value={formatCurrency(fi.maintCost)}
          tone="danger"
          trend={`${maintDue} vehicle${maintDue === 1 ? "" : "s"} due for service`}
        />
      </StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Monthly Fuel Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fu.monthlyData.length === 0 ? (
              <EmptyState
                icon={Fuel}
                title="No fuel data available"
                description="Approved fuel records will populate this monthly trend."
              />
            ) : (
              <div className="space-y-3">
                {fu.monthlyData.map((m) => (
                  <div key={m.month} className="flex items-center gap-3">
                    <span className="text-xs font-medium w-16 text-foreground-muted">{m.month}</span>
                    <ProgressBar
                      className="flex-1"
                      tone="warning"
                      value={(m.liters / maxMonthlyLiters) * 100}
                    />
                    <span className="text-xs text-foreground-secondary w-28 text-right font-data">
                      {m.liters.toFixed(0)} L · {formatCurrency(m.cost)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" /> Cost Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fi.totalCost === 0 ? (
              <EmptyState
                icon={DollarSign}
                title="No cost data available"
                description="Approved expenses will populate this distribution."
              />
            ) : (
              <div className="space-y-4">
                {[
                  { label: "Trip Costs", value: fi.tripCost, pct: (fi.tripCost / fi.totalCost) * 100, tone: "primary" },
                  { label: "Fuel Costs", value: fi.fuelCost, pct: (fi.fuelCost / fi.totalCost) * 100, tone: "warning" },
                  { label: "Maintenance", value: fi.maintCost, pct: (fi.maintCost / fi.totalCost) * 100, tone: "danger" },
                ].map((item) => (
                  <ProgressBar
                    key={item.label}
                    tone={item.tone}
                    value={item.pct}
                    label={`${item.label} · ${formatCurrency(item.value)}`}
                    valueLabel={`${Math.round(item.pct)}%`}
                  />
                ))}
                <div className="pt-3 border-t border-border">
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-secondary">Cost per km</span>
                    <span className="font-data font-semibold text-foreground">{formatCurrency(fi.costPerKm)}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Fleet Utilization
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <ProgressBar
                tone={utilTone}
                value={f.utilization}
                label="Active Fleet"
                valueLabel={`${f.utilization}%`}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xl font-bold text-primary">{f.totalTrips}</p>
                <p className="text-xs text-foreground-muted">Total Trips</p>
              </div>
              <div className="p-3 rounded-xl bg-muted/30">
                <p className="text-xl font-bold text-primary">{formatDistance(f.totalDistance)}</p>
                <p className="text-xs text-foreground-muted">Total Distance</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" /> Key Metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Avg Cost per Trip", value: f.totalTrips ? formatCurrency(fi.totalCost / f.totalTrips) : "—", icon: DollarSign, color: "text-success", bg: "bg-success/10" },
              { label: "Fuel per km", value: f.totalDistance ? `${(fu.totalLiters / f.totalDistance).toFixed(2)} L` : "—", icon: Fuel, color: "text-warning", bg: "bg-warning/10" },
              { label: "Maintenance per km", value: f.totalDistance ? formatCurrency(fi.maintCost / f.totalDistance) : "—", icon: Wrench, color: "text-danger", bg: "bg-danger/10" },
              { label: "Vehicles Requiring Service", value: maintDue, icon: Clock, color: "text-primary", bg: "bg-primary/10" },
            ].map((metric) => (
              <div key={metric.label} className="flex items-center gap-3 p-3 rounded-lg hover:bg-hover transition-colors">
                <div className={`p-2 rounded-lg ${metric.bg}`}>
                  <metric.icon className={`w-4 h-4 ${metric.color}`} />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-foreground-muted">{metric.label}</p>
                  <p className="text-sm font-semibold text-foreground font-data">{metric.value}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
