"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EVENT_KIND, KIND_LABEL } from "@/lib/scheduling/calendar";
import { cn, formatTime } from "@/lib/utils";
import {
  AlertTriangle,
  CarFront,
  Clock,
  ExternalLink,
  Layers,
  MapPin,
  ShieldAlert,
  Sparkles,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";

/**
 * Slide-over / Modal Drawer displaying complete operational dispatch intelligence
 * when a calendar event or cluster of events is clicked.
 */
export function CalendarDetailDrawer({ event, conflicts = new Map(), open, onOpenChange }) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (!event) return null;

  // If this item is a cluster of multiple events, allow switching between them
  const isCluster = Boolean(event.isCluster && event.events?.length > 1);
  const clusterEvents = isCluster ? event.events : [event.primaryEvent || event];

  const currentEvent = clusterEvents[activeIdx] || clusterEvents[0] || event;

  const currentConflicts = conflicts instanceof Map
    ? conflicts.get(currentEvent?.id) || []
    : Array.isArray(conflicts) ? conflicts : [];

  const isDispatch = currentEvent.kind === EVENT_KIND.DISPATCH;
  const isMaintenance = currentEvent.kind === EVENT_KIND.MAINTENANCE;
  const isLeave = currentEvent.kind === EVENT_KIND.LEAVE || currentEvent.kind === EVENT_KIND.REST_DAY;
  const isDowntime = currentEvent.kind === EVENT_KIND.DOWNTIME;

  const hasConflicts = currentConflicts.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden rounded-[28px] border border-white/10 bg-surface p-1 shadow-[0_32px_90px_-36px_rgba(15,23,42,0.72)]"
        style={{ width: "min(48rem, calc(100vw - 2rem))", maxWidth: "none", maxHeight: "92dvh", overflow: "hidden" }}
      >
        {/* Drawer Header */}
        <div className="relative space-y-4 rounded-t-[24px] border-b border-border/60 bg-surface px-5 py-5 sm:px-6">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close trip details"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-foreground-muted transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:scale-105 hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>

          <div className="flex items-start pr-12">
            <div className="flex min-w-0 items-center gap-3.5">
              <div
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset",
                  isDispatch && "bg-primary/10 text-primary ring-primary/20",
                  isMaintenance && "bg-danger/10 text-danger ring-danger/20",
                  isLeave && "bg-warning/10 text-warning ring-warning/20",
                  isDowntime && "bg-hover text-foreground-secondary ring-border"
                )}
              >
                {isDispatch && <CarFront className="h-5 w-5" strokeWidth={1.6} />}
                {isMaintenance && <Wrench className="h-5 w-5" strokeWidth={1.6} />}
                {isLeave && <User className="h-5 w-5" strokeWidth={1.6} />}
                {isDowntime && <ShieldAlert className="h-5 w-5" strokeWidth={1.6} />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="truncate text-lg font-semibold tracking-[-0.02em] text-foreground">
                    {currentEvent.title}
                  </DialogTitle>
                  {currentEvent.status && (
                    <StatusBadge status={currentEvent.status} size="sm" />
                  )}
                  {currentEvent.vip && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                      <Sparkles className="h-2.5 w-2.5" /> VIP
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs font-medium text-foreground-muted">
                  {KIND_LABEL[currentEvent.kind] || "Operational Record"}
                  {currentEvent.subtitle ? ` · ${currentEvent.subtitle}` : ""}
                </p>
              </div>
            </div>
          </div>

          {/* Cluster Tab Switcher if 2+ trips share this slot */}
          {isCluster && (
            <div className="rounded-2xl bg-background/55 p-1.5 ring-1 ring-inset ring-border/60">
              <div className="mb-1 flex items-center gap-1.5 px-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                <Layers className="h-3.5 w-3.5 text-primary" strokeWidth={1.7} />
                <span>{clusterEvents.length} trips in this time slot</span>
              </div>
              <div className="flex items-center gap-1 overflow-x-auto">
                {clusterEvents.map((item, idx) => {
                  const itemConflicts = (conflicts instanceof Map ? conflicts.get(item.id) : []) || [];
                  const active = idx === activeIdx;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveIdx(idx)}
                      className={cn(
                        "flex min-h-8 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition-[background-color,color,transform,box-shadow] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        active
                          ? "bg-foreground text-surface shadow-sm"
                          : "text-foreground-secondary hover:bg-surface hover:text-foreground"
                      )}
                    >
                      <span>{item.guestName || item.title}</span>
                      {itemConflicts.length > 0 && (
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="max-h-[calc(92dvh-14rem)] space-y-4 overflow-y-auto bg-background/35 p-4 sm:p-6">
          {/* Conflict Alert Banner */}
          {hasConflicts && (
            <div className="space-y-2 rounded-2xl bg-rose-500/10 p-4 ring-1 ring-inset ring-rose-500/25">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <h4 className="text-xs font-bold uppercase tracking-wider">
                  Scheduling Conflict Detected ({currentConflicts.length})
                </h4>
              </div>
              <ul className="space-y-1 text-xs text-foreground">
                {currentConflicts.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 leading-relaxed">
                    <span className="font-bold text-rose-600 dark:text-rose-400">• {c.reason}:</span>
                    <span className="text-foreground-secondary">
                      {c.detail || c.with?.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Starting soon callout */}
          {currentEvent.isStartingSoon && (
            <div className="flex items-center gap-2 rounded-2xl bg-amber-500/10 px-4 py-3 text-xs font-semibold text-amber-600 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
              <Clock className="h-4 w-4 shrink-0 animate-pulse" />
              <span>Departing soon — scheduled within the next 30 minutes.</span>
            </div>
          )}

          {/* DISPATCH CONTENT */}
          {isDispatch && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              {/* Timing Block */}
              <div className="space-y-4 rounded-2xl bg-surface p-4 ring-1 ring-inset ring-border/70 sm:p-5 lg:col-start-1 lg:row-start-1">
                <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                  <Clock className="h-3.5 w-3.5 text-primary" strokeWidth={1.7} /> Schedule window
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-foreground-muted block text-[11px]">Departure</span>
                    <p className="font-data font-semibold text-foreground mt-0.5">
                      {format(currentEvent.start, "EEE, MMM d, yyyy")}
                    </p>
                    <p className="mt-1 font-data text-base font-semibold tracking-[-0.02em] text-primary">
                      {formatTime(currentEvent.start)}
                    </p>
                  </div>
                  <div>
                    <span className="text-foreground-muted block text-[11px]">Estimated Arrival</span>
                    <p className="font-data font-semibold text-foreground mt-0.5">
                      {format(currentEvent.end, "EEE, MMM d, yyyy")}
                    </p>
                    <p className="mt-1 font-data text-base font-semibold tracking-[-0.02em] text-foreground">
                      {formatTime(currentEvent.end)}
                    </p>
                  </div>
                </div>

                {(currentEvent.actualDeparture || currentEvent.actualArrival) && (
                  <div className="border-t border-border/60 pt-2.5 grid grid-cols-2 gap-3 text-xs">
                    {currentEvent.actualDeparture && (
                      <div>
                        <span className="text-foreground-muted text-[11px]">Actual Depart:</span>{" "}
                        <span className="font-data font-semibold text-foreground">
                          {formatTime(currentEvent.actualDeparture)}
                        </span>
                      </div>
                    )}
                    {currentEvent.actualArrival && (
                      <div>
                        <span className="text-foreground-muted text-[11px]">Actual Arrive:</span>{" "}
                        <span className="font-data font-semibold text-foreground">
                          {formatTime(currentEvent.actualArrival)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Route & Passenger */}
              <div className="space-y-4 rounded-2xl bg-surface p-4 ring-1 ring-inset ring-border/70 sm:p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                <div className="flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                    <MapPin className="h-3.5 w-3.5 text-primary" strokeWidth={1.7} /> Route & guest
                  </h4>
                  {currentEvent.priority && (
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[10px] font-bold",
                        currentEvent.priority === "Urgent"
                          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                          : currentEvent.priority === "High"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                            : "bg-hover text-foreground-secondary"
                      )}
                    >
                      {currentEvent.priority} Priority
                    </span>
                  )}
                </div>

                <div className="relative space-y-3 before:absolute before:left-[7px] before:top-4 before:h-[calc(100%-2rem)] before:w-px before:bg-border">
                  <div className="relative flex items-start gap-3 text-xs">
                    <span className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-surface bg-emerald-500 ring-1 ring-emerald-500/30" />
                    <div>
                      <span className="text-[10px] uppercase font-bold text-foreground-muted">Pickup</span>
                      <p className="font-semibold text-foreground">
                        {currentEvent.pickupLocation || currentEvent.raw?.routes?.pickup_location || "Standard Pickup"}
                      </p>
                    </div>
                  </div>

                  <div className="relative flex items-start gap-3 text-xs">
                    <span className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-surface bg-rose-500 ring-1 ring-rose-500/30" />
                    <div>
                      <span className="text-[10px] uppercase font-bold text-foreground-muted">Dropoff</span>
                      <p className="font-semibold text-foreground">
                        {currentEvent.dropoffLocation || currentEvent.raw?.routes?.dropoff_location || "Standard Dropoff"}
                      </p>
                    </div>
                  </div>
                </div>

                {(currentEvent.guestName || currentEvent.passengerCount != null || currentEvent.reservationNumber) && (
                  <div className="border-t border-border/60 pt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-secondary">
                    {currentEvent.guestName && (
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <User className="h-3.5 w-3.5 text-foreground-muted" /> {currentEvent.guestName}
                      </span>
                    )}
                    {currentEvent.passengerCount != null && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5 text-foreground-muted" /> {currentEvent.passengerCount} pax
                      </span>
                    )}
                    {currentEvent.reservationNumber && (
                      <span className="font-data text-[11px] text-foreground-muted">
                        Ref: {currentEvent.reservationNumber}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Resource Assignments */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-start-1 lg:row-start-2">
                {/* Driver */}
                <div
                  className={cn(
                    "space-y-2 rounded-2xl p-4 ring-1 ring-inset",
                    currentEvent.unassignedDriver
                      ? "bg-amber-500/5 ring-amber-500/30"
                      : "bg-surface ring-border/70"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                      <User className="h-3.5 w-3.5 text-primary" strokeWidth={1.7} /> Assigned driver
                    </span>
                    {currentEvent.unassignedDriver && (
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase">Unassigned</span>
                    )}
                  </div>
                  {currentEvent.driverDisplayName ? (
                    <div>
                      <p className="text-xs font-bold text-foreground">{currentEvent.driverDisplayName}</p>
                      {currentEvent.driver?.license_number && (
                        <p className="font-data text-[11px] text-foreground-muted">
                          Lic: {currentEvent.driver.license_number}
                        </p>
                      )}
                      {currentEvent.driver?.driver_status && (
                        <p className="text-[10px] text-foreground-secondary mt-0.5">
                          Status: {currentEvent.driver.driver_status}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs italic text-amber-600 dark:text-amber-400">No driver assigned yet.</p>
                  )}
                </div>

                {/* Vehicle */}
                <div
                  className={cn(
                    "space-y-2 rounded-2xl p-4 ring-1 ring-inset",
                    currentEvent.unassignedVehicle
                      ? "bg-amber-500/5 ring-amber-500/30"
                      : "bg-surface ring-border/70"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
                      <CarFront className="h-3.5 w-3.5 text-primary" strokeWidth={1.7} /> Assigned vehicle
                    </span>
                    {currentEvent.unassignedVehicle && (
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase">Unassigned</span>
                    )}
                  </div>
                  {currentEvent.vehicleDisplayName ? (
                    <div>
                      <p className="font-data text-xs font-bold text-foreground">
                        {currentEvent.vehicleDisplayName}
                      </p>
                      {currentEvent.vehicleModel && (
                        <p className="text-[11px] text-foreground-muted">{currentEvent.vehicleModel}</p>
                      )}
                      {currentEvent.vehicle?.seating_capacity && (
                        <p className="text-[10px] text-foreground-secondary mt-0.5">
                          Capacity: {currentEvent.vehicle.seating_capacity} seats
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs italic text-amber-600 dark:text-amber-400">No vehicle assigned yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* MAINTENANCE CONTENT */}
          {isMaintenance && (
            <div className="space-y-3 rounded-2xl bg-surface p-5 text-xs ring-1 ring-inset ring-border/70">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-rose-500">
                Maintenance Window
              </h4>
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-foreground">{currentEvent.title}</p>
                {currentEvent.subtitle && <p className="text-foreground-secondary">{currentEvent.subtitle}</p>}
                <p className="font-data text-foreground-muted">
                  Window: {format(currentEvent.start, "MMM d, yyyy")} – {format(currentEvent.end, "MMM d, yyyy")}
                </p>
                {currentEvent.vehicleDisplayName && (
                  <p className="font-data font-semibold text-primary">
                    Vehicle: {currentEvent.vehicleDisplayName}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* LEAVE / REST CONTENT */}
          {isLeave && (
            <div className="space-y-3 rounded-2xl bg-surface p-5 text-xs ring-1 ring-inset ring-border/70">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Driver Availability Restriction
              </h4>
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-foreground">{currentEvent.title}</p>
                {currentEvent.subtitle && <p className="text-foreground-secondary">{currentEvent.subtitle}</p>}
                <p className="font-data text-foreground-muted">
                  Date: {format(currentEvent.start, "EEEE, MMMM d, yyyy")}
                </p>
                {currentEvent.driverDisplayName && (
                  <p className="font-semibold text-foreground">
                    Driver: {currentEvent.driverDisplayName}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* DOWNTIME CONTENT */}
          {isDowntime && (
            <div className="space-y-3 rounded-2xl bg-surface p-5 text-xs ring-1 ring-inset ring-border/70">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
                Standing Resource Downtime
              </h4>
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-foreground">{currentEvent.title}</p>
                {currentEvent.subtitle && <p className="text-foreground-secondary">{currentEvent.subtitle}</p>}
                <p className="text-[11px] text-foreground-muted">
                  This resource has an active status marking it out of service.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 rounded-b-[24px] border-t border-border/60 bg-surface px-5 py-4 sm:px-6">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-10 rounded-full px-4">
            Close
          </Button>
          {isDispatch && currentEvent.dispatchId && (
            <Button asChild className="group h-10 gap-2 rounded-full px-5 shadow-sm">
              <Link href={`/dispatch/${currentEvent.dispatchId}`}>
                Open dispatch record
                <ExternalLink className="h-3.5 w-3.5 transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={1.8} />
              </Link>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
