"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { EVENT_KIND, KIND_LABEL } from "@/lib/scheduling/calendar";
import { cn, formatTime } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  CarFront,
  Clock,
  Coffee,
  Layers,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";

const KIND_ICON = {
  [EVENT_KIND.DISPATCH]: CarFront,
  [EVENT_KIND.MAINTENANCE]: Wrench,
  [EVENT_KIND.LEAVE]: User,
  [EVENT_KIND.REST_DAY]: Coffee,
  [EVENT_KIND.DOWNTIME]: CarFront,
};

const TONE_STYLES = {
  info: "bg-blue-500/10 text-foreground border-blue-500/30 hover:border-blue-500/60 hover:bg-blue-500/15 dark:bg-blue-950/30 dark:border-blue-700/40",
  warning: "bg-amber-500/10 text-foreground border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/15 dark:bg-amber-950/30 dark:border-amber-700/40",
  success: "bg-emerald-500/10 text-foreground border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/15 dark:bg-emerald-950/30 dark:border-emerald-700/40",
  danger: "bg-rose-500/10 text-foreground border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-500/15 dark:bg-rose-950/30 dark:border-rose-700/40",
  secondary: "bg-surface-secondary text-foreground-secondary border-border/80 hover:bg-hover hover:border-border",
  primary: "bg-primary/10 text-foreground border-primary/30 hover:border-primary/60 hover:bg-primary/15",
};

const SPINE_COLOR = {
  info: "bg-blue-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-rose-500",
  secondary: "bg-foreground-muted",
  primary: "bg-primary",
};

function eventTooltip(event, conflicts = []) {
  const lines = [];
  if (conflicts.length) {
    for (const c of conflicts) {
      lines.push(`Conflict: ${c.reason} (${c.detail || c.with?.title})`);
    }
  }
  if (event.isCluster) {
    lines.push(`${event.count} trips scheduled at this time`);
    lines.push(`Click to inspect all ${event.count} trips`);
    return lines.join("\n");
  }
  if (event.vip) lines.push("VIP guest");
  if (event.isStartingSoon) lines.push("Starting in less than 30 minutes");
  lines.push(`${KIND_LABEL[event.kind] || "Event"}: ${event.title}`);
  if (event.guestName) lines.push(`Guest: ${event.guestName} (${event.passengerCount || 1} pax)`);
  if (event.driverDisplayName) lines.push(`Driver: ${event.driverDisplayName}`);
  if (event.vehicleDisplayName) lines.push(`Vehicle: ${event.vehicleDisplayName}`);
  if (event.pickupLocation && event.dropoffLocation) {
    lines.push(`Route: ${event.pickupLocation} to ${event.dropoffLocation}`);
  }
  lines.push(
    event.allDay
      ? "All day"
      : `${formatTime(event.start)} - ${formatTime(event.end)}`
  );
  if (event.status) lines.push(`Status: ${event.status}`);
  return lines.join("\n");
}

