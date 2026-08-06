"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, TONE_CHIP, riskTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { isUnscheduled } from "@/lib/ai/predictive-maintenance";
import { formatCalendarDate } from "@/lib/dates";
import { Wrench, AlertTriangle, CheckCircle2, CalendarDays, Gauge, Activity, HelpCircle } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";

/**
 * A vehicle with no schedule is not healthy — it is unmeasured.
 *
 * The engine bands a null effectiveDays as `low` because there is no urgency to
 * rank, which is the right sort order but the wrong colour: rendered in success
 * green next to genuinely healthy vehicles, "we have no idea when this is due"
 * reads as "this one is fine".
 */
function predictionTone(prediction) {
  if (isUnscheduled(prediction)) return "secondary";
  return riskTone(prediction.risk);
}

export default function PredictiveMaintenancePage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const [riskFilter, setRiskFilter] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });
  // Memoized so the `?? []` fallback does not mint a fresh array identity on
  // every render, which would invalidate the filter memo below each time.
  const predictions = useMemo(() => data?.predictions ?? [], [data]);
  // Server-precomputed. The four client-side filters this replaces compared
  // against lowercase bands while the service emitted capitalised ones, so
  // every tile read 0 regardless of fleet state.
  const summary = data?.summary ?? { overdue: 0, critical: 0, high: 0, medium: 0, low: 0, total: 0, unscheduled: 0 };

  const filteredPredictions = useMemo(() => {
    // "low" means genuinely healthy, so it excludes the unscheduled vehicles the
    // engine also bands as low — they get their own filter. Without the split,
    // clicking Healthy would list vehicles nobody has established anything about.
    if (riskFilter === "overdue") return predictions.filter((p) => p.risk === "overdue");
    if (riskFilter === "critical") return predictions.filter((p) => p.risk === "critical");
    if (riskFilter === "high") return predictions.filter((p) => p.risk === "high");
    if (riskFilter === "low") return predictions.filter((p) => p.risk === "low" && !isUnscheduled(p));
    if (riskFilter === "unscheduled") return predictions.filter((p) => isUnscheduled(p));
    return predictions;
  }, [predictions, riskFilter]);

  // The engine bands a vehicle with no schedule as low, so summary.low counts
  // both. Subtracting is what keeps the Healthy tile honest.
  const healthyCount = Math.max(0, summary.low - summary.unscheduled);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI & Automation"
        title="Predictive Maintenance"
        description="AI-powered maintenance predictions and scheduling."
      />

      <StatGrid cols={5}>
        <StatCard icon={AlertTriangle} label="Overdue" value={summary.overdue} tone="danger" trend="service window passed" active={riskFilter === "overdue"} onClick={() => setRiskFilter((r) => r === "overdue" ? "all" : "overdue")} />
        <StatCard icon={CalendarDays} label="Critical (7 days)" value={summary.critical} tone="danger" trend="due within a week" active={riskFilter === "critical"} onClick={() => setRiskFilter((r) => r === "critical" ? "all" : "critical")} />
        <StatCard icon={Activity} label="High (30 days)" value={summary.high} tone="warning" trend="due within a month" active={riskFilter === "high"} onClick={() => setRiskFilter((r) => r === "high" ? "all" : "high")} />
        <StatCard icon={CheckCircle2} label="Healthy" value={healthyCount} tone="success" trend="more than 90 days out" active={riskFilter === "low"} onClick={() => setRiskFilter((r) => r === "low" ? "all" : "low")} />
        <StatCard icon={HelpCircle} label="No schedule" value={summary.unscheduled} tone="neutral" trend="not predicted — needs a date or mileage" active={riskFilter === "unscheduled"} onClick={() => setRiskFilter((r) => r === "unscheduled" ? "all" : "unscheduled")} />
      </StatGrid>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Maintenance Predictions ({filteredPredictions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-4 p-4 rounded-lg border border-border/60">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredPredictions.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No maintenance predictions found"
              description={
                riskFilter === "all"
                  ? "Add vehicles and set their service intervals to receive maintenance predictions."
                  : riskFilter === "unscheduled"
                  ? "Every vehicle has a next service date or service mileage set."
                  : "No vehicles match the selected maintenance risk filter."
              }
            />
          ) : (
            <div className="space-y-2">
              {filteredPredictions.map((p) => {
                const unscheduled = isUnscheduled(p);
                const tone = predictionTone(p);
                return (
                  <div key={p.vehicle_id} className="flex items-start gap-4 p-4 rounded-lg border border-border/60 bg-surface hover:shadow-sm transition-all">
                    <div className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg", TONE_CHIP[tone])}>
                      <Wrench className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-data text-sm font-semibold text-foreground">{p.plate_number}</h4>
                        <span className="text-xs text-foreground-muted">{p.vehicle_name}</span>
                        {/* "unscheduled" is deliberately absent from the risk map,
                            so the badge falls through to the neutral outline
                            variant instead of borrowing the healthy green. */}
                        <StatusBadge status={unscheduled ? "unscheduled" : p.risk} entity="risk" className="text-[11px]">
                          {unscheduled
                            ? "No schedule"
                            : p.effectiveDays < 0
                            ? `${Math.abs(p.effectiveDays)} days overdue`
                            : `${p.effectiveDays} days`}
                        </StatusBadge>
                      </div>
                      <p className="text-sm text-foreground-secondary mt-1 leading-relaxed">{p.recommendation}</p>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-foreground-muted">
                        <span className="flex items-center gap-1">
                          <Gauge className="w-3.5 h-3.5" /> {p.mileage?.toLocaleString()} km
                        </span>
                        {p.next_service_date && (
                          <span className="flex items-center gap-1">
                            {/* formatCalendarDate, not formatDate: the engine
                                normalizes this to a bare YYYY-MM-DD, and
                                formatDate would parse that as UTC midnight and
                                re-render it in the local zone. */}
                            <CalendarDays className="w-3.5 h-3.5" /> Next: {formatCalendarDate(p.next_service_date)}
                          </span>
                        )}
                        {p.kmToService !== null && (
                          <span className="flex items-center gap-1">
                            {/* Sign check, not a clamp: the engine reports a
                                negative kmToService for a vehicle already past
                                its service mileage, and rendering that raw gives
                                "-500 km to service", which reads as a countdown
                                rather than as an overrun. */}
                            <Wrench className="w-3.5 h-3.5" />{" "}
                            {p.kmToService < 0
                              ? `${Math.abs(p.kmToService).toLocaleString()} km overdue`
                              : `${p.kmToService.toLocaleString()} km to service`}
                          </span>
                        )}
                        {p.basis === "mileage" && (
                          <span className="flex items-center gap-1">
                            <Activity className="w-3.5 h-3.5" /> ~{Math.round(p.kmPerDay)} km/day
                          </span>
                        )}
                        {p.confidence === "low" && p.basis !== null && (
                          <span className="flex items-center gap-1 text-warning">
                            <AlertTriangle className="w-3.5 h-3.5" /> Calendar only — limited trip data
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-28 flex-shrink-0">
                      {unscheduled ? (
                        // healthScore returns 50 for a vehicle with no schedule —
                        // a placeholder for "unknown", not a measurement. Drawing
                        // it as a half-full bar would present that placeholder as
                        // a finding.
                        <div className="text-right">
                          <span className="font-data text-sm font-semibold text-foreground-muted">—</span>
                          <p className="text-[11px] text-foreground-muted">No health data</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="font-data text-sm font-semibold text-foreground">{p.score}/100</span>
                            <span className="text-[11px] text-foreground-muted">Health</span>
                          </div>
                          <ProgressBar value={p.score} tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "info" ? "info" : "success"} />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
