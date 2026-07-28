"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getFleetUtilizationReport, getFuelConsumptionReport, getFinancialSummary } from "@/services/report.service";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { formatCurrency, formatDistance } from "@/lib/utils";
import {
  BarChart3, TrendingUp, TrendingDown, Activity,
  Truck, Fuel, DollarSign, Wrench, Users, MapPin, Clock,
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-foreground-secondary mt-1">Comprehensive operational analytics and trends</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-primary/10"><Truck className="w-5 h-5 text-primary" /></div>
              <Badge variant={f.utilization > 70 ? "success" : "warning"} className="text-[10px]">{f.utilization}%</Badge>
            </div>
            <p className="text-lg font-bold">{formatDistance(f.totalDistance)}</p>
            <p className="text-xs text-foreground-muted">Total Distance</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-warning/10"><Fuel className="w-5 h-5 text-warning" /></div>
            </div>
            <p className="text-lg font-bold">{formatCurrency(fu.totalCost)}</p>
            <p className="text-xs text-foreground-muted">Fuel Cost</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-success/10"><DollarSign className="w-5 h-5 text-success" /></div>
            </div>
            <p className="text-lg font-bold">{formatCurrency(fi.totalCost)}</p>
            <p className="text-xs text-foreground-muted">Total Cost</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-danger/10"><Wrench className="w-5 h-5 text-danger" /></div>
              <Badge variant="danger" className="text-[10px]">{maintDue}</Badge>
            </div>
            <p className="text-lg font-bold">{formatCurrency(fi.maintCost)}</p>
            <p className="text-xs text-foreground-muted">Maintenance Cost</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Monthly Fuel Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fu.monthlyData.length === 0 ? (
              <p className="text-sm text-foreground-muted text-center py-12">No fuel data available</p>
            ) : (
              <div className="space-y-2">
                {fu.monthlyData.map((m) => (
                  <div key={m.month} className="flex items-center gap-3">
                    <span className="text-xs font-medium w-16 text-foreground-muted">{m.month}</span>
                    <div className="flex-1 bg-muted rounded-full h-6 relative">
                      <div className="bg-gradient-to-r from-warning/60 to-warning h-6 rounded-full flex items-center justify-end px-2" style={{ width: `${(m.liters / maxMonthlyLiters) * 100}%` }}>
                        <span className="text-[10px] text-white font-medium">{m.liters.toFixed(0)}L</span>
                      </div>
                    </div>
                    <span className="text-xs text-foreground-muted w-20 text-right">{formatCurrency(m.cost)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <PieChartIcon /> Cost Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fi.totalCost === 0 ? (
              <p className="text-sm text-foreground-muted text-center py-12">No cost data available</p>
            ) : (
              <div className="space-y-4">
                {[
                  { label: "Trip Costs", value: fi.tripCost, pct: (fi.tripCost / fi.totalCost) * 100, color: "bg-primary" },
                  { label: "Fuel Costs", value: fi.fuelCost, pct: (fi.fuelCost / fi.totalCost) * 100, color: "bg-warning" },
                  { label: "Maintenance", value: fi.maintCost, pct: (fi.maintCost / fi.totalCost) * 100, color: "bg-danger" },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-foreground-secondary">{item.label}</span>
                      <span className="font-medium">{Math.round(item.pct)}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-3">
                      <div className={`${item.color} h-3 rounded-full`} style={{ width: `${item.pct}%` }} />
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-border">
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground-secondary">Cost per km</span>
                    <span className="font-bold">{formatCurrency(fi.costPerKm)}</span>
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
              <TrendingUp className="w-4 h-4 text-primary" /> Fleet Utilization
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-foreground-secondary">Active Fleet</span>
                  <span className="text-sm font-bold">{f.utilization}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-4">
                  <div
                    className={`h-4 rounded-full transition-all ${f.utilization > 75 ? "bg-success" : f.utilization > 50 ? "bg-warning" : "bg-danger"}`}
                    style={{ width: `${f.utilization}%` }}
                  />
                </div>
              </div>
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
                  <p className="text-sm font-semibold text-foreground">{metric.value}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PieChartIcon() {
  return (
    <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.21 15.89A10 10 0 118 2.83M22 12A10 10 0 0012 2v10z" />
    </svg>
  );
}
