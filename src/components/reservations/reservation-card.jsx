"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusBadge, TONE_RAIL } from "@/components/ui/status-badge";
import { ConflictChips, ReadinessChip } from "@/components/reservations/conflict-chips";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { cn, formatDateTime, formatTime } from "@/lib/utils";
import {
  ArrowRight,
  Building2,
  CarFront,
  CheckCircle2,
  Clock,
  Eye,
  MapPin,
  Send,
  StickyNote,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";

// A request still awaiting a Fleet decision. Migration 016 split the old single
// "Waiting for Fleet Review" status into Pending (just arrived) and Under Review
// (a dispatcher has picked it up), so both are reviewable.
const isReviewable = (status) => status === L.PENDING || status === L.UNDER_REVIEW;

const PRIORITY_RAIL = {
  Urgent: "border-l-danger",
  High: "border-l-warning",
  Medium: "border-l-border",
  Low: "border-l-border",
};

/**
 * One label/value pair.
 *
 * The value carries the emphasis and the label is scaffolding — inverted from the
 * usual reading, because on a card that is 90% data the thing worth seeing is the
 * data. `muted` marks a value that is real but empty ("Unassigned"), which must
 * still read as absence rather than as a normal value.
 */
function Field({ icon: Icon, label, children, className, muted }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-foreground-muted">{label}</p>
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />}
        <span
          className={cn(
            "truncate text-sm",
            muted ? "italic text-foreground-muted" : "font-medium text-foreground"
          )}
        >
          {children ?? "—"}
        </span>
      </div>
    </div>
  );
}

/**
 * Pickup time, with the weekday.
 *
 * "Aug 11, 2026, 9:15 AM" makes a dispatcher count days to work out whether that
 * is tomorrow; "Tue, Aug 11 · 9:15 AM" does not. The year is dropped because a
 * queue of pending requests is always near-term — it comes back for anything more
 * than roughly six months out, where its absence would be genuinely ambiguous.
 */
function formatPickup(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const farOut = Math.abs(d.getTime() - Date.now()) > 180 * 24 * 60 * 60 * 1000;
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(farOut ? { year: "numeric" } : {}),
  }).format(d);

  return `${date} · ${formatTime(d)}`;
}

function driverName(driver) {
  if (!driver) return null;
  const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ").trim();
  return name || `Driver #${driver.driver_id}`;
}

/**
 * One transportation request as a dispatcher workspace card.
 *
 * Read-only with respect to guest data — Booking owns guest_name and
 * booking_reference, Fleet only decides. Action buttons are rendered by the
 * caller's `can()` result, passed in as `permissions`, so this component stays
 * presentational and the authorization decision has a single home on the page.
 */
