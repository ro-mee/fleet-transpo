"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { getTrips, getActiveTrips } from "@/services/trip.service";
import { formatTime, formatDuration } from "@/lib/utils";
import { Route, Play, Download, Truck, Users, Clock, CheckCircle2, MapPin, TriangleAlert } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";

const columnHelper = createColumnHelper();

export default function TripsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("all");

  const {
    data: trips = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["trips"],
    queryFn: () => getTrips(),
  });

  const { data: activeTrips = [] } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 30000,
  });

  const displayTrips = useMemo(() => {
    if (statusFilter === "Active")
      return trips.filter((t) =>
        ["In Progress", "Trip Started", "En Route", "Arrived", "Driver Accepted"].includes(t.trip_status)
      );
    if (statusFilter === "Completed") return trips.filter((t) => t.trip_status === "Completed");
    return trips;
  }, [trips, statusFilter]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("trip_id", {
        header: "ID",
        cell: (info) => <span className="font-data text-xs text-foreground-muted">#{info.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.vehicles?.plate_number, {
        id: "vehicle",
        header: "Vehicle",
        cell: (info) => <span className="font-medium text-foreground">{info.getValue() || "Unassigned"}</span>,
      }),
      columnHelper.accessor("drivers", {
        id: "driver",
        header: "Driver",
        cell: (info) => {
          const d = info.getValue();
          return d ? `${d.first_name || ""} ${d.last_name || ""}`.trim() : "Unassigned";
        },
      }),
      columnHelper.accessor((row) => row.dispatchschedules?.dispatch_number, {
        id: "dispatch",
        header: "Dispatch #",
        cell: (info) => <span className="font-data text-xs text-foreground-muted">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor((row) => row.routes?.route_name, {
        id: "route",
        header: "Route",
        cell: (info) => (
          <div className="flex items-center gap-1.5 text-xs text-foreground">
            <Route className="w-3.5 h-3.5 text-foreground-muted" />
            <span className="truncate max-w-[200px]">{info.getValue() || "—"}</span>
          </div>
        ),
      }),
      columnHelper.accessor("start_time", {
        header: "Started",
        cell: (info) => <span className="font-data text-xs text-foreground-muted">{formatTime(info.getValue())}</span>,
      }),
      columnHelper.accessor("end_time", {
        header: "Ended",
        cell: (info) => <span className="font-data text-xs text-foreground-muted">{formatTime(info.getValue())}</span>,
      }),
      columnHelper.accessor("trip_status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} entity="trip" />,
      }),
    ],
    []
  );

  const activeCount = useMemo(
    () =>
      trips.filter((t) =>
        ["In Progress", "Trip Started", "En Route", "Arrived", "Driver Accepted"].includes(t.trip_status)
      ).length,
    [trips]
  );
  const completedCount = useMemo(() => trips.filter((t) => t.trip_status === "Completed").length, [trips]);

  const statCards = [
    {
      label: "Total Trips",
      value: trips.length,
      icon: Route,
      color: "primary",
      active: statusFilter === "all",
      onClick: () => setStatusFilter("all"),
    },
    {
      label: "Active",
      value: activeCount,
      icon: Truck,
      color: "info",
      active: statusFilter === "Active",
      onClick: () => setStatusFilter(statusFilter === "Active" ? "all" : "Active"),
    },
    {
      label: "Completed",
      value: completedCount,
      icon: CheckCircle2,
      color: "success",
      active: statusFilter === "Completed",
      onClick: () => setStatusFilter(statusFilter === "Completed" ? "all" : "Completed"),
    },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Operations" title="Trips" description="Monitor and manage all trips." />
        <EmptyState
          icon={TriangleAlert}
          title="Could not load trips"
          description={error?.message || "Something went wrong reading the trips register."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Trips"
        description="Monitor and manage all trips."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportToCSV(trips, "trips", [
                  { label: "ID", key: "trip_id" },
                  { label: "Vehicle", accessor: (t) => t.vehicles?.plate_number || "" },
                  {
                    label: "Driver",
                    accessor: (t) =>
                      t.drivers ? `${t.drivers.first_name || ""} ${t.drivers.last_name || ""}`.trim() : "",
                  },
                  { label: "Dispatch", accessor: (t) => t.dispatchschedules?.dispatch_number || "" },
                  { label: "Route", accessor: (t) => t.routes?.route_name || "" },
                  { label: "Start Time", key: "start_time" },
                  { label: "End Time", key: "end_time" },
                  { label: "Distance (km)", key: "distance" },
                  { label: "Duration (min)", key: "actual_duration" },
                  { label: "Status", key: "trip_status" },
                  { label: "Notes", key: "notes" },
                ])
              }
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/trips/active")}>
              <Play className="w-4 h-4 mr-2" />
              Active Trips ({activeTrips.length})
            </Button>
          </>
        }
      />

      <StatGrid cols={3}>
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </StatGrid>

      <DataTable
        columns={columns}
        data={displayTrips}
        searchPlaceholder="Search trips..."
        emptyTitle="No trips found"
        emptyDescription="Trips will appear here once dispatches are scheduled."
        onRowClick={(row) => router.push(`/trips/${row.trip_id}`)}
        isLoading={isLoading}
      />
    </div>
  );
}
