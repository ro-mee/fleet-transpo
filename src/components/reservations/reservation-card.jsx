"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConflictChips, ReadinessChip } from "@/components/reservations/conflict-chips";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import { formatDateTime, formatTime } from "@/lib/utils";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CarFront,
  Crown,
  Eye,
  MapPin,
  Send,
  StickyNote,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";

const isTerminal = (status) => status === L.COMPLETED || status === L.CANCELLED;

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

  return `${date} • ${formatTime(d)}`;
}

function driverName(driver) {
  if (!driver) return null;
  const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ").trim();
  return name || `Driver #${driver.driver_id}`;
}

function guestInitials(name) {
  const words = String(name || "Guest").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

export function ReservationCard({
  request,
  permissions = {},
  onCancel,
  onAssign,
  isBusy = false,
}) {
  const r = request;
  const status = r.fleet_status;
  const conflicts = r.conflicts || [];
  const vehicle = r.vehicles || null;
  const driver = r.drivers || null;
  const hasRecommendation = Boolean(r.ai_vehicle_recommendation || r.ai_driver_recommendation);
  const category = r.vehiclecategories?.category_name || null;
  const vehicleClass = category || r.requested_vehicle_type || null;
  const assignable = status === L.PENDING || status === L.SCHEDULED;
  const guestName = r.guest_name || "Unnamed Guest";
  const passengerCount = Number(r.passenger_count) || 1;

  return (
    <Card className="space-y-4 rounded-card border-border/70 bg-surface p-4 shadow-none transition-colors hover:border-border sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-info-bg text-sm font-bold text-info">
            {guestInitials(guestName)}
          </div>

          <div className="min-w-0 space-y-2">
            <Link
              href={`/reservations/${r.request_id}`}
              className="block truncate text-lg font-bold tracking-tight text-foreground transition-colors hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
            >
              {guestName}
            </Link>
            <div className="flex flex-wrap items-center gap-1.5">
              {r.booking_reference && (
                <Badge variant="outline" className="rounded-control font-semibold text-foreground">
                  Ref: {r.booking_reference}
                </Badge>
              )}
              <Badge variant="info" className="rounded-control font-data font-semibold">
                {r.reservation_number || `REQ-${r.request_id}`}
              </Badge>
              {vehicleClass && (
                <Badge variant="info" className="gap-1 rounded-control font-semibold">
                  <CarFront className="h-3 w-3" aria-hidden="true" />
                  {vehicleClass}
                </Badge>
              )}
              <StatusBadge status={r.priority} entity="priority" className="rounded-control font-semibold" />
              {r.derived_priority && r.derived_priority !== r.priority && (
                <StatusBadge status={r.derived_priority} entity="priority" className="rounded-control font-semibold" />
              )}
              {r.is_vip && (
                <Badge variant="info" className="gap-1 rounded-control font-semibold">
                  <Crown className="h-3 w-3" aria-hidden="true" />
                  VIP Guest
                </Badge>
              )}
              {r.is_emergency && (
                <Badge variant="danger" className="rounded-control font-semibold">
                  Emergency
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <ReadinessChip conflicts={conflicts} hasRecommendation={hasRecommendation} status={status} />
          <StatusBadge status={status} entity="reservation" className="rounded-control px-3 py-1 font-semibold" />
        </div>
      </div>

      <div className="grid items-center gap-4 rounded-card border border-border/70 bg-surface p-4 lg:grid-cols-[minmax(0,16rem)_minmax(3rem,18rem)_minmax(0,16rem)_auto]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-info-bg text-info">
            <MapPin className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Pickup</p>
            <p className="truncate text-sm font-semibold text-foreground">{r.pickup_location || "—"}</p>
          </div>
        </div>

        <div className="hidden items-center lg:flex" aria-hidden="true">
          <span className="grow border-t border-dashed border-info/40" />
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-info text-info">
            <ArrowRight className="h-4 w-4" />
          </span>
          <span className="grow border-t border-dashed border-info/40" />
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-success-bg text-success">
            <MapPin className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Destination</p>
            <p className="truncate text-sm font-semibold text-foreground">{r.dropoff_location || "—"}</p>
          </div>
        </div>

        {r.pickup_datetime && (
          <div className="inline-flex items-center gap-2 rounded-control bg-info-bg px-3 py-2 font-data text-xs font-semibold text-info lg:justify-self-end">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{formatPickup(r.pickup_datetime)}</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex min-w-0 items-center gap-3 rounded-card border border-border/70 p-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-info-bg text-info">
            <Users className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Passengers</p>
            <p className="truncate text-sm font-semibold text-foreground">
              {passengerCount} {passengerCount === 1 ? "Passenger" : "Passengers"}
            </p>
          </div>
        </div>

        <div
          className="flex min-w-0 items-center gap-3 rounded-card border border-border/70 p-3.5"
          title={!category && r.requested_vehicle_type ? `Requested: ${r.requested_vehicle_type}` : undefined}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-warning-bg text-warning">
            <CarFront className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Vehicle</p>
            <p className="truncate text-sm font-semibold text-foreground">
              {vehicle?.plate_number || vehicleClass || "Unassigned"}
            </p>
            {(vehicle?.model || (!vehicle && vehicleClass)) && (
              <p className="truncate text-xs text-foreground-muted">{vehicle?.model || "Requested vehicle"}</p>
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3 rounded-card border border-border/70 p-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-success-bg text-success">
            <UserRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Driver</p>
            <p className="truncate text-sm font-semibold text-foreground">{driverName(driver) || "Unassigned"}</p>
          </div>
        </div>
      </div>

      {(r.special_requests || conflicts.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-info/30 bg-info-bg p-3.5">
          {r.special_requests ? (
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-surface text-info">
                <StickyNote className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Special Requests</p>
                <p className="text-sm text-foreground-secondary">{r.special_requests}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm font-semibold text-foreground">Assignment checks</p>
          )}
          {conflicts.length > 0 && <ConflictChips conflicts={conflicts} className="flex flex-wrap" />}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
          {r.source_system && (
            <Badge variant="secondary" className="gap-1 rounded-control font-semibold">
              <Building2 className="h-3 w-3" aria-hidden="true" />
              {r.source_system}
            </Badge>
          )}
          {r.created_at && <span>Received {formatDateTime(r.created_at)}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-control border-info/40 text-info hover:bg-info-bg">
            <Link href={`/reservations/${r.request_id}`}>
              <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              View
            </Link>
          </Button>

          {assignable && permissions.assign && (
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => onAssign?.(r)}
              className="rounded-control bg-info text-white hover:bg-info/90"
            >
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Assign Pair
            </Button>
          )}

          {!isTerminal(status) && permissions.cancel && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-control border-danger/50 text-danger hover:bg-danger-bg"
              disabled={isBusy}
              onClick={() => onCancel?.(r)}
            >
              <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ReservationCardSkeleton() {
  return (
    <Card className="rounded-card border-border/70 bg-surface p-4 shadow-none sm:p-5">
      <div className="animate-pulse space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-muted" />
            <div className="space-y-2">
              <div className="h-5 w-40 rounded bg-muted" />
              <div className="h-5 w-56 rounded-control bg-muted" />
            </div>
          </div>
          <div className="h-7 w-24 rounded-control bg-muted" />
        </div>
        <div className="h-20 rounded-card bg-muted" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="h-16 rounded-card bg-muted" />
          <div className="h-16 rounded-card bg-muted" />
          <div className="h-16 rounded-card bg-muted" />
        </div>
        <div className="h-14 rounded-card bg-muted" />
        <div className="flex justify-between border-t border-border pt-3">
          <div className="h-5 w-44 rounded bg-muted" />
          <div className="h-8 w-64 rounded-control bg-muted" />
        </div>
      </div>
    </Card>
  );
}