export function ReservationCard({
  request,
  permissions = {},
  onReview,
  onApprove,
  onReject,
  onAssign,
  isBusy = false,
}) {
  const r = request;
  const status = r.fleet_status;
  const conflicts = r.conflicts || [];
  const vehicle = r.vehicles || null;
  const driver = r.drivers || null;
  const hasRecommendation = Boolean(r.ai_vehicle_recommendation || r.ai_driver_recommendation);

  // What class of vehicle this request is for. The resolved Fleet category is
  // preferred over Booking's raw wording because it is the vocabulary the rest of
  // Fleet uses; the raw string is the honest fallback when ingest could not match
  // it to a category, and `unresolved` is what stops the two from looking alike.
  const category = r.vehiclecategories?.category_name || null;
  const vehicleClass = category || r.requested_vehicle_type || null;
  const unresolved = !category && Boolean(r.requested_vehicle_type);

  const reviewable = isReviewable(status);
  const assignable = status === L.APPROVED || status === L.SCHEDULED;

  return (
    <Card
      className={cn(
        "border-l-4 p-4 transition-shadow hover:shadow-sm",
        conflicts.length ? TONE_RAIL.danger : PRIORITY_RAIL[r.priority] || "border-l-border"
      )}
    >
      {/* Header: identity + status.
          The guest name leads because that is what a dispatcher recognises and
          what a caller asks about; the reservation number is the lookup key, so
          it drops to the secondary line and keeps the monospace treatment. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <Link
              href={`/reservations/${r.request_id}`}
              className="truncate text-base font-semibold text-foreground hover:underline"
            >
              {r.guest_name || "Unnamed guest"}
            </Link>
            <StatusBadge status={r.priority} entity="priority" />
            {r.derived_priority && (
              <StatusBadge status={r.derived_priority} entity="priority" />
            )}
            {r.is_vip && <Badge variant="outline">VIP</Badge>}
            {r.is_emergency && <Badge variant="destructive">Emergency</Badge>}
            {/* The vehicle class the request is for. Beside the guest rather than
                down in the field grid because it is what the request IS — it
                decides which vehicles are even eligible, and it is how a
                dispatcher recognises a VIP arrival at a glance. Booking used to
                convey this as prose in special_requests; a dispatcher should not
                have to read a note to learn it. */}
            {vehicleClass && (
              <Tooltip
                content={
                  unresolved
                    ? `Booking asked for "${r.requested_vehicle_type}", which matched no Fleet category. Pick the vehicle manually.`
                    : r.vehiclecategories?.description || vehicleClass
                }
              >
                <Badge variant={unresolved ? "outline" : "info"} className="gap-1 cursor-default">
                  <CarFront className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="truncate max-w-[14rem]">{vehicleClass}</span>
                  {unresolved && <span aria-hidden="true">?</span>}
                </Badge>
              </Tooltip>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 truncate font-data text-xs text-foreground-muted">
            {r.reservation_number || `REQ-${r.request_id}`}
            {r.booking_reference && <span>· {r.booking_reference}</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge status={status} entity="reservation" />
          <ReadinessChip conflicts={conflicts} hasRecommendation={hasRecommendation} status={status} />
        </div>
      </div>

      {/* Route + pickup time.
          Pickup time lives here rather than in the field grid below because it is
          the field that makes a request urgent, and "where" and "when" are read as
          one fact. On narrow screens the time wraps under the route instead of
          squeezing the locations. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-hover/50 px-3 py-2 text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
          <span className="truncate font-medium text-foreground">{r.pickup_location || "—"}</span>
          <ArrowRight className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
          <span className="truncate font-medium text-foreground">{r.dropoff_location || "—"}</span>
        </div>
        {r.pickup_datetime && (
          <span className="flex shrink-0 items-center gap-1.5 border-border text-foreground sm:border-l sm:pl-3">
            <Clock className="w-3.5 h-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
            <span className="font-medium">{formatPickup(r.pickup_datetime)}</span>
          </span>
        )}
      </div>

      {/* The fields a dispatcher needs without opening the request.
          Optional fields render only when populated — nine "—" placeholders read
          as a broken card and pad it by a third. Vehicle and Driver are the
          exception: for a request that is Approved but not yet crewed, the
          *absence* is the actionable fact, so it is stated rather than hidden. */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-4">
        <Field icon={Users} label="Passengers">
          {r.passenger_count || 1}
        </Field>
        {r.service_types?.service_name && (
          <Field label="Service">{r.service_types.service_name}</Field>
        )}
        <Field icon={CarFront} label="Vehicle" muted={!vehicle}>
          {vehicle ? `${vehicle.plate_number}${vehicle.model ? ` · ${vehicle.model}` : ""}` : "Unassigned"}
        </Field>
        <Field icon={UserRound} label="Driver" muted={!driver}>
          {driverName(driver) || "Unassigned"}
        </Field>
        {r.special_requests && (
          <Field icon={StickyNote} label="Special Requests" className="col-span-2">
            {r.special_requests}
          </Field>
        )}
      </div>

      {conflicts.length > 0 && (
        <div className="mt-3 flex flex-wrap">
          <ConflictChips conflicts={conflicts} />
        </div>
      )}

      {/* Actions — each gated on the permission the matching endpoint enforces.
          Provenance (where the request came from, when it arrived) shares this row
          rather than taking a slot in the grid above: it is audit data, needed to
          settle a question about a request, never to decide one. Putting it on the
          existing divider costs no extra vertical space. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3">
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
          {r.source_system && (
            <span className="flex items-center gap-1.5">
              <Building2 className="w-3 h-3 shrink-0" aria-hidden="true" />
              {r.source_system}
            </span>
          )}
          {r.created_at && <span>Received {formatDateTime(r.created_at)}</span>}
        </p>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/reservations/${r.request_id}`}>
            <Eye className="w-3.5 h-3.5 mr-1" />
            View
          </Link>
        </Button>

        {status === L.PENDING && permissions.update && (
          <Button variant="outline" size="sm" disabled={isBusy} onClick={() => onReview?.(r)}>
            Start Review
          </Button>
        )}

        {reviewable && permissions.approve && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              disabled={isBusy}
              onClick={() => onReject?.(r)}
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              Reject
            </Button>
            <Button variant="success" size="sm" disabled={isBusy} onClick={() => onApprove?.(r)}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Approve
            </Button>
          </>
        )}

        {assignable && permissions.assign && (
          <Button size="sm" disabled={isBusy} onClick={() => onAssign?.(r)}>
            <Send className="w-3.5 h-3.5 mr-1" />
            {r.vehicle_id && r.driver_id ? "Reassign" : "Assign"}
          </Button>
        )}
        </div>
      </div>
    </Card>
  );
}

export function ReservationCardSkeleton() {
  return (
    <Card className="border-l-4 border-l-border p-4">
      <div className="animate-pulse space-y-3">
        <div className="flex justify-between">
          <div className="space-y-2">
            <div className="h-5 w-40 rounded bg-hover" />
            <div className="h-3 w-48 rounded bg-hover" />
          </div>
          <div className="space-y-2">
            <div className="h-5 w-20 rounded bg-hover" />
            <div className="h-5 w-28 rounded bg-hover" />
          </div>
        </div>
        <div className="h-9 rounded-lg bg-hover" />
        {/* Five fields, matching the grid's usual populated width. */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-2 w-14 rounded bg-hover" />
              <div className="h-4 w-24 rounded bg-hover" />
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t border-border pt-3">
          <div className="h-3 w-44 rounded bg-hover" />
          <div className="h-8 w-40 rounded bg-hover" />
        </div>
      </div>
    </Card>
  );
}
