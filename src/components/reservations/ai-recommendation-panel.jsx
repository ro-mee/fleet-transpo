"use client";

import { useEffect, useMemo, useState } from "react";
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
 *
 * The pair is the decision unit: recommended and alternate are each a full
 * vehicle+driver pair. Swapping swaps the WHOLE pair, so swapping the vehicle
 * also pulls in that vehicle's designated driver in one action — you can never
 * end up with a vehicle and a driver that don't belong together.
 */
function AvailabilityChip({ availability }) {
  if (!availability?.label) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        availability.free ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
      )}
    >
      {availability.free ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {availability.label}
    </span>
  );
}

/** The always-visible "Why this pair?" checklist. */
function ChecklistBlock({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-hover/30 px-3 py-2.5">
      <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wider mb-1.5">
        Recommendation Reason
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs">
            {item.pass ? (
              <Check className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <TriangleAlert className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <span className={item.pass ? "text-foreground-secondary" : "text-foreground"}>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VehicleDriverPairBlock({ pair, pick, onSwap, isNarrating, narration }) {
  const chosen = pick === PICK.ALTERNATE ? pair?.alternate : pair?.recommended;
  const vehicle = chosen?.vehicle;
  const driver = chosen?.driver;

  if (!vehicle) {
    const reasons = Array.isArray(pair?.none_reasons) ? pair.none_reasons : [];
    return (
      <div className="rounded-xl border border-border bg-hover/30 p-4 space-y-2">
        <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
          <CarFront className="w-4 h-4 text-foreground-muted" />
          <span>Vehicle &amp; Driver Dispatch Pair</span>
        </div>
        <p className="text-xs text-foreground-secondary leading-relaxed">
          {reasons.length > 0
            ? `No available vehicle could form a dispatch pair for this pickup window.`
            : pair?.considered > 0
              ? `None of the ${pair.considered} available vehicles fit this request's seating capacity or requirements.`
              : "No candidates are currently available for this pickup window."}
        </p>
        {reasons.length > 0 && (
          <div className="rounded-lg border border-border/60 bg-surface/60 px-3 py-2.5 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
              Why no pair is available
            </p>
            <ul className="space-y-1.5">
              {reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-foreground-secondary leading-relaxed">
                  <TriangleAlert className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    {r.plate ? <span className="font-semibold text-foreground">{r.plate}: </span> : null}
                    {r.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

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
            <p className="text-[11px] text-foreground-muted">Vehicle paired with its designated driver</p>
          </div>
        </div>
      </div>

      {/* Replacement attribution */}
      {chosen?.reason_type === "replacement" && chosen?.replacement_reason && (
        <div className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-foreground-secondary">
          <TriangleAlert className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <span className="font-semibold text-foreground">Substitute pair.</span> The designated driver
            was unavailable: {chosen.replacement_reason}
          </span>
        </div>
      )}

      {/* Vehicle Info */}
      <div className="flex items-start justify-between gap-2 text-xs">
        <div className="space-y-0.5 min-w-0">
          <span className="flex items-center gap-1.5 text-foreground-secondary font-semibold">
            <CarFront className="w-3.5 h-3.5 text-primary shrink-0" /> Assigned Vehicle
            {pick === PICK.ALTERNATE && (
              <Badge variant="secondary" className="text-[11px] py-0 px-1">Alternate</Badge>
            )}
          </span>
          <p className="font-bold text-foreground text-sm truncate">{vehicleTitle}</p>
          {vehicleMeta.length > 0 && (
            <p className="text-foreground-muted text-[11px]">{vehicleMeta.join(" · ")}</p>
          )}
          <AvailabilityChip availability={vehicle.availability} />
        </div>
        {pair?.alternate && (
          <Button variant="ghost" size="sm" className="h-7 text-[11px] shrink-0" onClick={onSwap}>
            <Shuffle className="w-3 h-3 mr-1" /> Swap Pair
          </Button>
        )}
      </div>

      {/* Driver Info */}
      <div className="flex items-start justify-between gap-2 text-xs pt-2.5 border-t border-border/40">
        <div className="space-y-0.5 min-w-0">
          <span className="flex items-center gap-1.5 text-foreground-secondary font-semibold">
            <UserCheck className="w-3.5 h-3.5 text-info shrink-0" /> Designated Driver
            {chosen?.is_designated === false && (
              <Badge variant="secondary" className="text-[11px] py-0 px-1">Substitute</Badge>
            )}
          </span>
          <p className="font-bold text-foreground text-sm truncate">{driverTitle}</p>
          {driverMeta.length > 0 && (
            <p className="text-foreground-muted text-[11px]">{driverMeta.join(" · ")}</p>
          )}
          <AvailabilityChip availability={driver.availability} />
        </div>
      </div>

      {/* Why this pair? — always visible checklist */}
      <ChecklistBlock items={chosen?.checklist} />

      {/* AI Rationale / Match Reasons */}
      <div className="pt-3 border-t border-border/40 space-y-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-info shrink-0" aria-hidden="true" />
          <p className="text-[11px] font-semibold text-info uppercase tracking-wider">
            AI Rationale{narration?.provider ? ` · ${narration.provider}` : ""}
          </p>
        </div>
        {isNarrating ? (
          <p className="text-xs text-foreground-muted flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
            Writing rationale…
          </p>
        ) : narration ? (
          <ul className="space-y-2 text-xs text-foreground-secondary leading-relaxed">
            {narration.text.split(/(?<=\.)\s+/).filter(Boolean).map((sentence, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <Check className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
                <span>{sentence}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs leading-relaxed text-foreground-muted">
            Live rationale unavailable — the AI provider did not respond in time.
          </p>
        )}
      </div>

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

/** A live "now" that ticks every 30s, so countdowns and "X ago" stay current. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function relativeMinutes(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.floor((t - now) / 60_000);
  const abs = Math.abs(mins);
  if (abs < 1) return "just now";
  return `${abs} minute${abs === 1 ? "" : "s"} ${mins >= 0 ? "remaining" : "ago"}`;
}

/** Pickup countdown: the headline dispatchers use to prioritize. */
function Countdown({ pickupAt, now }) {
  if (!pickupAt) return null;
  const t = new Date(pickupAt).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.floor((t - now) / 60_000);
  const remaining = mins >= 0 ? `${mins} min${mins === 1 ? "" : "s"} remaining` : "Pickup time passed";
  const tone = mins < 30 ? "text-danger" : mins < 60 ? "text-warning" : "text-success";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-hover/50 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-foreground-secondary">
        <Clock className="w-3.5 h-3.5 text-foreground-muted" aria-hidden="true" />
        Pickup {formatDateTime(pickupAt)}
      </span>
      <span className={cn("font-bold", tone)}>{remaining}</span>
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
export function AiRecommendationPanel({ requestId, className, canAssign = false, onAssigned, alreadyAssigned = false, pickupAt = null }) {
  const queryClient = useQueryClient();
  const now = useNow();
  const [dismissed, setDismissed] = useState(false);
  const [pick, setPick] = useState(PICK.RECOMMENDED);
  const [conflictError, setConflictError] = useState(null);
  const [regenerating, setRegenerating] = useState(false);

  const {
    data: rec,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reservation-recommendation", requestId, regenerating ? "fresh" : "cached"],
    queryFn: () => getRecommendation(requestId, { regenerate: regenerating }),
    enabled: requestId != null && !dismissed,
    staleTime: 60_000,
  });

  // LLM narration — slow, nullable, streams in behind the scored result only
  // once the user opens the full explanation. Never changes the pick.
  const { data: narrated, isFetching: isNarrating } = useQuery({
    queryKey: ["reservation-recommendation", requestId, "narrated"],
    queryFn: () => getRecommendation(requestId, { narrate: true }),
    enabled: requestId != null && !dismissed,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const narration = narrated?.narration;

  const chosen = pick === PICK.ALTERNATE ? rec?.pair?.alternate : rec?.pair?.recommended;
  const vehicle = chosen?.vehicle ?? null;
  const driver = chosen?.driver ?? null;
  const snapshot = rec?.snapshot ?? null;

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
              setPick(PICK.RECOMMENDED);
              setRegenerating(true);
              refetch();
            }}
            aria-label="Regenerate recommendation"
            title="Regenerate a fresh fleet pair"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
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
            <Countdown pickupAt={pickupAt} now={now} />
            <TripSummary trip={rec?.trip} />

            {snapshot?.expired && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground-secondary">
                <span className="flex items-center gap-1.5">
                  <TriangleAlert className="w-3.5 h-3.5 text-warning shrink-0" aria-hidden="true" />
                  {snapshot.expiry_reason}
                </span>
                <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={() => refetch()}>
                  <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
                </Button>
              </div>
            )}

            <VehicleDriverPairBlock
              pair={rec?.pair}
              pick={pick}
              onSwap={() => setPick((p) => (p === PICK.RECOMMENDED ? PICK.ALTERNATE : PICK.RECOMMENDED))}
              isNarrating={isNarrating}
              narration={narration}
            />



            <ConflictBlock conflicts={blocking} />

            {canAssign && !alreadyAssigned && (
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
                Generated {relativeMinutes(rec.generated_at, now)}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
