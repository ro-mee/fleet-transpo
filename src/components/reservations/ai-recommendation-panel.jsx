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
import { cn } from "@/lib/utils";
import { hasCompleteAssignment } from "@/lib/scheduling/reservation-state";
import { useNow } from "@/components/reservations/trip-summary";
import {
  CarFront,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Clock,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  UserCheck,
  Scale as ScaleIcon,
} from "lucide-react";

// Phase 14 - the AI advisor's proposal for one request.
//
// AI NEVER ASSIGNS. The GET behind this panel is a pure preview that writes
// nothing, and the only path to a committed assignment is the Accept button,
// which calls the same assign endpoint the manual dialog uses. So the same
// conflict check, the same 409, and the same timeline entry apply whether a
// dispatcher picked the vehicle themselves or agreed with the advisor.
//
// Scoring is deterministic (lib/ai/dispatch-advisor.js): every number here traces
// to a rule, which is why the panel can explain itself instead of just asserting.
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
 * Combined Vehicle & Driver Pair Block.
 *
 * The pair is the decision unit: every eligible vehicle+driver pairing the
 * scorer formed is surfaced in `candidates`, top-ranked by score, and the
 * dispatcher picks any of them. Swapping always swaps the WHOLE pair, so the
 * vehicle's designated (or day-assigned substitute) driver comes along — you
 * can never end up with a vehicle and a driver that don't belong together.
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

/** AI Fair Workload Distribution chip - pool-relative fairness score. */
function FairWorkloadChip({ fairnessScore }) {
  if (fairnessScore == null) return null;
  const high = fairnessScore >= 85;
  const mid = fairnessScore >= 60;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        high ? "bg-success/10 text-success" : mid ? "bg-warning/10 text-warning" : "bg-danger/10 text-danger"
      )}
      title="Workload fairness vs the other eligible drivers in this window"
    >
      <ScaleIcon className="w-3 h-3" aria-hidden="true" />
      Fairness {fairnessScore}%
    </span>
  );
}

