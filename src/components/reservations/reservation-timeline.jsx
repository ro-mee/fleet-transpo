"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge, TONE_CHIP } from "@/components/ui/status-badge";
import { getRequestTimeline } from "@/services/transport.service";
import { RESERVATION_EVENT as E } from "@/lib/constants";
import { cn, formatDateTime } from "@/lib/utils";
import {
  Ban,
  CalendarClock,
  CarFront,
  CheckCircle2,
  CircleDot,
  Clock,
  Flag,
  History,
  MapPin,
  PlayCircle,
  Send,
  Sparkles,
  TriangleAlert,
  UserCheck,
  XCircle,
} from "lucide-react";

// Renders reservation_events for one request — the "why is this request in this
// state" answer. The event log is append-only and written best-effort by
// recordReservationEvent(), so this is a read-only view: no action here can
// change history, and a request with no events is a normal (if rare) state
// rather than an error.
const EVENT_STYLE = {
  [E.CREATED]: { icon: CircleDot, tone: "secondary", label: "Created" },
  [E.REVIEWED]: { icon: Clock, tone: "info", label: "Review started" },
  [E.APPROVED]: { icon: CheckCircle2, tone: "success", label: "Approved" },
  [E.REJECTED]: { icon: XCircle, tone: "danger", label: "Rejected" },
  [E.VEHICLE_RECOMMENDED]: { icon: Sparkles, tone: "info", label: "Vehicle recommended" },
  [E.DRIVER_RECOMMENDED]: { icon: Sparkles, tone: "info", label: "Driver recommended" },
  [E.VEHICLE_ASSIGNED]: { icon: CarFront, tone: "primary", label: "Vehicle assigned" },
  [E.DRIVER_ASSIGNED]: { icon: UserCheck, tone: "primary", label: "Driver assigned" },
  [E.DISPATCH_CREATED]: { icon: Send, tone: "primary", label: "Dispatched" },
  [E.TRIP_STARTED]: { icon: PlayCircle, tone: "primary", label: "Trip started" },
  [E.PASSENGER_PICKED_UP]: { icon: MapPin, tone: "info", label: "Passenger picked up" },
  [E.PASSENGER_DROPPED_OFF]: { icon: Flag, tone: "info", label: "Passenger dropped off" },
  [E.TRIP_COMPLETED]: { icon: CheckCircle2, tone: "success", label: "Trip completed" },
  [E.DISPATCH_CLOSED]: { icon: CheckCircle2, tone: "success", label: "Dispatch closed" },
  [E.CANCELLED]: { icon: Ban, tone: "secondary", label: "Cancelled" },
  [E.RESCHEDULED]: { icon: CalendarClock, tone: "warning", label: "Rescheduled" },
};

const FALLBACK = { icon: CircleDot, tone: "secondary", label: null };

// event_type is a free string in the table; humanize anything not in the map
// rather than rendering a raw snake_case token.
const humanize = (t) =>
  String(t || "event")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

function TimelineEntry({ event, isLast }) {
  const style = EVENT_STYLE[event.event_type] || FALLBACK;
  const Icon = style.icon;
  const forced = event.metadata?.forced === true;
  const overridden = event.metadata?.overridden_conflicts || [];

  return (
    <li className="relative flex gap-3.5 pb-6 last:pb-0">
      {!isLast && (
        <span
          className="absolute left-[15px] top-8 bottom-0 w-0.5 bg-border/70"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-xs ring-2 ring-surface",
          TONE_CHIP[style.tone] || TONE_CHIP.secondary
        )}
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1 pt-0.5 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">
            {style.label || humanize(event.event_type)}
          </p>
          {event.from_status && event.to_status && event.from_status !== event.to_status && (
            <div className="inline-flex items-center gap-1 bg-muted/40 p-1 rounded-lg border border-border/50">
              <StatusBadge status={event.from_status} entity="reservation" className="text-[10px] py-0 px-2 h-5 font-semibold" />
              <span className="text-foreground-muted text-xs font-bold px-0.5">→</span>
              <StatusBadge status={event.to_status} entity="reservation" className="text-[10px] py-0 px-2 h-5 font-semibold" />
            </div>
          )}
          {forced && (
            <Badge variant="danger" className="gap-1 text-[10px] py-0">
              <TriangleAlert className="w-3 h-3" aria-hidden="true" />
              Override
            </Badge>
          )}
        </div>

        {event.description && (
          <p className="text-sm text-foreground break-words leading-relaxed font-normal">
            {event.description}
          </p>
        )}

        {overridden.length > 0 && (
          <ul className="mt-1.5 space-y-1 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2">
            {overridden.map((c, i) => (
              <li key={i} className="text-xs text-danger font-medium flex items-center gap-1.5">
                <TriangleAlert className="w-3 h-3 shrink-0" />
                <span>{c.message}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="text-xs text-foreground-secondary flex items-center gap-1.5 pt-0.5 font-medium">
          <span>{formatDateTime(event.occurred_at)}</span>
          <span className="text-foreground-muted">•</span>
          <span className="text-foreground font-semibold">
            {event.actor_name || "System"}
          </span>
          {event.actor_role && (
            <span className="text-foreground-secondary text-[11px]">
              ({event.actor_role.replace(/_/g, " ")})
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export function ReservationTimeline({ requestId, className, limit }) {
  const {
    data: events = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reservation-timeline", requestId],
    queryFn: () => getRequestTimeline(requestId),
    enabled: requestId != null,
  });

  const shown = limit ? events.slice(0, limit) : events;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>
          Every decision and transition recorded for this request.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={TriangleAlert}
            title="Could not load the timeline"
            description={error?.message || "The request failed."}
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={History}
            title="No events yet"
            description="Activity appears here as the request moves through review, assignment, and the trip itself."
          />
        ) : (
          <>
            <ol className="relative">
              {shown.map((e, i) => (
                <TimelineEntry key={e.event_id} event={e} isLast={i === shown.length - 1} />
              ))}
            </ol>
            {limit && events.length > shown.length && (
              <p className="mt-2 text-xs text-foreground-muted">
                Showing the {shown.length} most recent of {events.length} events.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
