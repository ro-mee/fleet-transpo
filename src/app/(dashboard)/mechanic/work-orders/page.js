"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { getVehicleMaintenance, updateMaintenanceRecord } from "@/services/maintenance.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Button } from "@/components/ui/button";
import { HeroHeader } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { TableSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { JobQueue } from "@/components/mechanic/job-queue";

const FILTERS = ["All", "Scheduled", "In Progress", "Pending Inspection"];
const PAGE_SIZE = 10;

// My Work Orders — the full assigned queue. The assigned scope is implicit
// (server-forced from the session); the chips only narrow by status.
export default function MechanicWorkOrdersPage() {
  useRequireRole();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("All");
  const [page, setPage] = useState(1);

  const listQuery = useQuery({
    queryKey: ["mechanicWorkOrders", page, status],
    queryFn: () =>
      getVehicleMaintenance({
        page,
        pageSize: PAGE_SIZE,
        ...(status === "All" ? {} : { status }),
      }),
    placeholderData: (previous) => previous,
  });

  const transition = useMutation({
    mutationFn: ({ id, status: to }) => updateMaintenanceRecord(id, { status: to }),
    onSuccess: (_, { status: to }) => {
      toast.success(
        to === "In Progress" ? "Job started — repair clock is running." : "Marked ready for inspection."
      );
      queryClient.invalidateQueries({ queryKey: ["mechanicWorkOrders"] });
      queryClient.invalidateQueries({ queryKey: ["mechanicSummary"] });
    },
    onError: (err) => toast.error(err?.message || "Could not update the work order."),
  });

  const rows = listQuery.data?.rows ?? [];
  const total = Number(listQuery.data?.total) || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageEntrance>
      <div className="space-y-4">
        <HeroHeader
          icon={Wrench}
          title="My Work Orders"
          description={
            listQuery.isLoading ? "Loading your queue…" : `${total} assigned work order${total === 1 ? "" : "s"}`
          }
        />

        <QueryErrorBanner query={listQuery} title="Could not load work orders" />

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Button
              key={f}
              type="button"
              variant={status === f ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setStatus(f);
                setPage(1);
              }}
              aria-pressed={status === f}
              className={cn(
                "min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              )}
            >
              {f}
            </Button>
          ))}
        </div>

        {listQuery.isLoading && !listQuery.data ? (
          <TableSkeleton rows={4} cols={3} />
        ) : (
          <JobQueue
            jobs={rows}
            busy={transition.isPending}
            onAction={(job, to) => transition.mutate({ id: job.maintenance_id, status: to })}
          />
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1 || listQuery.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Previous
            </Button>
            <p className="text-xs tabular-nums text-foreground-secondary" aria-live="polite">
              Page {page} of {pageCount}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={page >= pageCount || listQuery.isFetching}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </PageEntrance>
  );
}
