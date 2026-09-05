"use client";

import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { getFuelAnalytics } from "@/services/fuel.service";
import { apiFetch } from "@/lib/api/client";
import { formatCurrency } from "@/lib/utils";
import { Fuel, TrendingDown, PhilippinePeso, BarChart3, PieChart, TrendingUp, Gauge } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

const chartTooltipStyle = {
  background: "var(--sf)",
  border: "1px solid var(--br)",
  borderRadius: "12px",
  fontSize: "12px",
};

export default function FuelAnalyticsPage() {
  useRequireRole();
  const { data: analytics, isLoading, isError, refetch } = useQuery({
    queryKey: ["fuel-analytics"],
    queryFn: () => getFuelAnalytics(),
  });

  const a = analytics || { totalCost: 0, totalLiters: 0, avgCostPerLiter: 0, recordsCount: 0, byFuelType: [], monthlyTrend: [] };
  const dash = (value) => (isLoading || isError ? "—" : value);

  // Measured per-vehicle efficiency from verified records (same source the
  // ops console's review flow reads; read-only here).
  const { data: efficiencyData, isLoading: efficiencyLoading } = useQuery({
    queryKey: ["fuel-efficiency"],
    queryFn: () => apiFetch("/api/admin/analytics/fuel"),
  });
  const efficiencyVehicles = efficiencyData?.vehicles || [];

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Fuel}
        title="Fuel Analytics"
        badge="Insights"
        description="Fuel consumption trends and cost analysis across the fleet."
      />

      {isError && (
        <QueryErrorBanner query={{ isError, refetch }} title="Fuel analytics could not be loaded" description="Approved-record aggregates are unavailable; other fuel data remains current." />
      )}

      <StatGrid cols={4}>
        <StatCard icon={Fuel} label="Total Fuel Consumed" value={dash(`${a.totalLiters.toFixed(1)} L`)} tone="primary" />
        <StatCard icon={PhilippinePeso} label="Total Cost" value={dash(formatCurrency(a.totalCost))} tone="success" />
        <StatCard icon={TrendingDown} label="Avg Cost / Liter" value={dash(formatCurrency(a.avgCostPerLiter))} tone="warning" />
        <StatCard icon={BarChart3} label="Total Transactions" value={dash(a.recordsCount)} tone="info" />
      </StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <PieChart className="w-4 h-4 text-primary" /> Fuel Type Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-10 text-center text-sm text-foreground-muted">Loading fuel mix…</p>
            ) : a.byFuelType.length === 0 ? (
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
            {isLoading ? (
              <p className="py-10 text-center text-sm text-foreground-muted">Loading monthly trend…</p>
            ) : a.monthlyTrend.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No data available"
                description="Approved fuel records will populate this monthly trend."
              />
            ) : (
              <div className="chart-h-md w-full" aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={a.monthlyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fuelTrendCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} tickFormatter={(value) => `₱${Number(value).toLocaleString()}`} width={72} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value, name) => (name === "cost" ? [formatCurrency(value), "Cost"] : [`${Number(value).toFixed(1)} L`, "Liters"])}
                    />
                    <Area type="monotone" dataKey="cost" stroke="var(--primary)" strokeWidth={2} fill="url(#fuelTrendCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            {a.monthlyTrend.length > 0 && (
              <table className="sr-only">
                <caption>Monthly fuel cost</caption>
                <thead><tr><th>Month</th><th>Cost</th><th>Liters</th></tr></thead>
                <tbody>{a.monthlyTrend.map((m) => <tr key={m.month}><th>{m.month}</th><td>{formatCurrency(m.cost)}</td><td>{m.liters}</td></tr>)}</tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary" /> Measured Efficiency
          </CardTitle>
        </CardHeader>
        <CardContent>
          {efficiencyLoading ? (
            <p className="py-10 text-center text-sm text-foreground-muted">Loading efficiency…</p>
          ) : efficiencyVehicles.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title="No data available"
              description="Verified fuel records will populate per-vehicle efficiency."
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {efficiencyVehicles.slice(0, 9).map((v) => (
                <div key={v.vehicle_id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-data text-xs font-bold text-foreground truncate">{v.plate_number}</p>
                    <p className="text-[11px] text-foreground-muted truncate">{v.vehicle_name || "—"}</p>
                  </div>
                  <span className="text-sm tabular-nums font-bold text-foreground shrink-0">
                    {v.estimated_kmpl != null ? `${Number(v.estimated_kmpl).toFixed(1)} km/L` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
