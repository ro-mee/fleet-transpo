"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { Route as RouteIcon, MapPin, TriangleAlert } from "lucide-react";
import { getRoutes } from "@/services/route.service";
import { useRequireRole } from "@/lib/auth/role-guard";

const columnHelper = createColumnHelper();

export default function RoutesPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const [statusFilter, setStatusFilter] = useState("all");

  const {
    data: routes = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["routes"],
    queryFn: () => getRoutes(),
  });

  const displayRoutes = useMemo(() => {
    if (statusFilter === "Active") return routes.filter((r) => r.status === "Active");
    if (statusFilter === "Inactive") return routes.filter((r) => r.status === "Inactive");
    return routes;
  }, [routes, statusFilter]);

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
        cell: (info) => <StatusBadge status={info.getValue()} entity="route" />,
      }),
    ],
    []
  );

  if (isError) {
    return (
      <div className="space-y-6">
        <HeroHeader
          icon={RouteIcon}
          title="Fleet Routes Registry"
          badge="Operations"
          description="Predefined origin-destination routes used when dispatching vehicles."
        />
        <EmptyState
          icon={TriangleAlert}
          title="Could not load routes"
          description={error?.message || "Something went wrong reading the routes register."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={RouteIcon}
        title="Fleet Routes Registry"
        badge="Operations"
        description="Predefined origin-destination routes used when dispatching vehicles."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-3 cursor-pointer select-none",
            statusFilter === "all" ? "border-primary bg-primary/10 shadow-xs" : "border-border/80 bg-surface hover:border-primary/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">Total Routes</span>
            <div className="p-2 rounded-xl bg-primary/10 text-primary"><RouteIcon className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{routes.length}</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Active')}
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-3 cursor-pointer select-none",
            statusFilter === "Active" ? "border-success bg-success/10 shadow-xs" : "border-border/80 bg-surface hover:border-success/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">Active Routes</span>
            <div className="p-2 rounded-xl bg-success/10 text-success"><MapPin className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{activeCount}</div>
          </div>
        </button>

        <div
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-3 select-none border-border/80 bg-surface"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">Total Distance</span>
            <div className="p-2 rounded-xl bg-info/10 text-info"><RouteIcon className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{`${totalDistance.toLocaleString()} km`}</div>
          </div>
        </div>
      </div>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={displayRoutes}
            searchPlaceholder="Search routes..."
            emptyTitle="No routes found"
            emptyDescription="Routes created here can be attached to dispatches."
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
