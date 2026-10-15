"use client";

import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn, formatDate } from "@/lib/utils";
import { jobAgeLabel, jobVehicle, sourceLabels } from "./mechanic-actions";

function PriorityLabel({ priority }) {
  const tone = priority === "Emergency" || priority === "High"
    ? "bg-danger-bg text-danger-700"
    : priority === "Normal" || priority === "Medium"
      ? "bg-warning-bg text-warning-700"
      : "bg-hover text-foreground-secondary";

  return (
    <span className={cn("inline-flex min-h-7 items-center rounded-control px-2.5 text-[11px] font-semibold", tone)}>
      {priority ?? "No priority"}
    </span>
  );
}

function ContextAction({ job, onAction, busy }) {
  if (job.status === "Scheduled") {
    return (
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => onAction?.(job, "In Progress")}
        className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <Play className="h-4 w-4" aria-hidden="true" /> Start
      </Button>
    );
  }

  const label = job.status === "In Progress" ? "Continue" : job.status === "Pending Inspection" ? "Open" : "View";
  return (
    <Link
      href={`/mechanic/work-orders/${job.maintenance_id}`}
      className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-control border border-border bg-surface px-3 text-sm font-semibold text-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
    >
      {label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

function JobIdentity({ job, vehicle, selected, onSelect }) {
  const orderLabel = `WO #${job.maintenance_id}`;
  const detailHref = `/mechanic/work-orders/${job.maintenance_id}`;
  const content = (
    <>
      <span className="block truncate text-sm font-semibold text-foreground">
        {vehicle.plate ?? orderLabel}
      </span>
      {vehicle.name && <span className="block truncate text-xs text-foreground-secondary">{vehicle.name}</span>}
      <span className="block text-[11px] text-foreground-muted">{orderLabel}</span>
    </>
  );

  if (!onSelect) {
    return (
      <Link
        href={detailHref}
        className="block min-h-[44px] min-w-0 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={`${vehicle.plate ?? orderLabel} — ${job.maintenance_type}, ${job.status}`}
      >
        {content}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Select ${orderLabel} for the vehicle snapshot`}
        onClick={() => onSelect(job)}
        className="hidden min-h-[44px] min-w-0 flex-col items-start justify-center rounded-control text-left sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {content}
      </button>
      <Link
        href={detailHref}
        aria-label={`Open ${orderLabel} — ${vehicle.plate ?? "vehicle"}, ${job.maintenance_type}`}
        className="block min-h-[44px] min-w-0 rounded-control sm:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {content}
      </Link>
    </>
  );
}

export function JobRow({ job, selectedId, onSelect, onAction, busy }) {
  const vehicle = jobVehicle(job);
  const age = jobAgeLabel(job);
  const sources = sourceLabels(job);
  const selected = String(selectedId) === String(job.maintenance_id);

  return (
    <li
      role="row"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-border/60 px-3 py-3 last:border-0 sm:grid-cols-[minmax(72px,0.68fr)_minmax(104px,1.2fr)_minmax(88px,0.9fr)_minmax(100px,1fr)_auto] sm:items-center sm:gap-x-3 sm:px-3 2xl:grid-cols-[minmax(86px,0.78fr)_minmax(135px,1.45fr)_minmax(100px,1.05fr)_minmax(118px,1.05fr)_minmax(100px,1fr)_auto] 2xl:gap-x-4 2xl:px-4",
        selected && onSelect && "bg-info-bg/50"
      )}
    >
      <span role="cell" className="col-span-2 flex items-center gap-2 sm:col-span-1">
        <PriorityLabel priority={job.priority} />
        {job.priority === "High" || job.priority === "Emergency" ? (
          <span className="text-[11px] font-medium text-danger-700">Urgent</span>
        ) : null}
      </span>

      <div role="cell" className="col-span-2 min-w-0 sm:col-span-1">
        <JobIdentity job={job} vehicle={vehicle} selected={selected} onSelect={onSelect} />
        {sources.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {sources.map((label) => (
              <span key={label} className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground-secondary">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      <span role="cell" className="col-span-2 min-w-0 text-sm text-foreground sm:col-span-1">
        <span className="block truncate">{job.maintenance_type ?? "Maintenance"}</span>
        <span className="hidden truncate text-xs text-foreground-secondary sm:block 2xl:hidden">
          {age ?? (job.maintenance_date ? `Due ${formatDate(job.maintenance_date)}` : "—")}
        </span>
      </span>

      <span role="cell" className="col-span-1 flex min-w-0 items-center sm:col-span-1">
        <StatusBadge status={job.status} entity="maintenance" />
      </span>

      <span role="cell" className="col-span-1 min-w-0 self-center text-xs tabular-nums text-foreground-secondary sm:hidden 2xl:block">
        {age ?? (job.maintenance_date ? `Due ${formatDate(job.maintenance_date)}` : "—")}
      </span>

      <span role="cell" className="col-span-2 flex justify-end sm:col-span-1">
        <ContextAction job={job} onAction={onAction} busy={busy} />
      </span>
    </li>
  );
}

export function JobQueue({
  jobs = [],
  compact = false,
  title = "Up next in the queue",
  selectedId,
  onSelect,
  onAction,
  busy = false,
  loading = false,
}) {
  const visible = compact ? jobs.slice(0, 4) : jobs;

  return (
    <Card className="overflow-hidden rounded-card border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <CardTitle className="text-sm">{title}</CardTitle>
        {compact && jobs.length > 4 && (
          <Link
            href="/mechanic/work-orders"
            className="inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 w-full rounded-control" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4">
            <EmptyState size="compact" title="No jobs in this view" description="Jobs assigned to you will appear here." />
          </div>
        ) : (
          <div role="table" aria-label={title}>
            <div role="rowgroup" className="hidden bg-hover px-3 sm:block 2xl:px-4">
              <div role="row" className="grid grid-cols-[minmax(72px,0.68fr)_minmax(104px,1.2fr)_minmax(88px,0.9fr)_minmax(100px,1fr)_auto] gap-x-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-foreground-muted 2xl:grid-cols-[minmax(86px,0.78fr)_minmax(135px,1.45fr)_minmax(100px,1.05fr)_minmax(118px,1.05fr)_minmax(100px,1fr)_auto] 2xl:gap-x-4">
                <span role="columnheader">Priority</span>
                <span role="columnheader">Work order</span>
                <span role="columnheader">Job type</span>
                <span role="columnheader">Status</span>
                <span role="columnheader" className="hidden 2xl:block">Timing</span>
                <span role="columnheader">Actions</span>
              </div>
            </div>
            <ul role="rowgroup" className="m-0 list-none p-0">
              {visible.map((job) => (
                <JobRow
                  key={job.maintenance_id}
                  job={job}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onAction={onAction}
                  busy={busy}
                />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
