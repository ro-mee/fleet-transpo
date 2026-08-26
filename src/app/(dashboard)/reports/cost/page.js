"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";
import { getFleetCostReport } from "@/services/report.service";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatsGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
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
    // Cost/km is descriptive, not good news — keep the KPI neutral instead of
    // painting an expense metric green.
    { label: "Cost / km", value: formatCurrency(totals.cost_per_km || 0), icon: TrendingDown },
  ];

  const columnHelper = createColumnHelper();
  const columns = useMemo(
    () => [
      columnHelper.accessor("plate_number", {
        header: "Vehicle",
        cell: (info) => (
          <div>
            <Link href={`/fleet/vehicles/${info.row.original.vehicle_id}`} className="font-medium text-foreground hover:underline">
              {info.getValue()}
            </Link>
            <div className="text-xs text-foreground-muted">{info.row.original.vehicle || "—"}</div>
          </div>
        ),
      }),
      columnHelper.accessor("fuel_cost", {
        header: () => <div className="text-right">Fuel</div>,
        cell: (info) => <div className="text-right tabular-nums text-foreground">{formatCurrency(info.getValue())}</div>,
      }),
      columnHelper.accessor("maintenance_cost", {
        header: () => <div className="text-right">Maintenance</div>,
        cell: (info) => <div className="text-right tabular-nums text-foreground">{formatCurrency(info.getValue())}</div>,
      }),
      columnHelper.accessor("total_cost", {
        header: () => <div className="text-right">Total Cost</div>,
        cell: (info) => <div className="text-right tabular-nums font-medium text-foreground">{formatCurrency(info.getValue())}</div>,
      }),
      columnHelper.accessor("distance", {
        header: () => <div className="text-right">Distance (km)</div>,
        cell: (info) => <div className="text-right tabular-nums text-foreground">{Number(info.getValue()).toLocaleString()}</div>,
      }),
      columnHelper.accessor("cost_per_km", {
        header: () => <div className="text-right">Cost / km</div>,
        cell: (info) => <div className="text-right tabular-nums text-foreground">{formatCurrency(info.getValue())}</div>,
      }),
    ],
    []
  );

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

      <DataTable
        columns={columns}
        data={details}
        isLoading={isLoading}
        title="Cost Per Vehicle"
        icon={Wallet}
        emptyTitle="No cost data"
        emptyDescription="Fuel, maintenance and trip data will populate costs."
      />
    </div>
  );
}
