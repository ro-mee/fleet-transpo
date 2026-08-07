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

const isReviewable = (status) => status === L.PENDING || status === L.UNDER_REVIEW;

const PRIORITY_RAIL = {
  Urgent: "border-l-danger",
  High: "border-l-warning",
  Medium: "border-l-border",
  Low: "border-l-border",
};

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

  const category = r.vehiclecategories?.category_name || null;
  const vehicleClass = category || r.requested_vehicle_type || null;
  const unresolved = !category && Boolean(r.requested_vehicle_type);

  const reviewable = isReviewable(status);
  const assignable = status === L.APPROVED || status === L.SCHEDULED;

  return (
    <Card
      className={cn(
        "border-0 border-l-4 p-6 shadow-xs rounded-3xl overflow-hidden transition-all hover:shadow-md bg-surface space-y-4 select-none",
        conflicts.length ? TONE_RAIL.danger : PRIORITY_RAIL[r.priority] || "border-l-border"
      )}
    >
      {/* ── Top Header: Identity & Statuses ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/reservations/${r.request_id}`}
              className="text-lg font-extrabold text-foreground hover:text-primary transition-colors tracking-tight truncate"
            >
              {r.guest_name || "Unnamed Guest"}
            </Link>
            <span className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-2.5 py-0.5 font-data text-xs font-bold text-foreground shadow-2xs">
              {r.reservation_number || `REQ-${r.request_id}`}
            </span>
            <StatusBadge status={r.priority} entity="priority" className="rounded-full px-3 py-0.5 text-xs font-bold" />
            {r.derived_priority && (
              <StatusBadge status={r.derived_priority} entity="priority" className="rounded-full px-3 py-0.5 text-xs font-bold" />
            )}
            {r.is_vip && <Badge variant="warning" className="rounded-full px-3 py-0.5 text-xs font-bold">VIP</Badge>}
            {r.is_emergency && <Badge variant="danger" className="rounded-full px-3 py-0.5 text-xs font-bold">Emergency</Badge>}
            {vehicleClass && (
              <Tooltip
                content={
                  unresolved
                    ? `Booking asked for "${r.requested_vehicle_type}", which matched no Fleet category.`
                    : r.vehiclecategories?.description || vehicleClass
                }
              >
                <Badge variant={unresolved ? "secondary" : "info"} className="gap-1 rounded-full px-3 py-0.5 text-xs font-bold">
                  <CarFront className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[14rem]">{vehicleClass}</span>
                </Badge>
              </Tooltip>
            )}
          </div>
          {r.booking_reference && (
            <p className="text-xs font-medium text-foreground-muted">
              Ref: <span className="font-data font-bold text-foreground-secondary">{r.booking_reference}</span>
            </p>
          )}
        </div>
        <div className="flex flex-row sm:flex-col items-end gap-1.5 shrink-0">
          <StatusBadge status={status} entity="reservation" className="rounded-full px-3 py-1 text-xs font-bold" />
          <ReadinessChip conflicts={conflicts} hasRecommendation={hasRecommendation} status={status} />
        </div>
      </div>

      {/* ── Route & Pickup Time Highlight Banner ── */}
      <div className="rounded-2xl bg-muted/40 p-3.5 border border-border/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-foreground min-w-0">
          <MapPin className="w-4 h-4 text-danger shrink-0" />
          <span className="truncate max-w-[200px]">{r.pickup_location || "—"}</span>
          <ArrowRight className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
          <MapPin className="w-4 h-4 text-success shrink-0" />
          <span className="truncate max-w-[200px]">{r.dropoff_location || "—"}</span>
        </div>
        {r.pickup_datetime && (
          <div className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 border border-primary/20 px-3 py-1.5 font-data text-xs font-bold text-primary shadow-2xs shrink-0">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatPickup(r.pickup_datetime)}</span>
          </div>
        )}
      </div>

      {/* ── Resources Grid Cards (Passengers, Vehicle, Driver) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Passengers Box */}
        <div className="p-3 rounded-2xl border border-border/50 bg-surface flex items-center gap-3 shadow-2xs">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Passengers</p>
            <p className="text-xs font-bold font-data text-foreground mt-0.5">{r.passenger_count || 1} Passengers</p>
          </div>
        </div>

        {/* Vehicle Box */}
        <div className="p-3 rounded-2xl border border-border/50 bg-surface flex items-center gap-3 shadow-2xs">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/10 text-warning shrink-0 border border-warning/20">
            <CarFront className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Vehicle</p>
            {vehicle ? (
              <p className="text-xs font-bold text-foreground mt-0.5 truncate">
                <span className="font-data font-bold rounded-md bg-muted/60 px-1.5 py-0.5 mr-1 border border-border/60">{vehicle.plate_number}</span>
                {vehicle.model || ""}
              </p>
            ) : (
              <p className="text-xs italic font-medium text-foreground-muted mt-0.5">Unassigned</p>
            )}
          </div>
        </div>

        {/* Driver Box */}
        <div className="p-3 rounded-2xl border border-border/50 bg-surface flex items-center gap-3 shadow-2xs">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/10 text-success shrink-0 border border-success/20">
            <UserRound className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">Driver</p>
            {driver ? (
              <p className="text-xs font-bold text-foreground mt-0.5 truncate">{driverName(driver)}</p>
            ) : (
              <p className="text-xs italic font-medium text-foreground-muted mt-0.5">Unassigned</p>
            )}
          </div>
        </div>
      </div>

      {r.special_requests && (
        <div className="p-3 rounded-2xl border border-border/50 bg-muted/20 flex items-start gap-2.5 text-xs text-foreground-secondary">
          <StickyNote className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-foreground">Special Requests: </span>
            <span>{r.special_requests}</span>
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="flex flex-wrap">
          <ConflictChips conflicts={conflicts} />
        </div>
      )}

      {/* ── Footer Metadata & Executive Action Buttons ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <p className="flex items-center gap-2 text-xs font-medium text-foreground-muted">
          {r.source_system && (
            <span className="inline-flex items-center gap-1 font-bold text-foreground-secondary bg-muted/50 px-2.5 py-0.5 rounded-full border border-border/60">
              <Building2 className="w-3 h-3 text-foreground-muted" />
              {r.source_system}
            </span>
          )}
          {r.created_at && <span>Received {formatDateTime(r.created_at)}</span>}
        </p>

        <div className="flex items-center gap-2">
          <Link
            href={`/reservations/${r.request_id}`}
            className="inline-flex items-center gap-1.5 h-8 px-4 rounded-full border border-border/80 bg-surface text-xs font-bold text-foreground-secondary hover:border-primary/40 hover:text-foreground transition-all shadow-2xs"
          >
            <Eye className="w-3.5 h-3.5" />
            View
          </Link>

          {status === L.PENDING && permissions.update && (
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => onReview?.(r)}
              className="h-8 px-4 rounded-full border-primary/40 text-primary font-bold text-xs hover:bg-primary/10 cursor-pointer shadow-2xs"
            >
              Start Review
            </Button>
          )}

          {reviewable && permissions.approve && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 rounded-full text-danger hover:bg-danger/10 font-bold text-xs cursor-pointer"
                disabled={isBusy}
                onClick={() => onReject?.(r)}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />
                Reject
              </Button>
              <Button
                variant="success"
                size="sm"
                className="h-8 px-4 rounded-full font-bold text-xs cursor-pointer shadow-2xs"
                disabled={isBusy}
                onClick={() => onApprove?.(r)}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                Approve
              </Button>
            </>
          )}

          {assignable && permissions.assign && (
            <Button
              size="sm"
              disabled={isBusy}
              onClick={() => onAssign?.(r)}
              className="h-8 px-4 rounded-full bg-primary text-white dark:text-slate-950 font-bold text-xs shadow-2xs hover:bg-primary/90 cursor-pointer"
            >
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
    <Card className="border-0 border-l-4 border-l-border p-6 rounded-3xl bg-surface">
      <div className="animate-pulse space-y-4">
        <div className="flex justify-between">
          <div className="space-y-2">
            <div className="h-6 w-48 rounded-xl bg-muted" />
            <div className="h-3 w-32 rounded-lg bg-muted" />
          </div>
          <div className="h-6 w-24 rounded-full bg-muted" />
        </div>
        <div className="h-10 rounded-2xl bg-muted" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-14 rounded-2xl bg-muted" />
          <div className="h-14 rounded-2xl bg-muted" />
          <div className="h-14 rounded-2xl bg-muted" />
        </div>
        <div className="flex justify-between border-t border-border pt-3">
          <div className="h-4 w-40 rounded-lg bg-muted" />
          <div className="h-8 w-36 rounded-full bg-muted" />
        </div>
      </div>
    </Card>
  );
}
