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
function CandidateBlock({ icon: Icon, label, side, pick, onSwap, expanded }) {
  const { recommended, alternate, considered = 0 } = side || {};
  const showingAlternate = pick === PICK.ALTERNATE;
  const active = showingAlternate ? alternate : recommended;

  if (!active) {
    return (
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-foreground-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">{label}</p>
        </div>
        <p className="mt-1 text-sm text-foreground-secondary">
          {considered > 0
            ? `None of the ${considered} available candidates fits this request.`
            : "No candidates are currently available."}
        </p>
      </div>
    );
  }

  const pct = confidencePercent(active);
  const title = active.plate_number
    ? `${active.plate_number}${active.vehicle_name ? ` · ${active.vehicle_name}` : ""}`
    : active.driver_name;

  const meta = [
    active.seating_capacity != null ? `${active.seating_capacity} seats` : null,
    active.fuel_level != null ? `Fuel ${active.fuel_level}%` : null,
    active.years_of_experience != null ? `${active.years_of_experience} yr experience` : null,
    active.rating ? `Rating ${active.rating}/5` : null,
    active.estimated_fuel_liters != null
      ? `~${active.estimated_fuel_liters} L round trip${
          active.estimated_fuel_percent_of_tank != null
            ? ` (${active.estimated_fuel_percent_of_tank}% of tank)`
            : ""
        }`
      : null,
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 shrink-0 text-foreground-muted" aria-hidden="true" />
            <p className="text-xs text-foreground-muted">{label}</p>
            {showingAlternate && (
              <Badge variant="secondary" className="text-[10px]">
                Alternate
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">{title}</p>
        </div>
        {alternate && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onSwap}>
            <Shuffle className="w-3.5 h-3.5 mr-1" />
            Choose Another
          </Button>
        )}
      </div>

      <ProgressBar
        className="mt-2"
        value={pct}
        tone={confidenceTone(pct)}
        label="Confidence"
        valueLabel={`${pct}%`}
      />

      {meta.length > 0 && (
        <p className="mt-2 text-xs text-foreground-muted">{meta.join(" · ")}</p>
      )}

      {expanded && active.reasons?.length > 0 && (
        <ul className="mt-2 space-y-1">
          {active.reasons.map((reason, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs">
              <Check className="mt-0.5 w-3 h-3 shrink-0 text-success" aria-hidden="true" />
              <span className="text-foreground-secondary">{reason}</span>
            </li>
          ))}
        </ul>
      )}

      <RiskList risks={active.detected_risks} />

      {expanded && (
        <p className="mt-2 text-xs text-foreground-muted">
          Score {active.score}/100 · {considered} candidate{considered === 1 ? "" : "s"} considered
        </p>
      )}
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

            <CandidateBlock
              icon={CarFront}
              label="Vehicle"
              side={rec?.vehicle}
              pick={vehiclePick}
              expanded={expanded}
              onSwap={() =>
                setVehiclePick((p) => (p === PICK.RECOMMENDED ? PICK.ALTERNATE : PICK.RECOMMENDED))
              }
            />

            <CandidateBlock
              icon={UserCheck}
              label="Driver"
              side={rec?.driver}
              pick={driverPick}
              expanded={expanded}
              onSwap={() =>
                setDriverPick((p) => (p === PICK.RECOMMENDED ? PICK.ALTERNATE : PICK.RECOMMENDED))
              }
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
