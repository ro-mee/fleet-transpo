"use client";

import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";

// Read-only vehicle history for the mechanic work-order detail page. No edit
// controls, no cost inputs, no cost display — the payload carries no cost
// keys at all (see GET /api/mechanic/vehicle-history). Sections render only
// when they have rows; an empty section states that honestly rather than
// vanishing, so "no previous maintenance" reads as a fact, not a load gap.
function SectionTitle({ children }) {
  return <h4 className="text-xs font-bold uppercase tracking-wide text-foreground-muted">{children}</h4>;
}

function Row({ children }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-control border border-border/60 px-3 py-2 text-sm">
      {children}
    </li>
  );
}

function HistoryRowSkeleton({ detail = false }) {
  return (
    <li aria-hidden="true" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-control border border-border/60 px-3 py-2">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-20" />
      {detail && <Skeleton className="h-3 w-3/4" />}
    </li>
  );
}

export function VehicleHistory({ history, isLoading = false, loadError = null }) {
  if (isLoading) {
    return (
      <Card className="rounded-card border-border/70 shadow-sm" aria-label="Vehicle history" aria-busy="true">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-foreground-secondary" aria-hidden="true" />
            Vehicle history
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p role="status" className="sr-only">Loading history…</p>
          <div className="space-y-2">
            <SectionTitle>Last PMS</SectionTitle>
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="space-y-2">
            <SectionTitle>Previous maintenance</SectionTitle>
            <ul className="list-none space-y-2 p-0">
              <HistoryRowSkeleton />
            </ul>
          </div>
          <div className="space-y-2">
            <SectionTitle>Recent incidents</SectionTitle>
            <ul className="list-none space-y-2 p-0">
              <HistoryRowSkeleton />
            </ul>
          </div>
          <div className="space-y-2">
            <SectionTitle>Recent inspections</SectionTitle>
            <ul className="list-none space-y-2 p-0">
              <HistoryRowSkeleton detail />
              <HistoryRowSkeleton detail />
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Fail-closed UI: a refused or failed history fetch never blocks the job
  // itself — the evidence form below stays fully usable.
  if (loadError || !history) {
    return (
      <Card className="rounded-card border-border/70 shadow-sm" aria-label="Vehicle history">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-foreground-secondary" aria-hidden="true" />
            Vehicle history
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground-muted">Vehicle history unavailable.</p>
        </CardContent>
      </Card>
    );
  }

  const maintenance = Array.isArray(history.maintenance) ? history.maintenance : [];
  const incidents = Array.isArray(history.incidents) ? history.incidents : [];
  const inspections = Array.isArray(history.inspections) ? history.inspections : [];
  const lastPms = history.lastPms ?? null;

  return (
    <Card className="rounded-card border-border/70 shadow-sm" aria-label="Vehicle history">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4 text-foreground-secondary" aria-hidden="true" />
          Vehicle history
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <SectionTitle>Last PMS</SectionTitle>
          {lastPms ? (
            <p className="text-sm text-foreground">
              {formatDate(lastPms.completed_date ?? lastPms.maintenance_date)}
              {lastPms.source === "vehicle.last_service_date" && (
                <span className="text-foreground-muted"> (vehicle record)</span>
              )}
            </p>
          ) : (
            <p className="text-sm text-foreground-muted">No completed routine service on record.</p>
          )}
        </div>

        <div className="space-y-2">
          <SectionTitle>Previous maintenance</SectionTitle>
          {maintenance.length ? (
            <ul className="list-none space-y-2 p-0">
              {maintenance.map((m) => (
                <Row key={m.maintenance_id}>
                  <span className="font-medium text-foreground">
                    {m.maintenance_type ?? "Maintenance"} · {m.maintenance_date ? formatDate(m.maintenance_date) : "—"}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-foreground-muted">{m.priority ?? ""}</span>
                    <StatusBadge status={m.status} entity="maintenance" />
                  </span>
                  {m.diagnosis && (
                    <span className="w-full whitespace-pre-wrap break-words text-xs text-foreground-secondary">
                      {m.diagnosis}
                    </span>
                  )}
                </Row>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-muted">No previous maintenance on record.</p>
          )}
        </div>

        <div className="space-y-2">
          <SectionTitle>Recent incidents</SectionTitle>
          {incidents.length ? (
            <ul className="list-none space-y-2 p-0">
              {incidents.map((i) => (
                <Row key={i.incident_id}>
                  <span className="font-medium text-foreground">
                    {i.incident_type ?? "Incident"} · {i.incident_date ? formatDate(i.incident_date) : "—"}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-foreground-muted">
                    <span>{i.severity ?? ""}</span>
                    <span>{i.status ?? ""}</span>
                  </span>
                </Row>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-muted">No incidents on record.</p>
          )}
        </div>

        <div className="space-y-2">
          <SectionTitle>Recent inspections</SectionTitle>
          {inspections.length ? (
            <ul className="list-none space-y-2 p-0">
              {inspections.map((i) => (
                <Row key={i.inspection_id}>
                  <span className="font-medium text-foreground">
                    {i.inspection_type ?? "Inspection"} · {i.inspection_date ? formatDate(i.inspection_date) : "—"}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-foreground-muted">
                    <span>{i.severity ?? ""}</span>
                    <span>{i.status ?? ""}</span>
                  </span>
                  {i.findings_excerpt && (
                    <span className="w-full whitespace-pre-wrap break-words text-xs text-foreground-secondary">
                      {i.findings_excerpt}
                    </span>
                  )}
                </Row>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-muted">No inspections on record.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
