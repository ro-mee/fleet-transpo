"use client";

import { useEffect, useMemo, useState } from "react";
import { format, isSameDay } from "date-fns";
import { CalendarEvent } from "@/components/dispatch/calendar-event";
import { EmptyState } from "@/components/ui/empty-state";
import { dayPosition, onDay, packColumns } from "@/lib/scheduling/calendar";
import { cn } from "@/lib/utils";
import { CarFront, Clock, Search, Users, X } from "lucide-react";

const LANE_HEADER_PX = 248;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function laneSpan(event, day) {
  const pos = dayPosition(event, day);
  return { leftPct: pos.top, widthPct: pos.height };
}

function statusDotClass(resource) {
  if (resource.unavailable) return "bg-danger ring-4 ring-danger/10";
  if (resource.detail?.includes("On Trip") || resource.detail?.includes("In Use")) return "bg-info";
  return "bg-success";
}

function initials(label) {
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function NowLine({ pct }) {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-20 w-px bg-danger/75 shadow-[2px_0_8px_rgba(239,68,68,0.18)]"
      style={{ left: `${pct}%` }}
      aria-hidden="true"
    />
  );
}

function LaneRow({ resource, events, conflicts, day, monoLabel, nowPct, onSelectEvent }) {
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

  const height = Math.max(64, rows.length * 40 + 16);

  return (
    <div className="group/lane flex border-b border-border/60 bg-surface last:border-b-0 transition-colors duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-hover/35">
      {/* Resource Column Header */}
      <div
        className={cn(
          "sticky left-0 z-20 flex shrink-0 items-center gap-3 border-r border-border/60 bg-surface px-4 py-2 transition-colors duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/lane:bg-hover",
          resource.unavailable && "bg-danger/[0.035] group-hover/lane:bg-danger/[0.06]"
        )}
        style={{ width: LANE_HEADER_PX }}
      >
        <span className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-[11px] font-bold tracking-tight text-foreground ring-1 ring-border/60",
          resource.unavailable && "bg-danger/10 text-danger ring-danger/20"
        )}>
          {initials(resource.label)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(resource))}
          />
            <span className={cn("truncate text-xs font-bold tracking-[-0.01em] text-foreground", monoLabel && "font-data")}>
            {resource.label}
          </span>
          {events.length > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-hover px-1.5 font-data text-[10px] font-bold text-foreground-secondary ring-1 ring-border/50">
              {events.length}
            </span>
          )}
        </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px]">
            <span className="truncate text-foreground-muted">{resource.detail || "No additional details"}</span>
            <span className={cn("ml-auto shrink-0 font-semibold", resource.unavailable ? "text-danger" : "text-foreground-secondary")}>
              {resource.status}
            </span>
          </div>
        </div>
      </div>

      {/* Timeline track */}
      <div className={cn("relative min-w-0 flex-1", resource.unavailable && "bg-danger/[0.018]")} style={{ height }}>
        {nowPct != null && (
          <div
            className="pointer-events-none absolute inset-y-0 bg-danger/[0.025]"
            style={{ left: `${Math.max(0, nowPct - 2.08)}%`, width: "4.16%" }}
            aria-hidden="true"
          />
        )}
        {/* Hour vertical grid lines */}
        {HOURS.map((h) => (
          <div
            key={h}
            className={cn(
              "absolute inset-y-0 border-l",
              h % 4 === 0 ? "border-border/60" : "border-border/25"
            )}
            style={{ left: `${(h / 24) * 100}%` }}
            aria-hidden="true"
          />
        ))}

        {nowPct != null && <NowLine pct={nowPct} />}

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
                onSelect={onSelectEvent}
                style={{
                  left: `calc(${leftPct}% + 2px)`,
                  width: `calc(${Math.max(widthPct, 4)}% - 4px)`,
                  top: rowIndex * 40 + 10,
                  height: 36,
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export function LaneGrid({
  mode,
  day,
  events,
  conflicts,
  vehicles = [],
  drivers = [],
  onSelectEvent,
}) {
  const isVehicle = mode === "vehicle";
  const [filterQuery, setFilterQuery] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const nowPct = isSameDay(day, now)
    ? ((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * 100
    : null;

  const resources = useMemo(() => {
    if (isVehicle) {
      return vehicles.map((v) => ({
        key: `v-${v.vehicle_id}`,
        id: v.vehicle_id,
        label: v.plate_number || `Vehicle #${v.vehicle_id}`,
        detail: [v.make, v.model, v.seating_capacity ? `${v.seating_capacity} seats` : null]
          .filter(Boolean)
          .join(" · "),
        status: v.vehicle_status || "Unknown",
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
      detail: d.license_number ? `License ${d.license_number}` : "License not recorded",
      status: d.driver_status || "Unknown",
      unavailable: ["On Leave", "Suspended"].includes(d.driver_status),
    }));
  }, [isVehicle, vehicles, drivers]);

  const filteredResources = useMemo(() => {
    if (!filterQuery.trim()) return resources;
    const q = filterQuery.toLowerCase();
    return resources.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
    );
  }, [resources, filterQuery]);

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
            ? "Add a vehicle to the fleet to see its timeline lane."
            : "Add a driver to see their timeline lane."
        }
      />
    );
  }

  return (
    <div className="rounded-[22px] bg-border/25 p-1 ring-1 ring-black/[0.035] dark:ring-white/[0.055]">
      <div className="overflow-hidden rounded-[18px] bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_14px_32px_-28px_rgba(15,23,42,0.45)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex flex-col gap-3 border-b border-border/60 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" strokeWidth={1.6} aria-hidden="true" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              aria-label={`Filter ${isVehicle ? "vehicles" : "drivers"}`}
              placeholder={`Filter ${isVehicle ? "vehicles" : "drivers"}…`}
              className="h-10 w-full rounded-full bg-background/70 pl-10 pr-10 text-xs font-medium text-foreground shadow-[inset_0_0_0_1px_var(--br)] outline-none placeholder:text-foreground-muted focus-visible:shadow-[inset_0_0_0_2px_var(--primary),0_8px_20px_-16px_rgba(15,23,42,0.5)]"
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery("")}
                aria-label="Clear resource filter"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-foreground-muted transition-[transform,color,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-hover hover:text-foreground active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <div className="hidden items-center gap-3 text-[10px] font-semibold text-foreground-secondary md:flex">
              <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" />Available</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-danger" />Unavailable</span>
            </div>
            <span role="status" className="rounded-full bg-hover px-3 py-1.5 text-[11px] font-bold text-foreground-secondary ring-1 ring-border/50">
              {filteredResources.length === resources.length
                ? `${resources.length} ${isVehicle ? "vehicles" : "drivers"}`
                : `${filteredResources.length} of ${resources.length}`}
            </span>
          </div>
        </div>

        <div className="relative max-h-[calc(100dvh-18rem)] min-h-[360px] overscroll-contain overflow-auto [scrollbar-color:var(--br)_transparent] [scrollbar-width:thin]">
          <div className="min-w-[1040px]">
            <div className="sticky top-0 z-30 flex border-b border-border/60 bg-surface/95 shadow-[0_8px_20px_-20px_rgba(15,23,42,0.5)] backdrop-blur-md">
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center justify-between border-r border-border/60 bg-surface px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground-secondary"
                style={{ width: LANE_HEADER_PX }}
              >
                <span>{isVehicle ? "Vehicle fleet" : "Driver roster"}</span>
                <span className="font-data text-[10px] font-semibold normal-case tracking-normal text-foreground-muted">24 hours</span>
              </div>
              <div className="relative min-w-0 flex-1">
                {nowPct != null && (
                  <div
                    className="pointer-events-none absolute inset-y-0 z-20 -translate-x-1/2"
                    style={{ left: `${nowPct}%` }}
                    aria-hidden="true"
                  >
                    <span className="absolute left-1/2 top-1.5 flex -translate-x-1/2 items-center gap-1 rounded-full bg-danger px-2 py-1 font-data text-[9px] font-bold tabular-nums text-white shadow-[0_6px_16px_-8px_rgba(239,68,68,0.65)]">
                      <Clock className="h-2.5 w-2.5" strokeWidth={1.7} />
                      {format(now, "HH:mm")}
                    </span>
                  </div>
                )}
                {HOURS.filter((h) => h % 2 === 0).map((h) => (
                  <span
                    key={h}
                    className="absolute top-3 font-data text-[10px] font-semibold tabular-nums text-foreground-muted"
                    style={{ left: `${(h / 24) * 100}%` }}
                  >
                    {format(new Date(2000, 0, 1, h), "HH:mm")}
                  </span>
                ))}
                <div className="h-10" />
              </div>
            </div>

            {unassigned.length > 0 && (
              <div className="flex border-b border-warning/30 bg-warning/[0.035]">
                <div
                  className="sticky left-0 z-20 flex shrink-0 items-center gap-3 border-r border-warning/25 bg-warning/[0.04] px-4 py-2"
                  style={{ width: LANE_HEADER_PX }}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/10 text-warning ring-1 ring-warning/20">
                    <Users className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground">Unassigned trips</p>
                    <p className="text-[10px] text-warning">{unassigned.length} need a {isVehicle ? "vehicle" : "driver"}</p>
                  </div>
                </div>
                <div className="relative h-14 min-w-0 flex-1">
                  {unassigned.map((event) => {
                    const { leftPct, widthPct } = laneSpan(event, day);
                    return (
                      <CalendarEvent
                        key={event.id}
                        event={event}
                        conflicts={conflicts.get(event.id) || []}
                        compact
                        className="absolute z-10"
                        onSelect={onSelectEvent}
                        style={{
                          left: `calc(${leftPct}% + 4px)`,
                          width: `calc(${Math.max(widthPct, 4)}% - 8px)`,
                          top: 9,
                          height: 36,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {filteredResources.map((resource) => (
              <LaneRow
                key={resource.key}
                resource={resource}
                events={byResource.get(resource.key) || []}
                conflicts={conflicts}
                day={day}
                monoLabel={isVehicle}
                nowPct={nowPct}
                onSelectEvent={onSelectEvent}
              />
            ))}

            {filteredResources.length === 0 && (
              <div className="flex min-h-48 items-center justify-center px-6 text-center">
                <div>
                  <p className="text-sm font-bold text-foreground">No matching {isVehicle ? "vehicles" : "drivers"}</p>
                  <p className="mt-1 text-xs text-foreground-muted">Try a name, plate number, license, or status.</p>
                  <button type="button" onClick={() => setFilterQuery("")} className="mt-3 rounded-full bg-primary px-4 py-2 text-xs font-bold text-surface transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    Clear filter
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
