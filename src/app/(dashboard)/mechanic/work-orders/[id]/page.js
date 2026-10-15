"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Wrench } from "lucide-react";
import { getMaintenanceRecord, getVehicleHistory, updateMaintenanceRecord } from "@/services/maintenance.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { toast } from "@/components/ui/toast";
import { WorkOrderDetail, WorkOrderDetailSkeleton } from "@/components/mechanic/work-order-detail";

// Work-order detail uses the existing single-record endpoint, which enforces
// mechanic assignment on the server. Evidence and transitions PUT through the
// same route with whitelist-only bodies.
export default function MechanicWorkOrderDetailPage() {
  useRequireRole();
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = String(params?.id ?? "");

  const detailQuery = useQuery({
    queryKey: ["mechanicWorkOrder", id],
    queryFn: () => getMaintenanceRecord(id),
    enabled: Boolean(id),
    staleTime: 30 * 1000,
    retry: false,
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

  const workOrder = detailQuery.data ?? null;

  // Read-only vehicle history is gated server-side on an assigned work order
  // for the same vehicle. A failed history fetch degrades to an unavailable
  // note rather than blocking the job. retry:false — a 403 is final.
  const vehicleId = Number(workOrder?.vehicle_id);
  const historyQuery = useQuery({
    queryKey: ["mechanicVehicleHistory", Number.isInteger(vehicleId) ? vehicleId : null],
    queryFn: () => getVehicleHistory(vehicleId),
    enabled: Number.isInteger(vehicleId) && vehicleId > 0,
    staleTime: 60 * 1000,
    retry: false,
  });
  const history = useMemo(() => {
    if (!historyQuery.data) return null;
    return {
      ...historyQuery.data,
      maintenance: (historyQuery.data.maintenance ?? []).filter(
        (row) => String(row.maintenance_id) !== id
      ),
    };
  }, [historyQuery.data, id]);

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
          <WorkOrderDetailSkeleton />
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
            key={id}
            workOrder={workOrder}
            submitting={save.isPending}
            serverError={save.isError ? (save.error?.message ?? "Could not save.") : null}
            saveSuccess={save.isSuccess}
            onEdit={() => save.reset()}
            onSubmit={(body) => save.mutate(body)}
            history={history}
            historyLoading={historyQuery.isLoading}
            historyError={historyQuery.isError ? (historyQuery.error?.message ?? "Could not load history.") : null}
          />
        )}
      </div>
    </PageEntrance>
  );
}
