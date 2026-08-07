"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, TONE_CHIP, TONE_TEXT, severityTone, riskTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAiRecommendations, getAiInsights, getPredictiveMaintenance } from "@/services/ai.service";
import { isUnscheduled } from "@/lib/ai/predictive-maintenance";
import { formatDate } from "@/lib/utils";
import {
  Brain,
  Lightbulb,
  Wrench,
  TrendingUp,
  AlertTriangle,
  CalendarDays,
  Gauge,
  ArrowRight,
  Sparkles,
  Bot,
  ShieldAlert,
  ChevronRight,
  Zap,
  Activity,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";

function normalizeSeverity(insight) {
  return (insight.severity || insight.impact || "low").toLowerCase();
}

export default function AiDashboardPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);

  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => getAiInsights(),
  });

  const { data: recommendationsData } = useQuery({
    queryKey: ["ai-recommendations"],
    queryFn: () => getAiRecommendations(),
  });

  const { data: predictionData, isLoading: predictionsLoading } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });

  const predictions = predictionData?.predictions ?? [];
  const predictionSummary = predictionData?.summary ?? { overdue: 0, critical: 0, high: 0 };

  const insights = Array.isArray(insightsData)
    ? insightsData
    : Array.isArray(insightsData?.insights)
    ? insightsData.insights
    : [];

  const recommendations = Array.isArray(recommendationsData)
    ? recommendationsData
    : Array.isArray(recommendationsData?.recommendations)
    ? recommendationsData.recommendations
    : [];

  const critical = insights.filter(
    (i) => normalizeSeverity(i) === "high" || normalizeSeverity(i) === "critical"
  ).length;

  const overdueMaint = predictionSummary.overdue + predictionSummary.critical + predictionSummary.high;

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* ── TOP AI HERO HEADER ── */}
      <HeroHeader
        icon={Sparkles}
        title="AI & Operational Automation Hub"
        badge="Autonomous Engine v2.4"
        description="Intelligent predictive maintenance algorithms, telemetry insights, and automated fleet recommendations."
        actions={
          <Link href="/ai/insights">
            <Button variant="default" size="sm" className={cn("rounded-2xl h-10 px-5 text-xs font-bold shadow-xs cursor-pointer", heroButtonPrimaryClass)}>
              <Lightbulb className="w-4 h-4 mr-2" /> View Full Insights List <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        }
      />

      {/* ── EXECUTIVE KPI STAT CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Active Insights */}
        <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Active Insights</span>
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Lightbulb className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{insights.length}</div>
            <p className="text-[11px] text-primary font-medium mt-1">Across all telemetry modules</p>
          </div>
        </div>

        {/* KPI 2: Critical Alerts */}
        <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Critical Alerts</span>
            <div className="p-2 rounded-xl bg-danger/10 text-danger">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{critical}</div>
            <p className="text-[11px] text-danger font-semibold mt-1">Requires immediate attention</p>
          </div>
        </div>

        {/* KPI 3: Maintenance Alerts */}
        <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Maintenance Alerts</span>
            <div className="p-2 rounded-xl bg-warning/10 text-warning">
              <Wrench className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{overdueMaint}</div>
            <p className="text-[11px] text-warning font-semibold mt-1">Due or approaching service</p>
          </div>
        </div>

        {/* KPI 4: Recommendations */}
        <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Recommendations</span>
            <div className="p-2 rounded-xl bg-success/10 text-success">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{recommendations.length}</div>
            <p className="text-[11px] text-success font-medium mt-1">Actionable fleet suggestions</p>
          </div>
        </div>
      </div>

      {/* ── SECTION 1: AI INSIGHTS GRID ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Sparkles className="w-4 h-4 text-primary" /> Active Telemetry Insights
          </CardTitle>
          {insights.length > 3 && (
            <Link href="/ai/insights" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
              View all ({insights.length}) <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </CardHeader>

        <CardContent className="pt-4">
          {insightsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((n) => (
                <div key={n} className="p-4 rounded-3xl border border-border/80 space-y-3 bg-surface">
                  <Skeleton className="h-4 w-24 rounded-lg" />
                  <Skeleton className="h-4 w-3/4 rounded-lg" />
                  <Skeleton className="h-3 w-full rounded-lg" />
                </div>
              ))}
            </div>
          ) : insights.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title="No active insights yet"
              description="Insights will appear as the AI system analyzes fleet operational patterns."
              className="py-12"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {insights.map((insight) => {
                const sev = normalizeSeverity(insight);
                const tone = severityTone(sev);
                return (
                  <div
                    key={insight.insight_id || insight.title}
                    className="p-4.5 rounded-3xl border border-border/80 bg-surface hover:border-primary/40 hover:shadow-xs transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className={cn("w-4 h-4", TONE_TEXT[tone])} />
                          <StatusBadge severity={sev} className="text-[11px] font-bold" />
                        </div>
                        <span className="text-[10px] font-bold text-foreground-muted bg-hover px-2 py-0.5 rounded-full">
                          {insight.category || "Utilization"}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-foreground mb-1.5 line-clamp-1">{insight.title}</h4>
                      <p className="text-xs text-foreground-secondary leading-relaxed mb-3 line-clamp-2">
                        {insight.summary || insight.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border/60 text-[11px] text-foreground-muted font-medium">
                      <span>Status: <strong className="text-foreground font-bold">{insight.created_at ? formatDate(insight.created_at) : "Active"}</strong></span>
                      <Link href="/ai/insights" className="text-primary font-bold hover:underline">
                        Details →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── SECTION 2: PREDICTIVE MAINTENANCE TELEMETRY ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Wrench className="w-4 h-4 text-warning" /> Predictive Maintenance Telemetry
          </CardTitle>
          <Link href="/maintenance/predictive" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
            Open Maintenance Center <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </CardHeader>

        <CardContent className="p-0">
          {predictionsLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-4 p-3 rounded-3xl border border-border/60">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : predictions.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No vehicles registered in telemetry"
              description="Add vehicles to initialize AI predictive health scoring."
              className="py-12"
            />
          ) : (
            <div className="divide-y divide-border/60">
              {predictions.slice(0, 8).map((p) => {
                const unscheduled = isUnscheduled(p);
                const tone = unscheduled ? "secondary" : riskTone(p.risk);
                return (
                  <div key={p.vehicle_id} className="flex items-center justify-between gap-4 p-4 hover:bg-hover/50 transition-colors">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-3xl border shadow-2xs", TONE_CHIP[tone])}>
                        <Wrench className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-foreground font-data">{p.plate_number}</p>
                          <span className="text-xs text-foreground-muted truncate font-medium">{p.vehicle_name}</span>
                          <StatusBadge status={unscheduled ? "unscheduled" : p.risk} entity="risk" className="text-[11px] font-bold">
                            {unscheduled
                              ? "No schedule"
                              : p.effectiveDays < 0
                              ? `${Math.abs(p.effectiveDays)}d overdue`
                              : `${p.effectiveDays}d remaining`}
                          </StatusBadge>
                        </div>
                        <p className="text-xs text-foreground-secondary mt-0.5 truncate">{p.recommendation}</p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className={cn("font-data text-sm font-extrabold", unscheduled ? "text-foreground-muted" : "text-foreground")}>
                        {unscheduled ? "—" : `${p.score}/100`}
                      </p>
                      <p className="text-[11px] text-foreground-muted font-medium font-data">
                        {p.mileage?.toLocaleString()} km
                      </p>
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
