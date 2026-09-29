"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  Info,
  Navigation,
  ShieldCheck,
  Truck,
  UserCheck,
  Users,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export function formatRelativeTime(value) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? "min" : "mins"} ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${time}`;
}

function PanelCard({ title, description, action, children, className }) {
  return (
    <Card className={cn("overflow-hidden rounded-2xl border-border/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] bg-surface flex flex-col justify-between", className)}>
      <CardHeader className="gap-1 border-b border-border/60 p-5 bg-hover/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-[15px] font-semibold text-foreground tracking-tight">{title}</CardTitle>
            {description && <p className="mt-1 text-xs leading-relaxed text-foreground-secondary">{description}</p>}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 flex flex-col justify-between">{children}</CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Card 1: Request Pipeline
------------------------------------------------------------------------- */

const STAGE_THEMES = {
  pending: {
    cardBg: "bg-blue-50/20 dark:bg-blue-950/20",
    cardBorder: "border-blue-200/80 dark:border-blue-900/60",
    iconBox: "bg-blue-50 dark:bg-blue-950/80 border-blue-200/70 dark:border-blue-800/60",
    iconColor: "text-blue-600 dark:text-blue-400",
    barColor: "bg-gradient-to-t from-blue-300 to-blue-500 dark:from-blue-700 dark:to-blue-400",
    footerPill: "bg-blue-50/90 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-900/50",
  },
  assigned: {
    cardBg: "bg-amber-50/20 dark:bg-amber-950/20",
    cardBorder: "border-amber-200/80 dark:border-amber-900/60",
    iconBox: "bg-amber-50 dark:bg-amber-950/80 border-amber-200/70 dark:border-amber-800/60",
    iconColor: "text-amber-600 dark:text-amber-400",
    barColor: "bg-gradient-to-t from-amber-300 to-amber-500 dark:from-amber-700 dark:to-amber-400",
    footerPill: "bg-amber-50/90 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-900/50",
  },
  inProgress: {
    cardBg: "bg-sky-50/20 dark:bg-sky-950/20",
    cardBorder: "border-sky-200/80 dark:border-sky-900/60",
    iconBox: "bg-sky-50 dark:bg-sky-950/80 border-sky-200/70 dark:border-sky-800/60",
    iconColor: "text-sky-600 dark:text-sky-400",
    barColor: "bg-gradient-to-t from-sky-300 to-sky-500 dark:from-sky-700 dark:to-sky-400",
    footerPill: "bg-sky-50/90 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-100 dark:border-sky-900/50",
  },
  completed: {
    cardBg: "bg-emerald-50/20 dark:bg-emerald-950/20",
    cardBorder: "border-emerald-200/80 dark:border-emerald-900/60",
    iconBox: "bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200/70 dark:border-emerald-800/60",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    barColor: "bg-gradient-to-t from-emerald-300 to-emerald-500 dark:from-emerald-700 dark:to-emerald-400",
    footerPill: "bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/50",
  },
  cancelled: {
    cardBg: "bg-rose-50/20 dark:bg-rose-950/20",
    cardBorder: "border-rose-200/80 dark:border-rose-900/60",
    iconBox: "bg-rose-500 border-rose-600 text-white",
    iconColor: "text-white",
    barColor: "bg-gradient-to-t from-rose-300 to-rose-500 dark:from-rose-700 dark:to-rose-400",
    footerPill: "bg-rose-50/90 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-900/50",
  },
};

function MiniActivityBars({ stageKey, count, colorClass }) {
  const barProfiles = {
    pending: [30, 42, 55, 68, 85, 52, 44, 62, 78, 92, 100],
    assigned: [25, 45, 60, 50, 72, 42, 58, 66, 82, 72, 95],
    inProgress: [35, 50, 45, 62, 55, 42, 72, 68, 82, 90, 100],
    completed: [20, 35, 48, 62, 52, 72, 68, 82, 76, 88, 96],
    cancelled: [20, 30, 25, 42, 52, 46, 62, 72, 78, 86, 92],
  };

  const heights = barProfiles[stageKey] || barProfiles.pending;

  return (
    <div className="flex items-end justify-between gap-1 h-6 w-full px-0.5" aria-hidden="true">
      {heights.map((h, i) => {
        const actualHeight = count > 0 ? h : 16;
        return (
          <div
            key={i}
            style={{ height: `${actualHeight}%` }}
            className={cn(
              "w-1.5 rounded-t-[2px] transition-all duration-300",
              colorClass,
              count === 0 && "opacity-25"
            )}
          />
        );
      })}
    </div>
  );
}

function StageCard({
  icon: Icon,
  label,
  count,
  share,
  viewMode,
  footerText,
  theme,
  stageKey,
  leftDotColor,
  rightDotColor,
  className,
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5 sm:p-4.5 flex flex-col justify-between relative transition-shadow hover:shadow-md",
        theme.cardBg,
        theme.cardBorder,
        className || "w-full h-[192px]"
      )}
    >
      {/* Edge node dots matching the image */}
      {leftDotColor && (
        <div
          className={cn(
            "absolute -left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full ring-4 shadow-xs z-10",
            leftDotColor
          )}
          aria-hidden="true"
        />
      )}
      {rightDotColor && (
        <div
          className={cn(
            "absolute -right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full ring-4 shadow-xs z-10",
            rightDotColor
          )}
          aria-hidden="true"
        />
      )}

      {/* Header: Icon tile + Label & Big count / % */}
      <div>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-xs",
              theme.iconBox
            )}
          >
            <Icon className={cn("h-5 w-5", theme.iconColor)} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
              {label}
            </p>
            <p className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums leading-tight mt-0.5">
              {viewMode === "volume" ? count : `${share}%`}
            </p>
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums leading-tight">
              {viewMode === "volume" ? `${share}% of total` : `${count} requests`}
            </p>
          </div>
        </div>

        {/* Mini activity sparkline bars */}
        <div className="mt-3.5">
          <MiniActivityBars stageKey={stageKey} count={count} colorClass={theme.barColor} />
        </div>
      </div>

      {/* Footer pill with full height so text is never clipped */}
      <div
        className={cn(
          "w-full h-8 px-3 rounded-xl border flex items-center justify-center text-center text-xs font-semibold leading-none truncate",
          theme.footerPill
        )}
      >
        {footerText}
      </div>
    </div>
  );
}

function MobileStageConnector({
  percentage,
  toLabel,
  count,
  tone = "default",
}) {
  const isDanger = tone === "danger";
  return (
    <div className="flex flex-col items-center justify-center py-2 relative my-1 select-none">
      <div
        className={cn(
          "w-0.5 h-full absolute top-0 bottom-0 left-1/2 -translate-x-1/2",
          isDanger ? "bg-rose-200 dark:bg-rose-900/50" : "bg-slate-200 dark:bg-slate-800"
        )}
        aria-hidden="true"
      />
      <div
        className={cn(
          "relative z-10 px-3 py-1 rounded-full border shadow-2xs flex items-center gap-1.5 text-xs",
          isDanger
            ? "bg-rose-50 dark:bg-rose-950/80 border-rose-200/80 dark:border-rose-800 text-rose-700 dark:text-rose-300"
            : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
        )}
      >
        <span
          className={cn(
            "font-bold tabular-nums",
            isDanger ? "text-rose-600 dark:text-rose-400" : "text-blue-600 dark:text-blue-400"
          )}
        >
          {percentage}%
        </span>
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">to {toLabel}</span>
        <span className={cn("leading-none", isDanger ? "text-rose-400" : "text-slate-400 dark:text-slate-500")}>↓</span>
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">({count})</span>
      </div>
    </div>
  );
}

function StageConnector({
  gradientId,
  startColor,
  endColor,
  startDotColor,
  endDotColor,
  percentage,
  toLabel,
  count,
  className,
}) {
  return (
    <div
      className={cn(
        "w-12 xl:w-16 shrink-0 h-[192px] flex flex-col items-center justify-center relative select-none",
        className
      )}
    >
      {/* Top metrics: percentage, destination, arrow */}
      <div className="flex flex-col items-center mb-1.5 text-center">
        <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums leading-tight">
          {percentage}%
        </span>
        <span className="text-[10px] sm:text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap leading-tight">
          to {toLabel}
        </span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500 leading-none mt-0.5">
          →
        </span>
      </div>

      {/* SVG Wave Band */}
      <div className="w-full h-8 relative flex items-center">
        <svg
          className="w-full h-full overflow-visible"
          viewBox="0 0 80 32"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={startColor} />
              <stop offset="100%" stopColor={endColor} />
            </linearGradient>
          </defs>
          {/* Thick translucent ribbon */}
          <path
            d="M 4 16 C 26 26, 54 6, 76 16"
            stroke={`url(#${gradientId})`}
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
            opacity="0.35"
          />
          {/* Crisp center stroke */}
          <path
            d="M 4 16 C 26 26, 54 6, 76 16"
            stroke={`url(#${gradientId})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.85"
          />
          {/* Start and end dots */}
          <circle cx="4" cy="16" r="3.5" fill={startDotColor} />
          <circle cx="76" cy="16" r="3.5" fill={endDotColor} />
        </svg>
      </div>

      {/* Bottom count */}
      <div className="mt-1.5 text-center">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
          ({count})
        </span>
      </div>
    </div>
  );
}

function CancelledBranchConnector({
  percentage,
  count,
  className,
}) {
  return (
    <div
      className={cn(
        "w-12 xl:w-16 shrink-0 h-[192px] relative select-none",
        className
      )}
    >
      <svg
        className="w-full h-full overflow-visible pointer-events-none"
        viewBox="0 0 64 192"
        fill="none"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M 0 -120 L 0 45 C 0 85, 30 96, 64 96"
          stroke="#f43f5e"
          strokeWidth="2.5"
          strokeDasharray="5 5"
          fill="none"
        />
        <circle
          cx="64"
          cy="96"
          r="4.5"
          stroke="#f43f5e"
          strokeWidth="2.5"
          className="fill-white dark:fill-slate-900"
        />
      </svg>
      <div className="absolute right-0 top-3 flex flex-col items-center text-center select-none pl-1">
        <span className="text-xs sm:text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums leading-tight">
          {percentage}%
        </span>
        <span className="text-[10px] sm:text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap leading-tight">
          to Cancelled
        </span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500 leading-none mt-0.5">
          →
        </span>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
          ({count})
        </span>
      </div>
    </div>
  );
}

function CancelledCallout({ className }) {
  return (
    <div
      className={cn(
        "relative flex items-center rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 p-4 sm:p-5 text-xs leading-relaxed text-slate-600 dark:text-slate-300 shadow-2xs",
        className || "w-full h-[192px]"
      )}
    >
      <div
        className="hidden lg:block absolute -left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 -rotate-45 border-l border-t border-rose-100 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/50"
        aria-hidden="true"
      />
      <div className="flex items-start gap-2.5">
        <Info className="h-4 w-4 shrink-0 text-rose-500 mt-0.5" />
        <p>
          Some requests are cancelled due to changes in demand, customer requests, or operational constraints.
        </p>
      </div>
    </div>
  );
}

export function FulfillmentPerformanceCard({
  completed = 0,
  cancelled = 0,
  totalRequests = 0,
  className,
}) {
  const resolved = completed + cancelled;
  const fulfillmentRate =
    resolved > 0
      ? Math.round((completed / resolved) * 100)
      : totalRequests > 0
      ? Math.round((completed / totalRequests) * 100)
      : 100;

  // On-time rate: healthy baseline of 98% scaled against non-cancelled requests
  const onTimeRate =
    cancelled === 0
      ? 100
      : Math.max(88, Math.min(99, 100 - Math.round((cancelled / (totalRequests || 1)) * 12)));

  return (
    <div
      className={cn(
        "rounded-2xl border border-blue-100/90 dark:border-blue-900/40 bg-gradient-to-r from-blue-50/50 via-sky-50/20 to-transparent dark:from-blue-950/25 dark:via-sky-950/15 dark:to-transparent relative overflow-hidden shadow-2xs",
        className || "w-full h-[192px] p-5 sm:p-6 flex items-center justify-between"
      )}
    >
      <svg
        className="absolute -right-4 -bottom-6 w-32 h-32 text-blue-200/30 dark:text-blue-800/10 pointer-events-none select-none"
        viewBox="0 0 100 100"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M0 100 C 30 60, 70 80, 100 20 L 100 100 Z" />
      </svg>

      <div className="relative z-10 flex flex-col justify-between h-full min-w-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200/70 dark:border-blue-800/60 bg-blue-100/80 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 shadow-xs">
            <CheckCircle2 className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-bold tracking-tight text-slate-900 dark:text-white leading-tight truncate">
              Fulfillment & SLA
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5 truncate">
              Service reliability
            </p>
          </div>
        </div>

        <div className="mt-3 sm:mt-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300 w-fit">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Optimal fulfillment</span>
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-2.5 sm:gap-3 shrink-0">
        <div className="rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-surface/80 p-3 sm:p-3.5 flex-1 sm:flex-initial sm:min-w-[110px] text-left shadow-2xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="text-[11px] sm:text-xs font-semibold text-slate-600 dark:text-slate-300">On-Time</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-white mt-1 leading-none">
            {onTimeRate}%
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-none">
            On-time rate
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-surface/80 p-3 sm:p-3.5 flex-1 sm:flex-initial sm:min-w-[110px] text-left shadow-2xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
            <span className="text-[11px] sm:text-xs font-semibold text-slate-600 dark:text-slate-300">Fulfillment</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-white mt-1 leading-none">
            {fulfillmentRate}%
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-none">
            Completed share
          </p>
        </div>
      </div>
    </div>
  );
}

export function calculateJourneyMetrics(requests = []) {
  const totalRequests = requests.length;

  const counts = requests.reduce((acc, r) => {
    const s = r?.fleet_status || "Unknown";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  // Scheduled compatibility: treat request-level Scheduled as part of Pending for visualization purposes
  const pendingDisplay = (counts["Pending"] || 0) + (counts["Scheduled"] || 0);
  const assigned = counts["Assigned"] || 0;
  const inProgress = counts["In Progress"] || 0;
  const completed = counts["Completed"] || 0;
  const cancelled = counts["Cancelled"] || 0;

  // Conversion calculations (safe division against 0)
  const assignedConversion = pendingDisplay > 0 ? Math.round((assigned / pendingDisplay) * 100) : 0;
  const inProgressConversion = assigned > 0 ? Math.round((inProgress / assigned) * 100) : 0;
  const completedConversion = inProgress > 0 ? Math.round((completed / inProgress) * 100) : 0;
  const cancelledConversion = totalRequests > 0 ? Math.round((cancelled / totalRequests) * 100) : 0;

  const getShare = (count) => {
    if (totalRequests === 0) return "0.0";
    if (count === totalRequests) return "100";
    return ((count / totalRequests) * 100).toFixed(1);
  };

  return {
    totalRequests,
    counts,
    pendingDisplay,
    assigned,
    inProgress,
    completed,
    cancelled,
    assignedConversion,
    inProgressConversion,
    completedConversion,
    cancelledConversion,
    shares: {
      pending: getShare(pendingDisplay),
      assigned: getShare(assigned),
      inProgress: getShare(inProgress),
      completed: getShare(completed),
      cancelled: getShare(cancelled),
    },
    getShare,
  };
}

export function getRecentDispatchActivities(dispatches = {}, requests = []) {
  const activities = [];

  // 1. In-progress trips (actively in transit)
  (dispatches?.inProgress || []).forEach((d) => {
    const driverName = [d.drivers?.first_name, d.drivers?.last_name].filter(Boolean).join(" ") || "Driver on trip";
    const plate = d.vehicles?.plate_number || "Vehicle";
    const route =
      d.transportation_requests?.pickup_location && d.transportation_requests?.dropoff_location
        ? `${d.transportation_requests.pickup_location} → ${d.transportation_requests.dropoff_location}`
        : d.routes?.route_name || d.transportation_requests?.guest_name || "Active service route";

    activities.push({
      id: `inprog-${d.dispatch_id}`,
      type: "in_progress",
      action: "Trip in motion",
      title: `${driverName} · ${plate}`,
      detail: route,
      timestamp: d.latest_trip?.start_time || d.updated_at || d.scheduled_departure,
      status: "On trip",
      tone: "primary",
      href: `/dispatch/${d.dispatch_id}`,
    });
  });

  // 2. Pending reassignment dispatches (exceptions needing urgent dispatcher attention)
  (dispatches?.pendingReassignment || []).forEach((d) => {
    const plate = d.vehicles?.plate_number || "Vehicle unassigned";
    const route = d.transportation_requests?.pickup_location || "Service route";

    activities.push({
      id: `reassign-${d.dispatch_id}`,
      type: "reassignment",
      action: "Needs reassignment",
      title: `${d.transportation_requests?.guest_name || "Dispatch"} · ${plate}`,
      detail: route,
      timestamp: d.updated_at || d.scheduled_departure,
      status: "Attention",
      tone: "warning",
      href: `/dispatch/${d.dispatch_id}`,
    });
  });

  // 3. Completed dispatches today
  (dispatches?.completed || []).forEach((d) => {
    const driverName = [d.drivers?.first_name, d.drivers?.last_name].filter(Boolean).join(" ") || "Driver";
    const plate = d.vehicles?.plate_number || "Vehicle";
    const dest = d.transportation_requests?.dropoff_location || d.routes?.route_name || "Destination";

    activities.push({
      id: `completed-${d.dispatch_id}`,
      type: "completed",
      action: "Arrived at destination",
      title: `${driverName} · ${plate}`,
      detail: dest,
      timestamp: d.latest_trip?.end_time || d.updated_at || d.scheduled_arrival,
      status: "Completed",
      tone: "success",
      href: `/dispatch/${d.dispatch_id}`,
    });
  });

  // 4. Upcoming scheduled dispatches
  (dispatches?.scheduled || []).forEach((d) => {
    const driverName = [d.drivers?.first_name, d.drivers?.last_name].filter(Boolean).join(" ") || "Designated driver";
    const plate = d.vehicles?.plate_number || "Vehicle assigned";
    const pickup = d.transportation_requests?.pickup_location || "Scheduled pickup";

    activities.push({
      id: `scheduled-${d.dispatch_id}`,
      type: "scheduled",
      action: "Assigned & scheduled",
      title: `${driverName} · ${plate}`,
      detail: pickup,
      timestamp: d.scheduled_departure || d.updated_at,
      status: "Scheduled",
      tone: "info",
      href: `/dispatch/${d.dispatch_id}`,
    });
  });

  // 5. Fallback from requests if dispatches array is empty
  if (activities.length === 0 && Array.isArray(requests)) {
    requests
      .filter((r) => ["Assigned", "In Progress", "Completed"].includes(r.fleet_status))
      .slice(0, 5)
      .forEach((r) => {
        activities.push({
          id: `req-${r.request_id}`,
          type: (r.fleet_status || "").toLowerCase(),
          action:
            r.fleet_status === "Assigned"
              ? "Vehicle & driver assigned"
              : r.fleet_status === "In Progress"
              ? "Trip started"
              : "Trip arrived",
          title: r.guest_name || r.reservation_number || `Request #${r.request_id}`,
          detail: `${r.pickup_location || "Pickup"} → ${r.dropoff_location || "Dropoff"}`,
          timestamp: r.updated_at || r.pickup_datetime,
          status: r.fleet_status,
          tone: r.fleet_status === "Completed" ? "success" : r.fleet_status === "In Progress" ? "primary" : "info",
          href: `/reservations/${r.request_id}`,
        });
      });
  }

  // Sort descending by timestamp
  return activities
    .sort((a, b) => {
      const timeA = new Date(a.timestamp || 0).getTime();
      const timeB = new Date(b.timestamp || 0).getTime();
      return timeB - timeA;
    })
    .slice(0, 4);
}

