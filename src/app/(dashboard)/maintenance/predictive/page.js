"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, TONE_CHIP, riskTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { isUnscheduled } from "@/lib/ai/predictive-maintenance";
import { formatCalendarDate } from "@/lib/dates";
import {
  Wrench,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
  Gauge,
  Activity,
  HelpCircle,
  Sparkles,
  Bot,
  ShieldAlert,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";

function predictionTone(prediction) {
  if (isUnscheduled(prediction)) return "secondary";
  return riskTone(prediction.risk);
}

// Mirrors QueryBoundary's error state — a telemetry failure must not render as
// an all-zero fleet or a "no predictions match" empty state.
function PredictionErrorPanel({ onRetry, busy }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl border border-danger/20 bg-danger-bg/40"
      role="alert"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 mb-4">
        <AlertTriangle className="w-5 h-5 text-danger" />
      </div>
      <p className="text-sm font-medium text-foreground">Couldn&apos;t load predictive maintenance data</p>
      <p className="text-sm text-foreground-secondary mt-1 max-w-sm leading-relaxed">
        Health summaries and predictions are unavailable because the request failed — not because your fleet is fully healthy.
      </p>
      <Button variant="outline" size="sm" className="mt-4 cursor-pointer" onClick={onRetry} disabled={busy}>
        <RefreshCw className={cn("mr-2 h-3.5 w-3.5", busy && "animate-spin")} />
        Try again
      </Button>
    </div>
  );
}

