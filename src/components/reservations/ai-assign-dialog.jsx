"use client";

import { useMemo, useState } from "react";
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
import { ConflictBlock } from "@/components/reservations/conflict-block";
import { getRecommendation } from "@/services/transport.service";
import { getAvailableVehicles } from "@/services/vehicle.service";
import { getDrivers } from "@/services/driver.service";
import { getDriverAssignments } from "@/services/driver-assignment.service";
import { getSubstituteSchedules } from "@/services/substitute-driver.service";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";
import {
  MapPin,
  Clock,
  Users,
  CarFront,
  CheckCircle2,
  Send,
  StickyNote,
  Building2,
  Loader2,
  Sparkles,
  ShieldCheck,
  UserCheck,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";

// AI-Assisted Assignment — the one action for accepting a request.
//
// There is no standalone review/approve step anymore: a request opens straight
// into assignment, backed by the deterministic Smart Dispatch scorer. The scorer
// picks the best eligible vehicle+driver pair, the LLM writes a short rationale
// behind it (best-effort, nullable), and a single "Assign Now" commits the pair
// (Pending → Scheduled → Assigned, auto-creating the dispatch). The dispatcher
// can also drive the pair from the plain assign dialog when they want to pick
// something other than the recommended pairing.
export function AiAssignDialog({
  request,
  isOpen,
  onClose,
  onAssign,
  isPending = false,
  conflictError = null,
}) {
  const requestId = request?.request_id;

  // Manual override state: the recommended pair is the default, but the
  // dispatcher can pick any valid vehicle+driver pair from the collapsible
  // list below, which then wins for the commit.
  const [selection, setSelection] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // AI recommendation — deterministic scoring, fast.
  const { data: aiRec, isLoading: isAiLoading } = useQuery({
    queryKey: ["reservation-recommendation", requestId],
    queryFn: () => getRecommendation(requestId),
    enabled: isOpen && !!requestId,
  });

  // LLM narration is declared further down: it is pinned to the best available
  // pair, so it cannot be issued until that pair has been computed.

  // Real custodial pairs — same three queries the assign dialog uses.
  // These are database-backed and always show even when the AI returns nothing.
  const { data: vehiclesData, isLoading: vehiclesLoading } = useQuery({
    queryKey: ["available-vehicles", request?.pickup_datetime],
    queryFn: () => getAvailableVehicles(
      request?.pickup_datetime
        ? { pickup_at: request.pickup_datetime, ...(request.scheduled_arrival ? { return_at: request.scheduled_arrival } : {}) }
        : {}
    ),
    enabled: isOpen,
  });
  const { data: driversData, isLoading: driversLoading } = useQuery({
    queryKey: ["drivers", { status: "Available", pickup_at: request?.pickup_datetime }],
    queryFn: () => getDrivers({
      status: "Available",
      ...(request?.pickup_datetime ? { pickup_at: request.pickup_datetime } : {}),
      ...(request?.scheduled_arrival ? { return_at: request.scheduled_arrival } : {}),
    }),
    enabled: isOpen,
  });
  const vehicles = vehiclesData ?? [];
  const drivers = driversData ?? [];
  const { data: pairingData, isLoading: pairingLoading } = useQuery({
    queryKey: ["driver-assignments", "active"],
    queryFn: () => getDriverAssignments(),
    enabled: isOpen,
  });

  // Substitute coverage (migration 032): a vehicle whose custodian is off duty
  // but covered by a substitute on the pickup date is a valid pair. Mirrors the
  // assign dialog so the DB-backed "best pair" fallback never sells the dispatcher
  // short when an eligible substitute exists.
  const subDate = request?.pickup_datetime ? String(request.pickup_datetime).slice(0, 10) : null;
  const { data: subData, isLoading: subsLoading } = useQuery({
    queryKey: ["substitute-schedules", subDate],
    queryFn: () => getSubstituteSchedules(subDate ? { date: subDate } : {}),
    enabled: isOpen && !!subDate,
  });
  const substituteRows = subData?.schedules ?? [];

  // Build the best available pair from real DB data.
  // Logic mirrors assign-dialog: vehicle must be available + big enough + right class,
  // driver must be on duty. A vehicle whose custodian is off duty but covered by a
  // substitute for the pickup date is offered with the substitute instead. Pick the
  // first sorted pair; AI score enhances it.
  //
  // Computed above the `!request` guard, and before the narration query, because
  // the advisory is pinned to this pair — it must be known before we ask for it.
  const reqCategoryId = request?.requested_category_id ?? null;
  const passengers = Number(request?.passenger_count) || 1;
  const vById = new Map(vehicles.map((v) => [v.vehicle_id, v]));
  const onDuty = new Set(drivers.map((d) => d.driver_id));
  const driverById = new Map(drivers.map((d) => [d.driver_id, d]));
  const pairingRows = (pairingData?.assignments ?? []).filter((a) => {
    const v = vById.get(a.vehicle_id);
    if (!v || !onDuty.has(a.driver_id)) return false;
    const seats = Number(v.seating_capacity) || 0;
    if (seats > 0 && seats < passengers) return false;
    if (reqCategoryId != null && v.category_id !== reqCategoryId) return false;
    return true;
  });
  const offeredVehicleIds = new Set(pairingRows.map((a) => a.vehicle_id));
  const subRows = substituteRows
    .filter((s) => {
      const v = vById.get(s.vehicle_id);
      if (!v || offeredVehicleIds.has(s.vehicle_id) || !onDuty.has(s.substitute_driver_id)) return false;
      const seats = Number(v.seating_capacity) || 0;
      if (seats > 0 && seats < passengers) return false;
      if (reqCategoryId != null && v.category_id !== reqCategoryId) return false;
      return true;
    })
    .map((s) => ({
      driver_id: s.substitute_driver_id,
      vehicle_id: s.vehicle_id,
      is_substitute: true,
    }));
  const pairings = [...pairingRows, ...subRows].sort((a, b) => {
    const va = vById.get(a.vehicle_id);
    const vb = vById.get(b.vehicle_id);
    return (va?.plate_number || "").localeCompare(vb?.plate_number || "");
  });

  const bestPairing = pairings[0] ?? null;
  const bestVehicle = bestPairing ? vById.get(bestPairing.vehicle_id) : null;
  const bestDriver  = bestPairing ? driverById.get(bestPairing.driver_id) : null;

  // LLM narration — slow, nullable, streams in behind the scored result.
  //
  // PINNED to the pair above. The server ranks its own candidate pool and can
  // pick a different vehicle/driver; narrating that pick produced a checklist
  // about a dispatch the dispatcher was never going to make. Held until the
  // candidate pools have resolved so we never pin to a half-loaded pair.
  const poolsReady =
    vehiclesData !== undefined &&
    driversData !== undefined &&
    pairingData !== undefined &&
    (!subDate || subData !== undefined);

  const { data: narrated, isFetching: isNarrating } = useQuery({
    queryKey: [
      "reservation-recommendation",
      requestId,
      "narrated",
      bestPairing?.vehicle_id ?? null,
      bestPairing?.driver_id ?? null,
    ],
    queryFn: () =>
      getRecommendation(requestId, {
        narrate: true,
        vehicleId: bestPairing?.vehicle_id ?? null,
        driverId: bestPairing?.driver_id ?? null,
      }),
    enabled: isOpen && !!requestId && poolsReady,
    retry: false,
  });

  if (!request) return null;

  const r = request;
  const conflicts = r.conflicts || [];
  const narration = narrated?.narration;
  const category = r.vehiclecategories?.category_name || r.requested_vehicle_type || "Standard Vehicle";

  // AI-scored pair overlay — the pair is the decision unit, so score/reasons/
  // risks come from the recommended pair's vehicle & driver halves. Falls back
  // to the legacy independent columns for read-back compatibility.
  const aiPair    = aiRec?.pair?.recommended;
  const aiVehicle = aiPair?.vehicle || aiRec?.vehicle?.recommended || r.ai_vehicle_recommendation;
  const aiDriver  = aiPair?.driver  || aiRec?.driver?.recommended  || r.ai_driver_recommendation;

  // The scorer ranks its own candidate pool and can land on a different pair
  // than the custodial one shown here. Its score, reasons and risks describe
  // THAT pair, so they may only be overlaid when the two agree — otherwise the
  // card advertises a match percentage earned by a vehicle it isn't offering.
  const aiMatchesCard =
    !!bestPairing &&
    aiPair?.vehicle_id === bestPairing.vehicle_id &&
    aiPair?.driver_id === bestPairing.driver_id;
  const cardVehicleAi = aiMatchesCard ? aiVehicle : null;
  const cardDriverAi  = aiMatchesCard ? aiDriver  : null;

  // Merge: prefer real pairing for identity, AI for score/reasons.
  const displayVehicle = bestVehicle
    ? {
        plate_number:    bestVehicle.plate_number,
        vehicle_name:    bestVehicle.vehicle_name,
        fuel_level:      bestVehicle.fuel_level,
        seating_capacity: bestVehicle.seating_capacity,
        score:           cardVehicleAi?.score ?? null,
        reasons:         cardVehicleAi?.reasons ?? [],
        detected_risks:  cardVehicleAi?.detected_risks ?? [],
        estimated_fuel_liters: cardVehicleAi?.estimated_fuel_liters ?? null,
      }
    : aiVehicle ?? null;

  const personName = (d) =>
    `${d?.employees?.first_name || d?.first_name || ""} ${d?.employees?.last_name || d?.last_name || ""}`.trim() ||
    (d?.driver_id ? `Driver #${d.driver_id}` : null);

  const displayDriver = bestDriver
    ? {
        driver_name:          (personName(bestDriver) || bestDriver.driver_name) + (bestPairing?.is_substitute ? " (substitute)" : ""),
        years_of_experience:  bestDriver.years_of_experience,
        rating:               bestDriver.rating,
        score:                cardDriverAi?.score ?? null,
        reasons:              cardDriverAi?.reasons ?? [],
        detected_risks:       cardDriverAi?.detected_risks ?? [],
      }
    : aiDriver ?? null;

  const pairCount   = pairings.length;
  const vehicleCount = vehicles.length;
  const driverCount  = drivers.length;
  const pairScore   = displayVehicle?.score ?? displayDriver?.score ?? null;

  // The pair "Assign Now" commits: the DB-backed best eligible pair first,
  // falling back to the AI-recommended pair's ids when a real pairing could not
  // be assembled. When a manual pair is selected it wins over both.
  const recommended = bestPairing
    ? { vehicleId: bestPairing.vehicle_id, driverId: bestPairing.driver_id }
    : {
        vehicleId: aiVehicle?.vehicle_id ?? null,
        driverId: aiDriver?.driver_id ?? null,
      };

  // ── Manual pair picker ──
  //
  // The exact same eligible-pair list the former separate Assign Resources dialog
  // offered: custodial pairings (or their substitute coverage) whose vehicle is
  // free in the window, big enough, of the booked class, and whose driver is on
  // duty. Live-sources everything from the queries the AI card already runs, so
  // the manual list and the recommended-pair card never disagree.
  const rows = pairingData?.assignments ?? [];
  const seatsTooFew = (v) => {
    const seats = Number(v?.seating_capacity) || 0;
    return seats > 0 && seats < passengers;
  };

  const custodian = rows
    .filter((a) => {
      const v = vById.get(a.vehicle_id);
      return (
        v &&
        onDuty.has(a.driver_id) &&
        !seatsTooFew(v) &&
        (reqCategoryId == null || v.category_id === reqCategoryId)
      );
    })
    .map((a) => {
      const v = vById.get(a.vehicle_id);
      return {
        value: `${a.vehicle_id}:${a.driver_id}`,
        vehicleId: a.vehicle_id,
        driverId: a.driver_id,
        plate: v.plate_number,
        model: v.model,
        seats: v.seating_capacity,
        driverName: personName(a),
      };
    })
    .sort((a, b) => (a.plate || "").localeCompare(b.plate || ""));

  const custodianVehicleIds = new Set(custodian.map((o) => o.vehicleId));
  const substitute = substituteRows
    .filter((s) => {
      const v = vById.get(s.vehicle_id);
      return (
        v &&
        !custodianVehicleIds.has(s.vehicle_id) &&
        onDuty.has(s.substitute_driver_id) &&
        !seatsTooFew(v) &&
        (reqCategoryId == null || v.category_id === reqCategoryId)
      );
    })
    .map((s) => {
      const v = vById.get(s.vehicle_id);
      const subName =
        `${s.first_name || ""} ${s.last_name || ""}`.trim() ||
        (s.substitute_driver_id ? `Driver #${s.substitute_driver_id}` : "substitute");
      return {
        value: `${s.vehicle_id}:${s.substitute_driver_id}`,
        vehicleId: s.vehicle_id,
        driverId: s.substitute_driver_id,
        plate: v.plate_number,
        model: v.model,
        seats: v.seating_capacity,
        driverName: subName,
        note: "substitute",
      };
    })
    .sort((a, b) => (a.plate || "").localeCompare(b.plate || ""));

  const options = [...custodian, ...substitute];

  // A request may already hold a combination that is no longer an eligible pair;
  // keep showing it so a reopened picker never silently drops the current state.
  const pinned = useMemo(() => {
    if (!request?.vehicle_id && !request?.driver_id) return null;
    const key = `${request.vehicle_id ?? ""}:${request.driver_id ?? ""}`;
    if (options.some((o) => o.value === key)) return null;
    const v = vehicles.find((x) => x.vehicle_id === request.vehicle_id);
    const d = drivers.find((x) => x.driver_id === request.driver_id);
    const sourceLoading = vehiclesLoading || driversLoading || pairingLoading || subsLoading;
    if (sourceLoading) return null;
    return {
      value: key,
      vehicleId: request.vehicle_id ?? null,
      driverId: request.driver_id ?? null,
      plate: v?.plate_number || request.plate_number || (request.vehicle_id ? `Vehicle #${request.vehicle_id}` : "No vehicle"),
      model: v?.model,
      seats: v?.seating_capacity,
      driverName: request.driver_id ? (personName(d ?? { driver_id: request.driver_id }) || "No driver") : "No driver",
      isPinned: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, options, vehicles, drivers, vehiclesLoading, driversLoading, pairingLoading, subsLoading]);

  const allOptions = pinned ? [pinned, ...options] : options;
  const manualSelected = selection
    ? (allOptions.find((o) => o.value === selection) ?? null)
    : null;

  // The booked class, named so a short list explains itself.
  const requiredClass =
    reqCategoryId != null
      ? request?.vehiclecategories?.category_name || request?.requested_vehicle_type || "Requested class"
      : null;

  // Vehicles free in this window that no row offers — nobody is designated to
  // them, or their designated driver is unavailable and no substitute is
  // assigned for this date. Reported as a footnote.
  const manualOfferedVehicleIds = new Set(allOptions.map((o) => o.vehicleId));
  const hiddenCount = vehicles.filter((v) => !manualOfferedVehicleIds.has(v.vehicle_id)).length;

  const searchTerm = searchQuery.trim().toLowerCase();
  const filteredOptions = allOptions.filter((o) => {
    if (!searchTerm) return true;
    return [o.plate, o.model, o.driverName].filter(Boolean).some((f) =>
      String(f).toLowerCase().includes(searchTerm)
    );
  });

  const manualLoading = vehiclesLoading || driversLoading || pairingLoading || subsLoading;

  // The pair the commit uses: a manual pick wins, else the AI recommendation.
  const commitVehicleId = manualSelected ? manualSelected.vehicleId : recommended.vehicleId;
  const commitDriverId  = manualSelected ? manualSelected.driverId  : recommended.driverId;
  const canCommit = Boolean(commitVehicleId || commitDriverId);

  const blocking = conflictError?.data?.conflicts || [];

  const commit = (force) =>
    onAssign?.({ request: r, vehicleId: commitVehicleId, driverId: commitDriverId, force });

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
          <span className="text-[11px] font-bold text-warning uppercase tracking-wider shrink-0 mt-0.5">Action:</span>
          <p className="text-[11px] text-foreground font-medium leading-relaxed">{_fix}</p>
        </div>
        <div className="flex items-center gap-3 pt-0.5">
          <span className="flex items-center gap-1 text-[11px] text-foreground-muted">
            <CarFront className="w-3 h-3" />
            {vehicleCount} vehicle{vehicleCount !== 1 ? "s" : ""} available
          </span>
          <span className="flex items-center gap-1 text-[11px] text-foreground-muted">
            <UserCheck className="w-3 h-3" />
            {driverCount} driver{driverCount !== 1 ? "s" : ""} on duty
          </span>
          <span className="flex items-center gap-1 text-[11px] text-foreground-muted">
            <Users className="w-3 h-3" />
            {passengers} passenger{passengers !== 1 ? "s" : ""} needed
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl p-4 sm:p-6 w-[95vw] sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                <Sparkles className="w-5 h-5 text-primary shrink-0" /> AI-Assisted Assignment
              </DialogTitle>
              <DialogDescription className="text-xs text-foreground-secondary mt-0.5">
                Assign resources to <span className="font-mono font-semibold">{r.reservation_number || `REQ-#${r.request_id}`}</span> with the Smart Dispatch recommendation
              </DialogDescription>
            </div>
            <StatusBadge status={r.priority} entity="priority" />
          </div>
        </DialogHeader>

        <div className="space-y-3.5 py-2 flex-1 overflow-y-auto pr-1 -mr-1">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-4 h-4 text-danger shrink-0" />
                <span className="text-xs font-semibold text-foreground-muted uppercase w-16 shrink-0">Pickup:</span>
                <span className="font-medium text-foreground truncate">{r.pickup_location || "—"}</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-4 h-4 text-success shrink-0" />
                <span className="text-xs font-semibold text-foreground-muted uppercase w-16 shrink-0">Dropoff:</span>
                <span className="font-medium text-foreground truncate">{r.dropoff_location || "—"}</span>
              </div>
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
                    <Badge variant="primary" className="text-[11px] font-bold shrink-0">
                      {pairScore != null ? `${pairScore}% Match` : "Ready"}
                    </Badge>
                  </div>

                  {/* Substitute-pair attribution from the AI pair decision */}
                  {aiMatchesCard && aiPair?.reason_type === "replacement" && aiPair?.replacement_reason && (
                    <div className="flex items-start gap-1.5 px-3 py-1.5 border-b border-primary/15 bg-warning/10 text-[11px] text-foreground-secondary">
                      <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
                      <span>
                        <span className="font-semibold text-foreground">Substitute pair.</span> The designated
                        driver was unavailable: {aiPair.replacement_reason}
                      </span>
                    </div>
                  )}

                  {/* Combined Vehicle + Driver side by side */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-primary/15">
                    {/* Vehicle side */}
                    <div className="p-3 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
                        <CarFront className="w-3 h-3 text-primary" />
                        <span>Vehicle</span>
                        <Badge variant="success" className="text-[11px] py-0 px-1 ml-auto font-semibold">
                          {vehicleCount > 0 ? `${vehicleCount} Avail` : "Class Match"}
                        </Badge>
                      </div>
                      <p className="text-sm font-bold text-foreground truncate">
                        {displayVehicle?.plate_number
                          ? `${displayVehicle.plate_number}${displayVehicle.vehicle_name ? ` · ${displayVehicle.vehicle_name}` : ""}`
                          : displayVehicle?.vehicle_name || `Class: ${category}`}
                      </p>
                    </div>

                    {/* Driver side */}
                    <div className="p-3 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
                        <UserCheck className="w-3 h-3 text-info" />
                        <span>Driver</span>
                        <Badge variant="info" className="text-[11px] py-0 px-1 ml-auto font-semibold">
                          {driverCount > 0 ? `${driverCount} On Duty` : "Active"}
                        </Badge>
                      </div>
                      <p className="text-sm font-bold text-foreground truncate">
                        {displayDriver?.driver_name || "—"}
                      </p>
                    </div>
                  </div>

                  {/* LLM rationale */}
                  {(narrated || isNarrating) && (
                    <div className="px-4 py-3.5 border-t border-primary/10 bg-primary/[0.02] space-y-2.5 transition-all duration-300">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-primary/95">
                          AI Dispatch Advisory
                        </span>
                        {narration?.provider && (
                          <span className="text-[9px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full ml-auto">
                            {narration.provider}
                          </span>
                        )}
                      </div>

                      {isNarrating ? (
                        <div className="flex items-center gap-2 text-[11px] text-foreground-muted py-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                          <span className="animate-pulse">Analyzing dispatch safety &amp; efficiency...</span>
                        </div>
                      ) : narration ? (
                        <ul className="space-y-2">
                          {(narration.text || "")
                            .split("\n")
                            .map((line) => line.replace(/^[✓✓\s\-*]+/, "").trim())
                            .filter(Boolean)
                            .map((point, idx) => (
                              <li key={idx} className="flex items-start gap-2.5 text-[11px] leading-relaxed text-foreground-secondary">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                                <span>{point}</span>
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-danger/80 bg-danger/[0.03] border border-danger/10 px-2.5 py-2 rounded-lg flex items-center gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0" />
                          <span>AI Advisory currently offline (provider limit or network issues). Proceed with standard protocols.</span>
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

          {/* Choose manually — the dispatcher can override the recommendation */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3.5 py-3 text-left hover:bg-hover/50 transition-colors"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Search className="w-4 h-4 text-foreground-muted shrink-0" />
                Choose manually
                {manualSelected && (
                  <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    {manualSelected.plate}
                  </span>
                )}
              </span>
              {showManual ? (
                <ChevronUp className="w-4 h-4 text-foreground-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-foreground-muted" />
              )}
            </button>

            {showManual && (
              <div className="border-t border-border/60 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-secondary">
                    Vehicle &amp; Driver Assignment
                  </span>
                  {requiredClass && (
                    <Badge variant="outline" className="text-[10px] font-semibold text-primary">
                      {requiredClass} only
                    </Badge>
                  )}
                </div>

                {allOptions.length > 3 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-foreground-muted" />
                    <input
                      type="text"
                      placeholder="Search by plate, model, or driver..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 text-xs h-9 bg-surface/80 border border-border/80 rounded-xl focus:border-primary focus:outline-hidden"
                    />
                  </div>
                )}

                <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
                  {manualLoading ? (
                    <div className="flex h-20 w-full items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 text-xs font-medium text-foreground-muted">
                      Loading available vehicles...
                    </div>
                  ) : filteredOptions.length === 0 ? (
                    <div className="flex h-20 w-full flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 p-3 text-center">
                      <p className="text-xs font-semibold text-foreground">
                        {allOptions.length > 0 ? "No pairs match your search" : "No valid pairs found"}
                      </p>
                      <p className="text-[11px] text-foreground-muted mt-0.5">
                        {allOptions.length > 0
                          ? "Clear the search to see every assignable pair."
                          : "A vehicle is only offered with its designated driver — or a substitute assigned to it for this date. Assign a substitute first, then reopen."}
                      </p>
                    </div>
                  ) : (
                    filteredOptions.map((o) => {
                      const isSelected = selection === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => {
                            setSelection(o.value);
                            setShowManual(false);
                          }}
                          className={`w-full text-left p-2.5 rounded-xl border transition-all duration-200 flex items-center justify-between ${
                            isSelected
                              ? "border-primary bg-primary/10 ring-2 ring-primary/20 shadow-xs"
                              : "border-border/60 bg-surface/60 hover:bg-hover hover:border-border"
                          }`}
                        >
                          <div className="space-y-1 min-w-0 pr-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center rounded-lg border border-border/80 bg-surface px-2 py-0.5 font-data text-xs font-bold text-foreground shadow-2xs">
                                {o.plate}
                              </span>
                              {o.model && (
                                <span className="text-xs font-bold text-foreground truncate max-w-[150px]">
                                  {o.model}
                                </span>
                              )}
                              {o.seats && (
                                <span className="text-[10px] font-semibold text-foreground-muted bg-muted/60 px-1.5 py-0.5 rounded-full">
                                  {o.seats} seats
                                </span>
                              )}
                              {o.isPinned && (
                                <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                                  Current Assignment
                                </span>
                              )}
                            </div>
                            <span className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                              <UserCheck className="w-3 h-3 text-primary shrink-0" />
                              <span className="font-semibold truncate">{o.driverName}</span>
                              {o.note && (
                                <span className="shrink-0 text-[10px] font-semibold text-foreground-muted bg-muted/60 px-1.5 py-0.5 rounded-full">
                                  {o.note}
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="shrink-0 pl-2">
                            {isSelected ? (
                              <CheckCircle2 className="w-4 h-4 text-primary" />
                            ) : (
                              <div className="w-4 h-4 rounded-full border border-border/80" />
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {!manualLoading && hiddenCount > 0 && (
                  <p className="text-[11px] leading-relaxed text-foreground-muted">
                    {hiddenCount === 1
                      ? "1 vehicle is free for this window but has no driver cleared to take it."
                      : `${hiddenCount} vehicles are free for this window but have no driver cleared to take them.`}{" "}
                    Assign a designated or substitute driver to offer them here.
                  </p>
                )}

                {manualSelected?.isPinned && (
                  <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-2.5">
                    <Info className="mt-0.5 w-3.5 h-3.5 shrink-0 text-warning" aria-hidden="true" />
                    <p className="min-w-0 text-[11px] text-foreground-secondary leading-relaxed">
                      {manualSelected.driverId
                        ? `${manualSelected.plate} and ${manualSelected.driverName} are not a current valid pairing.`
                        : `${manualSelected.plate} has no driver assigned.`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Blocking conflicts surfaced by the server (409) */}
          <ConflictBlock conflicts={blocking} />
        </div>

        {/* Action Footer */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3.5 border-t border-border mt-2">
          <p className="text-[11px] text-foreground-muted leading-snug">
            {blocking.length > 0
              ? "Overriding records the override on the request timeline."
              : manualSelected
                ? `Assigning commits ${manualSelected.plate} with ${manualSelected.driverName} and schedules the dispatch.`
                : "Assigning commits the recommended vehicle & driver and schedules the dispatch automatically."}
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0 w-full sm:w-auto">
            <Button
              variant="outline"
              className="text-xs font-semibold px-3.5 h-9 w-full sm:w-auto"
              disabled={isPending}
              onClick={onClose}
            >
              Not now
            </Button>
            {blocking.length > 0 ? (
              <Button
                variant="destructive"
                className="text-xs font-semibold px-3.5 h-9 w-full sm:w-auto"
                disabled={isPending}
                onClick={() => commit(true)}
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Send className="w-4 h-4 mr-1.5" />}
                Override &amp; Assign
              </Button>
            ) : (
              <Button
                variant="default"
                className="text-xs font-semibold px-3.5 h-9 w-full sm:w-auto"
                disabled={isPending || !canCommit}
                onClick={() => commit(false)}
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Send className="w-4 h-4 mr-1.5" />}
                {isPending ? "Assigning…" : manualSelected ? "Assign Selected" : "Assign Now"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}