"use client";

import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { DataTable } from "@/components/tables/data-table";
import { Button } from "@/components/ui/button";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getTrips } from "@/services/trip.service";
import { formatDateTime, cn } from "@/lib/utils";
import { MapPin, Clock, Truck, Navigation, Route, TriangleAlert, RefreshCw, ClipboardList, CheckCircle2 } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { StatCard, StatGrid } from "@/components/ui/stat-card";

const columnHelper = createColumnHelper();

function formatShortPlate(plate) {
  if (!plate) return "—";
  if (plate.startsWith("HARN-VS-") && plate.length > 15) {
    const parts = plate.split("-");
    const lastPart = parts[parts.length - 1];
    const shortCode = lastPart.length > 3 ? lastPart.slice(-3) : lastPart;
    return `HARN-VS-${shortCode}`;
  }
  return plate;
}

export default function TrackingHistoryPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);

  const {
    data: trips = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["trips-history"],
    queryFn: async () => {
      const all = await getTrips({ trip_status: "Completed", limit: 50 });
      return (all && all.rows) || [];
    },
  });

  const totalDistance = trips.reduce((s, t) => s + (Number(t.distance) || 0), 0);
  const avgDistance = trips.length ? (totalDistance / trips.length).toFixed(1) : 0;

  const columns = useMemo(
    () => [
      columnHelper.accessor("trip_id", {
        header: "Trip ID",
        cell: (info) => <span className="font-data font-semibold text-foreground bg-muted/40 px-2 py-0.5 rounded-lg border border-border/60 text-xs">#{info.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.vehicles?.plate_number, {
        id: "vehicle",
        header: "Vehicle",
        cell: (info) => (
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Truck className="w-3.5 h-3.5" />
            </div>
            <span className="text-foreground font-semibold text-xs font-data">{formatShortPlate(info.getValue())}</span>
          </div>
        ),
      }),
      columnHelper.accessor("origin", {
        header: "Origin",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-danger shrink-0" />
            <span className="text-foreground-secondary font-normal text-xs truncate max-w-[160px]">{info.getValue() || "—"}</span>
          </div>
        ),
      }),
      columnHelper.accessor("destination", {
        header: "Destination",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-success shrink-0" />
            <span className="text-foreground-secondary font-normal text-xs truncate max-w-[160px]">{info.getValue() || "—"}</span>
          </div>
        ),
      }),
      columnHelper.accessor("distance", {
        header: "Distance",
        cell: (info) => <span className="font-semibold font-data text-foreground text-xs">{info.getValue() || "—"} km</span>,
      }),
      columnHelper.accessor("start_time", {
        header: "Completed At",
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-foreground-secondary font-data text-xs">{info.getValue() ? formatDateTime(info.getValue()) : "—"}</span>
          </div>
        ),
      }),
      columnHelper.accessor("trip_status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} entity="trip" />,
      }),
    ],
    []
  );

  if (isError) {
    return (
      <div className="space-y-6 pb-12 w-full select-none">
        <HeroHeader
          icon={ClipboardList}
          title="Operational Review & Route History"
          badge="Operations Audit"
          description="Review completed trip logs, route execution efficiency, and distance metrics."
        />
        <EmptyState
          icon={TriangleAlert}
          title="Could not load tracking history"
          description={error?.message || "Something went wrong reading tracking history."}
          action={<Button onClick={() => refetch()} className="rounded-full h-9 px-4 text-xs font-semibold">Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 w-full select-none">
      {/* ── HERO HEADER BAR ── */}
      <HeroHeader
        icon={ClipboardList}
        title="Operational Review & Route History"
        badge="Operations Audit"
        description="Review completed trip logs, route execution efficiency, and distance metrics across the fleet."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className={cn("rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer", heroButtonOutlineClass)}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-2", isFetching && "animate-spin")} />
            Refresh Operational Data
          </Button>
        }
      />

      {/* ── SUMMARY KPI CARDS ── */}
      <StatGrid cols={3}>
        <StatCard icon={CheckCircle2} label="Completed Trips" value={trips.length} trend="Successfully fulfilled trips" tone="success" />
        <StatCard icon={MapPin} label="Total Distance" value={`${totalDistance.toFixed(0)} km`} trend="Cumulative distance traveled" tone="primary" />
        <StatCard icon={Route} label="Avg Trip Distance" value={`${avgDistance} km`} trend="Average route leg length" tone="warning" />
      </StatGrid>

      {/* ── DATA TABLE CARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={trips}
            searchPlaceholder="Search trip ID, vehicle, origin, destination..."
            emptyTitle="No completed trips found"
            emptyDescription="Completed trips will appear here with their route and tracking data."
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}
