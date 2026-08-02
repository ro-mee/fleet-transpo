"use client";

import { useMemo } from "react";
import { format, isSameDay } from "date-fns";
import { CalendarEvent } from "@/components/dispatch/calendar-event";
import { EmptyState } from "@/components/ui/empty-state";
import { dayPosition, onDay, packColumns } from "@/lib/scheduling/calendar";
import { cn } from "@/lib/utils";
import { CarFront, Users } from "lucide-react";

// Vehicle / driver lanes — one row per resource, time running left to right.
//
// This is the view that answers "who is free at 14:00", which the day and week
// grids cannot: those stack every resource into one column, so an idle van looks
// identical to a van with no row at all. Here an empty lane is visibly empty.
//
// Only ever renders a single day. A week of lanes would be 7 × N rows of
// 5-minute-wide blocks — technically renderable, useless to read.

const LANE_HEADER_PX = 168;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Horizontal placement within a 24-hour lane, as percentages of the day. */
function laneSpan(event, day) {
  const pos = dayPosition(event, day);
  return { leftPct: pos.top, widthPct: pos.height };
}

function LaneRow({ resource, events, conflicts, day }) {
  // Stacked rows within a lane: two overlapping trips on the same vehicle are
  // the double-booking we are hunting, so they must be visible simultaneously
  // rather than one hiding the other.
  const rows = useMemo(() => {
    const placed = packColumns(events);
    const count = Math.max(1, ...placed.map((p) => Math.round(100 / p.widthPct)));
    const buckets = Array.from({ length: count }, () => []);
    for (const p of placed) {
      const row = Math.round(p.leftPct / p.widthPct);
      (buckets[row] || buckets[0]).push(p.event);
    }
    return buckets.filter((b) => b.length > 0);
  }, [events]);

  const height = Math.max(44, rows.length * 26 + 12);
  const blocked = resource.unavailable;

  return (
    <div className="flex border-b border-border last:border-b-0">
      <div
        className={cn(
          "shrink-0 border-r border-border px-3 py-2",
          blocked && "bg-hover/40"
        )}
        style={{ width: LANE_HEADER_PX }}
      >
        <p className="truncate text-xs font-medium text-foreground">{resource.label}</p>
        <p className="truncate text-[11px] text-foreground-muted">
          {resource.detail}
          {events.length > 0 && ` · ${events.length}`}
        </p>
      </div>

      <div className="relative min-w-0 flex-1" style={{ height }}>
        {HOURS.map((h) => (
          <div
            key={h}
            className={cn(
              "absolute inset-y-0 border-l",
              h % 6 === 0 ? "border-border" : "border-border/40"
            )}
            style={{ left: `${(h / 24) * 100}%` }}
            aria-hidden="true"
          />
        ))}

        {rows.map((rowEvents, rowIndex) =>
          rowEvents.map((event) => {
            const { leftPct, widthPct } = laneSpan(event, day);
            return (
              <CalendarEvent
                key={event.id}
                event={event}
                conflicts={conflicts.get(event.id) || []}
                compact
                className="absolute z-10"
                style={{
                  left: `calc(${leftPct}% + 1px)`,
                  width: `calc(${Math.max(widthPct, 2)}% - 2px)`,
                  top: rowIndex * 26 + 6,
                  height: 22,
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export function LaneGrid({ mode, day, events, conflicts, vehicles = [], drivers = [] }) {
  const isVehicle = mode === "vehicle";

  const resources = useMemo(() => {
    if (isVehicle) {
      return vehicles.map((v) => ({
        key: `v-${v.vehicle_id}`,
        id: v.vehicle_id,
        label: v.plate_number || `Vehicle #${v.vehicle_id}`,
        detail: [v.model || v.make, v.vehicle_status].filter(Boolean).join(" · "),
        unavailable: ["Under Maintenance", "Registration Expired", "Out of Service"].includes(
          v.vehicle_status
        ),
      }));
    }
    return drivers.map((d) => ({
      key: `d-${d.driver_id}`,
      id: d.driver_id,
      label:
        [d.first_name, d.last_name].filter(Boolean).join(" ").trim() || `Driver #${d.driver_id}`,
      detail: d.driver_status || "",
      unavailable: ["On Leave", "Suspended"].includes(d.driver_status),
    }));
  }, [isVehicle, vehicles, drivers]);

  const dayEvents = useMemo(() => events.filter((e) => onDay(e, day)), [events, day]);

  const byResource = useMemo(() => {
    const map = new Map(resources.map((r) => [r.key, []]));
    for (const event of dayEvents) {
      const id = isVehicle ? event.vehicleId : event.driverId;
      if (id == null) continue;
      const key = `${isVehicle ? "v" : "d"}-${id}`;
      if (map.has(key)) map.get(key).push(event);
    }
    return map;
  }, [dayEvents, resources, isVehicle]);

  // An unassigned dispatch belongs to no lane, and silently dropping it would
  // make the calendar lie about the day's workload — so it gets its own row.
  const unassigned = useMemo(
    () => dayEvents.filter((e) => (isVehicle ? e.vehicleId : e.driverId) == null),
    [dayEvents, isVehicle]
  );

  if (resources.length === 0) {
    return (
      <EmptyState
        icon={isVehicle ? CarFront : Users}
        title={isVehicle ? "No vehicles on file" : "No drivers on file"}
        description={
          isVehicle
            ? "Add a vehicle to the fleet to see its lane here."
            : "Add a driver to see their lane here."
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="flex border-b border-border bg-hover/30">
          <div
            className="shrink-0 border-r border-border px-3 py-1.5 text-[11px] font-medium text-foreground-muted"
            style={{ width: LANE_HEADER_PX }}
          >
            {isVehicle ? "Vehicle" : "Driver"}
            {isSameDay(day, new Date()) ? " · today" : ""}
          </div>
          <div className="relative min-w-0 flex-1">
            {HOURS.filter((h) => h % 3 === 0).map((h) => (
              <span
                key={h}
                className="absolute top-1 text-[10px] tabular-nums text-foreground-muted"
                style={{ left: `${(h / 24) * 100}%` }}
              >
                {format(new Date(2000, 0, 1, h), "HH:mm")}
              </span>
            ))}
            <div className="h-6" />
          </div>
        </div>

        {resources.map((resource) => (
          <LaneRow
            key={resource.key}
            resource={resource}
            events={byResource.get(resource.key) || []}
            conflicts={conflicts}
            day={day}
          />
        ))}

        {unassigned.length > 0 && (
          <LaneRow
            resource={{
              key: "unassigned",
              label: "Unassigned",
              detail: `no ${isVehicle ? "vehicle" : "driver"} yet`,
              unavailable: false,
            }}
            events={unassigned}
            conflicts={conflicts}
            day={day}
          />
        )}
      </div>
    </div>
  );
}
