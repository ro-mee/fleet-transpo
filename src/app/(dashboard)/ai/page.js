"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, TONE_CHIP, TONE_TEXT, severityTone, riskTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAiRecommendations, getAiInsights, getPredictiveMaintenance } from "@/services/ai.service";
import { isUnscheduled } from "@/lib/ai/predictive-maintenance";
import { formatDate } from "@/lib/utils";
import { Brain, Lightbulb, Wrench, TrendingUp, AlertTriangle, CalendarDays, Gauge, ArrowRight } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import Link from "next/link";
import { cn } from "@/lib/utils";

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
  // Server-precomputed. The filter this replaces lowercased each risk to
  // compare, which is what kept it working while the tiles elsewhere read 0.
  const overdueMaint = predictionSummary.overdue + predictionSummary.critical + predictionSummary.high;

  const kpis = [
    { label: "Active Insights", value: insights.length, icon: Lightbulb, tone: "primary", trend: "across all categories" },
    { label: "Critical Alerts", value: critical, icon: AlertTriangle, tone: "danger", trend: "need attention now" },
    { label: "Maintenance Alerts", value: overdueMaint, icon: Wrench, tone: "warning", trend: "due or approaching" },
    { label: "Recommendations", value: recommendations.length, icon: TrendingUp, tone: "success", trend: "actionable suggestions" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="AI & Automation"
        description="Intelligent insights and automated fleet operations."
      />

      <StatGrid cols={4}>
        {kpis.map((kpi) => (
          <StatCard key={kpi.label} {...kpi} />
        ))}
      </StatGrid>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary" /> AI Insights
          </CardTitle>
          {insights.length > 3 && (
            <Link href="/ai/insights" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {insightsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((n) => (
                <div key={n} className="p-4 rounded-lg border border-border space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          ) : insights.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title="No insights yet"
              description="Insights will appear as the system learns your fleet's operational patterns."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {insights.map((insight) => {
                const sev = normalizeSeverity(insight);
                const tone = severityTone(sev);
                return (
                  <div key={insight.insight_id || insight.title} className="p-4 rounded-lg border border-border/60 bg-surface hover:shadow-sm transition-all">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className={cn("w-4 h-4", TONE_TEXT[tone])} />
                      <StatusBadge severity={sev} className="text-[11px]" />
                    </div>
                    <h4 className="text-sm font-semibold text-foreground mb-1">{insight.title}</h4>
                    <p className="text-xs text-foreground-secondary leading-relaxed mb-2">
                      {insight.summary || insight.description}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] text-foreground-muted font-medium">
                        {insight.category || "Fleet Utilization"}
                      </span>
                      <span className="text-[11px] text-foreground-muted">
                        {insight.created_at ? formatDate(insight.created_at) : "Active"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Wrench className="w-4 h-4 text-primary" /> Predictive Maintenance
          </CardTitle>
          {predictions.length > 10 && (
            <Link href="/ai/predictive-maintenance" className="text-xs font-medium text-primary hover:underline">
              View all →
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {predictionsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-4 p-3 rounded-lg border border-border/60">
                  <Skeleton className="h-9 w-9 rounded-lg" />
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
              title="No vehicles in the system"
              description="Add vehicles to get AI-powered maintenance predictions."
            />
          ) : (
            <div className="space-y-2">
              {predictions.slice(0, 10).map((p) => {
                // Same rule as /maintenance/predictive: a vehicle with no
                // schedule is unmeasured, not healthy, so it gets the neutral
                // chip and no score rather than success green and a 50.
                const unscheduled = isUnscheduled(p);
                const tone = unscheduled ? "secondary" : riskTone(p.risk);
                return (
                  <div key={p.vehicle_id} className="flex items-center gap-4 p-3 rounded-lg hover:bg-hover transition-colors">
                    <div className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg", TONE_CHIP[tone])}>
                      <Wrench className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{p.plate_number}</p>
                        <span className="text-xs text-foreground-muted">{p.vehicle_name}</span>
                        <StatusBadge status={unscheduled ? "unscheduled" : p.risk} entity="risk" className="text-[11px]">
                          {unscheduled
                            ? "No schedule"
                            : p.effectiveDays < 0
                            ? `${Math.abs(p.effectiveDays)}d over`
                            : `${p.effectiveDays}d`}
                        </StatusBadge>
                      </div>
                      <p className="text-xs text-foreground-muted mt-0.5">{p.recommendation}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={cn("font-data text-sm font-semibold", unscheduled ? "text-foreground-muted" : "text-foreground")}>
                        {unscheduled ? "—" : `${p.score}/100`}
                      </p>
                      <p className="text-[11px] text-foreground-muted">
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
