"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getVehicles, deleteVehicle } from "@/services/vehicle.service";
import { formatDate, formatNumber } from "@/lib/utils";
import { Pencil, Archive, Eye, Plus, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const statusVariant = {
  Available: "success",
  "In Use": "warning",
  "Under Maintenance": "danger",
  "Out of Service": "danger",
  Reserved: "default",
};

export function FleetTable({ filters = {} }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles", filters],
    queryFn: () => getVehicles(filters),
  });

  const archiveMutation = useMutation({
    mutationFn: deleteVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    },
  });

  const [archivingId, setArchivingId] = useState(null);

  const columnHelper = createColumnHelper();

  const columns = useMemo(
    () => [
      columnHelper.accessor("plate_number", {
        header: "Plate #",
        cell: (info) => (
          <span className="font-medium text-foreground">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("vehicle_name", {
        header: "Vehicle",
        cell: (info) => (
          <div>
            <p className="font-medium text-foreground">{info.getValue()}</p>
            <p className="text-xs text-foreground-muted">{info.row.original.model}</p>
          </div>
        ),
      }),
      columnHelper.accessor("vehiclecategories.category_name", {
        id: "category",
        header: "Category",
        cell: (info) => (
          <span className="text-foreground-secondary">{info.getValue() || "—"}</span>
        ),
      }),
      columnHelper.accessor("seating_capacity", {
        header: "Capacity",
        cell: (info) => (
          <span className="text-foreground-secondary">{info.getValue()} seats</span>
        ),
      }),
      columnHelper.accessor("fuel_type", {
        header: "Fuel",
        cell: (info) => (
          <Badge variant="secondary" className="text-xs">
            {info.getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor("mileage", {
        header: "Mileage",
        cell: (info) => (
          <span className="text-foreground-secondary">
            {formatNumber(info.getValue() || 0)} km
          </span>
        ),
      }),
      columnHelper.accessor("vehicle_status", {
        header: "Status",
        cell: (info) => (
          <Badge variant={statusVariant[info.getValue()] || "default"}>
            {info.getValue()}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="View">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8"
                onClick={() => router.push(`/fleet/vehicles/${info.row.original.vehicle_id}`)}
              >
                <Eye className="w-4 h-4" />
              </Button>
            </Tooltip>
            <Tooltip content="Edit">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8"
                onClick={() => router.push(`/fleet/vehicles/${info.row.original.vehicle_id}/edit`)}
              >
                <Pencil className="w-4 h-4" />
              </Button>
            </Tooltip>
            <Tooltip content="Archive">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 text-danger hover:text-danger"
                onClick={() => setArchivingId(info.row.original.vehicle_id)}
              >
                <Archive className="w-4 h-4" />
              </Button>
            </Tooltip>
          </div>
        ),
      }),
    ],
    [router, archiveMutation, setArchivingId]
  );

  if (isLoading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-12 text-center text-foreground-muted">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/3 mx-auto" />
            <div className="h-64 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={vehicles}
        searchPlaceholder="Search by plate or name..."
        onRowClick={(row) => router.push(`/fleet/vehicles/${row.vehicle_id}`)}
      />
      <ConfirmDialog
        open={!!archivingId}
        onOpenChange={(open) => { if (!open) setArchivingId(null); }}
        title="Archive Vehicle?"
        message="This vehicle will be hidden from active lists."
        confirmLabel="Archive"
        variant="archive"
        onConfirm={() => { if (archivingId) archiveMutation.mutate(archivingId); }}
      />
    </>
  );
}
