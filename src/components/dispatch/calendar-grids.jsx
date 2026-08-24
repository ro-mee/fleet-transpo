"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, isSameDay, isSameMonth } from "date-fns";
import { CalendarEvent } from "@/components/dispatch/calendar-event";
import {
  clusterDayEvents,
  dayPosition,
  groupByDay,
  onDay,
} from "@/lib/scheduling/calendar";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Live current time line */
function NowLine({ day, now }) {
  if (!isSameDay(day, now)) return null;
  const pct = ((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * 100;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
      style={{ top: `${pct}%` }}
      aria-hidden="true"
    >
      <span className="rounded-r-full bg-danger px-1.5 py-0.5 font-data text-[8px] font-bold uppercase tabular-nums text-white shadow-sm">
        Now {format(now, "h:mm a")}
      </span>
      <span className="h-px flex-1 bg-danger/75 shadow-[0_2px_8px_rgba(239,68,68,0.18)]" />
    </div>
  );
}

/** Off-hours + weekend underlays */
function DayUnderlay({ day }) {
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  return (
    <>
      {weekend && <div aria-hidden="true" className="absolute inset-0 bg-hover/18" />}
      {/* Off-hours (before 6 AM and after 9 PM) */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[25%] bg-hover/22" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[12.5%] bg-hover/22" />
    </>
  );
}

export function TimeGrid({
  days,
  events,
  conflicts,
  density = "comfortable",
  laneLabel,
  onSelectEvent,
}) {
  const scrollRef = useRef(null);
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const hourPx = days.length > 3 ? 72 : density === "comfortable" ? 96 : 56;
  const isCompact = density === "compact";
  const compactEvents = isCompact || days.length > 3;

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const allDayByDay = useMemo(
    () => groupByDay(events.filter((e) => e.allDay), days),
    [events, days]
  );

  // Cluster overlapping events into clean time slot cards
  const timedByDay = useMemo(
    () =>
      days.map((day) => ({
        day,
        clusters: clusterDayEvents(events, day),
      })),
    [events, days]
  );

  const totalAllDayCount = allDayByDay.reduce((acc, d) => acc + d.events.length, 0);
  const hasAllDay = totalAllDayCount > 0;

  // Scroll to current hour on load
  const windowKey = `${days[0]?.toISOString() ?? ""}:${days.length}`;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const body = scroller.querySelector("[data-timed-body]");
    if (!body) return;

    const current = new Date();
    const hasToday = days.some((day) => isSameDay(day, current));
    const pct = hasToday
      ? (current.getHours() * 60 + current.getMinutes()) / (24 * 60)
      : 6 / 24;
    const target = body.offsetTop + body.offsetHeight * pct - scroller.clientHeight * 0.35;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }, [windowKey, days]);

  return (
    <div className="rounded-[22px] bg-border/25 p-1 ring-1 ring-black/[0.035] dark:ring-white/[0.055]">
      <div className="overflow-hidden rounded-[18px] bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_14px_32px_-28px_rgba(15,23,42,0.45)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div
          ref={scrollRef}
          className="relative max-h-[calc(100dvh-16rem)] min-h-[440px] overscroll-contain overflow-auto [scrollbar-color:var(--br)_transparent] [scrollbar-width:thin]"
        >
          <div className={cn("min-w-[720px]", days.length > 3 && "min-w-[1120px]")}>
        {/* Sticky Day Headers */}
        <div
              className="sticky top-0 z-30 grid border-b border-border/60 bg-surface/95 shadow-[0_8px_20px_-20px_rgba(15,23,42,0.5)] backdrop-blur-md"
          style={{ gridTemplateColumns: `4.5rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
              <div className="sticky left-0 z-10 flex items-center justify-center bg-surface/95 px-2.5 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-secondary">
            {laneLabel || "Time"}
          </div>
          {days.map((day) => {
            const isToday = isSameDay(day, new Date());
            return (
              <div
                key={day.toISOString()}
                className={cn(
                      "border-l border-border/60 px-3 py-3 text-center transition-colors duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      isToday && "bg-primary/[0.045]"
                )}
              >
                    <div className={cn("text-[10px] font-bold uppercase tracking-[0.12em]", isToday ? "text-primary" : "text-foreground-muted")}>
                  {format(day, "EEE")}
                </div>
                <div
                  className={cn(
                        "mt-1 font-data text-sm font-bold tabular-nums",
                    isToday
                          ? "inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2.5 text-white shadow-[0_6px_16px_-10px_rgba(15,23,42,0.7)] dark:text-slate-950"
                      : "text-foreground"
                  )}
                >
                  {format(day, "d MMM")}
                </div>
              </div>
            );
          })}
        </div>

        {/* Smart All-Day Availability Restrictions Band */}
        {hasAllDay && (
          <div
                className="grid border-b border-border/60 bg-background/45"
            style={{ gridTemplateColumns: `4.5rem repeat(${days.length}, minmax(0, 1fr))` }}
          >
                <div className="sticky left-0 z-10 flex flex-col items-center justify-center gap-1 bg-surface/95 px-2 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-foreground-muted">
              <span>All day</span>
              {totalAllDayCount > 2 && (
                <button
                  type="button"
                  onClick={() => setAllDayExpanded((v) => !v)}
                      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-primary transition-colors duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                  {allDayExpanded ? "Collapse" : "Expand"}
                      {allDayExpanded ? <ChevronUp className="h-2.5 w-2.5" strokeWidth={1.6} /> : <ChevronDown className="h-2.5 w-2.5" strokeWidth={1.6} />}
                </button>
              )}
            </div>

            {allDayByDay.map(({ day, events: dayEvents }) => {
              const displayEvents = allDayExpanded ? dayEvents : dayEvents.slice(0, 2);
              const hiddenCount = dayEvents.length - displayEvents.length;

              return (
                    <div key={day.toISOString()} className="min-h-[44px] space-y-1 border-l border-border/60 p-1.5">
                  {displayEvents.map((event) => (
                    <CalendarEvent
                      key={event.id}
                      event={event}
                      conflicts={conflicts.get(event.id) || []}
                      showTime={false}
                      compact
                      onSelect={onSelectEvent}
                    />
                  ))}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setAllDayExpanded(true)}
                          className="block rounded-full px-2 py-1 text-[10px] font-semibold text-primary transition-colors duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    >
                      +{hiddenCount} more restrictions
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Timed Body */}
        <div
          data-timed-body
          className="relative grid"
          style={{ gridTemplateColumns: `4.5rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {/* Hour labels on left gutter */}
          <div
                className="sticky left-0 z-20 border-r border-border/60 bg-surface"
            style={{ height: hourPx * 24 }}
          >
            {HOURS.map((h) => (
              <div
                key={h}
                className={cn(
                  "absolute right-2 -translate-y-1/2 text-[11px] font-data tabular-nums select-none",
                      h % 4 === 0 ? "font-bold text-foreground" : "text-foreground-muted",
                  h === 0 && "opacity-0"
                )}
                style={{ top: `${(h / 24) * 100}%` }}
              >
                {h === 0 ? "" : format(new Date(2000, 0, 1, h), "HH:mm")}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {timedByDay.map(({ day, clusters }) => (
            <div
              key={day.toISOString()}
              className={cn(
                    "relative border-l border-border/60",
                    isSameDay(day, now) && "bg-primary/[0.018]"
              )}
              style={{ height: hourPx * 24 }}
            >
              <DayUnderlay day={day} />

              {/* Hour horizontal grid lines */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className={cn(
                    "absolute inset-x-0 border-t",
                        h % 4 === 0 ? "border-border/60" : "border-border/25"
                  )}
                  style={{ top: `${(h / 24) * 100}%` }}
                  aria-hidden="true"
                />
              ))}

              {/* Real-time Now Line */}
                  <NowLine day={day} now={now} />

              {/* Scheduled Smart Slot Cluster Cards */}
              {clusters.map((cluster) => {
                const pos = dayPosition(cluster, day);
                const clusterConflicts = cluster.events.flatMap(
                  (e) => conflicts.get(e.id) || []
                );

                return (
                  <CalendarEvent
                    key={cluster.id}
                    event={cluster}
                    conflicts={clusterConflicts}
                    density={density}
                        compact={compactEvents}
                    className="absolute z-10 hover:z-30"
                    onSelect={onSelectEvent}
                    style={{
                      top: `${pos.top}%`,
                      height: `${pos.height}%`,
                      left: "3px",
                      width: "calc(100% - 6px)",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MonthGrid({ days, events, conflicts, anchor, onPickDay, onSelectEvent }) {
  const byDay = useMemo(() => groupByDay(events, days), [events, days]);
  const weekdays = days.slice(0, 7);

  return (
    <div className="rounded-[22px] bg-border/25 p-1 ring-1 ring-black/[0.035] dark:ring-white/[0.055]">
      <div className="overflow-auto rounded-[18px] bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_14px_32px_-28px_rgba(15,23,42,0.45)] [scrollbar-color:var(--br)_transparent] [scrollbar-width:thin] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="min-w-[920px]">
          <div className="sticky top-0 z-20 grid grid-cols-7 border-b border-border/60 bg-surface/95 shadow-[0_8px_20px_-20px_rgba(15,23,42,0.5)] backdrop-blur-md">
            {weekdays.map((day) => (
              <div
                key={day.toISOString()}
                className="px-3 py-3 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-secondary"
              >
                {format(day, "EEEE")}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {byDay.map(({ day, isToday, events: dayEvents }) => {
              const outside = !isSameMonth(day, anchor);
              const weekend = day.getDay() === 0 || day.getDay() === 6;
              const conflicted = dayEvents.filter((event) => conflicts.has(event.id)).length;
              const shown = dayEvents.slice(0, 3);

              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "group/day min-h-40 border-b border-l border-border/60 p-2.5 text-left align-top transition-colors duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-hover/45",
                    weekend && "bg-hover/15",
                    outside && "bg-hover/25 opacity-65",
                    isToday && "bg-primary/[0.035] opacity-100 hover:bg-primary/[0.055]"
                  )}
                >
                  <div className="mb-2.5 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onPickDay?.(day)}
                        aria-label={`Open ${format(day, "EEEE, MMMM d, yyyy")} in day view`}
                        className={cn(
                          "font-data flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums transition-[transform,background-color,color,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-hover active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                          isToday
                            ? "bg-primary text-white shadow-[0_6px_16px_-10px_rgba(15,23,42,0.7)] dark:text-slate-950"
                            : outside
                              ? "text-foreground-muted"
                              : "text-foreground"
                        )}
                      >
                        {format(day, "d")}
                      </button>
                      {isToday && <span className="text-[10px] font-bold text-primary">Today</span>}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {dayEvents.length > 0 && (
                        <span className="rounded-full bg-hover px-2 py-1 font-data text-[9px] font-bold tabular-nums text-foreground-secondary ring-1 ring-border/50">
                          {dayEvents.length}
                        </span>
                      )}
                      {conflicted > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-1 font-data text-[9px] font-bold text-danger ring-1 ring-danger/20" title={`${conflicted} conflicting item${conflicted === 1 ? "" : "s"}`}>
                          <AlertTriangle className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
                          {conflicted}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {shown.map((event) => (
                      <CalendarEvent
                        key={event.id}
                        event={event}
                        conflicts={conflicts.get(event.id) || []}
                        compact
                        onSelect={onSelectEvent}
                      />
                    ))}
                    {dayEvents.length > shown.length && (
                      <button
                        type="button"
                        onClick={() => onPickDay?.(day)}
                        className="block w-full cursor-pointer rounded-full px-2.5 py-1.5 text-left text-[10px] font-bold text-primary transition-[transform,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-primary/10 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                      >
                        View {dayEvents.length - shown.length} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
