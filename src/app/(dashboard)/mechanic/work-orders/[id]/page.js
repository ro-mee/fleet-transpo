"use client";

import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Wrench } from "lucide-react";
import { getVehicleMaintenance, updateMaintenanceRecord } from "@/services/maintenance.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { DetailSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { WorkOrderDetail } from "@/components/mechanic/work-order-detail";

// Work-order detail. The row is resolved from the assignee-scoped list read
// (ownership is server-enforced: a mechanic's list contains only their own
// rows, so an id that is not theirs resolves to not-found here). Evidence and
// transitions PUT through the [id] route with whitelist-only bodies.
export default function MechanicWorkOrderDetailPage() {
  useRequireRole();
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = String(params?.id ?? "");

  const detailQuery = useQuery({
    queryKey: ["mechanicWorkOrder"],
    queryFn: () => getVehicleMaintenance(),
    staleTime: 30 * 1000,
  });

  const save = useMutation({
    mutationFn: (body) => updateMaintenanceRecord(id, body),
    onSuccess: (_, body) => {
      toast.success(
        body?.status === "In Progress"
          ? "Job started — repair clock is running."
          : body?.status === "Pending Inspection"
            ? "Marked ready — handed to the Fleet Manager for inspection."
            : "Findings saved."
      );
      queryClient.invalidateQueries({ queryKey: ["mechanicWorkOrder"] });
      queryClient.invalidateQueries({ queryKey: ["mechanicWorkOrders"] });
      queryClient.invalidateQueries({ queryKey: ["mechanicSummary"] });
      queryClient.invalidateQueries({ queryKey: ["mechanicHistory"] });
    },
    onError: (err) => toast.error(err?.message || "Could not save. Check your connection and try again."),
  });

  const rows = Array.isArray(detailQuery.data)
    ? detailQuery.data
    : (detailQuery.data?.rows ?? []);
  const workOrder = rows.find((r) => String(r.maintenance_id) === id) ?? null;

  return (
    <PageEntrance>
      <div className="space-y-4">
        <HeroHeader
          icon={Wrench}
          title={workOrder ? `WO #${workOrder.maintenance_id}` : "Work order"}
          description={workOrder ? (workOrder.maintenance_type ?? "") : ""}
          actions={
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/mechanic/work-orders")}
              className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to queue
            </Button>
          }
        />

        <QueryErrorBanner query={detailQuery} title="Could not load the work order" />

        {detailQuery.isLoading ? (
          <DetailSkeleton />
        ) : !workOrder ? (
          <EmptyState
            icon={Wrench}
            size="hero"
            title="Work order not found"
            description="It may belong to another mechanic, or the link is stale. Return to your queue to pick up your assigned work."
            action={
              <Button
                type="button"
                onClick={() => router.push("/mechanic/work-orders")}
                className="min-h-[44px] rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Back to queue
              </Button>
            }
          />
        ) : (
          <WorkOrderDetail
            workOrder={workOrder}
            submitting={save.isPending}
            serverError={save.isError ? (save.error?.message ?? "Could not save.") : null}
            onSubmit={(body) => save.mutate(body)}
          />
        )}
      </div>
    </PageEntrance>
  );
}
