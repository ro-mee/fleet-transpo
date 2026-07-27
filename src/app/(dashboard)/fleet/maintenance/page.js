"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Pencil, Trash2, Eye, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";

export default function MaintenancePage() {
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["maintenance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehiclemaintenance")
        .select("*, vehicles(vehicle_id, plate_number, vehicle_name)")
        .is("deleted_at", null)
        .order("maintenance_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from("vehiclemaintenance")
        .update({ deleted_at: new Date().toISOString() })
        .eq("maintenance_id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance"] }),
  });

  const statusVariant = {
    Scheduled: "default",
    "In Progress": "warning",
    Completed: "success",
    Cancelled: "danger",
  };

  const priorityVariant = {
    Normal: "secondary",
    High: "warning",
    Critical: "danger",
    Low: "default",
  };

  const columnHelper = createColumnHelper();

  const columns = useMemo(
    () => [
      columnHelper.accessor("maintenance_type", {
        header: "Type",
        cell: (info) => (
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-foreground-muted" />
            <span className="font-medium text-foreground">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor("vehicles.plate_number", {
        id: "vehicle",
        header: "Vehicle",
        cell: (info) => (
          <div>
            <p className="font-medium text-foreground">{info.getValue() || "—"}</p>
            <p className="text-xs text-foreground-muted">{info.row.original.vehicles?.vehicle_name}</p>
          </div>
        ),
      }),
      columnHelper.accessor("maintenance_date", {
        header: "Date",
        cell: (info) => (
          <span className="text-foreground-secondary">{formatDate(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("cost", {
        header: "Cost",
        cell: (info) => (
          <span className="font-medium text-foreground">{formatCurrency(info.getValue() || 0)}</span>
        ),
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: (info) => (
          <Badge variant={priorityVariant[info.getValue()] || "secondary"} className="text-xs">
            {info.getValue() || "Normal"}
          </Badge>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => (
          <Badge variant={statusVariant[info.getValue()] || "default"}>
            {info.getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor("service_provider", {
        header: "Provider",
        cell: (info) => (
          <span className="text-foreground-secondary">{info.getValue() || "—"}</span>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="w-8 h-8"><Eye className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" className="w-8 h-8"><Pencil className="w-4 h-4" /></Button>
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 text-danger"
              onClick={() => {
                if (confirm("Delete this record?")) deleteMutation.mutate(info.row.original.maintenance_id);
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ),
      }),
    ],
    [deleteMutation]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Maintenance</h1>
          <p className="text-foreground-secondary mt-1">Vehicle maintenance records and scheduling</p>
        </div>
        <Button className="h-10">
          <Wrench className="w-4 h-4 mr-2" />
          Add Record
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Scheduled", count: records.filter((r) => r.status === "Scheduled").length, color: "text-primary", bg: "bg-primary/10" },
          { label: "In Progress", count: records.filter((r) => r.status === "In Progress").length, color: "text-warning", bg: "bg-warning/10" },
          { label: "Completed", count: records.filter((r) => r.status === "Completed").length, color: "text-success", bg: "bg-success/10" },
          { label: "Total Cost", count: `₱${records.reduce((s, r) => s + (r.cost || 0), 0).toLocaleString()}`, color: "text-danger", bg: "bg-danger/10" },
        ].map((stat) => (
          <div key={stat.label} className="p-4 rounded-xl bg-surface border border-border">
            <p className="text-xs text-foreground-muted">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.count}</p>
          </div>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={records}
        searchPlaceholder="Search maintenance records..."
      />
    </div>
  );
}
