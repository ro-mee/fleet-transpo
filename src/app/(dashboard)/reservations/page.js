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
import { getTransportRequests } from "@/services/transport.service";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { formatDate, formatTime, cn } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import {
  ArrowUpRight,
  Building,
  Calendar,
  CalendarCheck,
  CarFront,
  Clock,
  Download,
  Inbox,
  MapPin,
  Plus,
  SlidersHorizontal,
  TriangleAlert,
  UserCheck,
  Users,
} from "lucide-react";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";

// Phase 17 — the reservation list, repointed to transportation_requests.
//
// This page used to list `vehiclereservations` while /reservations/queue listed
// `transportation_requests` — two entities under one module, so the same booking
// appeared in both places with different ids, different statuses, and a row click
// that led to a detail page keyed on the other table's primary key. The request IS
// the reservation; `vehiclereservations` was dropped in Phase 3.
//
// The split with the queue is deliberate and is about audience, not data. The queue
// is the dispatcher's workspace: cards, conflict chips, AI badges, auto-refresh,
// scoped to what still needs a decision. This is the register — every request in
// every state, dense, sortable, exportable, for the "where is booking 4471" and
// end-of-month questions. Same rows, different job.
//
// Read-only by design. Actions live on the queue and the detail page, where the
// lifecycle endpoints validate each hop and write the timeline; a cancel button
// wired straight into a table row is how the old page ended up writing status
// without an event.
const columnHelper = createColumnHelper();

// Statuses that still need someone to do something, for the "Open" stat.
const OPEN_STATUSES = [L.PENDING, L.UNDER_REVIEW, L.APPROVED, L.SCHEDULED, L.ASSIGNED, L.IN_PROGRESS];

const isSameLocalDay = (value, day) => {
  if (!value) return false;
  const d = new Date(value);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
};

