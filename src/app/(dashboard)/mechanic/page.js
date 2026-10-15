"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Wrench } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { getPredictiveMaintenance, updateMaintenanceRecord } from "@/services/maintenance.service";
import { useAuth } from "@/hooks/use-auth";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { CardSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { JobQueue } from "@/components/mechanic/job-queue";
import { SideRail } from "@/components/mechanic/side-rail";
import { isActionablePrediction } from "@/components/mechanic/mechanic-actions";

const LINE_FILTERS = [
  { value: "All", label: "All", countKey: "assigned" },
  { value: "Scheduled", label: "Scheduled", countKey: "scheduled" },
  { value: "In Progress", label: "In Progress", countKey: "inProgress" },
  { value: "Pending Inspection", label: "Pending Inspection", countKey: "waitingApproval" },
];

// My Line is the mechanic's assigned queue. The summary endpoint keeps counts,
// upcoming work, and attention scoped to the caller while filtering only rows.
export default function MechanicPage() {
  useRequireRole();
  const queryClient = useQueryClient();
  const { employee } = useAuth();
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);

  const summaryQuery = useQuery({
    queryKey: ["mechanicSummary", statusFilter],
    queryFn: () => apiFetch(`/api/mechanic/summary${statusFilter === "All" ? "" : `?status=${encodeURIComponent(statusFilter)}`}`),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const historyQuery = useQuery({
    queryKey: ["mechanicHistoryStrip"],
    queryFn: () => apiFetch("/api/vehicle-maintenance?page=1&pageSize=10&status=Completed"),
    staleTime: 60 * 1000,
  });
  const predictiveQuery = useQuery({
    queryKey: ["mechanicPredictive"],
    queryFn: getPredictiveMaintenance,
    staleTime: 60 * 1000,
  });

  const transition = useMutation({
    mutationFn: ({ id, status }) => updateMaintenanceRecord(id, { status }),
    onSuccess: (_, { status }) => {
      toast.success(
        status === "In Progress" ? "Job started — repair clock is running." : "Marked ready for inspection."
      );
      queryClient.invalidateQueries({ queryKey: ["mechanicSummary"] });
    },
    onError: (err) => toast.error(err?.message || "Could not update the work order."),
  });

  const summary = summaryQuery.data ?? null;
  const counts = summary?.counts ?? { assigned: 0, scheduled: 0, inProgress: 0, waitingApproval: 0, urgent: 0, overdue: 0 };
  const queue = summary?.queue ?? [];
  const selectedJob = queue.find((job) => String(job.maintenance_id) === String(selectedId)) ?? queue[0] ?? null;
  const attention = summary?.attention ?? [];
  const upcoming = useMemo(() => {
    const raw = predictiveQuery.data?.predictions ?? predictiveQuery.data;
    if (Array.isArray(raw)) return raw.filter((prediction) => isActionablePrediction(prediction));
    return summary?.upcoming ?? [];
  }, [predictiveQuery.data, summary]);
  const history = historyQuery.data?.rows ?? [];
  const name = employee?.first_name || "Mechanic";
  const loading = summaryQuery.isLoading;
  const filteredCount = statusFilter === "All"
    ? counts.assigned
    : statusFilter === "Scheduled"
      ? counts.scheduled
      : statusFilter === "In Progress"
        ? counts.inProgress
        : counts.waitingApproval;

  return (
    <PageEntrance>
      <div className="space-y-4">
        <HeroHeader
          icon={Wrench}
          title={`Today's Line, ${name}`}
          description={
            loading
              ? "Loading your line…"
              : `${counts.assigned} assigned · ${counts.urgent} urgent${counts.overdue ? ` · ${counts.overdue} overdue` : ""}`
          }
        />

        <QueryErrorBanner query={summaryQuery} title="Could not load today's line" />

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_320px]">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : !summary ? null : counts.assigned === 0 ? (
          <EmptyState
            icon={Wrench}
            size="hero"
            title="The line is clear"
            description="No assigned work orders are waiting. New assignments will appear here."
          />
        ) : (
          <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_340px] 2xl:items-start">
            <section aria-label="Assigned work order queue" className="min-w-0 space-y-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter assigned work orders">
                {LINE_FILTERS.map((filter) => {
                  const count = Number(counts[filter.countKey]) || 0;
                  const selected = statusFilter === filter.value;
                  return (
                    <Button
                      key={filter.value}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      aria-pressed={selected}
                      aria-label={`${filter.label}: ${count} work orders`}
                      onClick={() => setStatusFilter(filter.value)}
                      className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      {filter.label}
                      <span
                        aria-hidden="true"
                        className={selected
                          ? "ml-1 inline-flex min-w-6 items-center justify-center rounded-full bg-surface/15 px-1.5 text-xs tabular-nums"
                          : "ml-1 inline-flex min-w-6 items-center justify-center rounded-full bg-hover px-1.5 text-xs tabular-nums text-foreground-secondary"}
                      >
                        {count}
                      </span>
                    </Button>
                  );
                })}
              </div>

              {queue.length === 0 ? (
                <EmptyState
                  size="compact"
                  title={`No ${statusFilter === "All" ? "assigned" : statusFilter.toLowerCase()} work orders`}
                  description="Choose another filter or check back when a new job is assigned."
                />
              ) : (
                <JobQueue
                  jobs={queue}
                  title="Assigned work orders"
                  selectedId={selectedJob?.maintenance_id}
                  onSelect={(job) => setSelectedId(job.maintenance_id)}
                  busy={transition.isPending}
                  onAction={(job, to) => transition.mutate({ id: job.maintenance_id, status: to })}
                />
              )}

              {queue.length > 0 && filteredCount > queue.length && (
                <p className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-foreground-secondary">
                  <span>Showing {queue.length} of {filteredCount} work orders</span>
                  <Link
                    href="/mechanic/work-orders"
                    className="inline-flex min-h-[44px] items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    View all work orders <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </p>
              )}
            </section>

            {selectedJob && (
              <SideRail
                job={selectedJob}
                history={history}
                attention={attention}
                upcoming={upcoming}
                upcomingLoading={predictiveQuery.isLoading}
                upcomingError={predictiveQuery.isError}
              />
            )}
          </div>
        )}
      </div>
    </PageEntrance>
  );
}
