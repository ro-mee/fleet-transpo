"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, TONE_CHIP, TONE_TEXT, TONE_RAIL, severityTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getAiInsights, dismissAiInsight } from "@/services/ai.service";
import { Lightbulb, AlertTriangle, Clock, X, RefreshCw, Sparkles, Radar } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_ICON = { critical: AlertTriangle, high: AlertTriangle, medium: Clock, low: Lightbulb };
const URGENCY_VERB = { high: "Act now", medium: "Act this week", low: "On the radar" };
const SEVERITY_BAR = {
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};

function normalizeSeverity(insight) {
  return (insight.severity || insight.impact || "low").toLowerCase();
}

export default function AiInsightsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);
  const queryClient = useQueryClient();

  const { data: insightsData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => getAiInsights(),
  });

  const insights = Array.isArray(insightsData)
    ? insightsData
    : Array.isArray(insightsData?.insights)
    ? insightsData.insights
    : [];

  const nlSummary = insightsData?.natural_language_summary || null;

  const counts = {
    high: insights.filter((i) => normalizeSeverity(i) === "high" || normalizeSeverity(i) === "critical").length,
    medium: insights.filter((i) => normalizeSeverity(i) === "medium").length,
    low: insights.filter((i) => normalizeSeverity(i) === "low").length,
  };

  const sorted = [...insights].sort(
    (a, b) => (SEVERITY_RANK[normalizeSeverity(a)] ?? 9) - (SEVERITY_RANK[normalizeSeverity(b)] ?? 9)
  );

  const dismissMutation = useMutation({
    mutationFn: dismissAiInsight,
    onSuccess: () => {
      toast.success("Alert dismissed");
      queryClient.invalidateQueries({ queryKey: ["ai-insights"] });
    },
    onError: (err) => toast.error(err.message || "Failed to dismiss alert"),
  });

  const distribution = [
    { label: "High", value: counts.high, tone: "danger" },
    { label: "Medium", value: counts.medium, tone: "warning" },
    { label: "Low", value: counts.low, tone: "info" },
  ];
  const total = counts.high + counts.medium + counts.low;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI & Automation"
        title="Operational Insights"
        description="What the system found in your fleet, in order of urgency."
        actions={
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin motion-reduce:animate-none")} />
            {isFetching ? "Refreshing..." : "Refresh"}
          </Button>
        }
      />

      {nlSummary && (
        <Card className="overflow-hidden">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <p className="font-data text-[11px] font-medium uppercase tracking-widest text-foreground-muted">
                    Operations briefing
                  </p>
                </div>
                <p className="text-[15px] leading-relaxed text-foreground-secondary">{nlSummary}</p>
              </div>
              <div className="lg:w-56 flex-shrink-0">
                <div className="space-y-2.5">
                  {distribution.map((d) => (
                    <div key={d.label} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-foreground-secondary">
                        <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_BAR[d.tone])} />
                        {d.label}
                      </span>
                      <span className={cn("font-data text-sm font-semibold", TONE_TEXT[d.tone])}>
                        {d.value}
                      </span>
                    </div>
                  ))}
                </div>
                {total > 0 && (
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-hover mt-3">
                    {distribution.map((d) =>
                      d.value > 0 ? (
                        <div
                          key={d.label}
                          className={cn("h-full", SEVERITY_BAR[d.tone])}
                          style={{ width: `${(d.value / total) * 100}%` }}
                        />
                      ) : null
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold">Action list ({insights.length})</CardTitle>
          <span className="text-xs text-foreground-muted">sorted by urgency</span>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-start gap-3 p-4 rounded-lg border border-border/60">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={Radar}
              title="Fleet is running clean"
              description="No anomalies detected right now. Alerts will surface here as vehicles approach service dates or registrations reach their renewal window."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Check fleet
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {sorted.map((insight) => {
                const sev = normalizeSeverity(insight);
                const tone = severityTone(sev);
                const Icon = SEVERITY_ICON[sev] || Lightbulb;
                return (
                  <div
                    key={insight.insight_id}
                    className={cn(
                      "flex items-start gap-3 border border-border/60 border-l-[3px] bg-surface rounded-lg p-3.5 transition-all hover:shadow-sm",
                      TONE_RAIL[tone]
                    )}
                  >
                    <div className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg", TONE_CHIP[tone])}>
                      <Icon className="w-[18px] h-[18px]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h4 className="text-sm font-semibold text-foreground">{insight.title}</h4>
                        <StatusBadge severity={sev} className="text-[11px]" />
                        <span className={cn("font-data text-[10px] uppercase tracking-wider", TONE_TEXT[tone])}>
                          {URGENCY_VERB[sev] || URGENCY_VERB.low}
                        </span>
                      </div>
                      <p className="text-sm text-foreground-secondary mt-1 leading-relaxed">
                        {insight.summary || insight.description}
                      </p>
                      <div className="mt-1.5">
                        <span className="inline-flex rounded-md bg-hover px-2 py-0.5 text-[11px] font-medium text-foreground-secondary">
                          {insight.category || "General"}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0 text-foreground-muted hover:text-foreground"
                      title="Dismiss alert"
                      aria-label={`Dismiss alert: ${insight.title}`}
                      onClick={() => dismissMutation.mutate(insight.insight_id)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
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
