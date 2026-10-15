"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, History, Sparkles, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getNotificationHref } from "@/lib/notifications/target";
import { formatDate } from "@/lib/utils";
import { jobAgeLabel, jobProblem, jobVehicle, predictiveDueLabel, sourceLabels } from "./mechanic-actions";

function VehicleSnapshot({ job }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const imageUrl = job?.vehicle?.image_url ?? job?.vehicles?.image_url ?? null;
  const imageFailed = Boolean(imageUrl && failedUrl === imageUrl);

  if (!job) {
    return (
      <EmptyState
        size="compact"
        icon={Truck}
        title="No active job"
        description="The vehicle snapshot appears once a job is on your line."
      />
    );
  }

  const vehicle = jobVehicle(job);
  const problem = jobProblem(job);
  const workOrderHref = `/mechanic/work-orders/${job.maintenance_id}`;
  const workOrderLabel = `WO #${job.maintenance_id}`;
  const age = jobAgeLabel(job);

  return (
    <div className="space-y-4">
      <div className="relative flex h-36 items-center justify-center overflow-hidden rounded-card bg-hover sm:h-40">
        {imageUrl && !imageFailed ? (
          <img
            src={imageUrl}
            alt={`${vehicle.name || "Assigned vehicle"}${vehicle.plate ? `, ${vehicle.plate}` : ""}`}
            loading="lazy"
            className="h-full w-full object-contain p-2"
            onError={() => setFailedUrl(imageUrl)}
          />
        ) : (
          <div role="img" aria-label="Vehicle photo unavailable" className="flex flex-col items-center gap-2 text-foreground-muted">
            <Truck className="h-9 w-9" aria-hidden="true" />
            <span className="text-xs font-medium">Photo unavailable</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-semibold leading-tight text-foreground">
          {vehicle.plate ?? workOrderLabel}
        </p>
        <StatusBadge status={job.status} entity="maintenance" />
      </div>
      {vehicle.name && <p className="text-sm text-foreground-secondary">{vehicle.name}</p>}
      <p className="-mt-3 text-xs text-foreground-muted">{workOrderLabel}</p>

      {problem && (
        <div className="border-t border-border pt-3">
          <h3 className="text-xs font-semibold text-foreground">Issue / description</h3>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground-secondary">{problem}</p>
        </div>
      )}

      <dl className="space-y-2 border-t border-border pt-3 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-foreground-muted">Job type</dt>
          <dd className="font-medium text-foreground">{job.maintenance_type ?? "—"}</dd>
        </div>
        {job.mileage_at_service != null && (
          <div className="flex justify-between gap-2">
            <dt className="text-foreground-muted">Odometer</dt>
            <dd className="font-data font-semibold tabular-nums text-foreground">
              {Number(job.mileage_at_service).toLocaleString()} km
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-foreground-muted">Scheduled</dt>
          <dd className="font-medium text-foreground">{job.maintenance_date ? formatDate(job.maintenance_date) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-foreground-muted">Priority</dt>
          <dd className="font-medium text-foreground">{job.priority ?? "—"}</dd>
        </div>
        {age && (
          <div className="flex justify-between gap-2">
            <dt className="text-foreground-muted">Timing</dt>
            <dd className="font-medium text-foreground">{age}</dd>
          </div>
        )}
      </dl>

      <Link
        href={workOrderHref}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-foreground px-4 text-sm font-semibold text-surface transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        {job.status === "In Progress" ? "Continue work order" : "Open work order"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function HistoryTimeline({ history }) {
  const rows = (history ?? []).slice(0, 3);
  if (rows.length === 0) {
    return <p className="text-xs text-foreground-muted">No completed work yet.</p>;
  }
  return (
    <ol className="list-none space-y-2 p-0">
      {rows.map((row) => {
        const vehicle = jobVehicle(row);
        return (
          <li key={row.maintenance_id} className="flex items-start gap-2 border-l-2 border-border pl-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">
                {vehicle.plate ?? `WO #${row.maintenance_id}`} · {row.maintenance_type}
              </p>
              <p className="text-[11px] text-foreground-muted">
                {formatDate(row.completed_date ?? row.maintenance_date)}
              </p>
            </div>
            <StatusBadge status={row.status} entity="maintenance" />
          </li>
        );
      })}
    </ol>
  );
}

function AttentionFeed({ attention }) {
  const items = attention ?? [];
  if (items.length === 0) {
    return <p className="text-xs text-foreground-muted">Nothing needs your attention.</p>;
  }
  return (
    <ul className="list-none space-y-1 p-0">
      {items.map((n) => {
        const href = getNotificationHref(n, "mechanic") ?? "/notifications";
        return (
          <li key={n.id}>
            <a
              href={href}
              className="flex min-h-[44px] items-start gap-2 rounded-control px-2 py-2 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-foreground">
                  {!n.is_read && (
                    <span aria-label="Unread" className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-info" />
                  )}
                  {n.title}
                </span>
                {n.message && (
                  <span className="block truncate text-[11px] text-foreground-muted">{n.message}</span>
                )}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function SideRail({ job, history = [], attention = [], upcoming = [], upcomingLoading = false, upcomingError = false }) {
  return (
    <aside aria-label="Selected work order and context" className="w-full 2xl:sticky 2xl:top-20 2xl:w-[340px] 2xl:shrink-0">
      <Card className="rounded-card border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Truck className="h-4 w-4 text-foreground-secondary" aria-hidden="true" /> Vehicle snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <VehicleSnapshot job={job} />
          <section aria-labelledby="mechanic-recent-history" className="border-t border-border pt-4">
            <h3 id="mechanic-recent-history" className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
              <History className="h-4 w-4 text-foreground-secondary" aria-hidden="true" /> Recent history
            </h3>
            <HistoryTimeline history={history} />
          </section>
          <section aria-labelledby="mechanic-needs-attention" className="border-t border-border pt-4">
            <h3 id="mechanic-needs-attention" className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
              <Bell className="h-4 w-4 text-foreground-secondary" aria-hidden="true" /> Needs attention
            </h3>
            <AttentionFeed attention={attention} />
          </section>
          <section aria-labelledby="mechanic-coming-up" className="border-t border-border pt-4">
            <h3 id="mechanic-coming-up" className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-foreground-secondary" aria-hidden="true" /> Coming up
            </h3>
            {upcomingError ? (
              <p role="status" className="text-xs text-foreground-muted">Upcoming maintenance unavailable.</p>
            ) : upcomingLoading ? (
              <p role="status" className="text-xs text-foreground-muted">Loading upcoming maintenance…</p>
            ) : upcoming.length === 0 ? (
              <p className="text-xs text-foreground-muted">No upcoming maintenance.</p>
            ) : (
              <ul className="list-none space-y-2 p-0">
                {upcoming.map((u, i) => {
                  const sources = sourceLabels(u);
                  const due = predictiveDueLabel(u);
                  return (
                    <li key={u.maintenance_id ?? u.vehicle_id ?? i} className="space-y-1 text-xs text-foreground-secondary">
                      <p>
                        <span className="font-semibold text-foreground">
                          {u.vehicle?.plate_number ?? u.plate_number ?? `WO #${u.maintenance_id ?? ""}`}
                        </span>
                        {" · "}
                        {u.maintenance_type ?? u.title ?? u.vehicle_name ?? "Scheduled service"}
                        {u.maintenance_date
                          ? ` · ${formatDate(u.maintenance_date)}`
                          : due
                            ? ` · ${due}`
                            : ""}
                      </p>
                      {sources.length > 0 && (
                        <p className="flex flex-wrap gap-1">
                          {sources.map((label) => (
                            <span key={label} className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-foreground-secondary">
                              {label}
                            </span>
                          ))}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>
    </aside>
  );
}