export function CalendarEvent({
  event,
  conflicts = [],
  style,
  className,
  compact = false,
  density = "comfortable",
  showTime = true,
  onSelect,
}) {
  const isCluster = Boolean(event.isCluster && event.events?.length > 1);
  const displayEvent = event.primaryEvent || event;

  const Icon = KIND_ICON[displayEvent.kind] || CarFront;
  const conflicted = conflicts.length > 0;
  const cancelled = displayEvent.status === "Cancelled";
  const isDispatch = displayEvent.kind === EVENT_KIND.DISPATCH;
  const isComfortable = density === "comfortable" && !compact;

  const handleClick = (e) => {
    if (onSelect) {
      e.preventDefault();
      onSelect(event);
    }
  };

  const cardClasses = cn(
    "group/block relative block w-full cursor-pointer overflow-hidden rounded-[10px] border text-left",
    "transition-[background-color,border-color,box-shadow,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
    "motion-safe:hover:-translate-y-0.5 hover:z-30 hover:shadow-[0_10px_24px_-16px_rgba(15,23,42,0.45)] active:scale-[0.985]",
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
    TONE_STYLES[displayEvent.tone] || TONE_STYLES.secondary,
    displayEvent.kind === EVENT_KIND.DOWNTIME && "border-danger/20 bg-danger/[0.045] hover:border-danger/40 hover:bg-danger/[0.07]",
    conflicted && "ring-2 ring-rose-500/80 border-rose-500 shadow-rose-500/10",
    displayEvent.isStartingSoon && "ring-2 ring-amber-500/60 shadow-amber-500/10",
    isComfortable ? "p-2 pl-3.5" : "px-2.5 py-1.5 pl-3.5 text-[11px]",
    className
  );

  return (
    <Tooltip content={<span className="whitespace-pre-line text-xs">{eventTooltip(isCluster ? event : displayEvent, conflicts)}</span>}>
      <button
        type="button"
        onClick={handleClick}
        className={cardClasses}
        style={style}
      >
        {/* Left Status Accent Bar */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 w-0.5",
            SPINE_COLOR[displayEvent.tone] || SPINE_COLOR.secondary,
            conflicted && "bg-rose-500",
            "opacity-80 transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/block:opacity-100"
          )}
        />

        {/* NON-DISPATCH RESTRICTION (Leave / Maintenance / Rest / Downtime) */}
        {!isDispatch ? (
          <div className={cn("flex h-full min-w-0", compact ? "items-center gap-2" : "flex-col justify-center")}>
            <div className="flex min-w-0 items-center gap-2">
              {conflicted ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" strokeWidth={1.7} />
              ) : (
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.6} />
              )}
              <span className="truncate text-xs font-bold tracking-[-0.01em]">
                {displayEvent.title}
              </span>
            </div>
            {displayEvent.subtitle && !compact && (
              <span className="mt-0.5 truncate text-[10px] text-foreground-muted opacity-80">
                {displayEvent.subtitle}
              </span>
            )}
          </div>
        ) : isComfortable ? (
          /* ── COMFORTABLE EXPANDED DISPATCH CARD ── */
          <div className="flex flex-col justify-between h-full space-y-1.5 min-w-0">
            {/* Top Row: Time + Status / Badges */}
            <div className="flex items-center justify-between gap-1 flex-wrap">
              <span className="font-data text-[11px] font-bold text-foreground flex items-center gap-1">
                <Clock className="w-3 h-3 text-foreground-muted shrink-0" />
                {formatTime(displayEvent.start)} – {formatTime(displayEvent.end)}
              </span>

              <div className="flex items-center gap-1 shrink-0">
                {displayEvent.vip && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                    <Sparkles className="w-2.5 h-2.5" /> VIP
                  </span>
                )}
                {conflicted && (
                  <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.2 text-[9px] font-bold bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                    <AlertTriangle className="h-2.5 w-2.5" strokeWidth={1.8} /> Conflict
                  </span>
                )}
                {displayEvent.status && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider",
                      displayEvent.status === "Scheduled" && "bg-blue-500/20 text-blue-700 dark:text-blue-300",
                      displayEvent.status === "In Progress" && "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                      displayEvent.status === "Completed" && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
                      displayEvent.status === "Cancelled" && "bg-hover text-foreground-muted line-through"
                    )}
                  >
                    {displayEvent.status}
                  </span>
                )}
              </div>
            </div>

            {/* Middle Row: Guest / Booking Title */}
            <div className="min-w-0">
              <p className={cn("text-xs font-bold text-foreground truncate", cancelled && "line-through opacity-70")}>
                {displayEvent.guestName || displayEvent.title}
                {displayEvent.passengerCount ? ` (${displayEvent.passengerCount} pax)` : ""}
              </p>
              {displayEvent.guestName && displayEvent.title && (
                <p className="font-data text-[10px] text-foreground-muted truncate">
                  {displayEvent.title}
                </p>
              )}
            </div>

            {/* Route Breadcrumb */}
            {(displayEvent.pickupLocation || displayEvent.dropoffLocation) && (
              <div className="flex items-center gap-1 text-[10px] text-foreground-secondary leading-tight truncate">
                <span className="truncate max-w-[45%] font-medium">{displayEvent.pickupLocation || "Pickup"}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-foreground-muted" strokeWidth={1.6} aria-hidden="true" />
                <span className="truncate max-w-[45%] font-medium">{displayEvent.dropoffLocation || "Destination"}</span>
              </div>
            )}

            {/* Bottom Row: Driver & Vehicle Allocation */}
            <div className="flex flex-wrap items-center gap-1 text-[10px] pt-1 border-t border-border/50">
              {displayEvent.unassigned ? (
                <span className="inline-flex items-center gap-1 font-bold text-amber-700 dark:text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded border border-amber-500/30 text-[9.5px]">
                  <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                  {displayEvent.unassignedDriver && displayEvent.unassignedVehicle
                    ? "Needs Driver & Vehicle"
                    : displayEvent.unassignedDriver
                      ? "Needs Driver"
                      : "Needs Vehicle"}
                </span>
              ) : (
                <>
                  {displayEvent.driverDisplayName && (
                    <span className="inline-flex items-center gap-1 font-semibold text-foreground-secondary bg-surface/90 px-1.5 py-0.5 rounded border border-border/70 text-[10px] truncate max-w-full">
                      <User className="w-2.5 h-2.5 text-foreground-muted shrink-0" />
                      <span className="truncate">{displayEvent.driverDisplayName}</span>
                    </span>
                  )}
                  {displayEvent.vehicleDisplayName && (
                    <span className="inline-flex items-center gap-1 font-data font-bold text-foreground bg-surface/90 px-1.5 py-0.5 rounded border border-border/70 text-[10px] truncate max-w-full">
                      <CarFront className="w-2.5 h-2.5 text-foreground-muted shrink-0" />
                      <span className="truncate">{displayEvent.vehicleDisplayName}</span>
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Smart Cluster Footer if 2+ trips are in this slot */}
            {isCluster && (
              <div className="flex items-center justify-between border-t border-primary/20 bg-primary/10 -mx-2 -mb-2 p-1.5 px-2.5 mt-1 text-[10.5px] font-bold text-primary transition-colors hover:bg-primary/20">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  +{event.events.length - 1} more trip{event.events.length - 1 === 1 ? "" : "s"} at {formatTime(event.start)}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase font-semibold text-primary/80">
                  Inspect all <ArrowRight className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
                </span>
              </div>
            )}
          </div>
        ) : (
          /* Compact timeline and month-grid treatment */
          <div className="flex h-full min-w-0 items-center gap-2">
            <span className="font-data shrink-0 text-[10px] font-bold tabular-nums text-foreground">
              {formatTime(displayEvent.start)}
            </span>
            <span className={cn("min-w-0 flex-1 truncate text-[11px] font-bold tracking-[-0.01em] text-foreground", cancelled && "line-through opacity-70")}>
              {displayEvent.guestName || displayEvent.title}
            </span>
            {conflicted && <AlertTriangle className="h-3 w-3 shrink-0 text-danger" strokeWidth={1.8} aria-label="Conflict" />}
            {displayEvent.unassigned ? (
              <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[9px] font-bold text-warning ring-1 ring-warning/20">
                Unassigned
              </span>
            ) : displayEvent.status ? (
              <span
                className={cn(
                  "hidden shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold sm:inline-flex",
                  displayEvent.status === "Scheduled" && "bg-info/10 text-info ring-1 ring-info/20",
                  displayEvent.status === "In Progress" && "bg-warning/10 text-warning ring-1 ring-warning/20",
                  displayEvent.status === "Completed" && "bg-success/10 text-success ring-1 ring-success/20",
                  displayEvent.status === "Cancelled" && "bg-hover text-foreground-muted line-through ring-1 ring-border/50"
                )}
              >
                {displayEvent.status}
              </span>
            ) : null}
            {isCluster && (
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                +{event.events.length - 1}
              </span>
            )}
          </div>
        )}
      </button>
    </Tooltip>
  );
}
