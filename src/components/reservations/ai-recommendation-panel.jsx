"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TONE_TEXT, severityTone } from "@/components/ui/status-badge";
import { ConflictBlock } from "@/components/reservations/conflict-block";
import { toast } from "@/components/ui/toast";
import { getRecommendation, assignResources } from "@/services/transport.service";
import { cn, formatDateTime, formatDistance, formatDuration } from "@/lib/utils";
import {
  CarFront,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  RefreshCw,
  Route,
  Shuffle,
  Sparkles,
  TriangleAlert,
  UserCheck,
  X,
} from "lucide-react";

// Phase 14 — the AI advisor's proposal for one request.
//
// AI NEVER ASSIGNS. The GET behind this panel is a pure preview that writes
// nothing, and the only path to a committed assignment is the Accept button,
// which calls the same assign endpoint the manual dialog uses. So the same
// conflict check, the same 409, and the same timeline entry apply whether a
// dispatcher picked the vehicle themselves or agreed with the advisor.
//
// Scoring is deterministic (lib/ai/dispatch-advisor.js): every number here traces
// to a rule, which is why the panel can explain itself instead of just asserting.
const PICK = { RECOMMENDED: "recommended", ALTERNATE: "alternate" };

/** Scorer confidence is 0–1; the bar wants a percentage. */
function confidencePercent(candidate) {
  const c = Number(candidate?.confidence);
  return Number.isFinite(c) ? Math.round(c * 100) : 0;
}

function confidenceTone(pct) {
  if (pct >= 80) return "success";
  if (pct >= 60) return "primary";
  if (pct >= 40) return "warning";
  return "danger";
}

