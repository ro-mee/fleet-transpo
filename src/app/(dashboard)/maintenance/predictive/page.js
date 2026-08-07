"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, TONE_CHIP, riskTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";
import { HeroHeader } from "@/components/ui/hero-header";

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* KPI 1: Overdue */}
        <button
          type="button"
          onClick={() => setRiskFilter((r) => (r === "overdue" ? "all" : "overdue"))}
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-2 cursor-pointer select-none",
            riskFilter === "overdue"
              ? "border-danger bg-danger/10 shadow-xs"
              : "border-border/80 bg-surface hover:border-danger/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">Overdue</span>
            <div className="p-1.5 rounded-xl bg-danger/15 text-danger">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-danger font-data">{summary.overdue}</div>
            <p className="text-[10px] text-danger font-semibold mt-0.5">Service window passed</p>
          </div>
        </button>

        {/* KPI 2: Critical */}
        <button
          type="button"
          onClick={() => setRiskFilter((r) => (r === "critical" ? "all" : "critical"))}
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-2 cursor-pointer select-none",
            riskFilter === "critical"
              ? "border-danger bg-danger/10 shadow-xs"
              : "border-border/80 bg-surface hover:border-danger/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">Critical (7d)</span>
            <div className="p-1.5 rounded-xl bg-danger/15 text-danger">
              <CalendarDays className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-danger font-data">{summary.critical}</div>
            <p className="text-[10px] text-danger font-semibold mt-0.5">Due within a week</p>
          </div>
        </button>

        {/* KPI 3: High */}
        <button
          type="button"
          onClick={() => setRiskFilter((r) => (r === "high" ? "all" : "high"))}
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-2 cursor-pointer select-none",
            riskFilter === "high"
              ? "border-warning bg-warning/10 shadow-xs"
              : "border-border/80 bg-surface hover:border-warning/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">High (30d)</span>
            <div className="p-1.5 rounded-xl bg-warning/15 text-warning">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-warning font-data">{summary.high}</div>
            <p className="text-[10px] text-warning font-semibold mt-0.5">Due within 30 days</p>
          </div>
        </button>

        {/* KPI 4: Healthy */}
        <button
          type="button"
          onClick={() => setRiskFilter((r) => (r === "low" ? "all" : "low"))}
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-2 cursor-pointer select-none",
            riskFilter === "low"
              ? "border-success bg-success/10 shadow-xs"
              : "border-border/80 bg-surface hover:border-success/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">Healthy</span>
            <div className="p-1.5 rounded-xl bg-success/15 text-success">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-success font-data">{healthyCount}</div>
            <p className="text-[10px] text-success font-semibold mt-0.5">More than 90 days out</p>
          </div>
        </button>

        {/* KPI 5: No Schedule */}
        <button
          type="button"
          onClick={() => setRiskFilter((r) => (r === "unscheduled" ? "all" : "unscheduled"))}
          className={cn(
            "p-4 rounded-3xl border transition-all text-left flex flex-col justify-between space-y-2 cursor-pointer select-none",
            riskFilter === "unscheduled"
              ? "border-primary bg-primary/10 shadow-xs"
              : "border-border/80 bg-surface hover:border-primary/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider">No Schedule</span>
            <div className="p-1.5 rounded-xl bg-hover text-foreground-muted">
              <HelpCircle className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-black text-foreground font-data">{summary.unscheduled}</div>
            <p className="text-[10px] text-foreground-muted font-medium mt-0.5">Needs date/mileage</p>
          </div>
        </button>
      </div>

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
              className="py-12"
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

                    <div className="w-32 shrink-0 pt-0.5">
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
