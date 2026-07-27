"use client";

import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime, formatDistance } from "@/lib/utils";
import { MapPin, Clock, Truck, Navigation } from "lucide-react";

export default function TrackingHistoryPage() {
  const supabase = createClient();

  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select("*, vehicles(plate_number, vehicle_name)")
        .eq("trip_status", "Completed")
        .is("deleted_at", null)
        .order("start_time", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const columnHelper = createColumnHelper();

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
        cell: (info) => <Badge variant="success">{info.getValue()}</Badge>,
      }),
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Route History</h1>
        <p className="text-foreground-secondary mt-1">Completed trip routes and tracking data</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Completed Trips", count: trips.length, icon: Navigation, color: "text-success", bg: "bg-success/10" },
          { label: "Total Distance", count: `${trips.reduce((s, t) => s + (t.distance || 0), 0).toFixed(0)} km`, icon: MapPin, color: "text-primary", bg: "bg-primary/10" },
          { label: "Avg Trip Distance", count: trips.length ? `${(trips.reduce((s, t) => s + (t.distance || 0), 0) / trips.length).toFixed(1)} km` : "—", icon: MapPin, color: "text-warning", bg: "bg-warning/10" },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${stat.bg}`}><stat.icon className={`w-5 h-5 ${stat.color}`} /></div>
              <div><p className="text-2xl font-bold text-foreground">{stat.count}</p><p className="text-xs text-foreground-muted">{stat.label}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <DataTable columns={columns} data={trips} searchPlaceholder="Search route history..." />
    </div>
  );
}
