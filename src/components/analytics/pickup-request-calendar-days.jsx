"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { CalendarDays, Sparkles, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

function dayLabel(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

function pickupLabel(value) {
  if (!value) return "Not provided";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not provided";
  return `${date.toLocaleString("en-US", {
    timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  })} (PHT)`;
}

function reference(request) {
  return request.reservation_number || request.booking_reference || `Request #${request.request_id}`;
}

function RequestSummary({ request, preview = false }) {
  return (
    <li className="min-w-0 space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          {preview ? (
            <p className="break-words font-semibold text-foreground">{reference(request)}</p>
          ) : (
            <Link href={`/reservations/${request.request_id}`} prefetch={false}
              className="inline-block max-w-full break-words [overflow-wrap:anywhere] font-semibold text-info-700 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
              {reference(request)}<span className="sr-only"> — view request</span>
            </Link>
          )}
          <p className="break-words text-foreground-secondary">{request.guest_name || "Guest name not provided"}</p>
        </div>
        <StatusBadge status={request.fleet_status || "Status unavailable"} entity="reservation" className="max-w-full break-words whitespace-normal" />
      </div>
      <dl className="space-y-1 text-xs">
        <div>
          <dt className="inline font-medium text-foreground-muted">Scheduled pickup: </dt>
          <dd className="inline text-foreground-secondary">{pickupLabel(request.pickup_datetime)}</dd>
        </div>
        <div className="break-words">
          <dt className="inline font-medium text-foreground-muted">Route: </dt>
          <dd className="inline text-foreground-secondary">{request.pickup_location || "Pickup not provided"} → {request.dropoff_location || "Drop-off not provided"}</dd>
        </div>
      </dl>
    </li>
  );
}

