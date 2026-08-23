"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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
import { toast } from "@/components/ui/toast";

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
const OPEN_STATUSES = [L.PENDING, L.SCHEDULED, L.ASSIGNED, L.IN_PROGRESS];

export default function ReservationsPage() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState([]);
  const [exporting, setExporting] = useState(false);

  // Debounce the server-side search so every keystroke doesn't hit the API.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Map the register's filter chips to server-side params the API understands.
  // "open" is a group -> comma-separated statuses; "review" = incomplete assignment;
  // "today" = that date; "all" = no filter.
  const filterParams = useMemo(() => {
    if (activeFilter === "open") return { fleet_status: OPEN_STATUSES.join(",") };
    if (activeFilter === "review") return { needs_assignment: "true" };
    if (activeFilter === "today") return { pickup_date: new Date().toISOString().slice(0, 10) };
    return {};
  }, [activeFilter]);

  const {
    data: requestsData = { rows: [], counts: { total: 0, open: 0, review: 0, today: 0 }, total: 0 },
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["transport-requests", "list", { page, pageSize, activeFilter, search, sort }],
    queryFn: () =>
      getTransportRequests({
        page,
        pageSize,
        search: search || undefined,
        sort: sort[0]?.id,
        sortDir: sort[0]?.desc ? "desc" : "asc",
        ...filterParams,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const requests = requestsData.rows ?? [];
  const total = requestsData.total ?? 0;
  const counts = requestsData.counts ?? { total: 0, open: 0, review: 0, today: 0 };
  const displayRequests = requests;

  const columns = useMemo(
    () => [
      columnHelper.accessor("reservation_number", {
        header: "Reservation",
        cell: (info) => (
          <div>
            <div className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
              {info.getValue() || `REQ-${info.row.original.request_id}`}
            </div>
            {info.row.original.booking_reference && (
              <p className="text-[11px] text-foreground-muted mt-1 font-medium">{info.row.original.booking_reference}</p>
            )}
          </div>
        ),
      }),
      columnHelper.accessor("guest_name", {
        header: "Guest",
        cell: (info) => {
          const name = info.getValue() || "";
          const parts = name.split(" ").filter(Boolean);
          const shortName = parts.length > 1 
            ? `${parts[0]} ${parts[parts.length - 1][0]}.` 
            : parts[0] || "—";
            
          return (
            <div>
              <p className="font-bold text-sm text-foreground">{shortName}</p>
              <p className="text-xs text-foreground-muted font-medium">{info.row.original.source_system}</p>
            </div>
          );
        },
      }),
      columnHelper.accessor("pickup_location", {
        header: "Route",
        cell: (info) => (
          <div className="max-w-[220px]">
            <p className="flex items-center gap-1.5 truncate text-xs font-medium text-foreground-secondary">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-danger" />
              {info.getValue() ? info.getValue().replace(/Terminal /i, "").replace(/ Hotel/i, "").trim() : "—"}
            </p>
            {info.row.original.dropoff_location && (
              <p className="flex items-center gap-1.5 truncate text-xs font-medium text-foreground-secondary mt-0.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-success" />
                {info.row.original.dropoff_location.replace(/Terminal /i, "").replace(/ Hotel/i, "").trim()}
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
                  {driver ? `${driver.first_name?.split(" ")[0]} ${driver.last_name ? driver.last_name.split(" ").pop()[0] + "." : ""}`.trim() : "—"}
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
    ],
    [router]
  );

  const statCards = [
    {
      label: "Total Requests",
      value: counts.total,
      icon: CalendarCheck,
      tone: "primary",
      trend: "all time",
      active: activeFilter === "all",
      onClick: () => { setActiveFilter("all"); setPage(1); },
    },
    {
      label: "Open",
      value: counts.open,
      icon: Clock,
      tone: "warning",
      trend: "still in the pipeline",
      active: activeFilter === "open",
      onClick: () => { setActiveFilter("open"); setPage(1); },
    },
    {
      label: "Awaiting Assignment",
      value: counts.review,
      icon: Inbox,
      tone: "info",
      trend: "needs a decision",
      active: activeFilter === "review",
      onClick: () => { setActiveFilter("review"); setPage(1); },
    },
    {
      label: "Pickups Today",
      value: counts.today,
      icon: Calendar,
      tone: "success",
      trend: "scheduled today",
      active: activeFilter === "today",
      onClick: () => { setActiveFilter("today"); setPage(1); },
    },
  ];

  // Export needs the whole register, not the current page — re-fetch
  // unpaginated, keeping whichever KPI chip is active so the file matches what
  // the user sees. Without page/pageSize params the API returns a plain array.
  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await getTransportRequests({ ...filterParams });
      const rows = Array.isArray(result) ? result : result?.rows || [];
      exportToCSV(rows, "reservations", [
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
      ]);
      toast.success(`Exported ${rows.length} transportation request${rows.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err?.message || "Failed to export reservations");
    } finally {
      setExporting(false);
    }
  };

  const filters = [
    { value: "all", label: "All requests" },
    { value: "open", label: "Open" },
    { value: "review", label: "Needs assignment" },
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
              disabled={!requests.length || exporting}
              className={cn(heroButtonOutlineClass)}
              onClick={handleExport}
            >
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "Exporting..." : "Export"}
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
                    onClick={() => { setActiveFilter(filter.value); setPage(1); }}
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
            emptyDescription="Requests ingested from Booking will appear here."
            emptyAction={
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                Refresh
              </Button>
            }
            onRowClick={(row) => router.push(`/reservations/${row.request_id}`)}
            manualPagination
            pageIndex={page - 1}
            onPageChange={(idx) => setPage(idx + 1)}
            rowCount={total}
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            onSortChange={(s) => { setSort(s); setPage(1); }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
