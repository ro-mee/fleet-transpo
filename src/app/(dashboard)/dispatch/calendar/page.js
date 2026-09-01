"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  getDay,
  isSameDay,
  isSameMonth,
  startOfDay,
  endOfDay,
  startOfMonth,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimeGrid, MonthGrid } from "@/components/dispatch/calendar-grids";
import { LaneGrid } from "@/components/dispatch/calendar-lanes";
import { CalendarDetailDrawer } from "@/components/dispatch/calendar-drawer";
import { useRequireRole } from "@/lib/auth/role-guard";
import { getDispatchCalendar } from "@/services/dispatch.service";
import {
  CALENDAR_DENSITY,
  CALENDAR_VIEW,
  EVENT_KIND,
  LANE,
  dispatchToEvent,
  downtimeToEvent,
  findOverlaps,
  leaveToEvent,
  maintenanceToEvent,
  rangeFor,
  shiftAnchor,
} from "@/lib/scheduling/calendar";
import { cn, formatTime } from "@/lib/utils";
import { DAY_NAMES } from "@/lib/scheduling/driver-schedule";
import {
  AlertTriangle,
  CalendarDays,
  CarFront,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutGrid,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  Wrench,
  X,
} from "lucide-react";

const REFETCH_MS = 60_000;

const VIEWS = [
  { id: CALENDAR_VIEW.DAY, label: "Day", keyHint: "D" },
  { id: CALENDAR_VIEW.WEEK, label: "Week", keyHint: "W" },
  { id: CALENDAR_VIEW.MONTH, label: "Month", keyHint: "M" },
];

const TYPE_FILTERS = [
  { id: "all", label: "All Items" },
  { id: "dispatches", label: "Bookings" },
  { id: "unassigned", label: "Needs Assignment" },
  { id: "maintenance", label: "Maintenance" },
  { id: "leave", label: "Leave & Rest" },
];

const VEHICLE_DOWN = ["Under Maintenance", "Registration Expired", "Out of Service"];
const DRIVER_DOWN = ["On Leave", "Suspended"];

function titleFor(view, anchor, days) {
  if (view === CALENDAR_VIEW.DAY) return format(anchor, "EEEE, d MMMM yyyy");
  if (view === CALENDAR_VIEW.MONTH) return format(anchor, "MMMM yyyy");
  const first = days[0];
  const last = days[days.length - 1];
  return isSameMonth(first, last)
    ? `${format(first, "d")} – ${format(last, "d MMM yyyy")}`
    : `${format(first, "d MMM")} – ${format(last, "d MMM yyyy")}`;
}

const PILL_BASE =
  "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] cursor-pointer disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

function PillGroup({ label, children }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface p-0.5 shadow-2xs"
    >
      {children}
    </div>
  );
}

