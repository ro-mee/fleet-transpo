"use client";

import { Wrench, TriangleAlert, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  DESKTOP_ONLY_TITLE,
  jobAgeLabel,
  jobProblem,
  jobVehicle,
  nextMechanicAction,
} from "./mechanic-actions";
import { useIsDesktop } from "./use-is-desktop";

// The ONE job: upNext from GET /api/mechanic/summary. Actions follow the
// mechanic transition map exactly — Start (Scheduled → In Progress) and
// Mark Ready (In Progress → Pending Inspection). Approve/Complete have no
// representation here: they are FM-only and must never render for mechanic.
function priorityTone(priority) {
  if (priority === "Emergency" || priority === "High") return "danger";
  if (priority === "Normal" || priority === "Medium") return "warning";
  return "secondary";
}

const SPINE = {
  danger: "bg-danger",
  warning: "bg-warning",
  secondary: "bg-border",
};

function EvidenceDots({ job }) {
  const parts = Array.isArray(job.parts_replaced) ? job.parts_replaced : null;
  const dots = [
    { key: "diagnosis", label: "Diagnosis", done: String(job.diagnosis ?? "").trim().length > 0 },
    { key: "parts", label: "Parts", done: parts != null ? parts.length > 0 : job.labor_hours != null },
    { key: "labor", label: "Labor", done: job.labor_hours != null && Number(job.labor_hours) > 0 },
  ];
  return (
    <div className="flex items-center gap-3" role="group" aria-label="Evidence completeness">
      <span className="relative flex h-1.5 flex-1 items-center gap-1.5" aria-hidden="true">
        {dots.map((d) => (
          <span
            key={d.key}
            title={`${d.label}: ${d.done ? "recorded" : "not recorded"}`}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
              d.done ? "bg-success" : "bg-border"
            )}
          />
        ))}
      </span>
      <span className="sr-only">
        {dots.map((d) => `${d.label}: ${d.done ? "recorded" : "not recorded"}`).join("; ")}
      </span>
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {dots.map((d) => (
          <span
            key={d.key}
            title={`${d.label}: ${d.done ? "recorded" : "not recorded"}`}
            className={cn(
              "h-2 w-2 rounded-full transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
              d.done ? "bg-success" : "bg-border"
            )}
          />
        ))}
      </span>
    </div>
  );
}

export function HeroJobCard({ job, desktop, onAction, busy = false }) {
  const detected = useIsDesktop();
  const isDesktop = desktop ?? detected;

  if (!job) {
    return (
      <Card className="rounded-card border-border/70 shadow-sm">
        <EmptyState
          icon={Wrench}
          title="The line is clear"
          description="No assigned work orders are waiting. New assignments will appear here."
        />
      </Card>
    );
  }

  const action = nextMechanicAction(job.status);
  const vehicle = jobVehicle(job);
  const problem = jobProblem(job);
  const age = jobAgeLabel(job);
  const tone = priorityTone(job.priority);
  const disabled = !isDesktop || busy;
  const disabledTitle = !isDesktop ? DESKTOP_ONLY_TITLE : undefined;

  return (
    <Card className="overflow-hidden rounded-card border-border/70 shadow-sm">
      <div className="flex">
        <span aria-hidden="true" className={cn("w-1 shrink-0", SPINE[tone])} />
        <CardContent className="min-w-0 flex-1 space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold leading-tight text-foreground">
              {vehicle.plate ?? `WO #${job.maintenance_id}`}
            </p>
            {vehicle.name && (
              <span className="text-sm text-foreground-secondary">{vehicle.name}</span>
            )}
            <span
              className={cn(
                "inline-flex min-h-[28px] items-center gap-1 rounded-control px-2.5 text-[11px] font-bold",
                tone === "danger" && "bg-danger-bg text-danger-700",
                tone === "warning" && "bg-warning-bg text-warning-700",
                tone === "secondary" && "bg-hover text-foreground-secondary"
              )}
            >
              {(tone === "danger" || tone === "warning") && (
                <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              )}
              {job.priority ?? "No priority"} priority
            </span>
          </div>

          <p className="text-sm text-foreground-secondary">
            {job.maintenance_type}
            {age ? ` · ${age}` : ""}
          </p>
          {problem && (
            <p className="line-clamp-2 text-sm text-foreground">{problem}</p>
          )}

          <EvidenceDots job={job} />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-secondary">
            {job.mileage_at_service != null && (
              <span className="font-data font-semibold tabular-nums">
                Odo {Number(job.mileage_at_service).toLocaleString()} km
              </span>
            )}
            <span>WO #{job.maintenance_id}</span>
          </div>

          {action && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                disabled={disabled}
                title={disabledTitle}
                onClick={() => onAction?.(action.to)}
                className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                {busy ? "Working…" : action.label}
              </Button>
              {job.status === "In Progress" && (
                <a
                  href={`/mechanic/work-orders/${job.maintenance_id}`}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-control border border-border px-4 text-sm font-semibold text-foreground transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
            </div>
          )}
        </CardContent>
      </div>
    </Card>
  );
}
