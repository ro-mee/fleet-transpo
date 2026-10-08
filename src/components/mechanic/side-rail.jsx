"use client";

import { Bell, History, Sparkles, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getNotificationHref } from "@/lib/notifications/target";
import { formatDate } from "@/lib/utils";
import { jobVehicle } from "./mechanic-actions";

// Sticky 320px side rail: vehicle snapshot (lean fields ONLY — never price,
// docs, or images), last-3 history mini-timeline, attention feed (Task 5
// titles deep-linked by reference_type/id), and the read-only predictive
// whisper strip. No CTAs in the whisper: it is information, not an action.
function VehicleSnapshot({ job }) {
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
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-semibold leading-tight text-foreground">
          {vehicle.plate ?? `WO #${job.maintenance_id}`}
        </p>
        <StatusBadge status={job.status} entity="maintenance" />
      </div>
      {vehicle.name && <p className="text-sm text-foreground-secondary">{vehicle.name}</p>}
      <dl className="space-y-1 text-xs">
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
          <dt className="text-foreground-muted">Priority</dt>
          <dd className="font-medium text-foreground">{job.priority ?? "—"}</dd>
        </div>
      </dl>
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

export function SideRail({ job, history = [], attention = [], upcoming = [] }) {
  return (
    <aside aria-label="Work context" className="w-full space-y-4 lg:sticky lg:top-20 lg:w-[320px] lg:shrink-0">
      <Card className="rounded-card border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Truck className="h-4 w-4 text-foreground-secondary" aria-hidden="true" /> Vehicle snapshot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VehicleSnapshot job={job} />
        </CardContent>
      </Card>

      <Card className="rounded-card border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-foreground-secondary" aria-hidden="true" /> Recent history
          </CardTitle>
        </CardHeader>
        <CardContent>
          <HistoryTimeline history={history} />
        </CardContent>
      </Card>

      <Card className="rounded-card border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bell className="h-4 w-4 text-foreground-secondary" aria-hidden="true" /> Needs attention
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AttentionFeed attention={attention} />
        </CardContent>
      </Card>

      <Card className="rounded-card border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-foreground-secondary" aria-hidden="true" /> Coming up
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="text-xs text-foreground-muted">No upcoming maintenance.</p>
          ) : (
            <ul className="list-none space-y-2 p-0">
              {upcoming.map((u, i) => (
                <li key={u.maintenance_id ?? i} className="text-xs text-foreground-secondary">
                  <span className="font-semibold text-foreground">
                    {u.vehicle?.plate_number ?? u.plate_number ?? `WO #${u.maintenance_id ?? ""}`}
                  </span>
                  {" · "}
                  {u.maintenance_type ?? u.title ?? "Scheduled service"}
                  {u.maintenance_date ? ` · ${formatDate(u.maintenance_date)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}
