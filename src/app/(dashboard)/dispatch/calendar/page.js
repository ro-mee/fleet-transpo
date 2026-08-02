"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, isSameMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeGrid, MonthGrid } from "@/components/dispatch/calendar-grids";
import { LaneGrid } from "@/components/dispatch/calendar-lanes";
import { useRequireRole } from "@/lib/auth/role-guard";
import { getDispatchCalendar } from "@/services/dispatch.service";
import {
  CALENDAR_VIEW,
  LANE,
  dispatchToEvent,
  downtimeToEvent,
  findOverlaps,
  leaveToEvent,
  maintenanceToEvent,
  rangeFor,
  shiftAnchor,
} from "@/lib/scheduling/calendar";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  CarFront,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  RefreshCw,
  TriangleAlert,
  Users,
} from "lucide-react";

// Phase 16 — the dispatch calendar.
//
// The board answers "what is the state of this dispatch"; the calendar answers
// "does this plan hold together". So it draws committed trips beside the reasons
// a resource cannot run one — maintenance windows, driver leave, standing
// downtime — and outlines anything that collides. A dispatch drawn on top of a
// maintenance bar is a mistake you can see without reading a single field.
//
// Overlap detection is client-side, in lib/scheduling/calendar.js, using the
// same half-open rule the dispatch INSERT enforces server-side. The server owns
// enforcement; this owns visibility.
const REFETCH_MS = 60_000;

const VIEWS = [
  { id: CALENDAR_VIEW.DAY, label: "Day" },
  { id: CALENDAR_VIEW.WEEK, label: "Week" },
  { id: CALENDAR_VIEW.MONTH, label: "Month" },
];

const LANE_MODES = [
  { id: LANE.NONE, label: "Combined", icon: LayoutGrid },
  { id: LANE.VEHICLE, label: "By vehicle", icon: CarFront },
  { id: LANE.DRIVER, label: "By driver", icon: Users },
];

/** Statuses that mean a resource is out of service regardless of any booking. */
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
export default function DispatchCalendarPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);

  const [view, setView] = useState(CALENDAR_VIEW.WEEK);
  const [laneMode, setLaneMode] = useState(LANE.NONE);
  const [anchor, setAnchor] = useState(() => new Date());

  // Lanes only make sense for a single day, so switching to one narrows the
  // view rather than rendering a week of unreadable slivers.
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

  // Four row shapes become one comparable event stream. Standing downtime has no
  // dates of its own, so it is stamped across the whole visible window — we know
  // the resource is out, we do not know until when.
  const events = useMemo(() => {
    if (!data) return [];
    const out = [];

    for (const d of data.dispatches || []) {
      const e = dispatchToEvent(d);
      if (e) out.push(e);
    }
    for (const m of data.maintenance || []) {
      const e = maintenanceToEvent(m);
      if (e) out.push(e);
    }
    for (const a of data.leave || []) {
      const e = leaveToEvent(a);
      if (e) out.push(e);
    }
    for (const v of data.vehicles || []) {
      if (!VEHICLE_DOWN.includes(v.vehicle_status)) continue;
      out.push(
        downtimeToEvent({
          kind: "vehicle",
          id: v.vehicle_id,
          label: `${v.plate_number} · ${v.vehicle_status}`,
          detail: "Vehicle downtime",
          start,
          end,
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
        })
      );
    }

    return out;
  }, [data, start, end]);

  const conflicts = useMemo(() => findOverlaps(events), [events]);

  const conflictCount = useMemo(() => {
    // Each collision flags both participants; count pairs, not flags.
    let flags = 0;
    for (const list of conflicts.values()) flags += list.length;
    return Math.round(flags / 2);
  }, [conflicts]);

  const dispatchCount = events.filter((e) => e.kind === "dispatch").length;
  const today = () => setAnchor(new Date());
  const step = (dir) => setAnchor((a) => shiftAnchor(effectiveView, a, dir));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Dispatch Calendar"
        description="Committed trips beside the maintenance, leave, and downtime that constrain them."
        actions={
          <Button variant="outline" asChild>
            <Link href="/dispatch">
              <LayoutGrid className="w-4 h-4 mr-2" />
              Board
            </Link>
          </Button>
        }
      />

      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Previous">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={today}>
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-sm font-medium text-foreground">
            {titleFor(effectiveView, anchor, days)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View switch. Disabled under lanes, which are inherently per-day. */}
          <div
            className="flex rounded-lg border border-border p-0.5"
            role="tablist"
            aria-label="Calendar view"
          >
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={effectiveView === v.id}
                disabled={laneMode !== LANE.NONE}
                onClick={() => setView(v.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                  effectiveView === v.id
                    ? "bg-foreground text-surface"
                    : "text-foreground-secondary hover:bg-hover"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Grouping">
            {LANE_MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={laneMode === m.id}
                  onClick={() => setLaneMode(m.id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    laneMode === m.id
                      ? "bg-foreground text-surface"
                      : "text-foreground-secondary hover:bg-hover"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {m.label}
                </button>
              );
            })}
          </div>

          <Button
            variant="ghost"
            size="icon"
            disabled={isFetching}
            onClick={() => refetch()}
            aria-label="Refresh the calendar"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Legend + conflict count. The count is the calendar's headline: it is the
          one number that says whether the plan holds together. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="text-foreground-secondary">
          <span className="font-data font-medium text-foreground">{dispatchCount}</span> dispatch
          {dispatchCount === 1 ? "" : "es"} in view
        </span>
        {conflictCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-2 py-1 font-medium text-danger">
            <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />
            {conflictCount} conflict{conflictCount === 1 ? "" : "s"}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-3 text-foreground-muted">
          <Legend className="bg-info/40" label="Scheduled" />
          <Legend className="bg-warning/40" label="In progress" />
          <Legend className="bg-success/40" label="Completed" />
          <Legend className="bg-danger/40" label="Maintenance" />
          <Legend className="bg-hover border border-border" label="Downtime / cancelled" />
        </span>
      </div>

      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 w-5 h-5 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Could not load the calendar</p>
              <p className="mt-0.5 text-sm text-foreground-secondary">
                {error?.message || "The request failed."}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      ) : isLoading ? (
        <div className="rounded-xl border border-border bg-surface p-3">
          <Skeleton className="h-8 w-full" />
          <div className="mt-2 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {laneMode !== LANE.NONE ? (
            <LaneGrid
              mode={laneMode}
              day={days[0]}
              events={events}
              conflicts={conflicts}
              vehicles={data?.vehicles || []}
              drivers={data?.drivers || []}
            />
          ) : effectiveView === CALENDAR_VIEW.MONTH ? (
            <MonthGrid
              days={days}
              events={events}
              conflicts={conflicts}
              anchor={anchor}
              onPickDay={(day) => {
                setAnchor(day);
                setView(CALENDAR_VIEW.DAY);
              }}
            />
          ) : (
            <TimeGrid days={days} events={events} conflicts={conflicts} />
          )}

          {events.length === 0 && (
            <EmptyState
              icon={CalendarDays}
              title="Nothing scheduled in this window"
              description="Dispatches appear here once approved requests are dispatched from the queue."
              action={
                <Button size="sm" asChild>
                  <Link href="/reservations/queue">Go to the queue</Link>
                </Button>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ className, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-sm", className)} aria-hidden="true" />
      {label}
    </span>
  );
}
