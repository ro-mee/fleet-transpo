"use client";

import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { getVehicleProblems } from "@/services/vehicle.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Card, CardContent } from "@/components/ui/card";
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
// Inspection severities (Minor/Moderate/Major/Critical) predate the shared
// severity grammar (critical/high/medium/low), so map to the nearest tone.
// "Not assessed" (or anything unmapped) renders the neutral outline chip.
const SEVERITY_TONE = { Critical: "critical", Major: "high", Moderate: "medium", Minor: "low" };

function ProblemRow({ item }) {
  const report = item.report?.kind === "free_text"
    ? item.report.text || "No description was recorded with this report."
    : (item.report?.items ?? [])
      .map((entry) => [entry.label, entry.remarks].filter(Boolean).join(": "))
      .join(" · ") || "No description was recorded with this report.";

  return (
    <li className="grid min-w-0 gap-3 border-b border-border/60 px-4 py-4 last:border-0 md:grid-cols-[minmax(125px,0.8fr)_minmax(0,1.6fr)_minmax(155px,0.9fr)] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">
          {item.plateNumber || `Vehicle #${item.vehicleId}`}
        </p>
        {item.vehicleName && <p className="truncate text-xs text-foreground-secondary">{item.vehicleName}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
          <StatusBadge status={item.inspectionType} className="rounded-control px-2.5 py-0.5 text-[11px] font-bold" />
          <span>{formatDate(item.inspectionDate)}</span>
        </div>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm text-foreground-secondary">{report}</p>

      <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
        <StatusBadge
          severity={SEVERITY_TONE[item.severityLabel]}
          label={item.severityLabel}
          className="rounded-control px-2.5 py-0.5 font-bold"
        />
        {item.driverName && <span className="text-xs text-foreground-secondary">Reported by {item.driverName}</span>}
        {item.workOrderId && (
          <a
            href={`/mechanic/work-orders/${item.workOrderId}`}
            className="inline-flex min-h-[44px] items-center rounded-control border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            WO #{item.workOrderId}
          </a>
        )}
        {item.workOrderId && item.workOrderStatus && <StatusBadge status={item.workOrderStatus} entity="maintenance" />}
      </div>
    </li>
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
            {(counts.tracked > 0 || counts.reportedUntracked + counts.failedUntracked > 0) && (
              <p className="text-xs text-foreground-secondary" aria-live="polite">
                {counts.tracked} tracked to a work order · {counts.reportedUntracked + counts.failedUntracked} awaiting triage
              </p>
            )}
            <Card className="overflow-hidden rounded-card border-border/70 shadow-sm">
              <CardContent className="p-0">
                <ul className="m-0 list-none p-0">
                  {items.map((item) => <ProblemRow key={item.inspectionId} item={item} />)}
                </ul>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </PageEntrance>
  );
}
