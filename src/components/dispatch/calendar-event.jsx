"use client";

import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";
import { EVENT_KIND, KIND_LABEL } from "@/lib/scheduling/calendar";
import { cn, formatTime } from "@/lib/utils";
import { CarFront, TriangleAlert, User, Wrench } from "lucide-react";

// One block on the calendar — a dispatch, or a reason a resource is unavailable.
//
// Conflicted blocks get a ring and a warning icon rather than a different fill:
// the fill already encodes status, and a dispatcher needs to read both at once
// ("the In Progress one is the double-booked one").
const KIND_ICON = {
  [EVENT_KIND.DISPATCH]: CarFront,
  [EVENT_KIND.MAINTENANCE]: Wrench,
  [EVENT_KIND.LEAVE]: User,
  [EVENT_KIND.DOWNTIME]: CarFront,
};

// Static class pairs — Tailwind cannot see interpolated class names.
const TONE_BLOCK = {
  info: "bg-info/15 text-info border-info/40 hover:bg-info/25",
  warning: "bg-warning/15 text-warning border-warning/40 hover:bg-warning/25",
  success: "bg-success/15 text-success border-success/40 hover:bg-success/25",
  danger: "bg-danger/15 text-danger border-danger/40 hover:bg-danger/25",
  secondary: "bg-hover text-foreground-secondary border-border hover:bg-hover/80",
  primary: "bg-primary/15 text-primary border-primary/40 hover:bg-primary/25",
};

/** What the tooltip says. Conflicts first — that is why the block is outlined. */
function eventTooltip(event, conflicts = []) {
  const lines = [];
  if (conflicts.length) {
    for (const c of conflicts) {
      lines.push(`⚠ ${c.reason}: ${c.with.title}`);
    }
  }
  lines.push(`${KIND_LABEL[event.kind]} · ${event.title}`);
  if (event.subtitle) lines.push(event.subtitle);
  lines.push(
    event.allDay
      ? "All day"
      : `${formatTime(event.start)} – ${formatTime(event.end)}`
  );
  if (event.status) lines.push(`Status: ${event.status}`);
  if (event.priority) lines.push(`Priority: ${event.priority}`);
  return lines.join("\n");
}

export function CalendarEvent({
  event,
  conflicts = [],
  style,
  className,
  compact = false,
  showTime = true,
}) {
  const Icon = KIND_ICON[event.kind] || CarFront;
  const conflicted = conflicts.length > 0;
  const cancelled = event.status === "Cancelled";

  const body = (
    <span className="flex min-w-0 items-center gap-1">
      {conflicted ? (
        <TriangleAlert className="w-3 h-3 shrink-0 text-danger" aria-hidden="true" />
      ) : (
        <Icon className="w-3 h-3 shrink-0 opacity-70" aria-hidden="true" />
      )}
      <span className={cn("truncate", cancelled && "line-through opacity-70")}>
        {showTime && !event.allDay && (
          <span className="font-data mr-1 opacity-80">{formatTime(event.start)}</span>
        )}
        {event.title}
      </span>
      {!compact && event.subtitle && (
        <span className="truncate opacity-70">· {event.subtitle}</span>
      )}
    </span>
  );

  const classes = cn(
    "block w-full overflow-hidden rounded border px-1.5 py-0.5 text-left text-[11px] leading-tight transition-colors",
    TONE_BLOCK[event.tone] || TONE_BLOCK.secondary,
    conflicted && "ring-2 ring-danger/70 ring-offset-1 ring-offset-surface",
    className
  );

  const content = event.href ? (
    <Link href={event.href} className={classes} style={style}>
      {body}
    </Link>
  ) : (
    <span className={classes} style={style}>
      {body}
    </span>
  );

  return (
    <Tooltip content={<span className="whitespace-pre-line">{eventTooltip(event, conflicts)}</span>}>
      {content}
    </Tooltip>
  );
}
