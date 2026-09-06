"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  Calendar,
  ChevronRight,
  FileText,
  Folder,
  ShieldCheck,
  Wrench,
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

export function RequestPipelineCard({ requests = [], query, linkClass }) {
  const totalRequests = requests.length;
  const completedCount = requests.filter((r) => r.fleet_status === "Completed").length;
  const completionRate = totalRequests > 0 ? Math.round((completedCount / totalRequests) * 100) : 0;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thisWeekCount = requests.filter((r) => {
    const d = new Date(r.created_at || r.pickup_time);
    return !Number.isNaN(d.getTime()) && d >= sevenDaysAgo;
  }).length;
  const prevWeekCount = requests.filter((r) => {
    const d = new Date(r.created_at || r.pickup_time);
    return !Number.isNaN(d.getTime()) && d >= fourteenDaysAgo && d < sevenDaysAgo;
  }).length;
  const delta = thisWeekCount - prevWeekCount;
  const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;

  const counts = useMemo(() => {
    return requests.reduce((acc, r) => {
      const s = r.fleet_status || "Unknown";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
  }, [requests]);

  const stages = [
    { label: "Pending", key: "Pending", bg: "bg-[#fef3c7] dark:bg-amber-950/40 text-[#92400e] dark:text-amber-200", dot: "bg-amber-400" },
    { label: "Scheduled", key: "Scheduled", bg: "bg-[#f1f5f9] dark:bg-slate-800/60 text-[#334155] dark:text-slate-200", dot: "bg-slate-300 dark:bg-slate-500" },
    { label: "Assigned", key: "Assigned", bg: "bg-[#e0f2fe] dark:bg-sky-950/40 text-[#0369a1] dark:text-sky-200", dot: "bg-sky-400" },
    { label: "In Progress", key: "In Progress", bg: "bg-blue-600 text-white dark:bg-blue-600 dark:text-white font-semibold", dot: "bg-blue-600" },
    { label: "Completed", key: "Completed", bg: "bg-[#d1fae5] dark:bg-emerald-950/40 text-[#065f46] dark:text-emerald-100", dot: "bg-emerald-500" },
    { label: "Cancelled", key: "Cancelled", bg: "bg-[#fee2e2] dark:bg-rose-950/40 text-[#991b1b] dark:text-rose-200", dot: "bg-rose-500" },
  ];

  const clipStyles = [
    { clipPath: "polygon(0% 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 0% 100%)" },
    { clipPath: "polygon(0% 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 0% 100%, 10px 50%)" },
    { clipPath: "polygon(0% 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 0% 100%, 10px 50%)" },
    { clipPath: "polygon(0% 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 0% 100%, 10px 50%)" },
    { clipPath: "polygon(0% 0%, calc(100% - 10px) 0%, 100% 50%, calc(100% - 10px) 100%, 0% 100%, 10px 50%)" },
    { clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 10px 50%)" },
  ];

  if (query?.isLoading) {
    return (
      <PanelCard title="Request pipeline" description="All requests by lifecycle status — movement through this funnel is the operation's throughput.">
        <div className="p-5"><CardSkeleton /></div>
      </PanelCard>
    );
  }

  if (query?.isError) {
    return (
      <PanelCard title="Request pipeline" description="All requests by lifecycle status — movement through this funnel is the operation's throughput.">
        <div className="m-5 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700">Request pipeline is unavailable.</div>
      </PanelCard>
    );
  }

  return (
    <PanelCard
      title="Request pipeline"
      description="All requests by lifecycle status — movement through this funnel is the operation's throughput."
      action={
        <Link href="/reservations/queue" className={linkClass}>
          View request queue <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      }
    >
      <div className="p-5 sm:p-6 flex flex-col justify-between h-full space-y-5">
        {/* Top summary metrics */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-5 sm:gap-6">
            <div>
              <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white leading-none">
                {totalRequests}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">
                Total requests
              </p>
            </div>
            <div className="h-8 w-px bg-slate-200 dark:bg-slate-800" />
            <div>
              <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-sm leading-none">
                <ArrowUp className="h-3.5 w-3.5 stroke-[2.5]" />
                <span>{deltaStr}</span>
              </div>
              <p className="text-xs text-slate-400 font-normal mt-1">vs. last week</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/30 px-3.5 py-2.5">
            <BarChart3 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <p className="text-xs sm:text-sm font-bold text-emerald-950 dark:text-emerald-200 leading-tight">
                {completionRate}% completed
              </p>
              <p className="text-[11px] text-emerald-700/90 dark:text-emerald-400/80 leading-tight mt-0.5">
                {completedCount} of {totalRequests} requests are completed
              </p>
            </div>
          </div>
        </div>

        {/* Process flow ribbon */}
        <div>
          <div className="flex w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800/60 p-0.5">
            {stages.map((stage, idx) => {
              const val = counts[stage.key] || 0;
              const pct = totalRequests > 0 ? Math.round((val / totalRequests) * 100) : 0;
              return (
                <div
                  key={stage.key}
                  style={{
                    ...clipStyles[idx],
                    marginLeft: idx === 0 ? 0 : "-8px",
                  }}
                  className={cn(
                    "flex-1 flex flex-col items-center justify-center py-2.5 sm:py-3 transition-colors relative",
                    idx === 0 ? "pl-2 pr-3.5" : idx === 5 ? "pl-3.5 pr-2" : "px-3",
                    stage.bg
                  )}
                >
                  <span className="text-sm sm:text-base font-bold tabular-nums leading-tight">{val}</span>
                  <span className={cn("text-[10px] sm:text-[11px] font-medium tabular-nums leading-tight mt-0.5", stage.key === "In Progress" ? "text-blue-100" : "opacity-75")}>{pct}%</span>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-1 px-1">
            {stages.map((stage) => (
              <div key={stage.key} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <span className={cn("h-2 w-2 rounded-full shrink-0", stage.dot)} />
                <span className="font-medium">{stage.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PanelCard>
  );
}

/* -------------------------------------------------------------------------
   Card 2: Document Compliance
------------------------------------------------------------------------- */

export function DocumentComplianceCard({ documents = { items: [], totals: {} }, query, linkClass }) {
  const docExpired = Number(documents.totals?.expired || 0);
  const docExpiring30 = Number(documents.totals?.expiring30 || 0);
  const docExpiring90 = Number(documents.totals?.expiring90 || 0);
  const docTracked = (documents.items || []).length;
  const docValid = Math.max(0, docTracked - docExpired - docExpiring30 - docExpiring90);

  const validPercent = docTracked > 0 ? Math.round((docValid / docTracked) * 100) : 100;
  const expiredPercent = docTracked > 0 ? Math.round((docExpired / docTracked) * 100) : 0;
  const due30Percent = docTracked > 0 ? Math.round((docExpiring30 / docTracked) * 100) : 0;
  const due90Percent = docTracked > 0 ? Math.round((docExpiring90 / docTracked) * 100) : 0;

  const urgentDocs = useMemo(() => {
    return (documents.items || [])
      .filter((d) => d.days_left != null && d.days_left <= 30)
      .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0));
  }, [documents.items]);

  const shownDocs = urgentDocs.slice(0, 3);
  const hiddenCount = urgentDocs.length - shownDocs.length;

  if (query?.isLoading) {
    return (
      <PanelCard title="Document compliance" description="Expired and upcoming expiries across tracked documents.">
        <div className="p-5"><CardSkeleton /></div>
      </PanelCard>
    );
  }

  if (query?.isError) {
    return (
      <PanelCard title="Document compliance" description="Expired and upcoming expiries across tracked documents.">
        <div className="m-5 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700">Document compliance is unavailable.</div>
      </PanelCard>
    );
  }

  return (
    <PanelCard
      title="Document compliance"
      description="Expired and upcoming expiries across tracked documents."
      action={
        <Link href="/fleet/documents" className={linkClass}>
          View compliance register <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      }
    >
      <div className="p-5 sm:p-6 flex flex-col justify-between h-full space-y-4">
        {/* Main compliance visualization row */}
        <div className="flex flex-col sm:flex-row items-stretch gap-4 sm:gap-5">
          {/* Left stat box */}
          <div className="rounded-2xl border border-sky-100 dark:border-sky-900/40 bg-sky-50/60 dark:bg-sky-950/30 p-4 flex flex-col justify-center shrink-0 min-w-[140px] sm:min-w-[150px]">
            <FileText className="h-5 w-5 text-sky-600 dark:text-sky-400 mb-1" />
            <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white leading-tight">
              {validPercent}%
            </span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">
              documents valid
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {docValid} of {docTracked} documents
            </span>
          </div>

          {/* Right horizontal stacked bar and columns */}
          <div className="flex-1 flex flex-col justify-between py-0.5 min-w-0">
            <div className="flex justify-end items-baseline gap-1.5 mb-1">
              <span className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{docTracked}</span>
              <span className="text-xs text-slate-400 font-medium">Total documents</span>
            </div>

            {/* Stacked bar */}
            <div className="h-3.5 sm:h-4 w-full rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800 my-2">
              {docExpired > 0 && <div style={{ width: `${(docExpired / docTracked) * 100}%` }} className="h-full bg-rose-500 transition-all duration-500" title={`Expired: ${docExpired}`} />}
              {docExpiring30 > 0 && <div style={{ width: `${(docExpiring30 / docTracked) * 100}%` }} className="h-full bg-amber-400 transition-all duration-500" title={`Due ≤30d: ${docExpiring30}`} />}
              {docExpiring90 > 0 && <div style={{ width: `${(docExpiring90 / docTracked) * 100}%` }} className="h-full bg-blue-500 transition-all duration-500" title={`Due 31–90d: ${docExpiring90}`} />}
              {docValid > 0 && <div style={{ width: `${(docValid / docTracked) * 100}%` }} className="h-full bg-emerald-500 transition-all duration-500" title={`Valid: ${docValid}`} />}
              {docTracked === 0 && <div className="h-full w-full bg-slate-200 dark:bg-slate-700" />}
            </div>

            {/* 4 Status columns */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                  <span className="truncate">Expired</span>
                </div>
                <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">{docExpired}</p>
                <p className="text-xs text-slate-400 tabular-nums">{expiredPercent}%</p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="truncate">Due ≤30d</span>
                </div>
                <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">{docExpiring30}</p>
                <p className="text-xs text-slate-400 tabular-nums">{due30Percent}%</p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                  <span className="truncate">Due 31–90d</span>
                </div>
                <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">{docExpiring90}</p>
                <p className="text-xs text-slate-400 tabular-nums">{due90Percent}%</p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="truncate">Valid</span>
                </div>
                <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">{docValid}</p>
                <p className="text-xs text-slate-400 tabular-nums">{validPercent}%</p>
              </div>
            </div>
          </div>
        </div>

        {/* Expiring soon row */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2.5">Expiring soon</p>
          <div className="flex flex-wrap gap-2.5 items-center">
            {shownDocs.map((doc, idx) => (
              <div
                key={doc.id || idx}
                className="rounded-xl border border-rose-200/80 dark:border-rose-900/40 bg-rose-50/70 dark:bg-rose-950/30 px-3 py-1.5 text-xs transition-colors"
              >
                <div className="font-semibold text-rose-950 dark:text-rose-200 flex items-center gap-1.5 truncate">
                  <span>{doc.plate_number || doc.driver_name || doc.vehicle || "Document"}</span>
                  <span className="font-normal text-rose-800/80 dark:text-rose-300/80 text-[11px]">{doc.document_type || "document"}</span>
                </div>
                <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1 mt-0.5">
                  <Calendar className="h-3 w-3 shrink-0" />
                  <span>{doc.days_left != null && doc.days_left < 0 ? "Expired" : `Due in ${doc.days_left}d`}</span>
                </div>
              </div>
            ))}
            {hiddenCount > 0 && (
              <Link
                href="/fleet/documents"
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                +{hiddenCount} more
              </Link>
            )}
            {urgentDocs.length === 0 && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">All tracked documents are currently valid.</p>
            )}
          </div>
        </div>
      </div>
    </PanelCard>
  );
}

/* -------------------------------------------------------------------------
   Card 3: Maintenance and Incident Pressure
------------------------------------------------------------------------- */

export function MaintenancePressureCard({ maintenance = [], query, linkClass }) {
  if (query?.isLoading) {
    return (
      <PanelCard title="Maintenance and incident pressure" description="The newest active maintenance records alongside incident severity totals.">
        <div className="p-5"><CardSkeleton /></div>
      </PanelCard>
    );
  }

  if (query?.isError) {
    return (
      <PanelCard title="Maintenance and incident pressure" description="The newest active maintenance records alongside incident severity totals.">
        <div className="m-5 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700">Maintenance attention is unavailable.</div>
      </PanelCard>
    );
  }

  return (
    <PanelCard
      title="Maintenance and incident pressure"
      description="The newest active maintenance records alongside incident severity totals."
      action={
        <Link href="/maintenance" className={linkClass}>
          Open maintenance <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      }
    >
      <div className="p-5 sm:p-6 space-y-2.5 flex-1">
        {maintenance.slice(0, 3).map((item) => {
          const isInProgress = item.status === "In Progress";
          const isScheduled = item.status === "Scheduled";
          return (
            <Link
              key={item.maintenance_id}
              href="/maintenance"
              className="group relative flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-surface hover:bg-slate-50/80 dark:hover:bg-hover/50 transition-all shadow-2xs overflow-hidden"
            >
              <span
                className={cn(
                  "absolute left-0 top-0 bottom-0 w-1",
                  isInProgress ? "bg-amber-400" : isScheduled ? "bg-blue-500" : "bg-slate-300"
                )}
              />
              <div className="flex items-center gap-3 min-w-0 pl-1.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200/60 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400">
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
          <EmptyState icon={Wrench} title="No active maintenance work" description="New work orders will appear here once maintenance is scheduled." variant="waiting" size="compact" />
        )}
      </div>
    </PanelCard>
  );
}

/* -------------------------------------------------------------------------
   Card 4: Incident Risk
------------------------------------------------------------------------- */

export function IncidentRiskCard({ incidents = {}, query }) {
  const totalActiveRisks = Number(incidents.open || 0);

  if (query?.isLoading) {
    return (
      <PanelCard title="Incident risk" description="Counts from the current incident attention summary.">
        <div className="p-5"><CardSkeleton /></div>
      </PanelCard>
    );
  }

  if (query?.isError) {
    return (
      <PanelCard title="Incident risk" description="Counts from the current incident attention summary.">
        <div className="m-5 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-700">Incident risk is unavailable.</div>
      </PanelCard>
    );
  }

  return (
    <PanelCard title="Incident risk" description="Counts from the current incident attention summary.">
      <div className="p-5 sm:p-6 flex flex-col justify-between h-full space-y-4">
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
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">Critical / major open</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
            <Bell className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white leading-none">
                {incidents.assistance_open || 0}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">Assistance open</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
            <Wrench className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white leading-none">
                {incidents.maintenance_pending || 0}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-tight">Maintenance pending</p>
            </div>
          </div>
        </div>

        {/* Large summary state panel */}
        {totalActiveRisks === 0 ? (
          <div className="rounded-2xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/30 dark:bg-emerald-950/20 p-6 sm:p-7 flex flex-col items-center justify-center text-center">
            <div className="h-10 w-10 rounded-full bg-emerald-100/70 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-2">
              <ShieldCheck className="h-6 w-6" strokeWidth={2} />
            </div>
            <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
              No active incident risks
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              All clear — there are no open incidents requiring attention right now.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-rose-200/80 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 p-6 sm:p-7 flex flex-col items-center justify-center text-center">
            <div className="h-10 w-10 rounded-full bg-rose-100/80 dark:bg-rose-900/40 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-2">
              <AlertTriangle className="h-6 w-6" strokeWidth={2} />
            </div>
            <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
              {totalActiveRisks} active incident {totalActiveRisks === 1 ? "risk" : "risks"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              Review open and critical items in the incident center.
            </p>
            <Link
              href="/incidents"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
            >
              Open incident center <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </PanelCard>
  );
}
