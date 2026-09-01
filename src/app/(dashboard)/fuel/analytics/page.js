"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { getFuelAnalytics } from "@/services/fuel.service";
import { formatCurrency } from "@/lib/utils";
import { Fuel, TrendingDown, PhilippinePeso, BarChart3, PieChart, TrendingUp } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function FuelAnalyticsPage() {
  useRequireRole();
  const { data: analytics } = useQuery({
    queryKey: ["fuel-analytics"],
    queryFn: () => getFuelAnalytics(),
  });

  const a = analytics || { totalCost: 0, totalLiters: 0, avgCostPerLiter: 0, recordsCount: 0, byFuelType: [], monthlyTrend: [] };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Fuel}
        title="Fuel Analytics"
        badge="Insights"
        description="Fuel consumption trends and cost analysis across the fleet."
      />

      <StatGrid cols={4}>
        <StatCard icon={Fuel} label="Total Fuel Consumed" value={`${a.totalLiters.toFixed(1)} L`} tone="primary" />
        <StatCard icon={PhilippinePeso} label="Total Cost" value={formatCurrency(a.totalCost)} tone="success" />
        <StatCard icon={TrendingDown} label="Avg Cost / Liter" value={formatCurrency(a.avgCostPerLiter)} tone="warning" />
        <StatCard icon={BarChart3} label="Total Transactions" value={a.recordsCount} tone="info" />
      </StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <PieChart className="w-4 h-4 text-primary" /> Fuel Type Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {a.byFuelType.length === 0 ? (
              <EmptyState
                icon={Fuel}
                title="No data available"
                description="Approved fuel records will populate this breakdown."
              />
            ) : (
              <div className="space-y-4">
                {a.byFuelType.map((ft) => {
                  const pct = a.totalLiters ? Math.round(((ft.liters || 0) / a.totalLiters) * 100) : 0;
                  return (
                    <div key={ft.fuel_type}>
                      <ProgressBar
                        tone="primary"
                        value={pct}
                        label={ft.fuel_type}
                        valueLabel={`${(ft.liters || 0).toFixed(1)} L (${pct}%)`}
                      />
                      <div className="flex justify-between text-xs text-foreground-muted mt-1">
                        <span className="font-data">{formatCurrency(ft.cost)}</span>
                        <span>{ft.count} transactions</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Monthly Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {a.monthlyTrend.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No data available"
                description="Approved fuel records will populate this monthly trend."
              />
            ) : (
              <div className="space-y-4">
                {a.monthlyTrend.map((m) => {
                  const maxCost = Math.max(...a.monthlyTrend.map((t) => t.cost));
                  const pct = maxCost ? Math.round((m.cost / maxCost) * 100) : 0;
                  return (
                    <div key={m.month}>
                      <ProgressBar
                        tone="success"
                        value={pct}
                        label={m.month}
                        valueLabel={formatCurrency(m.cost)}
                      />
                      <div className="flex justify-between text-xs text-foreground-muted mt-1">
                        <span className="font-data">{m.liters.toFixed(1)} L</span>
                        <span>{m.count} transactions</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
