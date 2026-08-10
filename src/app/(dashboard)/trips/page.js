"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { getTrips, getActiveTrips } from "@/services/trip.service";
import { formatTime, formatDuration } from "@/lib/utils";
import { Route, Play, Download, Truck, Users, Clock, CheckCircle2, MapPin, TriangleAlert, Navigation } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";

const columnHelper = createColumnHelper();

export default function TripsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("all");

  const {
    data: trips = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["trips"],
    queryFn: () => getTrips(),
  });

  const { data: activeTrips = [] } = useQuery({
    queryKey: ["trips-active"],
    queryFn: () => getActiveTrips(),
    refetchInterval: 30000,
  });

  const displayTrips = useMemo(() => {
    if (statusFilter === "Active")
      return trips.filter((t) =>
        ["In Progress", "Trip Started", "En Route", "Arrived", "Driver Accepted"].includes(t.trip_status)
      );
    if (statusFilter === "Completed") return trips.filter((t) => t.trip_status === "Completed");
    return trips;
  }, [trips, statusFilter]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("trip_id", {
        header: "Trip",
        cell: (info) => (
          <div className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
            #{info.getValue()}
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.vehicles?.plate_number, {
        id: "vehicle",
        header: "Vehicle",
        cell: (info) => {
          const row = info.row.original;
          const plate = info.getValue();
          const name = row.vehicles?.vehicle_name;
          return plate ? (
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 text-foreground border border-border/40 shadow-2xs">
                <Truck className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="font-data text-xs font-bold text-foreground tracking-wide">{plate}</p>
                {name && <p className="text-xs text-foreground-muted font-medium mt-0.5">{name}</p>}
              </div>
            </div>
          ) : (
            <span className="text-xs text-foreground-muted italic font-medium">Unassigned</span>
          );
        },
      }),
      columnHelper.accessor("drivers", {
        id: "driver",
        header: "Driver",
        cell: (info) => {
          const d = info.getValue();
          if (!d) return <span className="text-xs text-foreground-muted italic font-medium">Unassigned</span>;
          const name = `${d.first_name || ""} ${d.last_name || ""}`.trim();
          const initials = [d.first_name?.[0], d.last_name?.[0]].filter(Boolean).join("").toUpperCase();
          return (
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs">
                {initials || "DR"}
              </div>
              <div>
                <p className="font-bold text-sm text-foreground">{name}</p>
                <p className="text-xs text-foreground-muted font-medium">Assigned driver</p>
              </div>
            </div>
          );
        },
      }),
      columnHelper.accessor((row) => row.dispatchschedules?.dispatch_number, {
        id: "dispatch",
        header: "Dispatch #",
        cell: (info) => {
          const val = info.getValue();
          return val ? (
            <span className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-2.5 py-1 font-data text-xs font-bold text-foreground shadow-2xs" title={val}>
              {val}
            </span>
          ) : (
            <span className="text-foreground-muted text-xs font-medium">—</span>
          );
        },
      }),
      columnHelper.accessor((row) => row.routes?.route_name, {
        id: "route",
        header: "Route",
        cell: (info) => {
          const row = info.row.original;
          const name = info.getValue();
          const origin = row.routes?.origin;
          const dest = row.routes?.destination;
          return name ? (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Route className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="truncate max-w-[160px]">{name}</span>
              </div>
              {origin && dest && (
                <div className="flex items-center gap-1 mt-0.5 text-[11px] text-foreground-muted font-medium">
                  <MapPin className="w-3 h-3 text-danger shrink-0" />
                  <span className="truncate max-w-[60px]">{origin}</span>
                  <span>→</span>
                  <MapPin className="w-3 h-3 text-success shrink-0" />
                  <span className="truncate max-w-[60px]">{dest}</span>
                </div>
              )}
            </div>
          ) : (
            <span className="text-foreground-muted text-xs font-medium">—</span>
          );
        },
      }),
      columnHelper.accessor("start_time", {
        header: "Started",
        cell: (info) => {
          const v = info.getValue();
          if (!v) return <span className="text-xs text-foreground-muted font-medium">—</span>;
          const d = new Date(v);
          return (
            <div>
              <p className="font-data text-xs font-bold text-foreground">{formatTime(v)}</p>
              <p className="text-[11px] text-foreground-muted font-medium">{d.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</p>
            </div>
          );
        },
      }),
      columnHelper.accessor("end_time", {
        header: "Ended",
        cell: (info) => {
          const v = info.getValue();
          if (!v) return <span className="text-xs text-foreground-muted font-medium">—</span>;
          const d = new Date(v);
          return (
            <div>
              <p className="font-data text-xs font-bold text-foreground">{formatTime(v)}</p>
              <p className="text-[11px] text-foreground-muted font-medium">{d.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</p>
            </div>
          );
        },
      }),
      columnHelper.accessor("trip_status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} entity="trip" className="rounded-full px-3 py-1 text-xs font-bold" />,
      }),
    ],
    []
  );

  const activeCount = useMemo(
    () =>
      trips.filter((t) =>
        ["In Progress", "Trip Started", "En Route", "Arrived", "Driver Accepted"].includes(t.trip_status)
      ).length,
    [trips]
  );
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

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-surface border border-border/80 p-5 rounded-3xl shadow-xs">
          <div className="flex items-center gap-4">
            <div className="p-3.5 rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Route className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-extrabold text-foreground tracking-tight">Fleet Trips Log</h1>
                <Badge variant="outline" className="gap-1 px-3 py-1 text-xs rounded-full border-primary/30 bg-primary/5 text-primary font-bold">
                  Operations
                </Badge>
              </div>
              <p className="text-xs text-foreground-secondary mt-1">Monitor and manage all fleet trips across the network.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
          </div>
        </div>
        <EmptyState
          icon={TriangleAlert}
          title="Could not load trips"
          description={error?.message || "Something went wrong reading the trips register."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  const TONE_MAP = {
    primary:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   icon: 'bg-slate-500/15 text-slate-500',   dot: 'bg-slate-500',   text: 'text-slate-600 dark:text-slate-400' },
    success:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'bg-emerald-500/15 text-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
    warning:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   icon: 'bg-amber-500/15 text-amber-500',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400' },
    danger:    { bg: 'bg-red-500/10',     border: 'border-red-500/30',     icon: 'bg-red-500/15 text-red-500',       dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400' },
    info:      { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    icon: 'bg-blue-500/15 text-blue-500',     dot: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400' },
    secondary: { bg: 'bg-zinc-500/10',    border: 'border-zinc-500/30',    icon: 'bg-zinc-500/15 text-zinc-500',     dot: 'bg-zinc-500',    text: 'text-zinc-600 dark:text-zinc-400' },
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Route}
        title="Fleet Trips Log"
        badge="Operations"
        description="Monitor and manage all fleet trips across the network."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className={cn(heroButtonOutlineClass)}
              onClick={() =>
                exportToCSV(trips, "trips", [
                  { label: "ID", key: "trip_id" },
                  { label: "Vehicle", accessor: (t) => t.vehicles?.plate_number || "" },
                  {
                    label: "Driver",
                    accessor: (t) =>
                      t.drivers ? `${t.drivers.first_name || ""} ${t.drivers.last_name || ""}`.trim() : "",
                  },
                  { label: "Dispatch", accessor: (t) => t.dispatchschedules?.dispatch_number || "" },
                  { label: "Route", accessor: (t) => t.routes?.route_name || "" },
                  { label: "Start Time", key: "start_time" },
                  { label: "End Time", key: "end_time" },
                  { label: "Distance (km)", key: "distance" },
                  { label: "Duration (min)", key: "actual_duration" },
                  { label: "Status", key: "trip_status" },
                  { label: "Notes", key: "notes" },
                ])
              }
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" size="sm" className={cn(heroButtonOutlineClass)} onClick={() => router.push("/tracking/live-map")}>
              <Navigation className="w-4 h-4 mr-2" />
              Live GPS Map ({activeTrips.length})
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => {
          const t = TONE_MAP.primary;
          const isActive = statusFilter === "all";
          return (
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                isActive
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-primary/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Total Trips</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><Route className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{trips.length}</div>
              </div>
            </button>
          );
        })()}

        {(() => {
          const t = TONE_MAP.warning;
          const isActive = statusFilter === "Active";
          return (
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'Active' ? 'all' : 'Active')}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                isActive
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-warning/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Active</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><Truck className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{activeCount}</div>
              </div>
            </button>
          );
        })()}

        {(() => {
          const t = TONE_MAP.success;
          const isActive = statusFilter === "Completed";
          return (
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'Completed' ? 'all' : 'Completed')}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                isActive
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-success/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Completed</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><CheckCircle2 className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{completedCount}</div>
              </div>
            </button>
          );
        })()}
      </div>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={displayTrips}
            pageSize={10}
            title="Fleet Trips Log"
            description="Select a trip row to inspect details."
            icon={Route}
            context={statusFilter === "all" ? "All Trips" : statusFilter}
            isLoading={isLoading}
            searchPlaceholder="Search trips by vehicle, driver, or route..."
            emptyTitle="No trips found"
            emptyDescription="Trips will appear here once dispatches are scheduled."
            onRowClick={(row) => router.push(`/trips/${row.trip_id}`)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