/** One pinned day at a time; hover previews never contain interactive links. */
export function PickupRequestCalendarDays({ calendar, available = true, stale = false }) {
  const id = useId();
  const anchorRef = useRef(null);
  const gridRef = useRef(null);
  const restoreFocusRef = useRef(true);
  const [openDate, setOpenDate] = useState(null);
  const [previewDate, setPreviewDate] = useState(null);
  const [dismissedPreview, setDismissedPreview] = useState(null);
  if (openDate && (!available || !calendar.days.some((day) => day.dateStr === openDate && day.count > 0))) {
    setOpenDate(null);
  }
  const selectedDay = calendar.days.find((day) => day.dateStr === openDate);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const detailsId = `${id}-details`;

  useEffect(() => {
    const dismissOnResize = () => {
      restoreFocusRef.current = false;
      setOpenDate(null);
      setPreviewDate(null);
    };
    window.addEventListener("resize", dismissOnResize);
    return () => window.removeEventListener("resize", dismissOnResize);
  }, []);

  return (
    <Popover open={Boolean(selectedDay)} onOpenChange={(open) => {
      if (!open) setOpenDate(null);
      setPreviewDate(null);
    }}>
    <PopoverAnchor virtualRef={anchorRef} />
    <div ref={gridRef} className="grid grid-cols-7 gap-1.5" role="group"
      aria-label={`Pickup request calendar for ${calendar.monthName}, the current calendar month only. Does not follow the timeframe control. ${available ? `${calendar.totalMonthlyRequests} requests created.` : "Request data unavailable."}`}>
      {calendar.days.map((day) => {
        if (day.isPadding) {
          return <div key={day.id} aria-hidden="true" className="flex min-h-[52px] flex-col justify-between rounded-xl border border-dashed border-border/25 bg-muted/5 p-1.5 opacity-25 select-none">
            <span className="text-[10px] font-medium text-foreground-muted">{day.dayNumber}</span>
          </div>;
        }
        const isZero = day.count === 0;
        const ratio = day.count / Math.max(calendar.maxCount, 1);
        const isPeak = !isZero && day.count === calendar.maxCount && day.count >= 5;
        const isHigh = !isZero && !isPeak && (ratio >= 0.6 || day.count >= 8);
        const isMed = !isZero && !isPeak && !isHigh && (ratio >= 0.25 || day.count >= 3);
        const dateLabel = dayLabel(day.dateStr);
        const tileClass = cn(
          "relative flex min-h-[52px] min-w-0 flex-col justify-between rounded-xl border p-1.5 text-left select-none transition-colors",
          day.isToday && "ring-2 ring-primary border-primary shadow-xs",
          isPeak ? "border-info/60 bg-gradient-to-br from-info/25 via-info/15 to-primary/10 text-foreground ring-1 ring-info/35 shadow-xs"
            : isHigh ? "border-info/40 bg-info/15 text-foreground"
              : isMed ? "border-info/25 bg-info/10 text-foreground"
                : !isZero ? "border-info/15 bg-info/5 text-foreground" : "border-border/60 bg-surface text-foreground-muted",
          !isZero && available && "cursor-pointer hover:bg-info/20 hover:border-info/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          openDate === day.dateStr && "ring-2 ring-info ring-offset-2 ring-offset-surface"
        );
        const tileContent = <>
          <span className="flex items-center justify-between text-[10.5px]">
            <span className={cn("font-bold", day.isToday ? "rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-black text-surface" : isZero ? "text-foreground-muted/70 font-medium" : "text-foreground font-extrabold")}>{day.dayNumber}</span>
            {isPeak ? <span className="rounded-full bg-info/20 p-0.5"><Sparkles aria-hidden="true" className="h-2.5 w-2.5 text-info-700" /></span>
              : day.isToday ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
          </span>
          <span className="text-right">
            {!isZero ? <span className={cn("font-data text-[10px] rounded-md px-1.5 py-0.5", isPeak ? "bg-blue-600 font-black text-white shadow-xs" : isHigh ? "bg-info/25 text-info-700 font-bold ring-1 ring-info/30" : isMed ? "bg-info/20 text-info-700 font-bold" : "bg-info/10 text-info-700 font-semibold")}>
              {day.count} <span className="text-[8.5px] opacity-80">req</span>
            </span> : <span className="font-data text-[9.5px] text-foreground-muted/40 pr-1">-</span>}
          </span>
        </>;
        if (isZero || !available) {
          return <div key={day.id} className={tileClass} aria-label={`${dateLabel}${day.isToday ? ", today" : ""}. ${available ? "No requests created." : "Request data unavailable."}`}>{tileContent}</div>;
        }
        return (
            <TooltipPrimitive.Root key={day.id} open={!openDate && previewDate === day.dateStr && dismissedPreview !== day.dateStr} delayDuration={350}
              onOpenChange={(open) => setPreviewDate((current) => open ? day.dateStr : current === day.dateStr ? null : current)}>
              <TooltipPrimitive.Trigger asChild>
                  <button type="button" className={tileClass}
                    onClick={(event) => {
                      anchorRef.current = event.currentTarget;
                      restoreFocusRef.current = true;
                      setOpenDate((current) => current === day.dateStr ? null : day.dateStr);
                      setPreviewDate(null);
                    }}
                    onBlur={() => setDismissedPreview(null)}
                    onPointerLeave={() => setDismissedPreview(null)}
                    data-pickup-request-day={day.dateStr}
                    aria-haspopup="dialog"
                    aria-expanded={openDate === day.dateStr}
                    aria-controls={openDate === day.dateStr ? detailsId : undefined}
                    aria-label={`${dateLabel}${day.isToday ? ", today" : ""}. ${day.count} ${day.count === 1 ? "request" : "requests"} created. View request details.`}>
                    {tileContent}
                  </button>
              </TooltipPrimitive.Trigger>
              <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content side="top" align="start" sideOffset={8} collisionPadding={16}
                  className="custom-scrollbar z-50 w-[min(24rem,calc(100vw-2rem))] max-h-[var(--radix-tooltip-content-available-height)] overflow-y-auto rounded-2xl border border-border/80 bg-surface p-4 text-sm text-foreground shadow-md">
                  <p className="font-semibold">Requests created on {dateLabel}</p>
                  <p className="mt-1 text-xs text-foreground-muted">{day.count} {day.count === 1 ? "request" : "requests"}{stale ? " · Last loaded data" : ""}</p>
                  <ul className="mt-3 divide-y divide-border">
                    {day.requests.slice(0, 3).map((request) => <RequestSummary key={request.request_id} request={request} preview />)}
                  </ul>
                  <p className="mt-3 border-t border-border pt-2 text-xs font-medium text-info-700">{day.count > 3 ? `+${day.count - 3} more · ` : ""}Click to view all requests</p>
                  <TooltipPrimitive.Arrow className="fill-surface" />
                </TooltipPrimitive.Content>
              </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
        );
      })}
    </div>
    {selectedDay && (
            <PopoverContent id={detailsId} side="bottom" align="start" sideOffset={8} collisionPadding={16}
              aria-labelledby={titleId} aria-describedby={descriptionId}
              onInteractOutside={(event) => {
                // Day buttons switch the shared panel instead of dismissing it first.
                if (gridRef.current?.contains(event.target) && event.target.closest?.("[data-pickup-request-day]")) {
                  event.preventDefault();
                } else {
                  restoreFocusRef.current = false;
                }
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                setPreviewDate(null);
                setDismissedPreview(selectedDay.dateStr);
                if (restoreFocusRef.current) anchorRef.current?.focus();
              }}
              className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(28rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl bg-surface p-0">
              <div className="flex shrink-0 items-start gap-3 border-b border-border/50 bg-muted/20 p-5 pb-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-info/20 bg-info/10 text-info-700">
                  <CalendarDays aria-hidden="true" className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 id={titleId} className="text-base font-bold text-foreground">Requests created</h3>
                  <p id={descriptionId} className="mt-1 text-xs text-foreground-secondary">{dayLabel(selectedDay.dateStr)} · {selectedDay.count} {selectedDay.count === 1 ? "request" : "requests"}</p>
                  {stale && <p className="mt-1 text-xs text-warning-700">Last loaded data; refresh failed.</p>}
                </div>
                <button type="button" aria-label="Close request details" onClick={() => setOpenDate(null)}
                  className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground-muted hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <ul className="custom-scrollbar min-h-0 overflow-y-auto overscroll-contain divide-y divide-border/60 p-5 text-sm">
                {selectedDay.requests.map((request) => <RequestSummary key={request.request_id} request={request} />)}
              </ul>
              <p className="shrink-0 border-t border-border/50 bg-muted/20 px-5 py-3 text-xs text-foreground-muted">Pickup times in Philippine time · Select a reference to view the full request.</p>
            </PopoverContent>
    )}
    </Popover>
  );
}
