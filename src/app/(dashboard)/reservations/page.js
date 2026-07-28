"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getReservations, cancelReservation } from "@/services/reservation.service";
import { formatDate, formatTime } from "@/lib/utils";
import { Plus, Download, CalendarCheck, Calendar, Clock, Users, XCircle, Building } from "lucide-react";
import { exportToCSV } from "@/lib/export";
import { toast } from "@/components/ui/toast";

const statusVariant = {
  Pending: "warning",
  Approved: "success",
  Rejected: "danger",
  Cancelled: "secondary",
  Completed: "default",
};

export default function ReservationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: reservations = [], isLoading } = useQuery({
    queryKey: ["reservations"],
    queryFn: () => getReservations(),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelReservation,
    onSuccess: () => {
      toast.success("Reservation cancelled");
      queryClient.invalidateQueries({ queryKey: ["reservations"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const columnHelper = createColumnHelper();

  const columns = useMemo(
    () => [
      columnHelper.accessor("reservation_id", {
        header: "ID",
        cell: (info) => (
          <span className="font-data text-xs text-foreground-muted">#{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("guest_name", {
        header: "Guest",
        cell: (info) => (
          <div>
            <p className="font-medium text-foreground">{info.getValue() || "Walk-in"}</p>
            {info.row.original.guest_phone && (
              <p className="text-xs text-foreground-muted">{info.row.original.guest_phone}</p>
            )}
          </div>
        ),
      }),
      columnHelper.accessor("pickup_location", {
        header: "Pickup",
        cell: (info) => (
          <span className="text-foreground-secondary text-sm">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("reservation_date", {
        header: "Date",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-foreground-muted" />
            <span className="text-foreground-secondary">{formatDate(info.getValue())}</span>
          </div>
        ),
      }),
      columnHelper.accessor("pickup_time", {
        header: "Time",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-foreground-muted" />
            <span className="text-foreground-secondary">{formatTime(`1970-01-01T${info.getValue()}`)}</span>
          </div>
        ),
      }),
      columnHelper.accessor("service_types", {
        header: "Service",
        cell: (info) => {
          const st = info.getValue();
          return st ? (
            <div className="flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-foreground-muted" />
              <span className="text-foreground-secondary text-sm">{st.service_name}</span>
            </div>
          ) : (
            <span className="text-foreground-muted text-sm">—</span>
          );
        },
      }),
      columnHelper.accessor("passenger_count", {
        header: "Pax",
        cell: (info) => (
          <div className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-foreground-muted" />
            <span className="text-foreground-secondary">{info.getValue() || 1}</span>
          </div>
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
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {info.row.original.status === "Pending" && (
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 text-danger"
                onClick={() => cancelMutation.mutate(info.row.original.reservation_id)}
              >
                <XCircle className="w-4 h-4" />
              </Button>
            )}
          </div>
        ),
      }),
    ],
    [cancelMutation]
  );

  const stats = [
    { label: "Total", count: reservations.length, icon: CalendarCheck, color: "text-primary", bg: "bg-primary/10" },
    { label: "Pending", count: reservations.filter((r) => r.status === "Pending").length, icon: Clock, color: "text-warning", bg: "bg-warning/10" },
    { label: "Approved", count: reservations.filter((r) => r.status === "Approved").length, icon: CalendarCheck, color: "text-success", bg: "bg-success/10" },
    { label: "Today", count: reservations.filter((r) => r.reservation_date === new Date().toISOString().split("T")[0]).length, icon: Calendar, color: "text-primary", bg: "bg-primary/10" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reservations</h1>
          <p className="text-foreground-secondary mt-1">Manage vehicle reservations</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-10"
            onClick={() => exportToCSV(reservations, "reservations", [
              { label: "ID", key: "reservation_id" },
              { label: "Guest Name", key: "guest_name" },
              { label: "Guest Phone", key: "guest_phone" },
              { label: "Pickup Location", key: "pickup_location" },
              { label: "Dropoff Location", key: "dropoff_location" },
              { label: "Date", key: "reservation_date" },
              { label: "Pickup Time", key: "pickup_time" },
              { label: "Return Time", key: "estimated_return_time" },
              { label: "Passengers", key: "passenger_count" },
              { label: "Service", accessor: (r) => r.service_types?.service_name || "" },
              { label: "Status", key: "status" },
              { label: "Purpose", key: "purpose" },
            ])}
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => router.push("/reservations/new")} className="h-10">
            <Plus className="w-4 h-4 mr-2" />
            New Reservation
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${stat.bg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
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
        data={reservations}
        searchPlaceholder="Search by guest name, pickup, or booking ID..."
        onRowClick={(row) => router.push(`/reservations/${row.reservation_id}`)}
      />
    </div>
  );
}
