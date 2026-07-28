"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getTrips, getActiveTrips } from "@/services/trip.service";
import { formatDate, formatTime, formatDuration, formatDistance } from "@/lib/utils";
import { Route, Play, Truck, Users, Clock, MapPin, Navigation } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

const statusVariant = {
  Pending: "warning",
  Approved: "default",
  Dispatched: "default",
  "Driver Accepted": "info",
  "Trip Started": "info",
  "En Route": "primary",
  Arrived: "success",
  Completed: "success",
  Cancelled: "secondary",
};

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

  const columnHelper = createColumnHelper();

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
          <Badge variant={statusVariant[info.getValue()] || "default"} className="whitespace-nowrap">
            {info.getValue() === "En Route" && <Navigation className="w-3 h-3 mr-1 animate-pulse" />}
            {info.getValue()}
          </Badge>
        ),
      }),
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Trips</h1>
          <p className="text-foreground-secondary mt-1">Monitor and manage all trips</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push("/trips/active")}>
            <Play className="w-4 h-4 mr-2" />
            Active Trips ({activeTrips.length})
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Trips", count: trips.length, color: "text-primary", bg: "bg-primary/10" },
          { label: "Active", count: activeTrips.length, color: "text-success", bg: "bg-success/10" },
          { label: "Completed", count: trips.filter((t) => t.trip_status === "Completed").length, color: "text-success", bg: "bg-success/10" },
          { label: "Total Distance", count: `${trips.reduce((s, t) => s + (t.distance || 0), 0).toFixed(0)} km`, color: "text-warning", bg: "bg-warning/10" },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${stat.bg}`}>
                <Route className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stat.count}</p>
                <p className="text-xs text-foreground-muted">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={trips}
        searchPlaceholder="Search trips..."
        onRowClick={(row) => router.push(`/trips/${row.trip_id}`)}
      />
    </div>
  );
}