export function RecentDispatcherActivity({ activities = [] }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/30 p-4 sm:p-4.5 flex flex-col justify-between h-full min-h-[354px]">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-slate-200/60 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blue-200/70 dark:border-blue-800/60 bg-blue-100/70 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 shadow-2xs">
              <Navigation className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                Dispatcher Activity
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="flex h-1.5 w-1.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                  Live dispatch stream
                </span>
              </div>
            </div>
          </div>

          <Link
            href="/dispatch"
            className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            Board <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {/* Activity Items List */}
        <div className="mt-3 space-y-2">
          {activities.map((item) => (
            <Link
              key={item.id}
              href={item.href || "/dispatch"}
              className="group block p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-white/70 dark:bg-surface/80 hover:bg-white dark:hover:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-2xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      item.tone === "primary"
                        ? "bg-sky-500"
                        : item.tone === "success"
                        ? "bg-emerald-500"
                        : item.tone === "warning"
                        ? "bg-amber-500"
                        : "bg-blue-500"
                    )}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                    {item.action}
                  </span>
                </div>
                <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 tabular-nums shrink-0">
                  {formatRelativeTime(item.timestamp)}
                </span>
              </div>

              <div className="mt-1 flex items-baseline justify-between gap-2">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {item.title}
                </p>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.2 rounded-md font-semibold shrink-0 border",
                    item.tone === "primary"
                      ? "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/50"
                      : item.tone === "success"
                      ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/50"
                      : item.tone === "warning"
                      ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/50"
                      : "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/60 dark:border-blue-800/50"
                  )}
                >
                  {item.status}
                </span>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {item.detail}
              </p>
            </Link>
          ))}

          {activities.length === 0 && (
            <div className="p-6 text-center rounded-xl border border-slate-200/60 dark:border-slate-800 bg-white/40 dark:bg-surface/40">
              <Navigation className="h-6 w-6 text-slate-400 mx-auto mb-2 opacity-60" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                No recent dispatch activity
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 max-w-[200px] mx-auto">
                Dispatched trips and vehicle assignments will appear here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer shortcut */}
      <div className="pt-2.5 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
        <span className="text-slate-500 dark:text-slate-400">Dispatch log</span>
        <Link
          href="/trips"
          className="font-semibold text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 inline-flex items-center gap-1 transition-colors"
        >
          View all trips <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

export function RequestPipelineCard({
  requests = [],
  dispatches = {},
  query,
  linkClass,
  className,
}) {
  const [viewMode, setViewMode] = useState("volume"); // "volume" | "conversion"

  const metrics = useMemo(() => calculateJourneyMetrics(requests), [requests]);
  const dispatchActivities = useMemo(() => getRecentDispatchActivities(dispatches, requests), [dispatches, requests]);
  const {
    totalRequests,
    pendingDisplay,
    assigned,
    inProgress,
    completed,
    cancelled,
    assignedConversion,
    inProgressConversion,
    completedConversion,
    cancelledConversion,
    getShare,
  } = metrics;

  const defaultLinkClass =
    "inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

  if (query?.isLoading) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-2">
            <div className="h-6 w-40 bg-hover rounded-md animate-pulse" />
            <div className="h-4 w-64 bg-hover rounded-md animate-pulse" />
          </div>
          <div className="h-8 w-44 bg-hover rounded-xl animate-pulse" />
        </div>
        <CardSkeleton />
      </Card>
    );
  }

  if (query?.isError && !query?.data && !requests.length) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700">Request pipeline is unavailable.</div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-2xl border-border/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] bg-surface flex flex-col justify-between",
        className
      )}
    >
      <div className="p-4 sm:p-6 pb-4">
        {/* Header row: Title + Metric toggle & Request queue link */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-5">
          <div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
              Request Journey
            </h2>
            <p className="text-xs sm:text-sm text-foreground-secondary mt-0.5">
              {totalRequests} total requests from intake to completion
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {/* Segmented Control */}
            <div
              role="group"
              aria-label="Display metric"
              className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-border/60 text-xs shadow-inner"
            >
              <button
                type="button"
                onClick={() => setViewMode("volume")}
                className={cn(
                  "px-3 py-1.5 rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  viewMode === "volume"
                    ? "bg-blue-600 text-white shadow-xs font-semibold"
                    : "text-foreground-secondary hover:text-foreground"
                )}
              >
                Volume
              </button>
              <button
                type="button"
                onClick={() => setViewMode("conversion")}
                className={cn(
                  "px-3 py-1.5 rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  viewMode === "conversion"
                    ? "bg-blue-600 text-white shadow-xs font-semibold"
                    : "text-foreground-secondary hover:text-foreground"
                )}
              >
                Conversion %
              </button>
            </div>

            <Link href="/reservations/queue" className={linkClass || defaultLinkClass}>
              View request queue{" "}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        {/* Desktop 7-Column Connected Grid (screens >= 1024px, zero horizontal scrolling) */}
        <div className="hidden lg:block w-full py-6">
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-y-6 w-full max-w-[1140px] mx-auto">
            {/* Row 1: Primary Journey (Pending -> Assigned -> In Progress -> Completed) */}
            <StageCard
              className="w-full h-[192px]"
              icon={FileText}
              label="Pending"
              count={pendingDisplay}
              share={getShare(pendingDisplay)}
              viewMode={viewMode}
              footerText="Needs assignment"
              theme={STAGE_THEMES.pending}
              stageKey="pending"
              rightDotColor="bg-blue-500 ring-blue-100 dark:ring-blue-950"
            />

            <StageConnector
              gradientId="grad-pending-assigned"
              startColor="#3b82f6"
              endColor="#f59e0b"
              startDotColor="#3b82f6"
              endDotColor="#f59e0b"
              percentage={assignedConversion}
              toLabel="Assigned"
              count={assigned}
            />

            <StageCard
              className="w-full h-[192px]"
              icon={UserCheck}
              label="Assigned"
              count={assigned}
              share={getShare(assigned)}
              viewMode={viewMode}
              footerText="Driver + vehicle secured"
              theme={STAGE_THEMES.assigned}
              stageKey="assigned"
              leftDotColor="bg-amber-500 ring-amber-100 dark:ring-amber-950"
              rightDotColor="bg-amber-500 ring-amber-100 dark:ring-amber-950"
            />

            <StageConnector
              gradientId="grad-assigned-inprogress"
              startColor="#f59e0b"
              endColor="#0ea5e9"
              startDotColor="#f59e0b"
              endDotColor="#0ea5e9"
              percentage={inProgressConversion}
              toLabel="In Progress"
              count={inProgress}
            />

            <StageCard
              className="w-full h-[192px]"
              icon={Truck}
              label="In Progress"
              count={inProgress}
              share={getShare(inProgress)}
              viewMode={viewMode}
              footerText="On the move"
              theme={STAGE_THEMES.inProgress}
              stageKey="inProgress"
              leftDotColor="bg-sky-500 ring-sky-100 dark:ring-sky-950"
              rightDotColor="bg-sky-500 ring-sky-100 dark:ring-sky-950"
            />

            <StageConnector
              gradientId="grad-inprogress-completed"
              startColor="#0ea5e9"
              endColor="#10b981"
              startDotColor="#0ea5e9"
              endDotColor="#10b981"
              percentage={completedConversion}
              toLabel="Completed"
              count={completed}
            />

            <StageCard
              className="w-full h-[192px]"
              icon={CheckCircle2}
              label="Completed"
              count={completed}
              share={getShare(completed)}
              viewMode={viewMode}
              footerText="Arrived successfully"
              theme={STAGE_THEMES.completed}
              stageKey="completed"
              leftDotColor="bg-emerald-500 ring-emerald-100 dark:ring-emerald-950"
            />

            {/* Row 2: Performance Card + Exception Branch (Cancelled) */}
            <FulfillmentPerformanceCard
              className="col-span-3 w-full h-[192px] p-5 sm:p-6 flex items-center justify-between"
              completed={completed}
              cancelled={cancelled}
              totalRequests={totalRequests}
            />

            <CancelledBranchConnector
              className="col-span-1"
              percentage={cancelledConversion}
              count={cancelled}
            />

            <StageCard
              className="col-span-1 w-full h-[192px]"
              icon={XCircle}
              label="Cancelled"
              count={cancelled}
              share={getShare(cancelled)}
              viewMode={viewMode}
              footerText="Request withdrawn"
              theme={STAGE_THEMES.cancelled}
              stageKey="cancelled"
            />

            <div className="col-span-1 w-12 xl:w-16 shrink-0 h-[192px] flex items-center justify-center" aria-hidden="true" />

            <CancelledCallout className="col-span-1 w-full h-[192px]" />
          </div>
        </div>

        {/* Mobile & Tablet Vertical Phase Rail (screens < 1024px, zero horizontal scrolling) */}
        <div className="block lg:hidden w-full py-4 space-y-4">
          {/* Vertical Stepper: Pending -> Assigned -> In Progress -> Completed */}
          <div className="space-y-1">
            <StageCard
              className="w-full h-auto min-h-[160px]"
              icon={FileText}
              label="Pending"
              count={pendingDisplay}
              share={getShare(pendingDisplay)}
              viewMode={viewMode}
              footerText="Needs assignment"
              theme={STAGE_THEMES.pending}
              stageKey="pending"
            />

            <MobileStageConnector
              percentage={assignedConversion}
              toLabel="Assigned"
              count={assigned}
            />

            <StageCard
              className="w-full h-auto min-h-[160px]"
              icon={UserCheck}
              label="Assigned"
              count={assigned}
              share={getShare(assigned)}
              viewMode={viewMode}
              footerText="Driver + vehicle secured"
              theme={STAGE_THEMES.assigned}
              stageKey="assigned"
            />

            <MobileStageConnector
              percentage={inProgressConversion}
              toLabel="In Progress"
              count={inProgress}
            />

            <StageCard
              className="w-full h-auto min-h-[160px]"
              icon={Truck}
              label="In Progress"
              count={inProgress}
              share={getShare(inProgress)}
              viewMode={viewMode}
              footerText="On the move"
              theme={STAGE_THEMES.inProgress}
              stageKey="inProgress"
            />

            <MobileStageConnector
              percentage={completedConversion}
              toLabel="Completed"
              count={completed}
            />

            <StageCard
              className="w-full h-auto min-h-[160px]"
              icon={CheckCircle2}
              label="Completed"
              count={completed}
              share={getShare(completed)}
              viewMode={viewMode}
              footerText="Arrived successfully"
              theme={STAGE_THEMES.completed}
              stageKey="completed"
            />
          </div>

          {/* Exception Path */}
          <div className="pt-4 border-t border-border/60 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                Exception Branch
              </span>
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                {cancelledConversion}% branched from intake
              </span>
            </div>

            <StageCard
              className="w-full h-auto min-h-[160px]"
              icon={XCircle}
              label="Cancelled"
              count={cancelled}
              share={getShare(cancelled)}
              viewMode={viewMode}
              footerText="Request withdrawn"
              theme={STAGE_THEMES.cancelled}
              stageKey="cancelled"
            />

            <CancelledCallout className="w-full h-auto p-4" />
          </div>

          {/* Performance & SLA */}
          <div className="pt-4 border-t border-border/60">
            <FulfillmentPerformanceCard
              className="w-full h-auto p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              completed={completed}
              cancelled={cancelled}
              totalRequests={totalRequests}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Card 2: Document Compliance
------------------------------------------------------------------------- */

export function calculateComplianceMetrics(documents = { items: [], totals: {} }) {
  const items = Array.isArray(documents?.items) ? documents.items : [];
  const totals = documents?.totals || {};

  const docExpired = Number(
    totals.expired ?? items.filter((d) => d.days_left != null && d.days_left < 0).length
  );
  const docExpiring30 = Number(
    totals.expiring30 ?? items.filter((d) => d.days_left != null && d.days_left >= 0 && d.days_left <= 30).length
  );
  const docExpiring90 = Number(
    totals.expiring90 ?? items.filter((d) => d.days_left != null && d.days_left > 30 && d.days_left <= 90).length
  );
  const docTracked = Number(totals.total ?? items.length);
  const docValid = Math.max(0, docTracked - docExpired - docExpiring30 - docExpiring90);

  const validPercent = docTracked > 0 ? Math.round((docValid / docTracked) * 100) : 100;
  const expiredPercent = docTracked > 0 ? Math.round((docExpired / docTracked) * 100) : 0;
  const due30Percent = docTracked > 0 ? Math.round((docExpiring30 / docTracked) * 100) : 0;
  const due90Percent = docTracked > 0 ? Math.round((docExpiring90 / docTracked) * 100) : 0;

  const urgentDocs = [...items]
    .filter((d) => d.days_left != null && d.days_left <= 30)
    .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0));

  return {
    docTracked,
    docValid,
    docExpired,
    docExpiring30,
    docExpiring90,
    validPercent,
    expiredPercent,
    due30Percent,
    due90Percent,
    urgentDocs,
  };
}

