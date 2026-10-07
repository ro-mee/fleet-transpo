"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Wrench } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { updateMaintenanceRecord } from "@/services/maintenance.service";
import { useAuth } from "@/hooks/use-auth";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { CardSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { HeroJobCard } from "@/components/mechanic/hero-job-card";
import { JobQueue } from "@/components/mechanic/job-queue";
import { ShiftStrip } from "@/components/mechanic/shift-strip";
import { SideRail } from "@/components/mechanic/side-rail";

// Today's Line — the mechanic's dashboard. One summary fetch drives the four
// sections in dashboard-configs.js order: shift-strip, up-next, queue,
// side-rail. Web-only ≥1024px: below that the grid stacks and every mutating
// action disables itself with the desktop reason (handled in the components).
export default function MechanicPage() {
  useRequireRole();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee } = useAuth();

  const summaryQuery = useQuery({
    queryKey: ["mechanicSummary"],
    queryFn: () => apiFetch("/api/mechanic/summary"),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const historyQuery = useQuery({
    queryKey: ["mechanicHistoryStrip"],
    queryFn: () => apiFetch("/api/vehicle-maintenance?page=1&pageSize=10&status=Completed"),
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
  const counts = summary?.counts ?? { assigned: 0, inProgress: 0, waitingApproval: 0, urgent: 0, overdue: 0 };
  const queue = summary?.queue ?? [];
  const upNext = summary?.upNext ?? null;
  const attention = summary?.attention ?? [];
  const upcoming = summary?.upcoming ?? [];
  const history = historyQuery.data?.rows ?? [];
  const name = employee?.first_name || "Mechanic";
  const loading = summaryQuery.isLoading;

  return (
    <PageEntrance>
      <div className="space-y-4">
        <HeroHeader
          icon={Wrench}
          title={`Today's Line, ${name}`}
          description={
            loading
              ? "Loading your line…"
              : `${counts.assigned} assigned · ${counts.urgent} urgent`
          }
          actions={
            upNext && (
              <Button
                type="button"
                className={heroButtonPrimaryClass}
                onClick={() => router.push(`/mechanic/work-orders/${upNext.maintenance_id}`)}
              >
                <Play className="h-4 w-4" aria-hidden="true" /> Start next job
              </Button>
            )
          }
        />

        <QueryErrorBanner query={summaryQuery} title="Could not load today's line" />

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : !summary || counts.assigned === 0 ? (
          <EmptyState
            icon={Wrench}
            size="hero"
            title="The line is clear"
            description="No assigned work orders are waiting. New assignments will appear here."
          />
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 space-y-4">
              <ShiftStrip counts={counts} queue={queue} />
              <HeroJobCard
                job={upNext}
                busy={transition.isPending}
                onAction={(to) =>
                  upNext && transition.mutate({ id: upNext.maintenance_id, status: to })
                }
              />
              <JobQueue
                jobs={queue}
                compact
                busy={transition.isPending}
                onAction={(job, to) => transition.mutate({ id: job.maintenance_id, status: to })}
              />
            </div>
            <SideRail job={upNext} history={history} attention={attention} upcoming={upcoming} />
          </div>
        )}
      </div>
    </PageEntrance>
  );
}
