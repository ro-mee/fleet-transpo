"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getVehicles } from "@/services/vehicle.service";
import { useRouter } from "next/navigation";
import { Plus, Route as RouteIcon, MapPin, ArrowRight } from "lucide-react";
import { getRoutes, deleteRoute } from "@/services/route.service";

export default function RoutesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ["routes"],
    queryFn: () => getRoutes(),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRoute,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["routes"] }),
  });

  const columnHelper = createColumnHelper();

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
      columnHelper.accessor("origin_location.name", {
        header: "Origin",
        id: "origin",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-danger" />
            <span className="text-foreground-secondary">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor("destination_location.name", {
        header: "Destination",
        id: "destination",
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
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="w-8 h-8"><RouteIcon className="w-4 h-4" /></Button>
          </div>
        ),
      }),
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Routes</h1>
          <p className="text-foreground-secondary mt-1">Manage predefined routes</p>
        </div>
        <Button className="h-10">
          <Plus className="w-4 h-4 mr-2" />
          Add Route
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={routes}
        searchPlaceholder="Search routes..."
      />
    </div>
  );
}
