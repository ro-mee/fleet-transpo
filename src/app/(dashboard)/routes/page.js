"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Route as RouteIcon, MapPin } from "lucide-react";
import { getRoutes } from "@/services/route.service";
import { useRequireRole } from "@/lib/auth/role-guard";

const columnHelper = createColumnHelper();

export default function RoutesPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ["routes"],
    queryFn: () => getRoutes(),
  });

  const totalDistance = useMemo(
    () => routes.reduce((sum, r) => sum + (Number(r.estimated_distance) || 0), 0),
    [routes]
  );
  const activeCount = routes.filter((r) => r.status === "Active").length;

  const columns = useMemo(
    () => [
      columnHelper.accessor("route_name", {
        header: "Route",
        cell: (info) => (
          <div className="flex items-center gap-2">
            <RouteIcon className="w-4 h-4 text-primary" />
            <span className="font-medium text-foreground">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor("origin", {
        header: "Origin",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-danger" />
            <span className="text-foreground-secondary">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor("destination", {
        header: "Destination",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-success" />
            <span className="text-foreground-secondary">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor("estimated_distance", {
        header: "Distance",
        cell: (info) => (
          <span className="font-medium text-foreground">{info.getValue() || "—"} km</span>
        ),
      }),
      columnHelper.accessor("estimated_duration", {
        header: "Duration",
        cell: (info) => {
          const mins = info.getValue();
          if (!mins) return <span className="text-foreground-secondary">—</span>;
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return <span className="text-foreground-secondary">{h}h {m}m</span>;
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => (
          <Badge variant={info.getValue() === "Active" ? "success" : "secondary"}>
            {info.getValue()}
          </Badge>
        ),
      }),
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Routes"
        description="Predefined origin–destination routes used when dispatching vehicles."
      />

      <StatGrid cols={3}>
        <StatCard icon={RouteIcon} label="Total Routes" value={routes.length} tone="primary" />
        <StatCard icon={MapPin} label="Active Routes" value={activeCount} tone="success" />
        <StatCard icon={RouteIcon} label="Total Distance" value={`${totalDistance.toLocaleString()} km`} tone="info" />
      </StatGrid>

      <DataTable
        columns={columns}
        data={routes}
        searchPlaceholder="Search routes..."
        emptyTitle="No routes found"
        emptyDescription="Routes created here can be attached to dispatches."
      />
    </div>
  );
}
