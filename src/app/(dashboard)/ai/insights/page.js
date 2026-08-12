"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, TONE_CHIP, TONE_TEXT, TONE_RAIL, severityTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getAiInsights, dismissAiInsight } from "@/services/ai.service";
import { Lightbulb, AlertTriangle, Clock, X, RefreshCw, Sparkles, Radar, ShieldAlert, Bot, Activity, Zap, ShieldCheck } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";

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
  const [syncToken, setSyncToken] = useState(0);

  const { data: insightsData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ai-insights", syncToken],
    queryFn: () => getAiInsights(syncToken > 0),
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

  const handleForceSync = () => {
    toast.info("Re-analyzing fleet telemetry with AI...");
    setSyncToken(Date.now());
  };

  // Show success toast when fetching finishes
  useEffect(() => {
    if (syncToken > 0 && !isFetching && !isLoading) {
      toast.success("AI Insights re-analyzed and synced!");
    }
  }, [isFetching, isLoading, syncToken]);

  const distribution = [
    { label: "High / Critical", value: counts.high, tone: "danger" },
    { label: "Medium Urgency", value: counts.medium, tone: "warning" },
    { label: "Low Urgency", value: counts.low, tone: "info" },
  ];
  const total = counts.high + counts.medium + counts.low;

  return (
    <div className="space-y-6 pb-12 w-full select-none">
      {/* ── TOP HERO HEADER BAR ── */}
      <HeroHeader
        icon={Lightbulb}
        title="AI Operational Insights & Telemetry"
        badge="Fleet Anomaly Radar"
        description="Operational anomalies and fleet insights detected by AI engine, prioritized in order of urgency."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleForceSync}
            disabled={isFetching}
            className={cn("rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer", heroButtonOutlineClass)}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-2", isFetching && "animate-spin")} />
            Force AI Re-Analyze
          </Button>
        }
      />

      {/* ── PREMIUM AI OPERATIONS BRIEFING CARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            {/* Left 7 Cols: Executive AI Summary */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs shrink-0">
                  <Sparkles className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-foreground uppercase tracking-wider">AI Operations Briefing</h3>
                    <Badge variant="primary" className="rounded-full px-2.5 py-0.5 text-[10px] font-bold">Intelligence Engine</Badge>
                  </div>
                  <p className="text-xs text-foreground-muted font-medium mt-0.5">Continuous telemetry anomaly analysis</p>
                </div>
              </div>

              <div className="mt-4">
                {isLoading ? (
                  <div className="p-5 rounded-3xl bg-surface border border-border/60 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.02)] flex gap-4 items-center">
                    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2.5">
                      <Skeleton className="h-3.5 w-full rounded-md" />
                      <Skeleton className="h-3.5 w-[85%] rounded-md" />
                    </div>
                  </div>
                ) : nlSummary ? (
                  <div className="relative p-5 rounded-3xl bg-gradient-to-br from-primary/5 via-surface to-muted/20 border border-primary/10 shadow-[0_8px_30px_-6px_rgba(0,0,0,0.05)] overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary to-primary/20 group-hover:from-primary group-hover:to-primary/60 transition-colors duration-500" />
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary border border-primary/20 shadow-2xs group-hover:scale-110 transition-transform duration-300">
                          <Bot className="w-4 h-4" />
                        </div>
                      </div>
                      <p className="text-[13.5px] text-foreground-secondary leading-loose font-medium text-balance">
                        {nlSummary}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="relative p-5 rounded-3xl bg-surface/50 border border-border/60 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.02)] overflow-hidden flex gap-4 items-start">
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted/50 text-foreground-muted border border-border/60 shadow-2xs">
                        <Radar className="w-4 h-4 opacity-70" />
                      </div>
                    </div>
                    <p className="text-[13px] text-foreground-secondary leading-relaxed font-medium">
                      Live telemetry is currently operating in <span className="font-bold text-foreground">Deterministic Mode</span>. Generative AI summaries are temporarily unavailable, but all core rule-based safety, compliance, and maintenance alerts remain fully active below.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-foreground">
                <div className="px-3 py-1.5 rounded-xl bg-info/10 text-info border border-info/20 shadow-2xs flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" />
                  <span>Telemetry Synced</span>
                </div>
              </div>
            </div>

            {/* Right 5 Cols: Severity Breakdown Executive Card */}
            <div className="lg:col-span-5 p-5 rounded-3xl bg-muted/40 border border-border/80 space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-primary" /> Severity Distribution
                </span>
                <span className="text-[11px] font-bold font-data text-foreground-muted">{total} Active Alerts</span>
              </div>

              <div className="space-y-2.5">
                {distribution.map((d) => (
                  <div key={d.label} className="flex items-center justify-between p-2.5 rounded-xl bg-surface border border-border/60 text-xs font-bold">
                    <span className="flex items-center gap-2 text-foreground-secondary">
                      <span className={cn("h-2.5 w-2.5 rounded-full", SEVERITY_BAR[d.tone])} />
                      {d.label}
                    </span>
                    <span className={cn("font-data text-xs font-black px-2 py-0.5 rounded-md bg-muted/60", TONE_TEXT[d.tone])}>
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Progress Track */}
              <div className="space-y-1 pt-1">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-border/60">
                  {total > 0 ? (
                    distribution.map((d) =>
                      d.value > 0 ? (
                        <div
                          key={d.label}
                          className={cn("h-full transition-all", SEVERITY_BAR[d.tone])}
                          style={{ width: `${(d.value / total) * 100}%` }}
                        />
                      ) : null
                    )
                  ) : (
                    <div className="h-full w-full bg-success/40" />
                  )}
                </div>
                <p className="text-[10px] font-semibold text-foreground-muted text-right">
                  {total > 0 ? `${counts.high} high priority items` : "All operational parameters normal"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── ACTION LIST CARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Radar className="w-4 h-4 text-primary" /> Priority Action Items ({insights.length})
          </CardTitle>
          <span className="text-xs text-foreground-muted font-bold">Sorted by highest urgency</span>
        </CardHeader>

        <CardContent className="pt-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-start gap-4 p-4 rounded-3xl border border-border/60 bg-surface">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/5 rounded-lg" />
                    <Skeleton className="h-3 w-full rounded-lg" />
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
                <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-2xl text-xs font-bold mt-2">
                  <RefreshCw className="w-3.5 h-3.5 mr-2" /> Check Fleet Status
                </Button>
              }
              className="py-12"
            />
          ) : (
            <div className="space-y-3">
              {sorted.map((insight) => {
                const sev = normalizeSeverity(insight);
                const tone = severityTone(sev);
                const Icon = SEVERITY_ICON[sev] || Lightbulb;
                return (
                  <div
                    key={insight.insight_id}
                    className={cn(
                      "flex items-start gap-4 border border-border/80 border-l-4 bg-surface rounded-2xl p-4 transition-all hover:shadow-xs",
                      TONE_RAIL[tone]
                    )}
                  >
                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-3xl border shadow-2xs", TONE_CHIP[tone])}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h4 className="text-sm font-bold text-foreground">{insight.title}</h4>
                        <StatusBadge severity={sev} className="text-[11px] font-bold" />
                        <span className={cn("font-data text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-hover", TONE_TEXT[tone])}>
                          {URGENCY_VERB[sev] || URGENCY_VERB.low}
                        </span>
                      </div>
                      <p className="text-xs text-foreground-secondary leading-relaxed font-medium">
                        {insight.summary || insight.description}
                      </p>
                      <div className="mt-2.5 flex items-center gap-2">
                        <span className="inline-flex rounded-lg bg-hover border border-border/60 px-2.5 py-0.5 text-[11px] font-bold text-foreground-secondary">
                          {insight.category || "General"}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-foreground-muted hover:text-danger hover:bg-danger/10 rounded-xl cursor-pointer"
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
