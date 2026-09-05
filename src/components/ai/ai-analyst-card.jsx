"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TONE_CHIP, TONE_TEXT } from "@/components/ui/status-badge";
import { Sparkles, Bot, Radar, RefreshCw, CheckCircle2, ArrowUpRight, Crosshair, ListChecks, Clock } from "lucide-react";

// Reusable "AI Analyst" card for the reports & analytics pages (Tier 1).
//
// Given the /api/ai/report-narrative payload it renders the narrative paragraph,
// recommended actions, and a flag badge. Handles loading, no-data (demo/empty),
// deterministic mode, and generation.

const FLAG_META = {
  success: { label: "Healthy", tone: "success", icon: CheckCircle2 },
  watch: { label: "Monitoring", tone: "warning", icon: Crosshair },
  risk: { label: "Needs Attention", tone: "danger", icon: ArrowUpRight },
};

export function AiAnalystCard({
  title = "AI Analyst",
  reportLabel = "Automated report analysis",
  loading = false,
  data = null,
  onRegenerate,
  isRegenerating = false,
}) {
  const flag = data?.flag || "success";
  const meta = FLAG_META[flag] || FLAG_META.success;
  const FlagIcon = meta.icon;

  return (
    <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-foreground uppercase tracking-wider">{title}</h3>
                <Badge variant="primary" className="rounded-full px-2.5 py-0.5 text-[10px] font-bold">
                  Intelligence Engine
                </Badge>
              </div>
              <p className="text-xs text-foreground-muted font-medium mt-0.5">{reportLabel}</p>
            </div>
          </div>

          {onRegenerate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRegenerate}
              disabled={isRegenerating || loading}
              className="rounded-2xl h-9 px-3.5 text-xs font-semibold cursor-pointer shrink-0"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 mr-2", (isRegenerating || loading) && "animate-spin")} />
              Regenerate
            </Button>
          )}
        </div>

        {/* Body */}
        <div className="mt-4">
          {loading ? (
            <div className="p-4 rounded-3xl bg-surface border border-border/60 flex gap-3 items-center">
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-full rounded-md" />
                <Skeleton className="h-3.5 w-[80%] rounded-md" />
              </div>
            </div>
          ) : data?.mode === "no-data" ? (
            <div className="rounded-3xl border border-border/60 bg-surface">
              <EmptyState
                icon={Radar}
                title="No activity in this period"
                description="Trips, fuel, or maintenance recorded in the selected dates will feed the narrative — try widening the date range."
                variant="waiting"
                size="compact"
              />
            </div>
          ) : !data?.narrative ? (
            data?.mode === "rate-limited" ? (
              <div className="rounded-3xl border border-border/60 bg-surface">
                <EmptyState
                  icon={Clock}
                  title="Daily limit reached"
                  description="You've used all 3 regenerations for today — come back tomorrow for a fresh analysis."
                  tone="warning"
                  size="compact"
                />
              </div>
            ) : (
              <div className="rounded-3xl border border-border/60 bg-surface">
                <EmptyState
                  icon={Bot}
                  title="Deterministic mode"
                  description="Generative analysis is temporarily unavailable; the number-grounded fallback is shown below."
                  tone="info"
                  size="compact"
                />
              </div>
            )
          ) : (
            <div className="relative p-4 rounded-3xl bg-gradient-to-br from-primary/5 via-surface to-muted/20 border border-primary/10 overflow-hidden space-y-4">
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-primary to-primary/20" />

              {/* Rate-limit notice on top of the still-valid narrative */}
              {data?.mode === "rate-limited" && (
                <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-[12.5px] text-foreground-secondary font-medium flex items-start gap-2">
                  <Radar className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <span>
                    <span className="font-bold text-foreground">Daily regenerate limit reached.</span> You&apos;ve used your
                    3 regenerations for today. Showing your latest analysis — you can refresh again tomorrow.
                  </span>
                </div>
              )}

              {/* Flag chip */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-[11px] font-bold",
                    TONE_CHIP[meta.tone],
                    TONE_TEXT[meta.tone].replace("text-", "border-")
                  )}
                >
                  <FlagIcon className="w-3.5 h-3.5" />
                  {meta.label}
                </span>
                {data?.mode === "deterministic" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                    <Bot className="w-3 h-3" /> Deterministic
                  </span>
                )}
              </div>

              {/* Narrative */}
              <div className="flex gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary border border-primary/20">
                    <Bot className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[13.5px] text-foreground-secondary leading-loose font-medium text-balance">
                  {data.narrative}
                </p>
              </div>

              {/* Recommended actions */}
              {Array.isArray(data.actions) && data.actions.length > 0 && (
                <div className="border-t border-border/60 pt-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground-muted mb-2">
                    <ListChecks className="w-3.5 h-3.5" /> Recommended Actions
                  </p>
                  <ul className="space-y-1.5">
                    {data.actions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground-secondary font-medium leading-relaxed">
                        <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black", TONE_CHIP[meta.tone])}>
                          {i + 1}
                        </span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Mode tone footer */}
              <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground-muted">
                <span className={cn("h-2 w-2 rounded-full", TONE_TEXT[meta.tone])} />
                {data?.range ? `Analyzed for ${data.range.from} → ${data.range.to}` : "Analyzed for selected period"}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}