export default function PredictiveMaintenancePage() {
  useRequireRole();
  const [riskFilter, setRiskFilter] = useState("all");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });

  const predictions = useMemo(() => data?.predictions ?? [], [data]);
  const summary = data?.summary ?? { overdue: 0, critical: 0, high: 0, medium: 0, low: 0, total: 0, unscheduled: 0 };

  const filteredPredictions = useMemo(() => {
    if (riskFilter === "overdue") return predictions.filter((p) => p.risk === "overdue");
    if (riskFilter === "critical") return predictions.filter((p) => p.risk === "critical");
    if (riskFilter === "high") return predictions.filter((p) => p.risk === "high");
    if (riskFilter === "low") return predictions.filter((p) => p.risk === "low" && !isUnscheduled(p));
    if (riskFilter === "unscheduled") return predictions.filter((p) => isUnscheduled(p));
    return predictions;
  }, [predictions, riskFilter]);

  const healthyCount = Math.max(0, summary.low - summary.unscheduled);

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* ── TOP HERO HEADER BAR ── */}
      <HeroHeader
        icon={Sparkles}
        title="AI Predictive Maintenance"
        badge="Fleet Health Telemetry"
        description="AI-powered vehicle health telemetry, wear pattern predictions, and preventive service interval monitoring."
      />

      {/* ── KPI STAT FILTER CARDS ── */}
      {isError ? (
        <PredictionErrorPanel onRetry={() => refetch()} busy={isRefetching} />
      ) : (
      <>
      <StatGrid cols={5} className="gap-3">
        <StatCard icon={AlertTriangle} label="Overdue" value={summary.overdue} trend="Service window passed" tone="danger" active={riskFilter === "overdue"} onClick={() => setRiskFilter((r) => (r === "overdue" ? "all" : "overdue"))} />
        <StatCard icon={CalendarDays} label="Critical (7d)" value={summary.critical} trend="Due within a week" tone="danger" active={riskFilter === "critical"} onClick={() => setRiskFilter((r) => (r === "critical" ? "all" : "critical"))} />
        <StatCard icon={Activity} label="High (30d)" value={summary.high} trend="Due within 30 days" tone="warning" active={riskFilter === "high"} onClick={() => setRiskFilter((r) => (r === "high" ? "all" : "high"))} />
        <StatCard icon={CheckCircle2} label="Healthy" value={healthyCount} trend="More than 90 days out" tone="success" active={riskFilter === "low"} onClick={() => setRiskFilter((r) => (r === "low" ? "all" : "low"))} />
        <StatCard icon={HelpCircle} label="No Schedule" value={summary.unscheduled} trend="Needs date/mileage" tone="neutral" active={riskFilter === "unscheduled"} onClick={() => setRiskFilter((r) => (r === "unscheduled" ? "all" : "unscheduled"))} />
      </StatGrid>

      {/* ── PREDICTIONS LIST CARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Wrench className="w-4 h-4 text-warning" /> Vehicle Telemetry Health Records ({filteredPredictions.length})
          </CardTitle>
          {riskFilter !== "all" && (
            <button
              onClick={() => setRiskFilter("all")}
              className="text-xs font-bold text-primary hover:underline cursor-pointer"
            >
              Clear Filter ✕
            </button>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-4 p-4 rounded-3xl border border-border/60 bg-surface">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48 rounded-lg" />
                    <Skeleton className="h-3 w-full rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredPredictions.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No maintenance predictions match filter"
              description={
                riskFilter === "all"
                  ? "Add vehicles and set service intervals to generate predictive telemetry."
                  : "No fleet vehicles match the selected risk category."
              }
              variant={riskFilter === "all" ? "first-run" : "filtered"}
              size="compact"
            />
          ) : (
            <div className="divide-y divide-border/60">
              {filteredPredictions.map((p) => {
                const unscheduled = isUnscheduled(p);
                const tone = predictionTone(p);
                return (
                  <div key={p.vehicle_id} className="flex items-start gap-4 p-4.5 hover:bg-hover/50 transition-colors">
                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-3xl border shadow-2xs mt-0.5", TONE_CHIP[tone])}>
                      <Wrench className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h4 className="font-data text-sm font-bold text-foreground">{p.plate_number}</h4>
                        <span className="text-xs text-foreground-muted font-medium">{p.vehicle_name}</span>
                        <StatusBadge status={unscheduled ? "unscheduled" : p.risk} entity="risk" className="text-[11px] font-bold">
                          {unscheduled
                            ? "No schedule"
                            : p.effectiveDays < 0
                            ? `${Math.abs(p.effectiveDays)} days overdue`
                            : `${p.effectiveDays} days remaining`}
                        </StatusBadge>
                      </div>

                      <p className="text-xs text-foreground-secondary font-medium leading-relaxed">{p.recommendation}</p>

                      <div className="flex flex-wrap items-center gap-4 mt-2.5 text-xs text-foreground-muted font-medium">
                        <span className="flex items-center gap-1.5 font-data">
                          <Gauge className="w-3.5 h-3.5 text-primary" /> {p.mileage?.toLocaleString()} km
                        </span>
                        {p.next_service_date && (
                          <span className="flex items-center gap-1.5 font-data">
                            <CalendarDays className="w-3.5 h-3.5 text-primary" /> Next: {formatCalendarDate(p.next_service_date)}
                          </span>
                        )}
                        {p.kmToService !== null && (
                          <span className="flex items-center gap-1.5 font-data">
                            <Wrench className="w-3.5 h-3.5 text-primary" />{" "}
                            {p.kmToService < 0
                              ? `${Math.abs(p.kmToService).toLocaleString()} km overdue`
                              : `${p.kmToService.toLocaleString()} km to service`}
                          </span>
                        )}
                        {p.basis === "mileage" && (
                          <span className="flex items-center gap-1.5 font-data">
                            <Activity className="w-3.5 h-3.5 text-primary" /> ~{Math.round(p.kmPerDay)} km/day
                          </span>
                        )}
                        {p.confidence === "low" && p.basis !== null && (
                          <span className="flex items-center gap-1 text-warning font-bold">
                            <AlertTriangle className="w-3.5 h-3.5" /> Calendar only — limited trip telemetry
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="w-32 shrink-0 pt-0.5 flex flex-col items-stretch gap-2">
                      {unscheduled ? (
                        <div className="text-right">
                          <span className="font-data text-sm font-bold text-foreground-muted">—</span>
                          <p className="text-[11px] text-foreground-muted font-medium">No health score</p>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="font-data text-xs font-black text-foreground">{p.score}/100</span>
                            <span className="text-[10px] font-bold text-foreground-muted">Health Rating</span>
                          </div>
                          <ProgressBar value={p.score} tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "info" ? "info" : "success"} />
                        </div>
                      )}
                      {p.vehicle_id && (
                        <Button asChild variant="outline" size="sm" className="h-7 rounded-xl px-2.5 text-[11px] font-semibold">
                          <Link href={`/fleet/vehicles/${p.vehicle_id}`} title="Open this vehicle's detail page">
                            Open vehicle
                            <ChevronRight className="ml-1 w-3 h-3" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
