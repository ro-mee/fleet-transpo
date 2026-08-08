"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyTrips } from "@/services/driver.service";
import { formatTime } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { Route, Truck, CheckCircle2, TriangleAlert } from "lucide-react";

const columnHelper = createColumnHelper();

const ACTIVE_STATUSES = ["In Progress", "Trip Started", "En Route", "Arrived", "Driver Accepted"];

export default function DriverTripsPage() {
  useRequireRole(["driver"]);
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: trips = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["driver-trips"],
    queryFn: () => getMyTrips(),
  });

  const displayTrips = useMemo(() => {
    if (statusFilter === "Active") return trips.filter((t) => ACTIVE_STATUSES.includes(t.trip_status));
    if (statusFilter === "Completed") return trips.filter((t) => t.trip_status === "Completed");
    return trips;
  }, [trips, statusFilter]);

  const activeCount = useMemo(() => trips.filter((t) => ACTIVE_STATUSES.includes(t.trip_status)).length, [trips]);
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
        cell: (info) => <span className="font-data text-xs text-foreground-muted">{info.getValue() ? formatTime(info.getValue()) : "—"}</span>,
      }),
      columnHelper.accessor("end_time", {
        header: "Ended",
        cell: (info) => <span className="font-data text-xs text-foreground-muted">{info.getValue() ? formatTime(info.getValue()) : "—"}</span>,
      }),
      columnHelper.accessor("trip_status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} entity="trip" />,
      }),
    ],
    []
  );

  return (
    <DriverConsentGate>
      <div className="space-y-6">
        <HeroHeader
          icon={Route}
          title="My Trips"
          badge="My Work"
          description="Trips assigned to you, newest first."
        />

        {isError ? (
          <EmptyState
            icon={TriangleAlert}
            title="Could not load trips"
            description={error?.message || "Something went wrong reading your trips."}
          />
        ) : (
          <>
            <StatGrid cols={3}>
              {statCards.map((card) => (
                <StatCard key={card.label} {...card} />
              ))}
            </StatGrid>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Trip History</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={columns}
                  data={displayTrips}
                  searchPlaceholder="Search trips..."
                  emptyTitle="No trips found"
                  emptyDescription="Trips will appear here once your dispatcher schedules you."
                  isLoading={isLoading}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DriverConsentGate>
  );
}