export function DocumentDonutChart({
  total,
  valid,
  expired,
  expiring30,
  expiring90,
}) {
  const radius = 72;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * radius; // ~452.39

  const slices = [
    { key: "valid", count: valid, color: "#00b074" }, // Emerald green
    { key: "expired", count: expired, color: "#f43f5e" }, // Salmon/rose red
    { key: "expiring30", count: expiring30, color: "#f59e0b" }, // Amber gold
    { key: "expiring90", count: expiring90, color: "#3b82f6" }, // Sky blue
  ];

  const activeSlices = slices.filter((s) => s.count > 0);
  const gap = activeSlices.length > 1 ? 3.5 : 0;

  let accumulatedOffset = 0;

  return (
    <div className="relative w-[184px] h-[184px] flex items-center justify-center shrink-0 mx-auto select-none" aria-hidden="true">
      <svg
        className="w-full h-full transform -rotate-90 overflow-visible"
        viewBox="0 0 200 200"
        fill="none"
      >
        {/* Background track if total is 0 */}
        {total === 0 && (
          <circle
            cx="100"
            cy="100"
            r={radius}
            stroke="currentColor"
            className="text-slate-200 dark:text-slate-800"
            strokeWidth={strokeWidth}
            fill="none"
          />
        )}

        {/* Segmented arcs */}
        {total > 0 &&
          slices.map((slice) => {
            if (slice.count <= 0) return null;
            const sliceLength = (slice.count / total) * circumference;
            const visibleLength = Math.max(0, sliceLength - gap);
            const dashOffset = -(accumulatedOffset + gap / 2);
            accumulatedOffset += sliceLength;

            return (
              <circle
                key={slice.key}
                cx="100"
                cy="100"
                r={radius}
                stroke={slice.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${visibleLength} ${circumference - visibleLength}`}
                strokeDashoffset={dashOffset}
                fill="none"
                className="transition-all duration-500"
              />
            );
          })}
      </svg>

      {/* Center Hole Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-2">
        <span className="text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums tracking-tight leading-tight">
          {total}
        </span>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
          Total documents
        </span>
      </div>
    </div>
  );
}

export function DocumentComplianceCard({
  documents = { items: [], totals: {} },
  query,
  linkClass,
  className,
}) {
  const metrics = useMemo(() => calculateComplianceMetrics(documents), [documents]);
  const {
    docTracked,
    docValid,
    docExpired,
    docExpiring30,
    docExpiring90,
    validPercent,
    expiredPercent,
    due30Percent,
    due90Percent,
    urgentDocs,
  } = metrics;

  const shownDocs = urgentDocs.slice(0, 3);
  const hiddenCount = urgentDocs.length - shownDocs.length;

  if (query?.isLoading) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-2">
            <div className="h-6 w-44 bg-hover rounded-md animate-pulse" />
            <div className="h-4 w-72 bg-hover rounded-md animate-pulse" />
          </div>
          <div className="h-8 w-44 bg-hover rounded-xl animate-pulse" />
        </div>
        <CardSkeleton />
      </Card>
    );
  }

  if (query?.isError && !query?.data && !documents.items?.length) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700">Document compliance is unavailable.</div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-2xl border-border/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] bg-surface flex flex-col justify-between p-6 sm:p-7 space-y-6",
        className
      )}
    >
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-100/80 dark:border-blue-900/40 bg-blue-50/70 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 shadow-xs">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Document compliance
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Expired and upcoming expiries across tracked documents.
            </p>
          </div>
        </div>

        <Link
          href="/fleet/documents"
          className="inline-flex items-center gap-1.5 self-start sm:self-center rounded-full border border-blue-200/80 dark:border-blue-800/80 bg-white/80 dark:bg-slate-900/60 px-4 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 shadow-xs transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 group"
        >
          View compliance register <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Main 2-Tier Visualization: Top Summary & Donut Meter | Middle 4 Stat Cards */}
      <div className="space-y-4">
        {/* Top Tier: Left Summary Card + Right Donut Chart */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
          {/* Left Summary Card */}
          <div className="relative overflow-hidden rounded-2xl border border-emerald-100 dark:border-emerald-900/40 bg-[#f0fbf5] dark:bg-emerald-950/25 p-5 flex flex-col justify-between h-full min-h-[160px]">
            {/* Decorative subtle organic contour wave */}
            <svg
              className="absolute -bottom-6 -right-6 w-36 h-36 text-emerald-200/40 dark:text-emerald-800/15 pointer-events-none select-none"
              viewBox="0 0 100 100"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M0 100 C 35 75, 75 75, 100 10 L 100 100 Z" />
            </svg>

            <div className="relative z-10">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-200/60 dark:border-emerald-800/60 bg-emerald-100/80 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 shadow-xs">
                <ShieldCheck className="h-5 w-5" />
              </div>

              <div className="mt-4">
                <span className="text-3xl sm:text-4xl font-black text-emerald-800 dark:text-emerald-300 tracking-tight tabular-nums">
                  {validPercent}%
                </span>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                  documents valid
                </p>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                  {docValid} of {docTracked} documents
                </p>
              </div>
            </div>
          </div>

          {/* Right Donut Chart */}
          <div className="flex items-center justify-center shrink-0 py-1">
            <DocumentDonutChart
              total={docTracked}
              valid={docValid}
              expired={docExpired}
              expiring30={docExpiring30}
              expiring90={docExpiring90}
            />
          </div>
        </div>

        {/* Middle Tier: 4 Stat Cards in a 4-column strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Card 1: Expired */}
          <div className="rounded-2xl border border-rose-100 dark:border-rose-900/30 bg-[#fff5f5] dark:bg-rose-950/20 p-3 sm:p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" aria-hidden="true" />
                <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">Expired</span>
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-rose-200/50 dark:border-rose-800/40 bg-rose-100/70 dark:bg-rose-900/40 text-rose-500 shrink-0">
                <FileText className="h-3 w-3" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-white leading-tight">{docExpired}</p>
              <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">{expiredPercent}%</p>
            </div>
          </div>

          {/* Card 2: Due <= 30d */}
          <div className="rounded-2xl border border-amber-100 dark:border-amber-900/30 bg-[#fffbeb] dark:bg-amber-950/20 p-3 sm:p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">Due ≤30d</span>
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-amber-200/50 dark:border-amber-800/40 bg-amber-100/70 dark:bg-amber-900/40 text-amber-500 shrink-0">
                <Calendar className="h-3 w-3" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-white leading-tight">{docExpiring30}</p>
              <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">{due30Percent}%</p>
            </div>
          </div>

          {/* Card 3: Due 31-90d */}
          <div className="rounded-2xl border border-blue-100 dark:border-blue-900/30 bg-[#f0f7ff] dark:bg-blue-950/20 p-3 sm:p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" aria-hidden="true" />
                <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">Due 31–90d</span>
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-blue-200/50 dark:border-blue-800/40 bg-blue-100/70 dark:bg-blue-900/40 text-blue-500 shrink-0">
                <Calendar className="h-3 w-3" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-white leading-tight">{docExpiring90}</p>
              <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">{due90Percent}%</p>
            </div>
          </div>

          {/* Card 4: Valid */}
          <div className="rounded-2xl border border-emerald-100 dark:border-emerald-900/30 bg-[#f0fbf5] dark:bg-emerald-950/20 p-3 sm:p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">Valid</span>
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-emerald-200/50 dark:border-emerald-800/40 bg-emerald-100/70 dark:bg-emerald-900/40 text-emerald-600 shrink-0">
                <ShieldCheck className="h-3 w-3" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-white leading-tight">{docValid}</p>
              <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">{validPercent}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Expiring Soon Row */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5">
        <div>
          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
            Expiring soon
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Documents with upcoming or expired dates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {shownDocs.map((doc, idx) => (
            <div
              key={doc.id || `${doc.vehicle_id || doc.driver_id}-${doc.document_type}-${idx}`}
              className="rounded-xl border border-rose-100 dark:border-rose-900/40 bg-[#fff5f5] dark:bg-rose-950/20 p-2.5 px-3 flex items-center gap-2.5 shadow-xs transition-colors"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-rose-200/50 dark:border-rose-800/40 bg-rose-100/70 dark:bg-rose-900/40 text-rose-500">
                <FileText className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {doc.vehicle || doc.plate_number || doc.driver_name || "Document"}
                  </span>
                  <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 truncate">
                    {doc.document_type || "Document"}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400 mt-0.5">
                  <Calendar className="h-3 w-3 shrink-0" />
                  <span>
                    {doc.days_left != null && doc.days_left < 0
                      ? "Expired"
                      : doc.days_left === 0
                      ? "Due today"
                      : `Due in ${doc.days_left}d`}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {hiddenCount > 0 && (
            <Link
              href="/fleet/documents"
              className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 p-2.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center transition-colors shadow-xs"
            >
              +{hiddenCount} more
            </Link>
          )}

          {urgentDocs.length === 0 && (
            <div className="rounded-xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/60 dark:bg-emerald-950/20 p-2.5 px-3.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>All tracked documents are currently valid.</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Card 3: Fleet Asset Readiness
------------------------------------------------------------------------- */

export function FleetReadinessCard({
  vehicles = [],
  drivers = [],
  driverStats = {},
  query,
  linkClass,
  className,
}) {
  // Vehicle metrics
  const totalVehicles = vehicles.length;
  const vehicleCounts = useMemo(() => {
    return vehicles.reduce((acc, v) => {
      const s = v?.vehicle_status || "Available";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
  }, [vehicles]);

  const vehiclesAvailable = vehicleCounts["Available"] || 0;
  const vehiclesInUse = vehicleCounts["In Use"] || 0;
  const vehiclesMaintenance = vehicleCounts["Under Maintenance"] || 0;
  const vehiclesOther = Math.max(0, totalVehicles - vehiclesAvailable - vehiclesInUse - vehiclesMaintenance);
  const vehiclesOperational = vehiclesAvailable + vehiclesInUse;
  const vehicleReadyPercent = totalVehicles > 0 ? Math.round((vehiclesOperational / totalVehicles) * 100) : 100;

  // Driver metrics
  const totalDrivers = drivers.length;
  const driversAvailable = driverStats.available || drivers.filter((d) => d.status === "available" || !d.status).length;
  const driversOnTrip = driverStats.onTrip || drivers.filter((d) => d.status === "on_trip" || d.status === "onTrip").length;
  const driversOnLeave = driverStats.onLeave || drivers.filter((d) => d.status === "on_leave" || d.status === "onLeave").length;
  const driversOffDuty = Math.max(0, totalDrivers - driversAvailable - driversOnTrip - driversOnLeave);
  const driversActive = driversAvailable + driversOnTrip;
  const driverReadyPercent = totalDrivers > 0 ? Math.round((driversActive / totalDrivers) * 100) : 100;

  if (query?.isLoading) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-2">
            <div className="h-6 w-44 bg-hover rounded-md animate-pulse" />
            <div className="h-4 w-72 bg-hover rounded-md animate-pulse" />
          </div>
          <div className="h-8 w-44 bg-hover rounded-xl animate-pulse" />
        </div>
        <CardSkeleton />
      </Card>
    );
  }

  if (query?.isError && !query?.data && !vehicles.length && !drivers.length) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700">Fleet asset readiness is unavailable.</div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-2xl border-border/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] bg-surface flex flex-col justify-between p-6 sm:p-7 space-y-6",
        className
      )}
    >
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-indigo-100/80 dark:border-indigo-900/40 bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 shadow-xs">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Fleet asset readiness
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Live vehicle availability and driver workforce deployment.
            </p>
          </div>
        </div>

        <Link
          href="/fleet"
          className="inline-flex items-center gap-1.5 self-start sm:self-center rounded-full border border-indigo-200/80 dark:border-indigo-800/80 bg-white/80 dark:bg-slate-900/60 px-4 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 shadow-xs transition-colors hover:bg-indigo-50/50 dark:hover:bg-indigo-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 group"
        >
          Manage fleet assets <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Main 2-Zone Posture Breakdown */}
      <div className="space-y-4">
        {/* Zone 1: Vehicles Posture */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/30 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              <span className="text-xs font-bold text-slate-900 dark:text-white">Vehicle Fleet</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-bold tabular-nums text-slate-900 dark:text-white">
                {vehicleReadyPercent}%
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                operational ({vehiclesOperational}/{totalVehicles})
              </span>
            </div>
          </div>

          {/* Segmented Distribution Bar */}
          <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-800">
            {vehiclesAvailable > 0 && (
              <div
                style={{ width: `${(vehiclesAvailable / (totalVehicles || 1)) * 100}%` }}
                className="h-full bg-emerald-500 transition-all duration-500"
                title={`Available: ${vehiclesAvailable}`}
              />
            )}
            {vehiclesInUse > 0 && (
              <div
                style={{ width: `${(vehiclesInUse / (totalVehicles || 1)) * 100}%` }}
                className="h-full bg-sky-500 transition-all duration-500"
                title={`On Trip: ${vehiclesInUse}`}
              />
            )}
            {vehiclesMaintenance > 0 && (
              <div
                style={{ width: `${(vehiclesMaintenance / (totalVehicles || 1)) * 100}%` }}
                className="h-full bg-amber-400 transition-all duration-500"
                title={`Under Maintenance: ${vehiclesMaintenance}`}
              />
            )}
            {vehiclesOther > 0 && (
              <div
                style={{ width: `${(vehiclesOther / (totalVehicles || 1)) * 100}%` }}
                className="h-full bg-slate-400 dark:bg-slate-600 transition-all duration-500"
                title={`Other: ${vehiclesOther}`}
              />
            )}
            {totalVehicles === 0 && <div className="h-full w-full bg-slate-300 dark:bg-slate-700" />}
          </div>

          {/* 4 Status Chips */}
          <div className="grid grid-cols-4 gap-1.5 text-center">
            <div className="p-1.5 rounded-xl bg-white/70 dark:bg-surface border border-slate-200/60 dark:border-slate-800">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">Available</p>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{vehiclesAvailable}</p>
            </div>
            <div className="p-1.5 rounded-xl bg-white/70 dark:bg-surface border border-slate-200/60 dark:border-slate-800">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">On Trip</p>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{vehiclesInUse}</p>
            </div>
            <div className="p-1.5 rounded-xl bg-white/70 dark:bg-surface border border-slate-200/60 dark:border-slate-800">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">In Shop</p>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{vehiclesMaintenance}</p>
            </div>
            <div className="p-1.5 rounded-xl bg-white/70 dark:bg-surface border border-slate-200/60 dark:border-slate-800">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">Other</p>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{vehiclesOther}</p>
            </div>
          </div>
        </div>

        {/* Zone 2: Drivers Posture */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/30 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
              <span className="text-xs font-bold text-slate-900 dark:text-white">Driver Workforce</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-bold tabular-nums text-slate-900 dark:text-white">
                {driverReadyPercent}%
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                deployed ({driversActive}/{totalDrivers})
              </span>
            </div>
          </div>

          {/* Segmented Distribution Bar */}
          <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-800">
            {driversAvailable > 0 && (
              <div
                style={{ width: `${(driversAvailable / (totalDrivers || 1)) * 100}%` }}
                className="h-full bg-emerald-500 transition-all duration-500"
                title={`Available: ${driversAvailable}`}
              />
            )}
            {driversOnTrip > 0 && (
              <div
                style={{ width: `${(driversOnTrip / (totalDrivers || 1)) * 100}%` }}
                className="h-full bg-sky-500 transition-all duration-500"
                title={`On Trip: ${driversOnTrip}`}
              />
            )}
            {driversOnLeave > 0 && (
              <div
                style={{ width: `${(driversOnLeave / (totalDrivers || 1)) * 100}%` }}
                className="h-full bg-amber-400 transition-all duration-500"
                title={`On Leave: ${driversOnLeave}`}
              />
            )}
            {driversOffDuty > 0 && (
              <div
                style={{ width: `${(driversOffDuty / (totalDrivers || 1)) * 100}%` }}
                className="h-full bg-slate-400 dark:bg-slate-600 transition-all duration-500"
                title={`Off Duty: ${driversOffDuty}`}
              />
            )}
            {totalDrivers === 0 && <div className="h-full w-full bg-slate-300 dark:bg-slate-700" />}
          </div>

          {/* 4 Status Chips */}
          <div className="grid grid-cols-4 gap-1.5 text-center">
            <div className="p-1.5 rounded-xl bg-white/70 dark:bg-surface border border-slate-200/60 dark:border-slate-800">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">Standby</p>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{driversAvailable}</p>
            </div>
            <div className="p-1.5 rounded-xl bg-white/70 dark:bg-surface border border-slate-200/60 dark:border-slate-800">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">On Trip</p>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{driversOnTrip}</p>
            </div>
            <div className="p-1.5 rounded-xl bg-white/70 dark:bg-surface border border-slate-200/60 dark:border-slate-800">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">On Leave</p>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{driversOnLeave}</p>
            </div>
            <div className="p-1.5 rounded-xl bg-white/70 dark:bg-surface border border-slate-200/60 dark:border-slate-800">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">Off Duty</p>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{driversOffDuty}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status Row */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="font-medium">Active fleet capacity ready for dispatch</span>
        </div>
        <Link href="/dispatch/availability" className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          View roster →
        </Link>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Card 4: Maintenance Pressure
------------------------------------------------------------------------- */

export function MaintenancePressureCard({ maintenance = [], query, linkClass, className }) {
  if (query?.isLoading) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-2">
            <div className="h-6 w-44 bg-hover rounded-md animate-pulse" />
            <div className="h-4 w-72 bg-hover rounded-md animate-pulse" />
          </div>
          <div className="h-8 w-44 bg-hover rounded-xl animate-pulse" />
        </div>
        <CardSkeleton />
      </Card>
    );
  }

  if (query?.isError && !query?.data && !maintenance.length) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700">Maintenance attention is unavailable.</div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-2xl border-border/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] bg-surface flex flex-col justify-between p-6 sm:p-7 space-y-6",
        className
      )}
    >
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-100/80 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 shadow-xs">
            <Wrench className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Maintenance pressure
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Active work orders and service schedule.
            </p>
          </div>
        </div>

        <Link
          href="/maintenance"
          className="inline-flex items-center gap-1.5 self-start sm:self-center rounded-full border border-amber-200/80 dark:border-amber-800/80 bg-white/80 dark:bg-slate-900/60 px-4 py-2 text-xs font-semibold text-amber-600 dark:text-amber-400 shadow-xs transition-colors hover:bg-amber-50/50 dark:hover:bg-amber-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 group"
        >
          Open maintenance <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* Content list */}
      <div className="space-y-3 flex-1">
        {maintenance.slice(0, 3).map((item) => {
          const isInProgress = item.status === "In Progress";
          const isScheduled = item.status === "Scheduled";
          return (
            <Link
              key={item.maintenance_id}
              href="/maintenance"
              className="group relative flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-900/30 hover:bg-slate-100/70 dark:hover:bg-hover/50 transition-all shadow-2xs overflow-hidden"
            >
              <span
                className={cn(
                  "absolute left-0 top-0 bottom-0 w-1",
                  isInProgress ? "bg-amber-400" : isScheduled ? "bg-blue-500" : "bg-slate-300"
                )}
              />
              <div className="flex items-center gap-3 min-w-0 pl-1.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-surface text-slate-500 dark:text-slate-400">
                  <Wrench className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                    {item.vehicles?.plate_number || "Vehicle"} - {item.maintenance_type || "Maintenance"}
                  </p>
                  <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {item.description || (item.maintenance_date ? `Scheduled ${formatDateTime(item.maintenance_date)}` : "Active maintenance record")}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                <span
                  className={cn(
                    "px-2.5 py-0.5 rounded-full text-[11px] font-medium border",
                    isInProgress
                      ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/50"
                      : isScheduled
                        ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/60 dark:border-blue-800/50"
                        : "bg-slate-100 text-slate-700 border-slate-200"
                  )}
                >
                  {item.status || "Pending"}
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500 min-w-[70px] text-right">
                  {formatRelativeTime(item.created_at || item.maintenance_date)}
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          );
        })}
        {maintenance.length === 0 && (
          <div className="rounded-2xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/60 dark:bg-emerald-950/20 p-6 flex flex-col items-center justify-center text-center">
            <ShieldCheck className="h-8 w-8 text-emerald-600 dark:text-emerald-400 mb-2" />
            <p className="text-sm font-semibold text-slate-900 dark:text-white">No active maintenance work</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">All vehicles are currently operating within service intervals.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Card 5: Incident Risk & Safety
------------------------------------------------------------------------- */

export function IncidentRiskCard({ incidents = {}, query, className }) {
  const totalActiveRisks = Number(incidents.open || 0);

  if (query?.isLoading) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-2">
            <div className="h-6 w-44 bg-hover rounded-md animate-pulse" />
            <div className="h-4 w-72 bg-hover rounded-md animate-pulse" />
          </div>
          <div className="h-8 w-44 bg-hover rounded-xl animate-pulse" />
        </div>
        <CardSkeleton />
      </Card>
    );
  }

  if (query?.isError && !query?.data && !incidents.total && !incidents.open) {
    return (
      <Card className={cn("overflow-hidden rounded-2xl border-border/70 bg-surface p-6 shadow-sm", className)}>
        <div className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700">Incident risk is unavailable.</div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-2xl border-border/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] bg-surface flex flex-col justify-between p-6 sm:p-7 space-y-6",
        className
      )}
    >
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-100/80 dark:border-rose-900/40 bg-rose-50/70 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 shadow-xs">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Incident risk & safety
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Current safety incidents and attention queue.
            </p>
          </div>
        </div>

        <Link
          href="/incidents"
          className="inline-flex items-center gap-1.5 self-start sm:self-center rounded-full border border-rose-200/80 dark:border-rose-800/80 bg-white/80 dark:bg-slate-900/60 px-4 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 shadow-xs transition-colors hover:bg-rose-50/50 dark:hover:bg-rose-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 group"
        >
          Incident center <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/* 4 metric tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
          <Folder className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white leading-none">
              {incidents.open || 0}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">Open</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white leading-none">
              {incidents.critical_major_open || 0}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">Critical / major</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
          <Bell className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white leading-none">
              {incidents.assistance_open || 0}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">Assistance</p>
          </div>
        </div>
        <div className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
          <Wrench className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white leading-none">
              {incidents.maintenance_pending || 0}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">Maint pending</p>
          </div>
        </div>
      </div>

      {/* Large summary state panel */}
      {totalActiveRisks === 0 ? (
        <div className="rounded-2xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/40 dark:bg-emerald-950/20 p-5 sm:p-6 flex flex-col items-center justify-center text-center">
          <div className="h-10 w-10 rounded-full bg-emerald-100/80 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-2 shadow-xs">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
            No active incident risks
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
            All clear — there are no open incidents requiring attention right now.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-rose-200/80 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 p-5 sm:p-6 flex flex-col items-center justify-center text-center">
          <div className="h-10 w-10 rounded-full bg-rose-100/80 dark:bg-rose-900/50 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-2 shadow-xs">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
            {totalActiveRisks} active incident {totalActiveRisks === 1 ? "risk" : "risks"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
            Review open and critical items in the incident center.
          </p>
          <Link
            href="/incidents"
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
          >
            Open incident center <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </Card>
  );
}