function RiskList({ risks = [] }) {
  if (!risks.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {risks.map((r, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs">
          <TriangleAlert
            className={cn("mt-0.5 w-3 h-3 shrink-0", TONE_TEXT[severityTone(r.level)])}
            aria-hidden="true"
          />
          <span className="text-foreground-secondary">{r.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One half of the proposal — the vehicle side or the driver side.
 *
 * "Choose Another" swaps to the alternate rather than opening a picker: the
 * advisor ranks a top pick and one runner-up, and anything past that is the
 * manual assign dialog's job. When there is no alternate the button is absent,
 * so the UI never offers a choice it cannot honour.
 */
/**
 * Combined Vehicle & Driver Pair Block.
 * Replaces the split separate vehicle/driver blocks with a single unified pair card.
 */
function VehicleDriverPairBlock({
  vehicleSide,
  driverSide,
  vehiclePick,
  driverPick,
  onSwapVehicle,
  onSwapDriver,
  expanded,
}) {
  const vehicle = vehiclePick === PICK.ALTERNATE ? vehicleSide?.alternate : vehicleSide?.recommended;
  const driver = driverPick === PICK.ALTERNATE ? driverSide?.alternate : driverSide?.recommended;

  if (!vehicle) {
    return (
      <div className="rounded-xl border border-border bg-hover/30 p-4 space-y-2">
        <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
          <CarFront className="w-4 h-4 text-foreground-muted" />
          <span>Vehicle &amp; Driver Dispatch Pair</span>
        </div>
        <p className="text-xs text-foreground-secondary leading-relaxed">
          {vehicleSide?.considered > 0
            ? `None of the ${vehicleSide.considered} available vehicles fit this request's seating capacity or requirements.`
            : "No candidates are currently available for this pickup window."}
        </p>
      </div>
    );
  }

  const vPct = confidencePercent(vehicle);
  const dPct = driver ? confidencePercent(driver) : 0;
  const pairPct = driver ? Math.round((vPct + dPct) / 2) : vPct;

  const vehicleTitle = vehicle.plate_number
    ? `${vehicle.plate_number}${vehicle.vehicle_name ? ` · ${vehicle.vehicle_name}` : ""}`
    : "Vehicle Unassigned";

  const driverTitle = driver ? driver.driver_name : "No Designated Driver Available";

  const vehicleMeta = [
    vehicle.seating_capacity != null ? `${vehicle.seating_capacity} seats` : null,
    vehicle.fuel_level != null ? `Fuel ${vehicle.fuel_level}%` : null,
    vehicle.estimated_fuel_liters != null ? `~${vehicle.estimated_fuel_liters} L round trip` : null,
  ].filter(Boolean);

  const driverMeta = driver
    ? [
        driver.years_of_experience != null ? `${driver.years_of_experience} yr experience` : null,
        driver.rating ? `Rating ${driver.rating}/5` : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3.5 shadow-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
              Recommended Fleet Pair
            </p>
            <p className="text-[11px] text-foreground-muted">Vehicle paired with designated shift driver</p>
          </div>
        </div>
        <Badge variant={confidenceTone(pairPct)} className="text-xs font-bold px-2 py-0.5">
          {pairPct}% Pair Confidence
        </Badge>
      </div>

      {/* Vehicle Info */}
      <div className="flex items-start justify-between gap-2 text-xs">
        <div className="space-y-0.5 min-w-0">
          <span className="flex items-center gap-1.5 text-foreground-secondary font-semibold">
            <CarFront className="w-3.5 h-3.5 text-primary shrink-0" /> Assigned Vehicle
            {vehiclePick === PICK.ALTERNATE && (
              <Badge variant="secondary" className="text-[9px] py-0 px-1">Alternate</Badge>
            )}
          </span>
          <p className="font-bold text-foreground text-sm truncate">{vehicleTitle}</p>
          {vehicleMeta.length > 0 && (
            <p className="text-foreground-muted text-[11px]">{vehicleMeta.join(" · ")}</p>
          )}
        </div>
        {vehicleSide?.alternate && (
          <Button variant="ghost" size="sm" className="h-7 text-[11px] shrink-0" onClick={onSwapVehicle}>
            <Shuffle className="w-3 h-3 mr-1" /> Swap Vehicle
          </Button>
        )}
      </div>

      {/* Driver Info */}
      <div className="flex items-start justify-between gap-2 text-xs pt-2.5 border-t border-border/40">
        <div className="space-y-0.5 min-w-0">
          <span className="flex items-center gap-1.5 text-foreground-secondary font-semibold">
            <UserCheck className="w-3.5 h-3.5 text-info shrink-0" /> Designated Driver
            {driverPick === PICK.ALTERNATE && (
              <Badge variant="secondary" className="text-[9px] py-0 px-1">Alternate</Badge>
            )}
          </span>
          <p className="font-bold text-foreground text-sm truncate">{driverTitle}</p>
          {driverMeta.length > 0 && (
            <p className="text-foreground-muted text-[11px]">{driverMeta.join(" · ")}</p>
          )}
        </div>
        {driverSide?.alternate && driver && (
          <Button variant="ghost" size="sm" className="h-7 text-[11px] shrink-0" onClick={onSwapDriver}>
            <Shuffle className="w-3 h-3 mr-1" /> Swap Driver
          </Button>
        )}
      </div>

      {/* Rationale / Match Reasons */}
      {expanded && (
        <div className="pt-2 border-t border-border/40 space-y-1.5">
          <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wider">Pairing Rationale</p>
          <ul className="space-y-1 text-xs">
            {(vehicle?.reasons || []).slice(0, 2).map((r, i) => (
              <li key={`v-${i}`} className="flex items-start gap-1.5 text-foreground-secondary">
                <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                <span>Vehicle: {r}</span>
              </li>
            ))}
            {driver && (driver?.reasons || []).slice(0, 2).map((r, i) => (
              <li key={`d-${i}`} className="flex items-start gap-1.5 text-foreground-secondary">
                <Check className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
                <span>Driver: {r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Risks */}
      <RiskList risks={[...(vehicle?.detected_risks || []), ...(driver?.detected_risks || [])]} />
    </div>
  );
}
/** The trip estimate the advisor scored against. */
function TripSummary({ trip }) {
  if (!trip) return null;
  const low = trip.estimate_confidence === "low";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-hover/50 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-foreground-secondary">
        <Route className="w-3.5 h-3.5 text-foreground-muted" aria-hidden="true" />
        {trip.estimated_distance_km != null
          ? `~${formatDistance(trip.estimated_distance_km)}`
          : "Distance unknown"}
      </span>
      <span className="flex items-center gap-1.5 text-foreground-secondary">
        <Clock className="w-3.5 h-3.5 text-foreground-muted" aria-hidden="true" />
        {trip.estimated_travel_minutes != null
          ? `~${formatDuration(trip.estimated_travel_minutes)}`
          : "Duration unknown"}
      </span>
      {trip.estimate_basis && (
        <span className={cn("text-foreground-muted", low && "text-warning")}>
          {trip.estimate_basis}
        </span>
      )}
    </div>
  );
}

/**
 * Expandable AI recommendation panel for one request.
 *
 * `onAssigned` fires only after the assign endpoint returns 200, so the parent
 * invalidates on a real state change rather than on an intent. A 409 keeps the
 * panel open with the server's blocking conflicts and an explicit override —
 * identical to the manual dialog, because it is the same endpoint answering.
 */
export function AiRecommendationPanel({ requestId, className, defaultExpanded = false, canAssign = false, onAssigned }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [dismissed, setDismissed] = useState(false);
  const [vehiclePick, setVehiclePick] = useState(PICK.RECOMMENDED);
  const [driverPick, setDriverPick] = useState(PICK.RECOMMENDED);
  const [conflictError, setConflictError] = useState(null);

  const {
    data: rec,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reservation-recommendation", requestId],
    queryFn: () => getRecommendation(requestId),
    enabled: requestId != null && !dismissed,
    staleTime: 60_000,
  });

  const vehicle = vehiclePick === PICK.ALTERNATE ? rec?.vehicle?.alternate : rec?.vehicle?.recommended;
  const driver = driverPick === PICK.ALTERNATE ? rec?.driver?.alternate : rec?.driver?.recommended;

  const assignMutation = useMutation({
    mutationFn: ({ force }) =>
      assignResources(requestId, {
        vehicleId: vehicle?.vehicle_id ?? null,
        driverId: driver?.driver_id ?? null,
        force,
      }),
    onSuccess: (res) => {
      const forced = res?.warnings?.length;
      toast[forced ? "warning" : "success"](
        forced
          ? `Assigned with ${res.warnings.length} conflict override${res.warnings.length === 1 ? "" : "s"}`
          : "AI recommendation accepted — resources assigned"
      );
      setConflictError(null);
      queryClient.invalidateQueries({ queryKey: ["reservation-timeline", requestId] });
      onAssigned?.(res);
    },
    onError: (e) => {
      // The 409 carries the blocking findings; show them rather than a toast so
      // the override decision is made against the server's own reasons.
      if (e?.status === 409 && e?.data?.conflicts?.length) setConflictError(e);
      else toast.error(e.message || "Failed to assign resources");
    },
  });

  if (dismissed) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-foreground-secondary">
            AI recommendation dismissed for this request.
          </p>
          <Button variant="outline" size="sm" onClick={() => setDismissed(false)}>
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            Show again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const blocking = conflictError?.data?.conflicts || [];
  const nothingToAssign = !vehicle && !driver;

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-info" aria-hidden="true" />
            AI Recommendation
          </CardTitle>
          <CardDescription>
            Deterministic scoring of the available fleet. Advisory only — you confirm the
            assignment.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={isFetching}
            onClick={() => {
              setConflictError(null);
              refetch();
            }}
            aria-label="Refresh recommendation"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span className="ml-1">{expanded ? "Less" : "Full Explanation"}</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        ) : isError ? (
          <EmptyState
            icon={TriangleAlert}
            title="Could not build a recommendation"
            description={error?.message || "The request failed."}
            action={
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <>
            <TripSummary trip={rec?.trip} />

            <VehicleDriverPairBlock
              vehicleSide={rec?.vehicle}
              driverSide={rec?.driver}
              vehiclePick={vehiclePick}
              driverPick={driverPick}
              onSwapVehicle={() =>
                setVehiclePick((p) => (p === PICK.RECOMMENDED ? PICK.ALTERNATE : PICK.RECOMMENDED))
              }
              onSwapDriver={() =>
                setDriverPick((p) => (p === PICK.RECOMMENDED ? PICK.ALTERNATE : PICK.RECOMMENDED))
              }
              expanded={expanded}
            />

            {expanded && rec?.narration && (
              <p className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm text-foreground-secondary">
                {rec.narration}
              </p>
            )}

            <ConflictBlock conflicts={blocking} />

            {canAssign && (
              <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border pt-3">
                <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
                  <X className="w-3.5 h-3.5 mr-1" />
                  Reject
                </Button>
                {blocking.length > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={assignMutation.isPending}
                    onClick={() => assignMutation.mutate({ force: true })}
                  >
                    Override &amp; Accept
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={assignMutation.isPending || nothingToAssign}
                  onClick={() => assignMutation.mutate({ force: false })}
                >
                  <Check className="w-3.5 h-3.5 mr-1" />
                  {assignMutation.isPending ? "Assigning…" : "Accept & Assign"}
                </Button>
              </div>
            )}

            {rec?.generated_at && (
              <p className="text-xs text-foreground-muted">
                Generated {formatDateTime(rec.generated_at)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
