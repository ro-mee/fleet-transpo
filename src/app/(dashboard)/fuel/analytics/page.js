"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getFuelAnalytics } from "@/services/fuel.service";
import { formatCurrency } from "@/lib/utils";
import { Fuel, TrendingDown, DollarSign, BarChart3, PieChart, TrendingUp } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function FuelAnalyticsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);
  const { data: analytics } = useQuery({
    queryKey: ["fuel-analytics"],
    queryFn: () => getFuelAnalytics(),
  });

  const a = analytics || { totalCost: 0, totalLiters: 0, avgCostPerLiter: 0, recordsCount: 0, byFuelType: [], monthlyTrend: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Fuel Analytics</h1>
        <p className="text-foreground-secondary mt-1">Fuel consumption trends and cost analysis</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-primary/10"><Fuel className="w-5 h-5 text-primary" /></div>
            </div>
            <p className="text-2xl font-bold">{a.totalLiters.toFixed(1)} L</p>
            <p className="text-xs text-foreground-muted">Total Fuel Consumed</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-success/10"><DollarSign className="w-5 h-5 text-success" /></div>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(a.totalCost)}</p>
            <p className="text-xs text-foreground-muted">Total Cost</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-warning/10"><TrendingDown className="w-5 h-5 text-warning" /></div>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(a.avgCostPerLiter)}</p>
            <p className="text-xs text-foreground-muted">Avg Cost / Liter</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-info/10"><BarChart3 className="w-5 h-5 text-info" /></div>
            </div>
            <p className="text-2xl font-bold">{a.recordsCount}</p>
            <p className="text-xs text-foreground-muted">Total Transactions</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <PieChart className="w-4 h-4 text-primary" /> Fuel Type Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {a.byFuelType.length === 0 ? (
              <p className="text-sm text-foreground-muted text-center py-8">No data available</p>
            ) : (
              <div className="space-y-4">
                {a.byFuelType.map((ft) => {
                  const pct = a.totalLiters ? Math.round((ft.quantity / a.totalLiters) * 100) : 0;
                  return (
                    <div key={ft.fuel_type}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-foreground">{ft.fuel_type}</span>
                        <span className="text-foreground-muted">{ft.quantity.toFixed(1)} L ({pct}%)</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5">
                        <div className="bg-primary h-2.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-foreground-muted mt-1">
                        <span>{formatCurrency(ft.cost)}</span>
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
              <p className="text-sm text-foreground-muted text-center py-8">No data available</p>
            ) : (
              <div className="space-y-4">
                {a.monthlyTrend.map((m) => {
                  const maxCost = Math.max(...a.monthlyTrend.map((t) => t.cost));
                  const pct = maxCost ? Math.round((m.cost / maxCost) * 100) : 0;
                  return (
                    <div key={m.month}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-foreground">{m.month}</span>
                        <span className="text-foreground-muted">{formatCurrency(m.cost)}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5">
                        <div className="bg-success h-2.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-foreground-muted mt-1">
                        <span>{m.liters.toFixed(1)} L</span>
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
