"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getVehicles, deleteVehicle } from "@/services/vehicle.service";
import { getUvvrpPolicy } from "@/services/settings.service";
import { isRestricted } from "@/lib/uvvrp/policy";
import { formatDate, formatNumber } from "@/lib/utils";
import { Archive, CalendarClock, CircleGauge, Eye, Pencil, Truck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";

const statusVariant = {
  Available: "success",
  "In Use": "warning",
  "Under Maintenance": "danger",
  "Out of Service": "danger",
  Reserved: "default",
  "Registration Expired": "danger",
};

const columnHelper = createColumnHelper();

export function FleetTable({ filters = {} }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: allVehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => getVehicles(),
  });

  const vehicles = useMemo(() => {
    return allVehicles.filter((v) => {
      // status filter
      if (filters.status && v.vehicle_status !== filters.status) {
        return false;
      }
      return true;
    });
  }, [allVehicles, filters]);

  const { data: uvvrpPolicy } = useQuery({
    queryKey: ["uvvrp-policy"],
    queryFn: getUvvrpPolicy,
  });

  const restrictedPlates = useMemo(() => {
    const set = new Set();
    if (!uvvrpPolicy?.enabled) return set;
    vehicles.forEach((v) => {
      if (v.plate_number && isRestricted(v.plate_number, uvvrpPolicy, new Date())) set.add(v.plate_number);
    });
    return set;
  }, [uvvrpPolicy, vehicles]);

  const archiveMutation = useMutation({
    mutationFn: deleteVehicle,
    onSuccess: (_, vehicleId) => {
      toast.success("Vehicle archived");
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
    },
    onError: (err) => toast.error(err.message),
  });

  const [archivingId, setArchivingId] = useState(null);

  const columns = useMemo(
    () => [
      columnHelper.accessor("plate_number", {
        header: "Plate #",
        cell: (info) => (
          <div className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
            {info.getValue()}
          </div>
        ),
      }),
      columnHelper.accessor("vehicle_name", {
        header: "Vehicle",
        cell: (info) => (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 text-foreground border border-border/40 shadow-2xs">
              <Truck className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">{info.getValue()}</p>
              <p className="text-xs text-foreground-muted font-medium">{info.row.original.model || "Model not listed"}</p>
            </div>
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.vehiclecategories?.category_name, {
        id: "category",
        header: "Category",
        cell: (info) => (
          <span className="text-xs font-medium text-foreground-secondary">{info.getValue() || "—"}</span>
        ),
      }),
      columnHelper.accessor("seating_capacity", {
        header: "Capacity",
        cell: (info) => (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-secondary">
            <Users className="h-3.5 w-3.5 text-foreground-muted" />
            {info.getValue()} seats
          </span>
        ),
      }),
      columnHelper.accessor("fuel_type", {
        header: "Fuel",
        cell: (info) => (
          <Badge variant="secondary" className="gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full">
            <CircleGauge className="h-3 w-3" />
            {info.getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor("mileage", {
        header: "Mileage",
        cell: (info) => (
          <span className="text-xs font-medium text-foreground-secondary font-data">
            {formatNumber(info.getValue() || 0)} km
          </span>
        ),
      }),
      columnHelper.accessor("registration_expiry", {
        header: "Registration",
        cell: (info) => {
          const expiry = info.getValue();
          if (!expiry) return <span className="text-xs font-medium text-foreground-secondary">—</span>;
          const overdue = new Date(expiry) < new Date(new Date().toDateString());
          return (
            <div className="flex items-center gap-2">
              <CalendarClock className={overdue ? "h-3.5 w-3.5 text-danger" : "h-3.5 w-3.5 text-foreground-muted"} />
              <span className={overdue ? "font-medium text-danger text-xs font-data" : "text-xs font-medium text-foreground-secondary font-data"}>{formatDate(expiry)}</span>
              {overdue && <Badge variant="danger" className="ml-1.5 text-[11px] rounded-full">Overdue</Badge>}
            </div>
          );
        },
      }),
      columnHelper.accessor("vehicle_status", {
        header: "Status",
        cell: (info) => {
          const restricted = restrictedPlates.has(info.row.original.plate_number);
          const status = restricted ? "Coding Restricted" : info.getValue();
          const variant = restricted ? "danger" : statusVariant[info.getValue()] || "default";
          return <Badge variant={variant} className="rounded-full px-3 py-1 text-xs font-bold">{status}</Badge>;
        },
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => (
          <div className="inline-flex items-center gap-0.5 rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="View">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
                onClick={() => router.push(`/fleet/vehicles/${info.row.original.vehicle_id}`)}
              >
                <Eye className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Edit">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
                onClick={() => router.push(`/fleet/vehicles/${info.row.original.vehicle_id}/edit`)}
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Archive">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-danger hover:bg-danger/10 hover:text-danger cursor-pointer"
                onClick={() => setArchivingId(info.row.original.vehicle_id)}
              >
                <Archive className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
          </div>
        ),
      }),
    ],
    [router, restrictedPlates]
  );

  if (isLoading) {
    return (
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="py-12 text-center text-foreground-muted">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded-xl w-1/3 mx-auto" />
            <div className="h-64 bg-muted rounded-2xl" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeLabel = filters.status || "All vehicles";

  return (
    <>
      <DataTable
        columns={columns}
        data={vehicles}
        pageSize={8}
        title="Fleet Inventory"
        description="Select a row to view its complete vehicle record."
        icon={Truck}
        context={activeLabel}
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
