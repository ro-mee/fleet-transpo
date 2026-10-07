"use client";

import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  DESKTOP_ONLY_TITLE,
  jobAgeLabel,
  jobProblem,
  jobVehicle,
} from "./mechanic-actions";
import { useIsDesktop } from "./use-is-desktop";

// Queue rows: status notch, plate + type + age, one context action.
// The row body is a real link (keyboard-navigable, focus ring); the action
// sits beside it so interactive elements never nest.
const NOTCH = {
  Scheduled: "border-l-info",
  "In Progress": "border-l-warning",
  "Pending Inspection": "border-l-success",
  Completed: "border-l-success",
  Cancelled: "border-l-border",
};

function ContextAction({ job, desktop, onAction, busy }) {
  const isDesktop = desktop;
  if (job.status === "Scheduled") {
    return (
      <Button
        type="button"
        size="sm"
        disabled={!isDesktop || busy}
        title={!isDesktop ? DESKTOP_ONLY_TITLE : undefined}
        onClick={() => onAction?.(job, "In Progress")}
        className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <Play className="h-4 w-4" aria-hidden="true" /> Start
      </Button>
    );
  }
  if (job.status === "In Progress") {
    return (
      <a
        href={`/mechanic/work-orders/${job.maintenance_id}`}
        className="inline-flex min-h-[44px] items-center gap-1 rounded-control border border-border px-4 text-sm font-semibold text-foreground transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    );
  }
  return (
    <a
      href={`/mechanic/work-orders/${job.maintenance_id}`}
      className="inline-flex min-h-[44px] items-center gap-1 rounded-control border border-border px-4 text-sm font-semibold text-foreground transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      View <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}

export function JobRow({ job, desktop, onAction, busy }) {
  const vehicle = jobVehicle(job);
  const problem = jobProblem(job);
  const age = jobAgeLabel(job);
  return (
    <li
      id={`job-${job.maintenance_id}`}
      className={cn(
        "flex scroll-mt-20 flex-col gap-3 rounded-control border border-border/70 bg-surface p-3 sm:flex-row sm:items-center sm:justify-between",
        "border-l-4",
        NOTCH[job.status] ?? "border-l-border"
      )}
    >
      <a
        href={`/mechanic/work-orders/${job.maintenance_id}`}
        className="min-w-0 flex-1 space-y-1 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={`${vehicle.plate ?? `WO #${job.maintenance_id}`} — ${job.maintenance_type}, ${job.status}`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {vehicle.plate ?? `WO #${job.maintenance_id}`}
          </span>
          {vehicle.name && (
            <span className="text-xs text-foreground-secondary">{vehicle.name}</span>
          )}
          <StatusBadge status={job.status} entity="maintenance" />
        </span>
        <span className="block truncate text-xs text-foreground-secondary">
          {job.maintenance_type}
          {age ? ` · ${age}` : ""}
          {problem ? ` · ${problem}` : ""}
        </span>
      </a>
      <span className="shrink-0">
        <ContextAction job={job} desktop={desktop} onAction={onAction} busy={busy} />
      </span>
    </li>
  );
}

export function JobQueue({
  jobs = [],
  compact = false,
  desktop,
  onAction,
  busy = false,
  loading = false,
  title = "Up next in the queue",
}) {
  const detected = useIsDesktop();
  const isDesktop = desktop ?? detected;
  const visible = compact ? jobs.slice(0, 4) : jobs;

  if (loading) {
    return (
      <Card className="rounded-card border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-control" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-card border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
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
      <CardContent>
        {visible.length === 0 ? (
          <EmptyState
            size="compact"
            title="No jobs in this view"
            description="Jobs assigned to you will appear here."
          />
        ) : (
          <ul className="list-none space-y-2 p-0">
            {visible.map((job) => (
              <JobRow key={job.maintenance_id} job={job} desktop={isDesktop} onAction={onAction} busy={busy} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
