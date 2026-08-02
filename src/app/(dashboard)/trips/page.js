"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { getTrips, getActiveTrips } from "@/services/trip.service";
import { formatTime, formatDuration } from "@/lib/utils";
import { Route, Play, Download, Truck, Users, Clock, CheckCircle2, MapPin } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";

const columnHelper = createColumnHelper();

export default function TripsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();

  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: () => getTrips(),
  });

  const { data: activeTrips = [] } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 30000,
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor("trip_id", {
        header: "ID",
        cell: (info) => <span className="font-data text-xs text-foreground-muted">#{info.getValue()}</span>,
      }),
      columnHelper.accessor("vehicles.plate_number", {
        id: "vehicle",
        header: "Vehicle",
        cell: (info) => (
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-foreground-muted" />
            <span className="font-medium text-foreground">{info.getValue() || "—"}</span>
          </div>
        ),
      }),
      columnHelper.accessor("drivers.employees.first_name", {
        id: "driver",
        header: "Driver",
        cell: (info) => (
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-foreground-muted" />
            <span className="text-foreground-secondary">
              {info.getValue() || ""} {info.row.original.drivers?.employees?.last_name || ""}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor("start_time", {
        header: "Start",
        cell: (info) => {
          if (!info.getValue()) return <span className="text-foreground-muted">—</span>;
          return (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-foreground-muted" />
              <span className="text-foreground-secondary">{formatTime(info.getValue())}</span>
            </div>
          );
        },
      }),
      columnHelper.accessor("distance", {
        header: "Distance",
        cell: (info) => (
          <span className="font-medium text-foreground">
            {info.getValue() ? `${info.getValue()} km` : "—"}
          </span>
        ),
      }),
      columnHelper.accessor("actual_duration", {
        header: "Duration",
        cell: (info) => (
          <span className="text-foreground-secondary">
            {info.getValue() ? formatDuration(info.getValue()) : "—"}
          </span>
        ),
      }),
      columnHelper.accessor("trip_status", {
        header: "Status",
        cell: (info) => (
          <StatusBadge status={info.getValue()} entity="trip" className="whitespace-nowrap" />
        ),
      }),
    ],
    []
  );

  const totalDistance = trips.reduce((s, t) => s + (t.distance || 0), 0);

  const statCards = [
    { label: "Total Trips", value: trips.length, icon: Route, tone: "primary", trend: "all time" },
    { label: "Active", value: activeTrips.length, icon: Play, tone: "info", trend: "in motion now" },
    { label: "Completed", value: trips.filter((t) => t.trip_status === "Completed").length, icon: CheckCircle2, tone: "success", trend: "finished" },
    { label: "Total Distance", value: `${totalDistance.toFixed(0)} km`, icon: MapPin, tone: "warning", trend: "across all trips" },
  ];

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
              onClick={() => exportToCSV(trips, "trips", [
                { label: "ID", key: "trip_id" },
                { label: "Vehicle", accessor: (t) => t.vehicles?.plate_number || "" },
                { label: "Driver", accessor: (t) => (t.drivers?.employees ? `${t.drivers.employees.first_name} ${t.drivers.employees.last_name}` : "") },
                { label: "Dispatch", accessor: (t) => t.dispatchschedules?.dispatch_number || "" },
                { label: "Route", accessor: (t) => t.routes?.route_name || "" },
                { label: "Start Time", key: "start_time" },
                { label: "End Time", key: "end_time" },
                { label: "Distance (km)", key: "distance" },
                { label: "Duration (min)", key: "actual_duration" },
                { label: "Status", key: "trip_status" },
                { label: "Notes", key: "notes" },
              ])}
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

      <StatGrid cols={4}>
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </StatGrid>

      <DataTable
        columns={columns}
        data={trips}
        searchPlaceholder="Search trips..."
        emptyTitle="No trips found"
        emptyDescription="Trips will appear here once dispatches are scheduled."
        onRowClick={(row) => router.push(`/trips/${row.trip_id}`)}
      />
    </div>
  );
}
