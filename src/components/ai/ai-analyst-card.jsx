"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  RefreshCw,
  Settings,
  ListChecks,
  Calendar,
  Radar,
} from "lucide-react";

// Reusable "AI Analyst" card for reports & analytics pages.
//
// Matches the visual source of truth (media_1788657029174.png):
// - Header with Sparkles squircle, title, "Intelligence Engine" pill, subtitle, and outline Regenerate button.
// - Inner panel with soft #f8fafd background, Monitoring and DETERMINISTIC pills.
// - 3-bar icon leading into prominent number-grounded narrative insight sentence.
// - Subtle horizontal divider.
// - RECOMMENDED ACTIONS section with numbered soft-blue circular badges.
// - Footer date row with calendar icon and analyzed date range.
// - Atmospheric landscape wave background along the lower half of the panel.

const FLAG_CONFIG = {
  success: {
    label: "Healthy",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50/90 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60",
  },
  watch: {
    label: "Monitoring",
    dot: "bg-amber-500",
    badge: "bg-amber-50/90 text-amber-700 border-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
  },
  risk: {
    label: "Needs Attention",
    dot: "bg-rose-500",
    badge: "bg-rose-50/90 text-rose-700 border-rose-200/70 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60",
  },
};

export function AiAnalystCard({
  title = "AI Analyst - Fleet Utilization",
  reportLabel = "Number-grounded analysis for the selected window",
  // Expected report identity (e.g. "drivers"). When provided, a narrative is
  // rendered ONLY if its server-echoed `report` matches — a stale narrative
  // from another tab must never appear under this title.
  report = null,
  // Fallback date window ({ from, to }) shown when the narrative carries none.
  range = null,
  loading = false,
  data = null,
  onRegenerate,
  isRegenerating = false,
}) {
  const matchedData = report ? (data?.report === report ? data : null) : data;
  const hasAnalysis = Boolean(matchedData?.narrative);
  const flagKey = matchedData?.flag || "watch";
  const flagMeta = FLAG_CONFIG[flagKey] || FLAG_CONFIG.watch;

  const narrativeText = matchedData?.narrative || null;
  const actionsList = Array.isArray(matchedData?.actions)
    ? matchedData.actions.map((a) => String(a).trim()).filter(Boolean).slice(0, 3)
    : [];

  const modeLabel = matchedData?.mode ? String(matchedData.mode).toUpperCase() : null;

  const rangeFrom = matchedData?.range?.from || range?.from || null;
  const rangeTo = matchedData?.range?.to || range?.to || null;
  const dateRangeText =
    rangeFrom && rangeTo
      ? `${rangeFrom} — ${rangeTo}`
      : typeof matchedData?.range === "string" && matchedData.range
        ? matchedData.range
        : "—";
  // "AI Analyst - Driver performance" → "Driver performance", for the
  // loading skeleton's accessible status text.
  const reportName = String(title || "").replace(/^AI Analyst\s*[-—:]\s*/i, "").trim() || "report";

  return (
    <Card className="rounded-2xl sm:rounded-3xl border border-slate-200/70 dark:border-border/70 bg-white dark:bg-surface p-5 sm:p-6 shadow-xs overflow-hidden">
      <CardContent className="p-0">
        {/* Card Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-950/40 text-sky-500 border border-sky-100 dark:border-sky-900/40 shadow-2xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                  {title}
                </h3>
                <span className="rounded-full bg-[#0b132b] dark:bg-white text-white dark:text-slate-900 px-2.5 py-0.5 text-[10px] font-bold">
                  Intelligence Engine
                </span>
              </div>
              <p className="text-xs text-slate-400 font-normal mt-0.5">
                {reportLabel}
              </p>
            </div>
          </div>

          {onRegenerate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRegenerate}
              disabled={isRegenerating || loading}
              className="rounded-full h-8 px-4 text-xs font-semibold cursor-pointer shrink-0 border border-slate-200/80 bg-white hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 transition-colors shadow-2xs"
            >
              <RefreshCw
                className={cn(
                  "w-3.5 h-3.5 mr-2",
                  (isRegenerating || loading) && "animate-spin"
                )}
              />
              Regenerate
            </Button>
          )}
        </div>

        {/* Inner Insight Panel */}
        <div className="mt-4">
          {loading ? (
            <div
              className="p-5 rounded-2xl bg-[#f8fafd] dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800 flex gap-3 items-center"
              role="status"
              aria-live="polite"
              aria-label={`Generating analysis for ${reportName}`}
            >
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-xs font-medium text-slate-400">Generating analysis for {reportName}…</p>
                <Skeleton className="h-3.5 w-full rounded-md" />
                <Skeleton className="h-3.5 w-[80%] rounded-md" />
              </div>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-[#f8fafd] dark:bg-slate-900/40 p-5 sm:p-6">
              {/* Atmospheric Landscape Wave Background in Lower Half */}
              <svg
                className="pointer-events-none absolute inset-x-0 bottom-0 h-44 w-full select-none"
                preserveAspectRatio="none"
                viewBox="0 0 1000 200"
                fill="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="analyst-landscape-1" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.08" />
                    <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.03" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="analyst-landscape-2" x1="1" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.06" />
                    <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.02" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {/* Upper gentle wave flowing across */}
                <path
                  d="M0 120 Q 300 60, 600 110 T 1000 70 L 1000 200 L 0 200 Z"
                  fill="url(#analyst-landscape-1)"
                />
                <path
                  d="M0 120 Q 300 60, 600 110 T 1000 70"
                  stroke="rgba(56, 189, 248, 0.18)"
                  strokeWidth="1.25"
                  fill="none"
                />
                {/* Lower overlapping wave */}
                <path
                  d="M0 155 Q 350 110, 700 145 T 1000 120 L 1000 200 L 0 200 Z"
                  fill="url(#analyst-landscape-2)"
                />
                <path
                  d="M0 155 Q 350 110, 700 145 T 1000 120"
                  stroke="rgba(56, 189, 248, 0.12)"
                  strokeWidth="1"
                  fill="none"
                />
                {/* Faint dotted landscape contour on the right */}
                <path
                  d="M450 135 Q 720 90, 1000 130"
                  stroke="rgba(56, 189, 248, 0.15)"
                  strokeWidth="1.25"
                  strokeDasharray="4 4"
                  fill="none"
                />
              </svg>

              {/* Panel Content (Z-indexed above waves) */}
              <div className="relative z-10 space-y-4">
                {/* Rate-limit notice if applicable */}
                {matchedData?.mode === "rate-limited" && (
                  <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/40 px-3.5 py-2 text-xs text-amber-800 dark:text-amber-200 font-medium flex items-center gap-2">
                    <Radar className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>Daily regenerate limit reached (3/3). Showing current analysis.</span>
                  </div>
                )}

                {/* Top Row: Status Pills */}
                <div className="flex flex-wrap items-center gap-2">
                  {hasAnalysis ? (
                    <>
                      {/* Pill 1: Monitoring / Flag */}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-2xs",
                          flagMeta.badge
                        )}
                      >
                        <span className={cn("h-2 w-2 rounded-full shrink-0", flagMeta.dot)} />
                        {flagMeta.label}
                      </span>

                      {/* Pill 2: mode (deterministic / generative) */}
                      {modeLabel && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 shadow-2xs">
                          <Settings className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                          {modeLabel}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 shadow-2xs">
                      Awaiting analysis
                    </span>
                  )}
                </div>

                {/* Main Narrative Insight Row */}
                <div className="flex items-center gap-3 pt-0.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100/80 dark:bg-sky-950/70 text-sky-600 dark:text-sky-400 border border-sky-200/50 dark:border-sky-800/40 shadow-2xs">
                    <svg className="h-4.5 w-4.5 text-sky-600 dark:text-sky-400" viewBox="0 0 20 20" fill="currentColor">
                      <rect x="3.5" y="10" width="2.5" height="7" rx="1.25" />
                      <rect x="8.75" y="4" width="2.5" height="13" rx="1.25" />
                      <rect x="14" y="8" width="2.5" height="9" rx="1.25" />
                    </svg>
                  </div>
                  {hasAnalysis ? (
                    <p className="text-[15px] sm:text-base font-semibold tracking-tight text-slate-900 dark:text-white leading-snug">
                      {narrativeText}
                    </p>
                  ) : (
                    <p className="text-sm font-normal text-slate-400 leading-snug">
                      No analysis available for this report in the selected period yet.
                    </p>
                  )}
                </div>

                {/* Divider */}
                <div className="border-b border-slate-200/60 dark:border-slate-800/80 my-4" />

                {/* Recommended Actions Section */}
                <div>
                  <div className="flex items-center gap-2 text-slate-400 dark:text-slate-400 mb-2.5">
                    <ListChecks className="h-4 w-4 text-slate-400" />
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em]">
                      RECOMMENDED ACTIONS
                    </p>
                  </div>

                  {actionsList.length > 0 ? (
                    <ul className="space-y-2">
                      {actionsList.map((action, i) => (
                        <li key={i} className="flex items-center gap-3">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-950/70 text-[11px] font-bold text-sky-600 dark:text-sky-400">
                            {i + 1}
                          </span>
                          <span className="text-sm font-normal text-slate-700 dark:text-slate-300 leading-normal">
                            {action}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm font-normal text-slate-400 leading-normal">
                      No recommended actions for this period.
                    </p>
                  )}
                </div>

                {/* Footer / Date Row */}
                <div className="pt-2 flex items-center gap-2 text-xs font-normal text-slate-400 dark:text-slate-400">
                  <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                  <span>Analyzed for {dateRangeText}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}