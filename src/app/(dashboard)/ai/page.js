"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, TONE_CHIP, TONE_TEXT, severityTone, riskTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAiRecommendations, getAiInsights, getPredictiveMaintenance } from "@/services/ai.service";
import { dueLabel } from "@/lib/maintenance/outlook-display";
import { hasRole } from "@/lib/auth/permissions";
import { isUnscheduled } from "@/lib/ai/predictive-maintenance";
import { formatDate } from "@/lib/utils";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
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
  const {role} = useRequireRole();
  const canOpenMaintenance = hasRole({role}, ["super_admin","admin","fleet_manager"]);

  const { data: insightsData, isLoading: insightsLoading } = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => getAiInsights(),
  });

  const { data: recommendationsData } = useQuery({
    queryKey: ["ai-recommendations"],
    queryFn: () => getAiRecommendations(),
  });

  const { data: predictionData, isLoading: predictionsLoading, isError: predictionsError, refetch: retryPredictions } = useQuery({
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

  const overdueMaint = predictionsLoading || predictionsError ? "Unavailable" : (predictionSummary.overdue ?? 0) + (predictionSummary.critical ?? 0) + (predictionSummary.high ?? 0);

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
      <StatGrid cols={4}>
        <StatCard icon={Lightbulb} label="Active Insights" value={insights.length} trend="Across all telemetry modules" tone="primary" />
        <StatCard icon={AlertTriangle} label="Critical Alerts" value={critical} trend="Requires immediate attention" tone="danger" />
        <StatCard icon={Wrench} label="Vehicles due soon" value={overdueMaint} trend="Overdue or due within 30 days" tone="warning" />
        <StatCard icon={TrendingUp} label="Recommendations" value={recommendations.length} trend="Actionable fleet suggestions" tone="success" />
      </StatGrid>

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
              variant="waiting"
              size="compact"
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
            <Wrench className="w-4 h-4 text-warning" /> Vehicle service outlook
          </CardTitle>
          {canOpenMaintenance && <Link href="/maintenance/predictive" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
            Open service outlook <ChevronRight className="w-3.5 h-3.5" />
          </Link>}
        </CardHeader>

        <CardContent className="p-0">
          {predictionsError ? (<div role="alert" className="p-4 space-y-2"><p>Service outlook unavailable. Refresh to see current evidence.</p><Button variant="outline" onClick={retryPredictions}>Retry</Button></div>) : predictionsLoading ? (
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
              title="No eligible vehicles to assess"
              description="Service timing appears when eligible vehicle plans are recorded."
              variant="first-run"
              size="compact"
            />
          ) : (
            <div className="divide-y divide-border/60">
              {predictions.slice(0, 8).map((p) => {
                const unscheduled = isUnscheduled(p);
                const primary = p.services?.find(service => service.plan_id === p.primary_service_plan_id) || p.services?.[0] || p;
                const tone = unscheduled || p.serviceStatus === "needs_data" ? "secondary" : riskTone(p.risk);
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
                          <StatusBadge
                            status={unscheduled || p.serviceStatus === "needs_data" ? "unscheduled" : p.risk}
                            entity="risk"
                            className="text-[11px] font-bold"
                            label={unscheduled ? "No schedule" : dueLabel(primary)}
                          />
                        </div>
                        <p className="text-xs text-foreground-secondary mt-0.5 truncate">{p.recommendation}</p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className={cn("font-data text-sm font-extrabold", unscheduled || p.effectiveDays == null ? "text-foreground-muted" : "text-foreground")}>
                        {p.services?.length ?? 0} services
                      </p>
                      <p className="text-[11px] text-foreground-muted font-medium font-data">
                        {p.mileage == null ? "Mileage unavailable" : p.mileage.toLocaleString() + " km"}
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
