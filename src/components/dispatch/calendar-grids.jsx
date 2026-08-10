"use client";

import { useMemo } from "react";
import { format, isSameDay, isSameMonth } from "date-fns";
import { CalendarEvent } from "@/components/dispatch/calendar-event";
import {
  dayPosition,
  groupByDay,
  onDay,
  packColumns,
} from "@/lib/scheduling/calendar";
import { cn } from "@/lib/utils";

// The two grid layouts the calendar switches between.
//
// TimeGrid (day/week) places blocks by clock position, so a 40-minute gap
// between trips is visible as a gap. MonthGrid trades that for span — you see
// the shape of the month but only the first few events per day.

const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Enough height that a 30-minute trip is still a readable block.
const HOUR_PX = 44;

function NowLine({ day }) {
  // Rendered from the same clock every other block uses; a minute of drift on a
  // reference line is not worth a re-render timer.
  const now = new Date();
  if (!isSameDay(day, now)) return null;
  const pct = ((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * 100;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
      style={{ top: `${pct}%` }}
      aria-hidden="true"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-danger" />
      <span className="h-px flex-1 bg-danger/70" />
    </div>
  );
}

export function TimeGrid({ days, events, conflicts, laneLabel }) {
  const allDayByDay = useMemo(
    () => groupByDay(events.filter((e) => e.allDay), days),
    [events, days]
  );
  const timedByDay = useMemo(
    () =>
      days.map((day) => ({
        day,
        placed: packColumns(events.filter((e) => !e.allDay && onDay(e, day))),
      })),
    [events, days]
  );

  const hasAllDay = allDayByDay.some((d) => d.events.length > 0);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* Day headers */}
        <div
          className="grid border-b border-border"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div className="px-2 py-2 text-[11px] font-medium text-foreground-muted">
            {laneLabel || ""}
          </div>
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={cn(
                "border-l border-border px-2 py-2 text-center",
                isSameDay(day, new Date()) && "bg-primary/5"
              )}
            >
              <div className="text-[11px] uppercase tracking-wide text-foreground-muted">
                {format(day, "EEE")}
              </div>
              <div
                className={cn(
                  "text-sm font-semibold",
                  isSameDay(day, new Date()) ? "text-primary" : "text-foreground"
                )}
              >
                {format(day, "d")}
              </div>
            </div>
          ))}
        </div>

        {/* All-day band: maintenance, leave, downtime. Only rendered when
            something occupies it, so a clear week costs no vertical space. */}
        {hasAllDay && (
          <div
            className="grid border-b border-border bg-hover/30"
            style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div className="px-2 py-1.5 text-[11px] font-medium text-foreground-muted">
              All day
            </div>
            {allDayByDay.map(({ day, events: dayEvents }) => (
              <div key={day.toISOString()} className="space-y-1 border-l border-border p-1">
                {dayEvents.map((event) => (
                  <CalendarEvent
                    key={event.id}
                    event={event}
                    conflicts={conflicts.get(event.id) || []}
                    showTime={false}
                    compact
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Timed body */}
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div className="relative" style={{ height: HOUR_PX * 24 }}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-foreground-muted"
                style={{ top: (h / 24) * 100 + "%" }}
              >
                {h === 0 ? "" : format(new Date(2000, 0, 1, h), "HH:mm")}
              </div>
            ))}
          </div>

          {timedByDay.map(({ day, placed }) => (
            <div
              key={day.toISOString()}
              className={cn(
                "relative border-l border-border",
                isSameDay(day, new Date()) && "bg-primary/[0.03]"
              )}
              style={{ height: HOUR_PX * 24 }}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border/50"
                  style={{ top: (h / 24) * 100 + "%" }}
                  aria-hidden="true"
                />
              ))}

              <NowLine day={day} />

              {placed.map(({ event, widthPct, leftPct }) => {
                const pos = dayPosition(event, day);
                return (
                  <CalendarEvent
                    key={event.id}
                    event={event}
                    conflicts={conflicts.get(event.id) || []}
                    className="absolute z-10"
                    compact={days.length > 1}
                    style={{
                      top: `${pos.top}%`,
                      height: `${pos.height}%`,
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MonthGrid({ days, events, conflicts, anchor, onPickDay }) {
  const byDay = useMemo(() => groupByDay(events, days), [events, days]);
  const weekdays = days.slice(0, 7);

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border">
        {weekdays.map((day) => (
          <div
            key={day.toISOString()}
            className="px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-foreground-muted"
          >
            {format(day, "EEE")}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {byDay.map(({ day, isToday, events: dayEvents }) => {
          const outside = !isSameMonth(day, anchor);
          const conflicted = dayEvents.filter((e) => conflicts.has(e.id)).length;
          const shown = dayEvents.slice(0, 3);

          return (
            <button
              type="button"
              key={day.toISOString()}
              onClick={() => onPickDay?.(day)}
              className={cn(
                "min-h-[7rem] border-b border-l border-border p-1 text-left align-top transition-colors hover:bg-hover",
                outside && "bg-hover/30",
                isToday && "bg-primary/5"
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-1 px-0.5">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    isToday
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white dark:text-slate-950"
                      : outside
                        ? "text-foreground-muted"
                        : "text-foreground"
                  )}
                >
                  {format(day, "d")}
                </span>
                {conflicted > 0 && (
                  <span className="rounded bg-danger/15 px-1 text-[11px] font-semibold text-danger">
                    {conflicted}
                  </span>
                )}
              </div>

              <div className="space-y-0.5">
                {shown.map((event) => (
                  <CalendarEvent
                    key={event.id}
                    event={event}
                    conflicts={conflicts.get(event.id) || []}
                    compact
                  />
                ))}
                {dayEvents.length > shown.length && (
                  <span className="block px-1 text-[11px] text-foreground-muted">
                    +{dayEvents.length - shown.length} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
