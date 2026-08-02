"use client";

import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { DataTable } from "@/components/tables/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getTrips } from "@/services/trip.service";
import { formatDateTime } from "@/lib/utils";
import { MapPin, Clock, Truck, Navigation, Route } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

const columnHelper = createColumnHelper();

export default function TrackingHistoryPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);

  const { data: trips = [] } = useQuery({
    queryKey: ["trips-history"],
    queryFn: async () => {
      const all = await getTrips({ trip_status: "Completed", limit: 50 });
      return all || [];
    },
  });

  const totalDistance = trips.reduce((s, t) => s + (t.distance || 0), 0);

  const columns = useMemo(
    () => [
      columnHelper.accessor("trip_id", {
        header: "Trip",
        cell: (info) => <span className="font-data font-medium text-foreground">#{info.getValue()}</span>,
      }),
      columnHelper.accessor("vehicles.plate_number", {
        header: "Vehicle",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 text-foreground-muted" />
            <span className="text-foreground-secondary">{info.getValue() || "—"}</span>
          </div>
        ),
      }),
      columnHelper.accessor("origin", {
        header: "Origin",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-danger" />
            <span className="text-foreground-secondary truncate max-w-[150px]">{info.getValue() || "—"}</span>
          </div>
        ),
      }),
      columnHelper.accessor("destination", {
        header: "Destination",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-success" />
            <span className="text-foreground-secondary truncate max-w-[150px]">{info.getValue() || "—"}</span>
          </div>
        ),
      }),
      columnHelper.accessor("distance", {
        header: "Distance",
        cell: (info) => <span className="font-medium text-foreground">{info.getValue() || "—"} km</span>,
      }),
      columnHelper.accessor("start_time", {
        header: "Started",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-foreground-muted" />
            <span className="text-foreground-secondary text-xs">{info.getValue() ? formatDateTime(info.getValue()) : "—"}</span>
          </div>
        ),
      }),
      columnHelper.accessor("trip_status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} entity="trip" />,
      }),
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tracking"
        title="Route History"
        description="Completed trip routes and tracking data."
      />

      <StatGrid cols={3}>
        <StatCard icon={Navigation} label="Completed Trips" value={trips.length} tone="success" />
        <StatCard icon={MapPin} label="Total Distance" value={`${totalDistance.toFixed(0)} km`} tone="primary" />
        <StatCard icon={Route} label="Avg Trip Distance" value={trips.length ? `${(totalDistance / trips.length).toFixed(1)} km` : "—"} tone="warning" />
      </StatGrid>

      <DataTable
        columns={columns}
        data={trips}
        searchPlaceholder="Search route history..."
        emptyTitle="No completed trips found"
        emptyDescription="Completed trips will appear here with their route and tracking data."
      />
    </div>
  );
}