function JumpToDate({ anchor, onPick }) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(anchor));

  const grid = useMemo(() => {
    const first = viewMonth;
    const leading = getDay(first);
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    const daysInMonth = new Date(
      first.getFullYear(),
      first.getMonth() + 1,
      0
    ).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(first.getFullYear(), first.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewMonth]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setViewMonth(startOfMonth(anchor));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Jump to date" className="gap-1.5 rounded-full">
          <CalendarDays className="w-3.5 h-3.5" />
          <span className="font-data tabular-nums">{format(anchor, "MMM d")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[248px] rounded-2xl border-border/80 p-3">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-foreground-secondary">
              {format(viewMonth, "MMMM yyyy")}
            </span>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full"
                aria-label="Previous month"
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full"
                aria-label="Next month"
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-wide text-foreground-muted">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <span key={d} className="py-1">{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((day, i) =>
              day ? (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => {
                    onPick(day);
                    setOpen(false);
                  }}
                  className={cn(
                    "font-data flex h-7 items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-primary",
                    isSameDay(day, anchor)
                      ? "bg-primary text-white dark:text-slate-950"
                      : isSameDay(day, new Date())
                        ? "border border-primary text-primary hover:bg-primary/10"
                        : !isSameMonth(day, viewMonth)
                          ? "text-foreground-muted/50 hover:bg-hover"
                          : "text-foreground hover:bg-hover"
                  )}
                >
                  {format(day, "d")}
                </button>
              ) : (
                <span key={`pad-${i}`} aria-hidden="true" />
              )
            )}
          </div>

          <div className="flex justify-end border-t border-border/60 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-3 text-xs font-semibold"
              onClick={() => {
                onPick(new Date());
                setOpen(false);
              }}
            >
              Today
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function DispatchCalendarPage() {
  useRequireRole();

  const [view, setView] = useState(CALENDAR_VIEW.DAY);
  const [laneMode, setLaneMode] = useState(LANE.DRIVER);
  const [density, setDensity] = useState(CALENDAR_DENSITY.COMFORTABLE);
  const [anchor, setAnchor] = useState(() => new Date());

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Selected event for detail drawer
  const [selectedEvent, setSelectedEvent] = useState(null);

  const effectiveView = laneMode === LANE.NONE ? view : CALENDAR_VIEW.DAY;
  const { start, end, days } = useMemo(
    () => rangeFor(effectiveView, anchor),
    [effectiveView, anchor]
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["dispatch-calendar", start.toISOString(), end.toISOString()],
    queryFn: () =>
      getDispatchCalendar({ from: start.toISOString(), to: end.toISOString() }),
    refetchInterval: REFETCH_MS,
    placeholderData: (prev) => prev,
  });

  // Build lookups from vehicles & drivers (handling both string and number ID types)
  const lookups = useMemo(() => {
    const vehiclesById = new Map();
    for (const v of data?.vehicles || []) {
      vehiclesById.set(v.vehicle_id, v);
      vehiclesById.set(String(v.vehicle_id), v);
      if (!isNaN(Number(v.vehicle_id))) vehiclesById.set(Number(v.vehicle_id), v);
    }
    const driversById = new Map();
    for (const d of data?.drivers || []) {
      driversById.set(d.driver_id, d);
      driversById.set(String(d.driver_id), d);
      if (!isNaN(Number(d.driver_id))) driversById.set(Number(d.driver_id), d);
    }
    return { vehiclesById, driversById };
  }, [data?.vehicles, data?.drivers]);

  // Transform raw records into normalized enriched events
  const rawEvents = useMemo(() => {
    if (!data) return [];
    const out = [];

    for (const d of data.dispatches || []) {
      const e = dispatchToEvent(d, lookups);
      if (e) out.push(e);
    }
    for (const m of data.maintenance || []) {
      const e = maintenanceToEvent(m, lookups);
      if (e) out.push(e);
    }
    for (const a of data.leave || []) {
      const e = leaveToEvent(a, lookups);
      if (e) out.push(e);
    }
    for (const ws of data.work_schedules || []) {
      if (!ws.is_rest_day) continue;
      const driverObj = lookups.driversById.get(ws.driver_id);
      const driverName = driverObj
        ? [driverObj.first_name, driverObj.last_name].filter(Boolean).join(" ")
        : `Driver #${ws.driver_id}`;

      for (const day of days) {
        if (day.getDay() !== Number(ws.day_of_week)) continue;
        out.push({
          id: `rest-${ws.schedule_id}-${format(day, "yyyy-MM-dd")}`,
          kind: EVENT_KIND.REST_DAY,
          start: startOfDay(day),
          end: endOfDay(day),
          allDay: true,
          holdsResource: true,
          tone: "secondary",
          title: `Rest Day (${driverName || "Driver"})`,
          subtitle: `${DAY_NAMES[Number(ws.day_of_week)] || "Rest day"} weekly schedule`,
          driverId: ws.driver_id ?? null,
          driverDisplayName: driverName,
          raw: ws,
        });
      }
    }
    for (const v of data.vehicles || []) {
      if (!VEHICLE_DOWN.includes(v.vehicle_status)) continue;
      out.push(
        downtimeToEvent({
          kind: "vehicle",
          id: v.vehicle_id,
          label: `${v.plate_number || `Vehicle #${v.vehicle_id}`} · ${v.vehicle_status}`,
          detail: "Vehicle out of service",
          start,
          end,
          raw: v,
        })
      );
    }
    for (const d of data.drivers || []) {
      if (!DRIVER_DOWN.includes(d.driver_status)) continue;
      const name = [d.first_name, d.last_name].filter(Boolean).join(" ").trim();
      out.push(
        downtimeToEvent({
          kind: "driver",
          id: d.driver_id,
          label: `${name || `Driver #${d.driver_id}`} · ${d.driver_status}`,
          detail: "Driver unavailable",
          start,
          end,
          raw: d,
        })
      );
    }

    return out;
  }, [data, lookups, start, end, days]);

  // Detect conflicts across all events
  const conflicts = useMemo(() => findOverlaps(rawEvents), [rawEvents]);

  // Operational KPI metrics
  const conflictCount = useMemo(() => {
    let flags = 0;
    for (const list of conflicts.values()) flags += list.length;
    return Math.round(flags / 2);
  }, [conflicts]);

  const dispatchEvents = useMemo(
    () => rawEvents.filter((e) => e.kind === EVENT_KIND.DISPATCH),
    [rawEvents]
  );
  const dispatchCount = dispatchEvents.length;
  const activeCount = dispatchEvents.filter((e) => e.status === "In Progress" || e.isStartingSoon).length;
  const upcomingCount = dispatchEvents.filter((e) => e.status === "Scheduled").length;
  const unassignedCount = dispatchEvents.filter((e) => e.unassigned).length;
  const unassignedEvents = dispatchEvents.filter((e) => e.unassigned);
  const availableDriverCount = (data?.drivers || []).filter(
    (d) => d.driver_status === "Available"
  ).length;
  const availableVehicleCount = (data?.vehicles || []).filter(
    (v) => v.vehicle_status === "Available"
  ).length;
  const blockedCount =
    (data?.vehicles || []).filter((v) => VEHICLE_DOWN.includes(v.vehicle_status)).length +
    (data?.drivers || []).filter((d) => DRIVER_DOWN.includes(d.driver_status)).length;

  // Filter events based on search query, type filter, status filter
  const filteredEvents = useMemo(() => {
    return rawEvents.filter((e) => {
      // 1. Type filter
      if (typeFilter === "dispatches" && e.kind !== EVENT_KIND.DISPATCH) return false;
      if (typeFilter === "unassigned" && (!e.unassigned || e.kind !== EVENT_KIND.DISPATCH)) return false;
      if (typeFilter === "maintenance" && e.kind !== EVENT_KIND.MAINTENANCE) return false;
      if (
        typeFilter === "leave" &&
        e.kind !== EVENT_KIND.LEAVE &&
        e.kind !== EVENT_KIND.REST_DAY
      )
        return false;

      // 2. Status filter
      if (statusFilter !== "all" && e.status !== statusFilter) return false;

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = e.title?.toLowerCase().includes(q);
        const matchesGuest = e.guestName?.toLowerCase().includes(q);
        const matchesDriver = e.driverDisplayName?.toLowerCase().includes(q);
        const matchesVehicle = e.vehicleDisplayName?.toLowerCase().includes(q);
        const matchesRoute =
          e.pickupLocation?.toLowerCase().includes(q) ||
          e.dropoffLocation?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesGuest && !matchesDriver && !matchesVehicle && !matchesRoute) {
          return false;
        }
      }

      return true;
    });
  }, [rawEvents, typeFilter, statusFilter, searchQuery]);

  const today = useCallback(() => setAnchor(new Date()), []);
  const step = useCallback(
    (dir) => setAnchor((a) => shiftAnchor(effectiveView, a, dir)),
    [effectiveView]
  );

  // Keyboard navigation shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (
        target &&
        typeof target.closest === "function" &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          step(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          step(1);
          break;
        case "t":
        case "T":
          today();
          break;
        case "d":
        case "D":
          setLaneMode(LANE.DRIVER);
          setView(CALENDAR_VIEW.DAY);
          break;
        case "w":
        case "W":
          setLaneMode(LANE.NONE);
          setView(CALENDAR_VIEW.WEEK);
          break;
        case "m":
        case "M":
          setLaneMode(LANE.NONE);
          setView(CALENDAR_VIEW.MONTH);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, today]);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-surface shadow-sm">
              <CalendarDays className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-[22px] font-bold tracking-tight text-foreground">
                Dispatcher Calendar
              </h1>
              <p className="text-xs text-foreground-secondary">
                <span className="font-semibold text-primary">Today</span>
                {" · "}
                <span className="font-data tabular-nums">{format(new Date(), "EEE, MMM d, yyyy")}</span>
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-full" asChild>
            <Link href="/dispatch">
              <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
              Dispatch board
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="rounded-full" asChild>
            <Link href="/reservations/queue">
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Reservation queue
            </Link>
          </Button>
        </div>
      </header>

      {/* Reference-led operational KPI row */}
      <section aria-label="Dispatch summary" className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <StatCard
          icon={CarFront}
          value={dispatchCount}
          label="Total trips"
          trend="In this date window"
          tone="info"
          className="min-h-28 rounded-2xl p-3"
          onClick={() => {
            setTypeFilter("all");
            setStatusFilter("all");
          }}
          active={typeFilter === "all" && statusFilter === "all"}
        />
        <StatCard icon={CalendarDays} value={upcomingCount} label="Upcoming" trend="Scheduled trips" tone="primary" className="min-h-28 rounded-2xl p-3" />
        <StatCard icon={Sparkles} value={activeCount} label="In progress" trend="Active or starting soon" tone="success" className="min-h-28 rounded-2xl p-3" />
        <StatCard
          icon={AlertTriangle}
          value={unassignedCount}
          label="Unassigned"
          trend="Trips needing resources"
          tone="warning"
          className="min-h-28 rounded-2xl p-3"
          onClick={() => setTypeFilter((f) => (f === "unassigned" ? "all" : "unassigned"))}
          active={typeFilter === "unassigned"}
        />
        <StatCard
          icon={conflictCount > 0 ? AlertTriangle : CheckCircle2}
          value={conflictCount}
          label="Needs attention"
          trend={conflictCount > 0 ? "Scheduling conflicts" : "No conflicts detected"}
          tone={conflictCount > 0 ? "danger" : "success"}
          className="min-h-28 rounded-2xl p-3"
        />
        <StatCard icon={Users} value={availableDriverCount} label="Available drivers" trend={`of ${(data?.drivers || []).length}`} tone="success" className="min-h-28 rounded-2xl p-3" />
        <StatCard icon={CarFront} value={availableVehicleCount} label="Available vehicles" trend={`of ${(data?.vehicles || []).length}`} tone="info" className="min-h-28 rounded-2xl p-3" />
      </section>

      {unassignedEvents.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-danger/40 bg-danger/5" aria-label="Trips needing assignment">
          <div className="flex items-center justify-between border-b border-danger/20 px-4 py-2.5">
            <div className="flex items-center gap-2 text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <h2 className="text-xs font-bold uppercase tracking-wide">Needs assignment</h2>
              <span className="rounded-full bg-danger px-1.5 py-0.5 font-data text-[10px] font-bold text-white">
                {unassignedCount}
              </span>
            </div>
            <button type="button" onClick={() => setTypeFilter("unassigned")} className="text-xs font-bold text-danger hover:underline">
              View all
            </button>
          </div>
          <div className="grid divide-y divide-danger/20 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            {unassignedEvents.slice(0, 2).map((event) => (
              <article key={event.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
                <p className="font-data shrink-0 text-sm font-bold tabular-nums text-danger">
                  {formatTime(event.start)}
                </p>
                <div className="min-w-0 flex-1 border-l border-danger/20 pl-3">
                  <p className="truncate text-sm font-bold text-foreground">
                    {event.pickupLocation || "Pickup"} → {event.dropoffLocation || "Destination"}
                  </p>
                  <p className="truncate text-[11px] text-foreground-secondary">
                    {event.title} · {event.unassignedDriver ? "Driver" : "Vehicle"} unassigned
                  </p>
                </div>
                <Button size="sm" className="h-8 shrink-0 rounded-full bg-danger px-4 text-xs text-white hover:bg-danger/90" asChild>
                  <Link href={`/dispatch/${event.dispatchId}`}>Assign now</Link>
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="hidden items-center gap-x-3 text-xs text-foreground-muted xl:flex">
        <LegendDot className="bg-info" label="Scheduled" />
        <LegendDot className="bg-warning" label="In progress" />
        <LegendDot className="bg-success" label="Completed" />
        <LegendDot className="bg-danger" label="Maintenance" />
        <LegendDot className="bg-foreground-muted" label="Leave / rest" />
        {blockedCount > 0 && <span className="ml-auto font-medium">{blockedCount} resources out of service</span>}
      </div>

      {/* Main Controls Double-Bezel Bar */}
      <section
        aria-label="Calendar controls"
        className="rounded-[2rem] border border-border/60 bg-gradient-to-b from-border/40 to-border/15 p-1.5 shadow-xs"
      >
        <div className="flex flex-col gap-3 rounded-3xl bg-surface p-2.5 lg:flex-row lg:items-center lg:justify-between">
          {/* Left: Navigation & Date Jump */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-full border border-border/70 bg-surface p-0.5 shadow-2xs">
              <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Previous period" className="h-8 w-8 rounded-full">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={today} className="h-8 rounded-full px-3 text-xs font-bold">
                Today
              </Button>
              <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Next period" className="h-8 w-8 rounded-full">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <JumpToDate anchor={anchor} onPick={(day) => setAnchor(day)} />

            <p className="text-sm font-bold tracking-tight text-foreground px-1">
              {titleFor(effectiveView, anchor, days)}
            </p>

            {!isLoading && isFetching && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
                Syncing…
              </span>
            )}
          </div>

          {/* Right: View Switchers & Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* View Selector */}
            <PillGroup label="Calendar view">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={effectiveView === v.id}
                  onClick={() => {
                    setView(v.id);
                    setLaneMode(v.id === CALENDAR_VIEW.DAY ? LANE.DRIVER : LANE.NONE);
                  }}
                  className={cn(
                    PILL_BASE,
                    effectiveView === v.id
                      ? "bg-primary text-white shadow-xs dark:text-slate-950"
                      : "text-foreground-secondary hover:bg-hover hover:text-foreground"
                  )}
                >
                  {v.label}
                </button>
              ))}
            </PillGroup>

            {/* Density Switch */}
            {laneMode === LANE.NONE && effectiveView !== CALENDAR_VIEW.MONTH && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-full text-xs font-semibold gap-1 px-2.5"
                onClick={() =>
                  setDensity((d) =>
                    d === CALENDAR_DENSITY.COMFORTABLE
                      ? CALENDAR_DENSITY.COMPACT
                      : CALENDAR_DENSITY.COMFORTABLE
                  )
                }
              >
                {density === CALENDAR_DENSITY.COMFORTABLE ? (
                  <>
                    <Minimize2 className="w-3 h-3 text-foreground-muted" />
                    <span>Compact</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3 h-3 text-foreground-muted" />
                    <span>Comfortable</span>
                  </>
                )}
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              disabled={isFetching}
              onClick={() => refetch()}
              aria-label="Refresh calendar"
              className="h-8 w-8 rounded-full"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-3 py-2 mt-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search guest, driver, vehicle plate…"
                className="w-full bg-surface rounded-full border border-border/80 pl-8 pr-7 py-1 text-xs text-foreground placeholder:text-foreground-muted outline-none focus:border-primary transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Type Filters */}
            <div className="flex items-center gap-1">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTypeFilter(f.id)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                    typeFilter === f.id
                      ? "bg-foreground text-background"
                      : "bg-surface-secondary/60 text-foreground-secondary hover:bg-hover hover:text-foreground"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {(searchQuery || typeFilter !== "all" || statusFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setTypeFilter("all");
                setStatusFilter("all");
              }}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      </section>

      {/* Calendar Board Surface */}
      {isError ? (
        <div className="rounded-3xl border border-danger/30 bg-danger/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 w-5 h-5 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-foreground">Could not load the calendar</p>
              <p className="mt-0.5 text-xs text-foreground-secondary">
                {error?.message || "The request failed."}
              </p>
              <Button variant="outline" size="sm" className="mt-3 rounded-full" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      ) : isLoading ? (
        <div className="rounded-3xl border border-border bg-surface p-4 space-y-3">
          <Skeleton className="h-10 w-full rounded-2xl" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-64 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-xs shadow-black/[0.03]">
          {laneMode !== LANE.NONE ? (
            <LaneGrid
              mode={laneMode}
              day={days[0]}
              events={filteredEvents}
              conflicts={conflicts}
              vehicles={data?.vehicles || []}
              drivers={data?.drivers || []}
              onSelectEvent={(e) => setSelectedEvent(e)}
            />
          ) : effectiveView === CALENDAR_VIEW.MONTH ? (
            <MonthGrid
              days={days}
              events={filteredEvents}
              conflicts={conflicts}
              anchor={anchor}
              onPickDay={(day) => {
                setAnchor(day);
                setView(CALENDAR_VIEW.DAY);
                setLaneMode(LANE.DRIVER);
              }}
              onSelectEvent={(e) => setSelectedEvent(e)}
            />
          ) : (
            <TimeGrid
              days={days}
              events={filteredEvents}
              conflicts={conflicts}
              density={density}
              onSelectEvent={(e) => setSelectedEvent(e)}
            />
          )}

          {filteredEvents.length === 0 && (
            <EmptyState
              icon={CalendarDays}
              title="No schedules match the selected filters"
              description="Try adjusting your search query, type filter, or date window."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setTypeFilter("all");
                    setStatusFilter("all");
                  }}
                  className="rounded-full"
                >
                  Reset all filters
                </Button>
              }
            />
          )}
        </div>
      )}

      {/* Operational Detail Drawer Modal */}
      <CalendarDetailDrawer
        key={selectedEvent?.id || "closed"}
        event={selectedEvent}
        conflicts={conflicts}
        open={!!selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
      />
    </div>
  );
}

function LegendDot({ className, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", className)} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
