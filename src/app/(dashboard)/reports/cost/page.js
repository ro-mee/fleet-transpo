"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getFleetCostReport } from "@/services/report.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { Wallet, Fuel, Wrench, TrendingDown } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { formatCurrency } from "@/lib/utils";

export default function FleetCostPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["fleet-cost"],
    queryFn: () => getFleetCostReport(),
  });

  const details = data?.details || [];
  const totals = data?.totals || { fuel_cost: 0, maintenance_cost: 0, total_cost: 0, distance: 0, cost_per_km: 0 };

  const kpis = [
    { label: "Total Cost", value: formatCurrency(totals.total_cost || 0), icon: Wallet, tone: "primary" },
    { label: "Fuel Cost", value: formatCurrency(totals.fuel_cost || 0), icon: Fuel, tone: "warning" },
    { label: "Maintenance Cost", value: formatCurrency(totals.maintenance_cost || 0), icon: Wrench, tone: "danger" },
    { label: "Cost / km", value: formatCurrency(totals.cost_per_km || 0), icon: TrendingDown, tone: "success" },
  ];

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Wallet}
        title="Fleet Cost Dashboard"
        badge="Reports"
        description="Fuel, maintenance and operating cost per vehicle and per kilometer."
      />

      {isLoading ? (
        <StatsGridSkeleton count={4} gridClass="md:grid-cols-2 lg:grid-cols-4" />
      ) : (
        <StatGrid cols={4}>
          {kpis.map((k) => (
            <StatCard key={k.label} icon={k.icon} label={k.label} value={k.value} tone={k.tone} />
          ))}
        </StatGrid>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost Per Vehicle</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-foreground-muted">Loading…</div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-foreground-secondary">
              Could not load cost data.{" "}
              <button onClick={() => refetch()} className="text-primary hover:underline">
                Retry
              </button>
            </div>
          ) : details.length === 0 ? (
            <EmptyState icon={Wallet} title="No cost data" description="Fuel, maintenance and trip data will populate costs." className="py-16" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-foreground-muted">
                    <th className="px-5 py-3 font-medium">Vehicle</th>
                    <th className="px-5 py-3 font-medium">Fuel</th>
                    <th className="px-5 py-3 font-medium">Maintenance</th>
                    <th className="px-5 py-3 font-medium">Total Cost</th>
                    <th className="px-5 py-3 font-medium">Distance (km)</th>
                    <th className="px-5 py-3 font-medium">Cost / km</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {details.map((d) => (
                    <tr key={d.vehicle_id} className="hover:bg-hover transition-colors">
                      <td className="px-5 py-3">
                        <Link href={`/fleet/vehicles/${d.vehicle_id}`} className="font-medium text-foreground hover:underline">
                          {d.plate_number}
                        </Link>
                        <div className="text-xs text-foreground-muted">{d.vehicle || "—"}</div>
                      </td>
                      <td className="px-5 py-3 text-foreground">{formatCurrency(d.fuel_cost)}</td>
                      <td className="px-5 py-3 text-foreground">{formatCurrency(d.maintenance_cost)}</td>
                      <td className="px-5 py-3 font-medium text-foreground">{formatCurrency(d.total_cost)}</td>
                      <td className="px-5 py-3 text-foreground">{Number(d.distance).toLocaleString()}</td>
                      <td className="px-5 py-3 text-foreground">{formatCurrency(d.cost_per_km)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