/** Verified dispatch checks used when AI narration is unavailable. */
function ChecklistBlock({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-hover/30 px-3 py-2.5">
      <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wider mb-1.5">
        Verified Dispatch Checks
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

function VehicleDriverPairBlock({ pair, candidates = [], selectedIndex = 0, onSelectIndex, isNarrating, narration }) {
  const chosen = candidates[selectedIndex] ?? candidates[0] ?? null;
  const vehicle = chosen?.vehicle;
  const driver = chosen?.driver;

  if (!vehicle) {
    const reasons = Array.isArray(pair?.none_reasons) ? pair.none_reasons : [];
    return (
      <div className="rounded-[1.375rem] p-1.5 bg-foreground/[0.035] ring-1 ring-border/60">
        <div className="rounded-[calc(1.375rem-0.375rem)] bg-surface shadow-xs p-4 space-y-2">
          <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
            <div className="w-8 h-8 rounded-xl bg-foreground/[0.06] text-foreground-muted flex items-center justify-center">
              <CarFront className="w-4 h-4" />
            </div>
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
            <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 space-y-1.5">
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
      </div>
    );
  }

  const vehicleTitle = vehicle.plate_number
    ? `${vehicle.plate_number}${vehicle.vehicle_name ? ` - ${vehicle.vehicle_name}` : ""}`
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

  // Rolling workload detail (AI Fair Workload Distribution) - only when history exists.
  const workload = chosen?.workload;
  const workloadMeta = workload
    ? (() => {
        const t7 = Number(workload.trips_7d) || 0;
        const t30 = Number(workload.trips_30d) || 0;
        const km7 = Number(workload.km_7d) || 0;
        const km30 = Number(workload.km_30d) || 0;
        const trips = t7 > 0 ? t7 : t30;
        const km = km7 > 0 ? km7 : km30;
        return [`${trips} trip${trips === 1 ? "" : "s"}${km ? ` - ${Math.round(km)} km` : ""} ${t7 > 0 ? "this week" : "this month"}`];
      })()
    : [];

  const rankLabel = (i) => (i === 0 ? "Recommended" : i === 1 ? "Alternate" : `Rank ${i + 1}`);
  const selectedRank = Math.min(selectedIndex, candidates.length - 1);

  return (
    <div className="rounded-[1.375rem] p-1.5 bg-foreground/[0.035] ring-1 ring-border/60">
      <div className="rounded-[calc(1.375rem-0.375rem)] bg-surface shadow-xs overflow-hidden">
        {/* Header: pair identity + ranked picker */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3 border-b border-border/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-info/10 text-info flex items-center justify-center shrink-0">
              <Sparkles className="w-[18px] h-[18px]" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-foreground uppercase tracking-wider">AI Fleet Pair</p>
              <p className="text-[11px] text-foreground-muted truncate">
                {chosen?.reason_type === "replacement"
                  ? "Substitute pair — designated driver unavailable"
                  : selectedIndex === 0
                    ? "Recommended vehicle + designated driver"
                    : `${rankLabel(selectedIndex)} · ${candidates.length} eligible pair${candidates.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>

          {candidates.length > 1 ? (
            <div className="relative shrink-0">
              <select
                value={selectedRank}
                onChange={(e) => onSelectIndex(Number(e.target.value))}
                aria-label="Choose dispatch pair"
                className={cn(
                  "appearance-none h-9 pl-3 pr-8 rounded-xl border border-border bg-surface",
                  "text-[11px] font-semibold text-foreground cursor-pointer",
                  "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                )}
              >
                {candidates.map((c, i) => (
                  <option key={`${c.vehicle_id}-${c.driver_id}`} value={i}>
                    {`${i + 1}. ${c.vehicle?.plate_number ?? "Vehicle"} · ${c.driver?.driver_name ?? "No driver"}${c.score != null ? ` · ${c.score}/100` : ""}`}
                  </option>
                ))}
              </select>
              <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground-muted" />
            </div>
          ) : (
            <span className="inline-flex items-center h-9 px-3 rounded-xl border border-border bg-hover/50 text-[11px] font-bold text-foreground-secondary shrink-0">
              1 eligible pair
            </span>
          )}
        </div>

        <div className="p-4 space-y-3">
          {/* Replacement attribution */}
          {chosen?.reason_type === "replacement" && chosen?.replacement_reason && (
            <div className="flex items-start gap-2 rounded-xl bg-warning/10 border border-warning/25 px-3 py-2 text-xs text-foreground-secondary">
              <TriangleAlert className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <span className="font-semibold text-foreground">Substitute pair.</span> The designated driver
                was unavailable: {chosen.replacement_reason}
              </span>
            </div>
          )}

          {/* Vehicle */}
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <CarFront className="w-[18px] h-[18px]" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide">Vehicle</span>
                {selectedIndex > 0 && (
                  <Badge variant="secondary" className="text-[10px] py-0 px-1">{rankLabel(selectedIndex)}</Badge>
                )}
              </div>
              <p className="font-bold text-foreground text-sm truncate">{vehicleTitle}</p>
              {vehicleMeta.length > 0 && (
                <p className="text-[11px] font-data text-foreground-muted truncate">{vehicleMeta.join(" · ")}</p>
              )}
            </div>
            <AvailabilityChip availability={vehicle.availability} />
          </div>

          {/* Driver */}
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3">
            <div className="w-10 h-10 rounded-xl bg-info/10 text-info flex items-center justify-center shrink-0">
              <UserCheck className="w-[18px] h-[18px]" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide">Designated Driver</span>
                {chosen?.is_designated === false && (
                  <Badge variant="secondary" className="text-[10px] py-0 px-1">Substitute</Badge>
                )}
                <FairWorkloadChip fairnessScore={chosen?.fairness_score} />
              </div>
              <p className="font-bold text-foreground text-sm truncate">{driverTitle}</p>
              {[...driverMeta, ...workloadMeta].length > 0 && (
                <p className="text-[11px] font-data text-foreground-muted truncate">
                  {[...driverMeta, ...workloadMeta].join(" · ")}
                </p>
              )}
            </div>
            <AvailabilityChip availability={driver.availability} />
          </div>

          {/* AI rationale with deterministic fallback */}
          <div className="rounded-xl border border-info/20 bg-info/[0.05] px-3.5 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-info/15 text-info flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
              </div>
              <p className="text-[11px] font-semibold text-info uppercase tracking-wider">
                AI Rationale{narration?.provider ? ` · ${narration.provider}` : ""}
              </p>
            </div>
            {isNarrating ? (
              <p className="text-xs text-foreground-muted flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                Writing rationale...
              </p>
            ) : narration ? (
              <ul className="space-y-2 text-xs text-foreground-secondary leading-relaxed">
                {narration.text.split(/\n+|(?<=\.)\s+/).map((sentence) => sentence.trim()).filter(Boolean).map((sentence, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-info/50 shrink-0 mt-1.5" aria-hidden="true" />
                    <span>{sentence}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-foreground-muted">
                  AI rationale is unavailable. Showing verified dispatch checks instead.
                </p>
                <ChecklistBlock items={chosen?.checklist} />
              </div>
            )}
          </div>

          {/* Risks */}
          <RiskList risks={[...(vehicle?.detected_risks || []), ...(driver?.detected_risks || [])]} />
        </div>
      </div>
    </div>
  );
}
/** The trip estimate the advisor scored against. */

function relativeMinutes(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.floor((t - now) / 60_000);
  const abs = Math.abs(mins);
  if (abs < 1) return "just now";
  return `${abs} minute${abs === 1 ? "" : "s"} ${mins >= 0 ? "remaining" : "ago"}`;
}

/**
 * Expandable AI recommendation panel for one request.
 *
 * `onAssigned` fires only after the assign endpoint returns 200, so the parent
 * invalidates on a real state change rather than on an intent. A 409 keeps the
 * panel open with the server's blocking conflicts and an explicit override -
 * identical to the manual dialog, because it is the same endpoint answering.
 */
export function AiRecommendationPanel({
  requestId,
  className,
  canAssign = false,
  onAssigned,
  alreadyAssigned = false,
  hideHeader = false,
  compact = false,
  onTrip,
}) {
  const queryClient = useQueryClient();
  const now = useNow();
  const [dismissed, setDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
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

  // Every eligible pair the scorer formed, top-ranked first. Backward compat:
  // a stored snapshot written before `candidates` existed carries only the top
  // two, so derive the list from those when the field is absent.
  const candidates = useMemo(() => {
    const list = rec?.pair?.candidates;
    if (Array.isArray(list) && list.length) return list;
    return [rec?.pair?.recommended, rec?.pair?.alternate].filter(Boolean);
  }, [rec]);

  const chosen = candidates[selectedIndex] ?? null;
  const vehicle = chosen?.vehicle ?? null;
  const driver = chosen?.driver ?? null;
  const snapshot = rec?.snapshot ?? null;
  const chosenVehicleId = vehicle?.vehicle_id ?? null;
  const chosenDriverId = driver?.driver_id ?? null;

  // Stream the scored trip estimate up to the shell so the request-context card
  // (TripEstimateCard) can show distance / duration / route basis without a
  // second fetch. Fires with `null` until the scorer answers.
  useEffect(() => {
    onTrip?.(rec?.trip ?? null);
  }, [rec, onTrip]);

  // LLM narration - slow, nullable, streams in behind the scored result only
  // once the user opens the full explanation. Never changes the pick. It is
  // pinned to the pair being shown so the rationale always describes the pair
  // the dispatcher sees, not the server's own first pick.
  const { data: narrated, isFetching: isNarrating } = useQuery({
    queryKey: ["reservation-recommendation", requestId, "narrated", chosenVehicleId, chosenDriverId],
    queryFn: () =>
      getRecommendation(requestId, {
        narrate: true,
        vehicleId: chosenVehicleId,
        driverId: chosenDriverId,
      }),
    enabled: requestId != null && !dismissed && chosenVehicleId != null,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: "always",
    retry: false,
  });
  const narration = narrated?.narration;

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
          : "AI recommendation accepted - resources assigned"
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

  const blocking =
    conflictError?.data?.conflicts ||
    (conflictError?.data?.conflict ? [conflictError.data.conflict] : []);
  const incompleteAssignment = !hasCompleteAssignment(vehicle?.vehicle_id, driver?.driver_id);
  return (
    <Card className={cn(className, compact && "border-0 shadow-none bg-transparent")}>
      {!hideHeader && (
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-info/10 text-info flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
              </span>
              AI Recommendation
            </CardTitle>
            <CardDescription>
              Deterministic scoring of the available fleet. Advisory only - you confirm the
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
                setSelectedIndex(0);
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
      )}

      <CardContent className={cn("space-y-3", compact && "p-0")}>
        {isLoading ? (
          <div className="rounded-[1.375rem] p-1.5 bg-foreground/[0.035] ring-1 ring-border/60">
            <div className="rounded-[calc(1.375rem-0.375rem)] bg-surface shadow-xs p-4 space-y-3">
              <Skeleton className="h-8 w-full rounded-xl" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
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
            {snapshot?.expired && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground-secondary">
                <span className="flex items-center gap-1.5">
                  <TriangleAlert className="w-3.5 h-3.5 text-warning shrink-0" aria-hidden="true" />
                  {snapshot.expiry_reason}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => {
                    setConflictError(null);
                    setSelectedIndex(0);
                    setRegenerating(true);
                    refetch();
                  }}
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
                </Button>
              </div>
            )}

            <VehicleDriverPairBlock
              pair={rec?.pair}
              candidates={candidates}
              selectedIndex={selectedIndex}
              onSelectIndex={(idx) => { setSelectedIndex(idx); setConflictError(null); }}
              isNarrating={isNarrating}
              narration={narration}
            />

            <ConflictBlock conflicts={blocking} />

            {canAssign && !alreadyAssigned && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                {blocking.length > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={assignMutation.isPending || incompleteAssignment || snapshot?.expired || regenerating}
                    onClick={() => assignMutation.mutate({ force: true })}
                    className="h-9 rounded-xl active:scale-[0.98] transition-transform"
                  >
                    <TriangleAlert className="w-3.5 h-3.5 mr-1.5" />
                    Override &amp; Accept
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={assignMutation.isPending || incompleteAssignment || snapshot?.expired || regenerating}
                  onClick={() => assignMutation.mutate({ force: false })}
                  className="group h-9 pl-3.5 pr-1.5 rounded-full active:scale-[0.98] transition-transform"
                >
                  {assignMutation.isPending ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Assigning...
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-bold">Assign Pair</span>
                      <span className="w-6 h-6 ml-2 rounded-full bg-black/10 dark:bg-white/15 text-surface dark:text-foreground flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5 group-hover:scale-105">
                        <Check className="w-3 h-3" strokeWidth={2.5} />
                      </span>
                    </>
                  )}
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