export default function ReservationsPage() {
  const router = useRouter();

  const {
    data: requests = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["transport-requests", "list"],
    queryFn: () => getTransportRequests(),
    refetchInterval: 30_000,
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor("reservation_number", {
        header: "Reservation",
        cell: (info) => (
          <div>
            <div className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
              {info.getValue() || `#${info.row.original.request_id}`}
            </div>
            {info.row.original.booking_reference && (
              <p className="text-[11px] text-foreground-muted mt-1 font-medium">{info.row.original.booking_reference}</p>
            )}
          </div>
        ),
      }),
      columnHelper.accessor("guest_name", {
        header: "Guest",
        cell: (info) => (
          <div>
            <p className="font-bold text-sm text-foreground">{info.getValue() || "—"}</p>
            <p className="text-xs text-foreground-muted font-medium">{info.row.original.source_system}</p>
          </div>
        ),
      }),
      columnHelper.accessor("pickup_location", {
        header: "Route",
        cell: (info) => (
          <div className="max-w-[220px]">
            <p className="flex items-center gap-1.5 truncate text-xs font-medium text-foreground-secondary">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-danger" />
              {info.getValue()}
            </p>
            {info.row.original.dropoff_location && (
              <p className="flex items-center gap-1.5 truncate text-xs font-medium text-foreground-secondary mt-0.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-success" />
                {info.row.original.dropoff_location}
              </p>
            )}
          </div>
        ),
      }),
      columnHelper.accessor("pickup_datetime", {
        header: "Pickup",
        cell: (info) => (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground-secondary font-data">
              <Calendar className="h-3.5 w-3.5 text-foreground-muted" />
              {formatDate(info.getValue())}
            </p>
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground-secondary font-data mt-0.5">
              <Clock className="h-3.5 w-3.5 text-foreground-muted" />
              {formatTime(info.getValue())}
            </p>
          </div>
        ),
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: (info) => <StatusBadge status={info.getValue()} entity="priority" className="rounded-full px-3 py-1 text-xs font-bold" />,
      }),
      columnHelper.accessor("service_types", {
        header: "Service",
        cell: (info) => {
          const st = info.getValue();
          const r = info.row.original;
          const label =
            st?.service_name || r.vehiclecategories?.category_name || r.requested_vehicle_type;
          return label ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground-secondary">
              <Building className="h-3.5 w-3.5 text-foreground-muted" />
              {label}
            </span>
          ) : (
            <span className="text-xs text-foreground-muted">—</span>
          );
        },
      }),
      columnHelper.display({
        id: "assignment",
        header: "Assigned",
        cell: (info) => {
          const r = info.row.original;
          const driver = r.drivers;
          return (
            <div className="space-y-1 text-xs font-medium">
              <p className="flex items-center gap-1.5">
                <CarFront className="h-3.5 w-3.5 text-foreground-muted" />
                <span className={r.vehicles ? "font-data font-bold text-foreground" : "text-foreground-muted"}>
                  {r.vehicles?.plate_number || "—"}
                </span>
              </p>
              <p className="flex items-center gap-1.5">
                <UserCheck className="h-3.5 w-3.5 text-foreground-muted" />
                <span className={driver ? "text-foreground-secondary font-semibold" : "text-foreground-muted"}>
                  {driver ? [driver.first_name, driver.last_name].filter(Boolean).join(" ") : "—"}
                </span>
              </p>
            </div>
          );
        },
      }),
      columnHelper.accessor("passenger_count", {
        header: "Pax",
        cell: (info) => (
          <span className="flex items-center gap-1 text-xs font-bold text-foreground-secondary font-data">
            <Users className="h-3.5 w-3.5 text-foreground-muted" />
            {info.getValue() || 1}
          </span>
        ),
      }),
      columnHelper.accessor("fleet_status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} entity="reservation" className="rounded-full px-3 py-1 text-xs font-bold" />,
      }),
      columnHelper.display({
        id: "open",
        header: "",
        cell: (info) => (
          <div className="inline-flex items-center rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label={`Open ${info.row.original.reservation_number || "reservation"}`}
              onClick={() => {
                router.push(`/reservations/${info.row.original.request_id}`);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-foreground-secondary transition-colors hover:bg-hover hover:text-foreground cursor-pointer"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ),
      }),
    ],
    [router]
  );

  const [activeFilter, setActiveFilter] = useState("all");
  const today = useMemo(() => new Date(), []);

  const displayRequests = useMemo(() => {
    if (activeFilter === "open") return requests.filter((r) => OPEN_STATUSES.includes(r.fleet_status));
    if (activeFilter === "review") return requests.filter((r) => r.fleet_status === L.PENDING || r.fleet_status === L.UNDER_REVIEW);
    if (activeFilter === "today") return requests.filter((r) => isSameLocalDay(r.pickup_datetime, today));
    return requests;
  }, [requests, activeFilter, today]);

  const statCards = [
    {
      label: "Total Requests",
      value: requests.length,
      icon: CalendarCheck,
      tone: "primary",
      trend: "all time",
      active: activeFilter === "all",
      onClick: () => setActiveFilter("all"),
    },
    {
      label: "Open",
      value: requests.filter((r) => OPEN_STATUSES.includes(r.fleet_status)).length,
      icon: Clock,
      tone: "warning",
      trend: "still in the pipeline",
      active: activeFilter === "open",
      onClick: () => setActiveFilter("open"),
    },
    {
      label: "Awaiting Review",
      value: requests.filter((r) => r.fleet_status === L.PENDING || r.fleet_status === L.UNDER_REVIEW).length,
      icon: Inbox,
      tone: "info",
      trend: "needs a decision",
      active: activeFilter === "review",
      onClick: () => setActiveFilter("review"),
    },
    {
      label: "Pickups Today",
      value: requests.filter((r) => isSameLocalDay(r.pickup_datetime, today)).length,
      icon: Calendar,
      tone: "success",
      trend: "scheduled today",
      active: activeFilter === "today",
      onClick: () => setActiveFilter("today"),
    },
  ];

  const filters = [
    { value: "all", label: "All requests" },
    { value: "open", label: "Open" },
    { value: "review", label: "Needs review" },
    { value: "today", label: "Today" },
  ];

  if (isError) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Could not load reservations"
        description={error?.message || "Something went wrong reading the request register."}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <HeroHeader
        icon={CalendarCheck}
        title="Reservations Register"
        badge="Operations"
        description="Monitor every transportation request from Booking in one place."
        actions={
          <>
            <Button
              variant="outline"
              disabled={!requests.length}
              className={cn(heroButtonOutlineClass)}
              onClick={() =>
                exportToCSV(requests, "reservations", [
                  { label: "Reservation No.", key: "reservation_number" },
                  { label: "Booking Reference", key: "booking_reference" },
                  { label: "Source", key: "source_system" },
                  { label: "Guest", key: "guest_name" },
                  { label: "Pickup Location", key: "pickup_location" },
                  { label: "Dropoff Location", key: "dropoff_location" },
                  { label: "Pickup", key: "pickup_datetime" },
                  { label: "Passengers", key: "passenger_count" },
                  { label: "Priority", key: "priority" },
                  { label: "Service", accessor: (r) => r.service_types?.service_name || r.vehiclecategories?.category_name || r.requested_vehicle_type || "" },
                  { label: "Vehicle", accessor: (r) => r.vehicles?.plate_number || "" },
                  {
                    label: "Driver",
                    accessor: (r) =>
                      r.drivers ? [r.drivers.first_name, r.drivers.last_name].filter(Boolean).join(" ") : "",
                  },
                  { label: "Est. Distance (km)", key: "estimated_distance" },
                  { label: "Est. Duration (min)", key: "estimated_duration" },
                  { label: "Fleet Status", key: "fleet_status" },
                  { label: "Booking Status", key: "booking_status" },
                  { label: "Reason", key: "status_reason" },
                ])
              }
            >
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button variant="outline" className={cn(heroButtonOutlineClass)} onClick={() => router.push("/reservations/queue")}>
              <Inbox className="mr-2 h-4 w-4" />
              Request Queue
            </Button>
            <Button className={cn(heroButtonPrimaryClass)} onClick={() => router.push("/reservations/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Request
            </Button>
          </>
        }
      />

      {/* ── KPI Filter Cards ── */}
      <StatGrid cols={4}>
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </StatGrid>

      {/* ── Table ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={displayRequests}
            pageSize={12}
            title="Reservations Register"
            description="Select a row to view its complete reservation record."
            icon={CalendarCheck}
            context={activeFilter === "all" ? "All Reservations" : activeFilter}
            isLoading={isLoading}
            searchPlaceholder="Search by reservation no., guest, booking reference, or location..."
            toolbar={
              <div className="flex items-center gap-1" aria-label="Reservation filters">
                <SlidersHorizontal className="hidden h-3.5 w-3.5 text-foreground-muted sm:block" />
                {filters.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setActiveFilter(filter.value)}
                    className={cn(
                      "whitespace-nowrap rounded-full px-3 h-7 text-[11px] font-bold border transition-colors cursor-pointer",
                      activeFilter === filter.value
                        ? "bg-primary text-white dark:text-slate-950 border-primary"
                        : "bg-surface border-border/60 text-foreground-secondary hover:border-primary/40 hover:text-foreground"
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            }
            emptyTitle="No transportation requests yet"
            emptyDescription="Requests arrive from the Booking subsystem. Use Inject Mock Request to create one in development."
            onRowClick={(row) => router.push(`/reservations/${row.request_id}`)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
