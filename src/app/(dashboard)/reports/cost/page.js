"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { getFleetCostReport, getFleetCostWorkbook } from "@/services/report.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { StatsGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { Wallet, Fuel, Wrench, TrendingDown, Download } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useRoleAccess } from "@/hooks/use-role-access";
import { cn, formatCurrency } from "@/lib/utils";
import { downloadBlob } from "@/lib/export";
import { toast } from "@/components/ui/toast";

export default function FleetCostPage() {
  useRequireRole();
  // Plate links lead to /fleet/vehicles/[id], which excludes `management` —
  // render plain text for roles without vehicle read access instead of
  // punishing them with a denial-and-bounce for clicking a plausible link.
  const { can } = useRoleAccess();
  const canOpenVehicles = can("vehicles", "read");
  const [exporting, setExporting] = useState(false);

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
    // Cost/km is descriptive, not good news — keep the KPI neutral instead of
    // painting an expense metric green.
    { label: "Cost / km", value: formatCurrency(totals.cost_per_km || 0), icon: TrendingDown },
  ];

  async function handleExport() {
    setExporting(true);
    try {
      const result = await getFleetCostWorkbook();
      downloadBlob(result.blob, result.filename);
      toast.success(`Exported customized workbook — ${result.filename}`);
    } catch (exportError) {
      toast.error(exportError.message || "Fleet cost workbook export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Wallet}
        title="Fleet Cost Dashboard"
        badge="Reports"
        description="Fuel, maintenance and operating cost per vehicle and per kilometer."
        actions={
          <Button
            onClick={handleExport}
            disabled={isLoading || exporting}
            className={cn("h-11 rounded-full px-5 text-sm font-semibold", heroButtonPrimaryClass)}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Building workbook…" : "Export Fleet Cost Excel"}
          </Button>
        }
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
            <div className="p-5">
              <TableSkeleton rows={6} cols={6} />
            </div>
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
                    <th className="px-5 py-3 text-right font-medium">Fuel</th>
                    <th className="px-5 py-3 text-right font-medium">Maintenance</th>
                    <th className="px-5 py-3 text-right font-medium">Total Cost</th>
                    <th className="px-5 py-3 text-right font-medium">Distance (km)</th>
                    <th className="px-5 py-3 text-right font-medium">Cost / km</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {details.map((d) => (
                    <tr key={d.vehicle_id} className="hover:bg-hover transition-colors">
                      <td className="px-5 py-3">
                        {canOpenVehicles ? (
                          <Link href={`/fleet/vehicles/${d.vehicle_id}`} className="font-medium text-foreground hover:underline">
                            {d.plate_number}
                          </Link>
                        ) : (
                          <span className="font-medium text-foreground">{d.plate_number}</span>
                        )}
                        <div className="text-xs text-foreground-muted">{d.vehicle || "—"}</div>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-foreground">{formatCurrency(d.fuel_cost)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-foreground">{formatCurrency(d.maintenance_cost)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-foreground">{formatCurrency(d.total_cost)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-foreground">{Number(d.distance).toLocaleString()}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-foreground">{formatCurrency(d.cost_per_km)}</td>
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
