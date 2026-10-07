"use client";

import { TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Today's Line strip: Scheduled → In Progress → Waiting-for-FM segments with
// a connector line. Each segment shows its count plus stacked plate chips
// (anchor links that scroll to the job row). The urgent wash is never
// color-only: icon + danger-700 12px label carry the meaning.
const SEGMENTS = [
  { key: "Scheduled", label: "Scheduled" },
  { key: "In Progress", label: "In Progress" },
  { key: "Waiting", label: "Waiting for FM" },
];

function PlateChip({ job }) {
  const plate = job?.vehicle?.plate_number ?? job?.vehicles?.plate_number ?? `#${job?.maintenance_id}`;
  return (
    <a
      href={`#job-${job.maintenance_id}`}
      className="inline-flex min-h-[44px] items-center rounded-control border border-border bg-surface px-3 text-xs font-semibold text-foreground transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-px hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {plate}
    </a>
  );
}

export function ShiftStrip({ counts = {}, queue = [], loading = false }) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-3" aria-label="Loading today's line">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="rounded-card border-border/70">
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const scheduled = queue.filter((j) => j.status === "Scheduled");
  const inProgress = queue.filter((j) => j.status === "In Progress");
  const waiting = Number(counts.waitingApproval) || 0;
  const urgent = Number(counts.urgent) || 0;
  const overdue = Number(counts.overdue) || 0;
  const byKey = { Scheduled: scheduled, "In Progress": inProgress, Waiting: [] };

  return (
    <section aria-label="Today's line" className="space-y-3">
      {urgent > 0 && (
        <p className="flex min-h-[44px] items-center gap-2 rounded-card border border-danger/25 bg-danger-bg px-4 py-2 shadow-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <span className="text-xs font-semibold text-danger-700">
            {urgent} urgent job{urgent === 1 ? "" : "s"} on the line
            {overdue > 0 ? ` · ${overdue} overdue` : ""}
          </span>
        </p>
      )}
      <ol className="grid list-none gap-3 p-0 sm:grid-cols-3">
        {SEGMENTS.map((seg, i) => {
          const jobs = byKey[seg.key];
          const count = seg.key === "Waiting" ? waiting : jobs.length;
          return (
            <li key={seg.key} className="relative">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -left-3 top-1/2 hidden h-px w-3 -translate-y-1/2 bg-border sm:block"
                />
              )}
              <Card className="h-full rounded-card border-border/70 shadow-sm">
                <CardContent className="space-y-2 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">
                    {seg.label}
                  </p>
                  <p className="text-base font-semibold leading-none text-foreground" aria-label={`${count} ${seg.label}`}>
                    {count}
                  </p>
                  {jobs.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {jobs.map((job) => (
                        <PlateChip key={job.maintenance_id} job={job} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-foreground-muted">
                      {seg.key === "Waiting" ? "Nothing awaiting inspection" : "Nothing here"}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
