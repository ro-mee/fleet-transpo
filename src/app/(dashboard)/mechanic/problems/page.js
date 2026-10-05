"use client";

import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { getVehicleProblems } from "@/services/vehicle.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";

// Problem Queue (mechanic view) — READ-ONLY. Raising a work order from a
// problem (maintenance:create) is FM-only, so this page renders no raise
// button by design. Tracked problems carry a WO chip into the work order.
function ProblemCard({ item }) {
  return (
    <Card className="rounded-card border-border/70 shadow-sm">
      <CardContent className="space-y-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">
            {item.plateNumber || `Vehicle #${item.vehicleId}`}
          </p>
          {item.vehicleName && (
            <span className="text-xs text-foreground-secondary">{item.vehicleName}</span>
          )}
          <Badge variant="secondary" className="rounded-control px-2.5 py-0.5 text-[11px] font-bold">
            {item.inspectionType}
          </Badge>
          <span className="text-xs font-medium text-foreground-secondary">
            {formatDate(item.inspectionDate)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-foreground-secondary">
            Severity:
          </span>
          <Badge variant="outline" className="rounded-control px-2.5 py-0.5 font-bold">
            {item.severityLabel}
          </Badge>
          {item.driverName && (
            <span className="text-foreground-secondary">Reported by {item.driverName}</span>
          )}
        </div>
        {item.report?.kind === "free_text" ? (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">
            {item.report.text || "No description was recorded with this report."}
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {(item.report?.items ?? []).map((entry, i) => (
              <li key={`${entry.label}-${i}`}>
                <span className="font-semibold">{entry.label}</span>
                {entry.remarks ? <span className="text-foreground-secondary"> — {entry.remarks}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {item.workOrderId && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a
              href={`/mechanic/work-orders/${item.workOrderId}`}
              className="inline-flex min-h-[44px] items-center rounded-control bg-info-bg px-3 text-xs font-bold text-info-700 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              WO #{item.workOrderId}
            </a>
            {item.workOrderStatus && (
              <StatusBadge status={item.workOrderStatus} entity="maintenance" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MechanicProblemsPage() {
  useRequireRole();
  const problemsQuery = useQuery({
    queryKey: ["mechanicProblems"],
    queryFn: () => getVehicleProblems(),
    staleTime: 60 * 1000,
  });

  const items = problemsQuery.data?.items ?? [];
  const counts = problemsQuery.data?.counts ?? { tracked: 0, reportedUntracked: 0, failedUntracked: 0 };

  return (
    <PageEntrance>
      <div className="space-y-4">
        <HeroHeader
          icon={TriangleAlert}
          title="Problem Queue"
          description={
            problemsQuery.isLoading
              ? "Loading reported problems…"
              : `${items.length} problem${items.length === 1 ? "" : "s"} linked to your work orders`
          }
        />

        <QueryErrorBanner query={problemsQuery} title="Could not load problems" />

        {problemsQuery.isLoading ? (
          <TableSkeleton rows={4} cols={2} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={TriangleAlert}
            title="No problems linked to your work"
            description="Vehicle problems tied to your assigned work orders will appear here for context."
          />
        ) : (
          <div className="space-y-3">
            {counts.tracked > 0 && (
              <p className="text-xs text-foreground-secondary" aria-live="polite">
                {counts.tracked} tracked to a work order
                {counts.reportedUntracked + counts.failedUntracked > 0
                  ? ` · ${counts.reportedUntracked + counts.failedUntracked} awaiting triage`
                  : ""}
              </p>
            )}
            {items.map((item) => (
              <ProblemCard key={item.inspectionId} item={item} />
            ))}
          </div>
        )}
      </div>
    </PageEntrance>
  );
}
