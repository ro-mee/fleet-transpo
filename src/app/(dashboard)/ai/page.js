"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, TONE_CHIP, TONE_TEXT, severityTone, riskTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAiRecommendations, getAiInsights, getPredictiveMaintenance } from "@/services/ai.service";
import { dueLabel } from "@/lib/maintenance/outlook-display";
import { isUnscheduled } from "@/lib/ai/predictive-maintenance";
import { formatDate } from "@/lib/utils";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import {
  Lightbulb,
  Wrench,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { rolesFor } from "@/lib/auth/permissions";
import { QueryBoundary } from "@/components/ui/query-feedback";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";

function normalizeSeverity(insight) {
  return (insight.severity || insight.impact || "low").toLowerCase();
}

export default function AiDashboardPage() {
  const { authorized, role } = useRequireRole();
  const canViewOutlook = rolesFor("predictive_maintenance", "read").includes(role);

  const insightsQuery = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => getAiInsights(),
    enabled: authorized,
  });

  const recommendationsQuery = useQuery({
    queryKey: ["ai-recommendations"],
    queryFn: () => getAiRecommendations(),
    enabled: authorized,
  });

  const predictionsQuery = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
    enabled: authorized && canViewOutlook,
  });

  const { data: insightsData } = insightsQuery;
  const { data: recommendationsData } = recommendationsQuery;
  const { data: predictionData } = predictionsQuery;

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
  const metric = (query, value) => query.isLoading || query.isError || !query.data ? "—" : value;
  const metricNote = (query, label) => query.isError ? "Unavailable — retry below" : !query.data ? `Loading ${label}` : undefined;

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* ── TOP AI HERO HEADER ── */}
      <HeroHeader
        icon={Sparkles}
        title="AI & Operational Automation Hub"
        badge="Decision support"
        description="Review fleet insights, service schedules and advisory vehicle suggestions."
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
        <StatCard icon={Lightbulb} label="Active Insights" value={metric(insightsQuery, insights.length)} trend={metricNote(insightsQuery, "insights") || "Current fleet insights"} tone="primary" />
        <StatCard icon={AlertTriangle} label="High-priority insights" value={metric(insightsQuery, critical)} trend={metricNote(insightsQuery, "insights") || "High or critical insight severity"} tone="danger" />
        <StatCard icon={Wrench} label="Service schedule alerts" value={canViewOutlook ? metric(predictionsQuery, overdueMaint) : "—"} trend={canViewOutlook ? metricNote(predictionsQuery, "service outlook") || "Due or approaching planned service" : "Available to fleet maintenance roles"} tone="warning" />
        <StatCard icon={TrendingUp} label="Recommendations" value={metric(recommendationsQuery, recommendations.length)} trend={metricNote(recommendationsQuery, "recommendations") || "Advisory vehicles; confirm resources in dispatch"} tone="success" />
      </StatGrid>

      <QueryBoundary query={recommendationsQuery} isEmpty={() => false} skeleton={<></>}
        errorTitle="Recommendations unavailable"
        errorDescription="Vehicle suggestions could not be loaded. Try again; no resources have been assigned.">
        {() => null}
      </QueryBoundary>

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
          <QueryBoundary query={insightsQuery} isEmpty={() => false} errorTitle="Insights unavailable"
            errorDescription="Fleet insights could not be loaded. Try again to check the current results."
            skeleton={<div role="status" aria-label="Loading insights"><Skeleton className="h-28 w-full" /><span className="sr-only">Loading insights</span></div>}>
          {() => insights.length === 0 ? (
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
          </QueryBoundary>
        </CardContent>
      </Card>

      {/* ── SECTION 2: PREDICTIVE MAINTENANCE TELEMETRY ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Wrench className="w-4 h-4 text-warning" /> Service Schedule Outlook
          </CardTitle>
          {canViewOutlook && <Link href="/maintenance/predictive" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
            Open Maintenance Center <ChevronRight className="w-3.5 h-3.5" />
          </Link>}
        </CardHeader>

        <CardContent className="p-0">
          {!canViewOutlook ? <p className="p-4 text-sm text-foreground-secondary">Service outlook is available to fleet maintenance roles.</p> :
          <QueryBoundary query={predictionsQuery} isEmpty={() => false} errorTitle="Service outlook unavailable"
            errorDescription="Service schedule predictions could not be loaded. Try again before drawing conclusions about the fleet."
            skeleton={<div className="p-4" role="status" aria-label="Loading service outlook"><Skeleton className="h-28 w-full" /><span className="sr-only">Loading service outlook</span></div>}>
          {() => predictions.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No eligible vehicles to assess"
              description="No eligible active vehicles were returned. Service predictions are separate from maintenance work orders."
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
          </QueryBoundary>}
        </CardContent>
      </Card>
    </div>
  );
}
