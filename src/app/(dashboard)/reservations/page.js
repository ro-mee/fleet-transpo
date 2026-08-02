"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { getTransportRequests } from "@/services/transport.service";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { formatDate, formatTime } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import {
  Building,
  Calendar,
  CalendarCheck,
  CarFront,
  Clock,
  Download,
  FlaskConical,
  Inbox,
  MapPin,
  TriangleAlert,
  UserCheck,
  Users,
} from "lucide-react";

// Phase 17 — the reservation list, repointed to transportation_requests.
//
// This page used to list `vehiclereservations` while /reservations/queue listed
// `transportation_requests` — two entities under one module, so the same booking
// appeared in both places with different ids, different statuses, and a row click
// that led to a detail page keyed on the other table's primary key. The request IS
// the reservation now; vehiclereservations is a legacy FK target.
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
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor("reservation_number", {
        header: "Reservation",
        cell: (info) => (
          <div>
            <p className="font-data text-xs font-medium text-foreground">
              {info.getValue() || `#${info.row.original.request_id}`}
            </p>
            {info.row.original.booking_reference && (
              <p className="text-xs text-foreground-muted">{info.row.original.booking_reference}</p>
            )}
          </div>
        ),
      }),
      columnHelper.accessor("guest_name", {
        header: "Guest",
        cell: (info) => (
          <div>
            <p className="font-medium text-foreground">{info.getValue() || "—"}</p>
            <p className="text-xs text-foreground-muted">{info.row.original.source_system}</p>
          </div>
        ),
      }),
      columnHelper.accessor("pickup_location", {
        header: "Route",
        cell: (info) => (
          <div className="max-w-[220px]">
            <p className="flex items-center gap-1.5 truncate text-sm text-foreground-secondary">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-danger" />
              {info.getValue()}
            </p>
            {info.row.original.dropoff_location && (
              <p className="flex items-center gap-1.5 truncate text-sm text-foreground-secondary">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-success" />
                {info.row.original.dropoff_location}
              </p>
            )}
          </div>
        ),
      }),
      // pickup_datetime is a single timestamptz — date and time are split across
      // two columns for scanning, but both read the same field. The old page had
      // separate reservation_date and pickup_time columns; they no longer exist.
      columnHelper.accessor("pickup_datetime", {
        header: "Pickup",
        cell: (info) => (
          <div>
            <p className="flex items-center gap-1.5 text-foreground-secondary">
              <Calendar className="h-3.5 w-3.5 text-foreground-muted" />
              {formatDate(info.getValue())}
            </p>
            <p className="flex items-center gap-1.5 text-foreground-secondary">
              <Clock className="h-3.5 w-3.5 text-foreground-muted" />
              {formatTime(info.getValue())}
            </p>
          </div>
        ),
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: (info) => <StatusBadge status={info.getValue()} entity="priority" />,
      }),
      columnHelper.accessor("service_types", {
        header: "Service",
        cell: (info) => {
          const st = info.getValue();
          const r = info.row.original;
          // Resolved category before Booking's raw wording, so this column agrees
          // with the queue cards (which show the category). Falling straight
          // through to the raw string showed "Executive SUV" here and
          // "VIP Guest Transport" there for the same request.
          const label =
            st?.service_name || r.vehiclecategories?.category_name || r.requested_vehicle_type;
          return label ? (
            <span className="flex items-center gap-1.5 text-sm text-foreground-secondary">
              <Building className="h-3.5 w-3.5 text-foreground-muted" />
              {label}
            </span>
          ) : (
            <span className="text-sm text-foreground-muted">—</span>
          );
        },
      }),
      // One column for both halves of the assignment: a request is dispatchable
      // only when it has each, so showing them together makes the gap obvious.
      columnHelper.display({
        id: "assignment",
        header: "Assigned",
        cell: (info) => {
          const r = info.row.original;
          const driver = r.drivers;
          return (
            <div className="space-y-0.5 text-sm">
              <p className="flex items-center gap-1.5">
                <CarFront className="h-3.5 w-3.5 text-foreground-muted" />
                <span className={r.vehicles ? "text-foreground-secondary" : "text-foreground-muted"}>
                  {r.vehicles?.plate_number || "—"}
                </span>
              </p>
              <p className="flex items-center gap-1.5">
                <UserCheck className="h-3.5 w-3.5 text-foreground-muted" />
                <span className={driver ? "text-foreground-secondary" : "text-foreground-muted"}>
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
          <span className="flex items-center gap-1 text-foreground-secondary">
            <Users className="h-3.5 w-3.5 text-foreground-muted" />
            {info.getValue() || 1}
          </span>
        ),
      }),
      columnHelper.accessor("fleet_status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} entity="reservation" />,
      }),
    ],
    []
  );

  const today = new Date();
  const statCards = [
    {
      label: "Total Requests",
      value: requests.length,
      icon: CalendarCheck,
      tone: "primary",
      trend: "all time",
    },
    {
      label: "Open",
      value: requests.filter((r) => OPEN_STATUSES.includes(r.fleet_status)).length,
      icon: Clock,
      tone: "warning",
      trend: "still in the pipeline",
    },
    {
      label: "Awaiting Review",
      value: requests.filter((r) => r.fleet_status === L.PENDING || r.fleet_status === L.UNDER_REVIEW).length,
      icon: Inbox,
      tone: "info",
      trend: "needs a decision",
    },
    {
      label: "Pickups Today",
      value: requests.filter((r) => isSameLocalDay(r.pickup_datetime, today)).length,
      icon: Calendar,
      tone: "success",
      trend: "scheduled today",
    },
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
      <PageHeader
        eyebrow="Operations"
        title="Reservations"
        description="Every transportation request received from Booking, in every state."
        actions={
          <>
            <Button
              variant="outline"
              disabled={!requests.length}
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
            <Button variant="outline" onClick={() => router.push("/reservations/queue")}>
              <Inbox className="mr-2 h-4 w-4" />
              Request Queue
            </Button>
            <Button onClick={() => router.push("/reservations/new")}>
              <FlaskConical className="mr-2 h-4 w-4" />
              Inject Mock Request
            </Button>
          </>
        }
      />

      <StatGrid cols={4}>
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </StatGrid>

      <DataTable
        columns={columns}
        data={requests}
        isLoading={isLoading}
        searchPlaceholder="Search by reservation no., guest, booking reference, or location..."
        emptyTitle="No transportation requests yet"
        emptyDescription="Requests arrive from the Booking subsystem. Use Inject Mock Request to create one in development."
        onRowClick={(row) => router.push(`/reservations/${row.request_id}`)}
      />
    </div>
  );
}
