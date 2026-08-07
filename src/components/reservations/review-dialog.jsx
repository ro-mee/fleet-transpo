"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConflictChips, ReadinessChip } from "@/components/reservations/conflict-chips";
import { getRecommendation } from "@/services/transport.service";
import { getAvailableVehicles } from "@/services/vehicle.service";
import { getDrivers } from "@/services/driver.service";
import { getDriverAssignments } from "@/services/driver-assignment.service";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";
import {
  MapPin,
  Clock,
  Users,
  CarFront,
  CheckCircle2,
  XCircle,
  Send,
  StickyNote,
  Building2,
  Loader2,
  Sparkles,
  ShieldCheck,
  UserCheck,
  AlertTriangle,
} from "lucide-react";

export function ReviewDialog({
  request,
  isOpen,
  onClose,
  onApprove,
  onReject,
  onAssign,
  isPending = false,
}) {
  const requestId = request?.request_id;

  // AI recommendation — deterministic scoring, fast.
  const { data: aiRec, isLoading: isAiLoading } = useQuery({
    queryKey: ["reservation-recommendation", requestId],
    queryFn: () => getRecommendation(requestId),
    enabled: isOpen && !!requestId,
  });

  // LLM narration — slow, nullable, streams in behind the scored result.
  const { data: narrated, isFetching: isNarrating } = useQuery({
    queryKey: ["reservation-recommendation", requestId, "narrated"],
    queryFn: () => getRecommendation(requestId, { narrate: true }),
    enabled: isOpen && !!requestId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Real custodial pairs — same three queries the assign dialog uses.
  // These are database-backed and always show even when the AI returns nothing.
  const { data: vehicles = [] } = useQuery({
    queryKey: ["available-vehicles", request?.pickup_datetime],
    queryFn: () => getAvailableVehicles(
      request?.pickup_datetime
        ? { pickup_at: request.pickup_datetime, ...(request.scheduled_arrival ? { return_at: request.scheduled_arrival } : {}) }
        : {}
    ),
    enabled: isOpen,
  });
  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers", { status: "Available", pickup_at: request?.pickup_datetime }],
    queryFn: () => getDrivers({
      status: "Available",
      ...(request?.pickup_datetime ? { pickup_at: request.pickup_datetime } : {}),
      ...(request?.scheduled_arrival ? { return_at: request.scheduled_arrival } : {}),
    }),
    enabled: isOpen,
  });
  const { data: pairingData } = useQuery({
    queryKey: ["driver-assignments", "active"],
    queryFn: () => getDriverAssignments(),
    enabled: isOpen,
  });

  if (!request) return null;

  const r = request;
  const conflicts = r.conflicts || [];
  const narration = narrated?.narration;
  const category = r.vehiclecategories?.category_name || r.requested_vehicle_type || "Standard Vehicle";
  const reqCategoryId = r.requested_category_id ?? null;
  const passengers = Number(r.passenger_count) || 1;

  // Build the best available pair from real DB data.
  // Logic mirrors assign-dialog: vehicle must be available + big enough + right class,
  // driver must be on duty. Pick the first sorted pair; AI score enhances it.
  const vById = new Map(vehicles.map((v) => [v.vehicle_id, v]));
  const onDuty = new Set(drivers.map((d) => d.driver_id));
  const driverById = new Map(drivers.map((d) => [d.driver_id, d]));
  const pairings = (pairingData?.assignments ?? [])
    .filter((a) => {
      const v = vById.get(a.vehicle_id);
      if (!v || !onDuty.has(a.driver_id)) return false;
      const seats = Number(v.seating_capacity) || 0;
      if (seats > 0 && seats < passengers) return false;
      if (reqCategoryId != null && v.category_id !== reqCategoryId) return false;
      return true;
    })
    .sort((a, b) => {
      const va = vById.get(a.vehicle_id);
      const vb = vById.get(b.vehicle_id);
      return (va?.plate_number || "").localeCompare(vb?.plate_number || "");
    });

  const bestPairing = pairings[0] ?? null;
  const bestVehicle = bestPairing ? vById.get(bestPairing.vehicle_id) : null;
  const bestDriver  = bestPairing ? driverById.get(bestPairing.driver_id) : null;

  // AI-scored pair overlay — the pair is the decision unit, so score/reasons/
  // risks come from the recommended pair's vehicle & driver halves. Falls back
  // to the legacy independent columns for read-back compatibility.
  const aiPair    = aiRec?.pair?.recommended;
  const aiVehicle = aiPair?.vehicle || aiRec?.vehicle?.recommended || r.ai_vehicle_recommendation;
  const aiDriver  = aiPair?.driver  || aiRec?.driver?.recommended  || r.ai_driver_recommendation;

  // Merge: prefer real pairing for identity, AI for score/reasons.
  const displayVehicle = bestVehicle
    ? {
        plate_number:    bestVehicle.plate_number,
        vehicle_name:    bestVehicle.vehicle_name,
        fuel_level:      bestVehicle.fuel_level,
        seating_capacity: bestVehicle.seating_capacity,
        score:           aiVehicle?.score ?? null,
        reasons:         aiVehicle?.reasons ?? [],
        detected_risks:  aiVehicle?.detected_risks ?? [],
        estimated_fuel_liters: aiVehicle?.estimated_fuel_liters ?? null,
      }
    : aiVehicle ?? null;

  const personName = (d) =>
    `${d?.employees?.first_name || d?.first_name || ""} ${d?.employees?.last_name || d?.last_name || ""}`.trim() ||
    (d?.driver_id ? `Driver #${d.driver_id}` : null);

  const displayDriver = bestDriver
    ? {
        driver_name:          personName(bestDriver) || bestDriver.driver_name,
        years_of_experience:  bestDriver.years_of_experience,
        rating:               bestDriver.rating,
        score:                aiDriver?.score ?? null,
        reasons:              aiDriver?.reasons ?? [],
        detected_risks:       aiDriver?.detected_risks ?? [],
      }
    : aiDriver ?? null;

  const pairCount   = pairings.length;
  const vehicleCount = vehicles.length;
  const driverCount  = drivers.length;
  const pairScore   = displayVehicle?.score ?? displayDriver?.score ?? null;

  // Pre-compute the diagnostic card for the no-pair-available state.
  // Computed here (not inside JSX) to avoid IIFE which breaks the JSX parser.
  const pickupLabel = r?.pickup_datetime
    ? `at ${formatDateTime(r.pickup_datetime)}`
    : "at the requested time";
  const noVehicles = vehicleCount === 0;
  const noDrivers  = driverCount  === 0;
  const noPairings = (pairingData?.assignments ?? []).length === 0;

  let _headline, _detail, _fix;
  if (noVehicles && noDrivers) {
    _headline = "Fully booked at this time slot";
    _detail   = `All vehicles and drivers are already scheduled or occupied ${pickupLabel}. This time window is at full capacity.`;
    _fix      = "Reschedule this request to a different time, or wait until a vehicle and driver complete their current trip.";
  } else if (noVehicles) {
    _headline = `No vehicles free ${pickupLabel}`;
    _detail   = `${driverCount} driver${driverCount !== 1 ? "s are" : " is"} available but all vehicles are already dispatched or occupied in this time window.`;
    _fix      = "Reschedule this request to a later time, or check the Dispatch page to see when vehicles become free.";
  } else if (noDrivers) {
    _headline = `No drivers free ${pickupLabel}`;
    _detail   = `${vehicleCount} vehicle${vehicleCount !== 1 ? "s are" : " is"} available but all drivers are already dispatched in this time window.`;
    _fix      = "Reschedule this request to a different time, or check driver schedules on the Dispatch page.";
  } else if (noPairings) {
    _headline = "No vehicle\u2013driver assignments configured";
    _detail   = `${vehicleCount} vehicle${vehicleCount !== 1 ? "s" : ""} and ${driverCount} driver${driverCount !== 1 ? "s" : ""} are free ${pickupLabel}, but no custodial pairings exist.`;
    _fix      = "Open a vehicle's detail page and assign a custodial driver to it before dispatching.";
  } else {
    _headline = "No eligible pair for this request";
    _detail   = `${vehicleCount} vehicle${vehicleCount !== 1 ? "s" : ""} and ${driverCount} driver${driverCount !== 1 ? "s" : ""} are free ${pickupLabel}, but none match this request's class (${category}) or seat requirement (${passengers} passenger${passengers !== 1 ? "s" : ""}).`;
    _fix      = "Try assigning a different vehicle class on the reservation, or add a vehicle of the required class to the fleet.";
  }

  const noPairEmptyState = (
    <div className="rounded-xl border border-warning/30 bg-warning/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-warning/20">
        <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
        <span className="text-xs font-bold text-warning">{_headline}</span>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-[11px] text-foreground-secondary leading-relaxed">{_detail}</p>
        <div className="flex items-start gap-1.5 bg-warning/10 rounded-lg p-2">
          <span className="text-[10px] font-bold text-warning uppercase tracking-wider shrink-0 mt-0.5">Action:</span>
          <p className="text-[11px] text-foreground font-medium leading-relaxed">{_fix}</p>
        </div>
        <div className="flex items-center gap-3 pt-0.5">
          <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
            <CarFront className="w-3 h-3" />
            {vehicleCount} vehicle{vehicleCount !== 1 ? "s" : ""} available
          </span>
          <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
            <UserCheck className="w-3 h-3" />
            {driverCount} driver{driverCount !== 1 ? "s" : ""} on duty
          </span>
          <span className="flex items-center gap-1 text-[10px] text-foreground-muted">
            <Users className="w-3 h-3" />
            {passengers} passenger{passengers !== 1 ? "s" : ""} needed
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl p-6 sm:max-w-2xl overflow-hidden">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                <Sparkles className="w-5 h-5 text-primary shrink-0" /> Request Review &amp; Decision Workspace
              </DialogTitle>
              <DialogDescription className="text-xs text-foreground-secondary mt-0.5">
                Review guest details and fleet readiness for <span className="font-mono font-semibold">{r.reservation_number || `REQ-#${r.request_id}`}</span>
              </DialogDescription>
            </div>
            <StatusBadge status={r.priority} entity="priority" />
          </div>
        </DialogHeader>

        <div className="space-y-3.5 py-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* Guest & Source Header */}
          <div className="p-3.5 rounded-xl bg-hover/50 border border-border/80 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Guest &amp; Reference</p>
              <p className="text-sm font-bold text-foreground mt-0.5">{r.guest_name || "Walk-in Guest"}</p>
              {r.booking_reference && (
                <p className="text-xs font-mono text-foreground-secondary mt-0.5">Ref: {r.booking_reference}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <span className="text-xs text-foreground-secondary font-medium flex items-center justify-end gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-primary" /> {r.source_system || "Booking System"}
              </span>
              <p className="text-xs text-foreground-muted mt-1">{r.created_at ? formatDateTime(r.created_at) : "Just now"}</p>
            </div>
          </div>

          {/* Route & Timing Box */}
          <div className="p-3.5 rounded-xl bg-surface border border-border space-y-2.5 text-sm shadow-xs">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-danger shrink-0" />
              <span className="text-xs font-semibold text-foreground-muted uppercase w-16">Pickup:</span>
              <span className="font-medium text-foreground truncate">{r.pickup_location || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-success shrink-0" />
              <span className="text-xs font-semibold text-foreground-muted uppercase w-16">Dropoff:</span>
              <span className="font-medium text-foreground truncate">{r.dropoff_location || "—"}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border/60 text-xs">
              <div className="flex items-center gap-1.5 text-foreground font-medium">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span>{r.pickup_datetime ? formatDateTime(r.pickup_datetime) : "—"}</span>
              </div>
              <div className="flex items-center gap-1 text-foreground font-medium">
                <Users className="w-3.5 h-3.5 text-foreground-muted" />
                <span>{r.passenger_count || 1} Passengers</span>
              </div>
              <div className="flex items-center gap-1 text-foreground font-medium">
                <CarFront className="w-3.5 h-3.5 text-foreground-muted" />
                <span>{category}</span>
              </div>
            </div>
          </div>

          {/* Expanded Fleet Readiness & Available Fleet Info Box */}
          <div className="p-3.5 rounded-xl bg-muted/20 border border-border space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground text-sm">Fleet Readiness &amp; Availability</span>
              </div>
              <ReadinessChip conflicts={conflicts} status={r.fleet_status} />
            </div>

            {/* Conflict Check */}
            {conflicts.length > 0 ? (
              <div className="pt-1">
                <ConflictChips conflicts={conflicts} />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-success font-semibold bg-success/10 p-2 rounded-lg border border-success/20">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>No scheduling, driver shift, or maintenance conflicts detected for this window.</span>
              </div>
            )}

            {/* Live Available Fleet & Driver Insights — Combined Pair */}
            <div className="space-y-2 pt-1">
              {/* Loading skeleton while pair data loads */}
              {!pairingData && isAiLoading ? (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                    <Sparkles className="w-4 h-4 animate-spin shrink-0" />
                    <span>Scoring available vehicle–driver pairs…</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Skeleton className="h-16 w-full rounded-lg bg-primary/10" />
                    <Skeleton className="h-16 w-full rounded-lg bg-primary/10" />
                  </div>
                </div>
              ) : (displayVehicle || displayDriver) ? (
                <div className="rounded-xl border border-primary/25 bg-primary/5 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-primary/15">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span>Best Available Pair</span>
                      {pairCount > 1 && (
                        <span className="text-primary/60 font-normal">· {pairCount - 1} more eligible</span>
                      )}
                    </div>
                    <Badge variant="primary" className="text-[10px] font-bold shrink-0">
                      {pairScore != null ? `${pairScore}% Match` : "Ready"}
                    </Badge>
                  </div>

                  {/* Substitute-pair attribution from the AI pair decision */}
                  {aiPair?.reason_type === "replacement" && aiPair?.replacement_reason && (
                    <div className="flex items-start gap-1.5 px-3 py-1.5 border-b border-primary/15 bg-warning/10 text-[11px] text-foreground-secondary">
                      <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
                      <span>
                        <span className="font-semibold text-foreground">Substitute pair.</span> The designated
                        driver was unavailable: {aiPair.replacement_reason}
                      </span>
                    </div>
                  )}

                  {/* Combined Vehicle + Driver side by side */}
                  <div className="grid grid-cols-2 divide-x divide-primary/15">
                    {/* Vehicle side */}
                    <div className="p-3 space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                        <CarFront className="w-3 h-3 text-primary" />
                        <span>Vehicle</span>
                        <Badge variant="success" className="text-[9px] py-0 px-1 ml-auto font-semibold">
                          {vehicleCount > 0 ? `${vehicleCount} Avail` : "Class Match"}
                        </Badge>
                      </div>
                      <p className="text-sm font-bold text-foreground truncate">
                        {displayVehicle?.plate_number
                          ? `${displayVehicle.plate_number}${displayVehicle.vehicle_name ? ` · ${displayVehicle.vehicle_name}` : ""}`
                          : displayVehicle?.vehicle_name || `Class: ${category}`}
                      </p>
                      {/* AI top reason (only when AI has scored this vehicle) */}
                      {displayVehicle?.reasons?.length > 0 ? (
                        <p className="text-[11px] text-foreground-muted truncate">
                          {displayVehicle.reasons[0]}
                        </p>
                      ) : displayVehicle?.seating_capacity ? (
                        <p className="text-[11px] text-foreground-muted truncate">
                          {displayVehicle.seating_capacity} seats · Available
                        </p>
                      ) : null}
                      {/* Risk or fuel hint */}
                      {displayVehicle?.detected_risks?.length > 0 ? (
                        <p className="text-[11px] text-warning font-medium truncate">
                          ⚠ {displayVehicle.detected_risks[0].message}
                        </p>
                      ) : displayVehicle?.fuel_level != null ? (
                        <p className="text-[11px] text-foreground-muted truncate">
                          Fuel: {displayVehicle.fuel_level}%
                          {displayVehicle.estimated_fuel_liters != null
                            ? ` · Est. ${displayVehicle.estimated_fuel_liters}L for trip`
                            : ""}
                        </p>
                      ) : null}
                    </div>

                    {/* Driver side */}
                    <div className="p-3 space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                        <UserCheck className="w-3 h-3 text-info" />
                        <span>Driver</span>
                        <Badge variant="info" className="text-[9px] py-0 px-1 ml-auto font-semibold">
                          {driverCount > 0 ? `${driverCount} On Duty` : "Active"}
                        </Badge>
                      </div>
                      <p className="text-sm font-bold text-foreground truncate">
                        {displayDriver?.driver_name || "—"}
                      </p>
                      {/* AI top reason (only when AI has scored this driver) */}
                      {displayDriver?.reasons?.length > 0 ? (
                        <p className="text-[11px] text-foreground-muted truncate">
                          {displayDriver.reasons[0]}
                        </p>
                      ) : displayDriver?.years_of_experience != null ? (
                        <p className="text-[11px] text-foreground-muted truncate">
                          {displayDriver.years_of_experience} yr{displayDriver.years_of_experience !== 1 ? "s" : ""} experience
                        </p>
                      ) : null}
                      {/* Risk or rating hint */}
                      {displayDriver?.detected_risks?.length > 0 ? (
                        <p className="text-[11px] text-warning font-medium truncate">
                          ⚠ {displayDriver.detected_risks[0].message}
                        </p>
                      ) : displayDriver?.avg_guest_rating != null ? (
                        <p className="text-[11px] text-foreground-muted truncate">
                          ⭐ {Number(displayDriver.avg_guest_rating).toFixed(1)}/5 guest rating
                          {displayDriver.total_completed_trips > 0
                            ? ` · ${displayDriver.total_completed_trips} trips`
                            : ""}
                        </p>
                      ) : displayDriver?.rating != null ? (
                        <p className="text-[11px] text-foreground-muted truncate">
                          ⭐ {Number(displayDriver.rating).toFixed(1)}/5 guest rating
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* LLM rationale */}
                  {(narration || isNarrating) && (
                    <div className="px-3 pb-2.5 pt-1.5 border-t border-primary/15 space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
                        AI Rationale{narration?.provider ? ` · ${narration.provider}` : ""}
                      </span>
                      {narration ? (
                        <p className="text-[11px] leading-relaxed text-foreground-secondary">{narration.text}</p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-foreground-muted flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                          Writing rationale…
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                noPairEmptyState
              )}
            </div>
          </div>

          {/* Special Requests */}
          {r.special_requests && (
            <div className="p-3 rounded-xl bg-warning/10 border border-warning/30 space-y-1">
              <span className="text-xs font-semibold text-warning flex items-center gap-1">
                <StickyNote className="w-3.5 h-3.5" /> Special Guest Requests
              </span>
              <p className="text-xs text-foreground font-medium">{r.special_requests}</p>
            </div>
          )}
        </div>

        {/* Clean, Non-Truncated Action Decision Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5 border-t border-border mt-2">
          <Button
            variant="outline"
            className="text-danger border-danger/30 hover:bg-danger/10 hover:text-danger text-xs font-semibold px-3 h-9 shrink-0"
            disabled={isPending}
            onClick={() => onReject(r)}
          >
            <XCircle className="w-4 h-4 mr-1.5" />
            Reject Request
          </Button>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="success"
              className="text-xs font-semibold px-3.5 h-9"
              disabled={isPending}
              onClick={() => onApprove(r)}
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              Approve Request
            </Button>
            <Button
              variant="default"
              className="text-xs font-semibold px-3.5 h-9"
              disabled={isPending}
              onClick={() => onAssign(r)}
            >
              <Send className="w-4 h-4 mr-1.5" />
              Approve &amp; Assign Now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
