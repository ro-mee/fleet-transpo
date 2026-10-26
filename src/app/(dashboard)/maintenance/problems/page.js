"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import {
  getVehicleProblems,
  createInspectionWorkOrder,
} from "@/services/vehicle.service";
import { cn, formatDate } from "@/lib/utils";
import {
  Wrench,
  TriangleAlert,
  ShieldAlert,
  ClipboardList,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

const PAGE_SIZE = 25;

// The office's worklist of vehicle problems.
//
// Read-only apart from one action. Buckets come from bucketFor() in
// lib/inspections/problem-queue.js and are rendered as three sections rather
// than one table, because only the first is an exception: a driver reported a
// fault and the automatic raise failed, so nobody is following it up. The other
// two are working lists.
//
// severityLabel is rendered, never severity. A NULL severity means "reported,
// and nobody assessed it" and must read as "Not assessed" — a blank cell in a
// manager's queue reads as "no problem recorded", which is the exact inversion.

function ReportBlock({ report }) {
  if (report.kind === "free_text") {
    const text = report.text || "";
    if (!text.trim()) {
      return (
        <p className="text-sm text-foreground-secondary italic">
          No description was recorded with this report.
        </p>
      );
    }
    return <p className="text-sm text-foreground whitespace-pre-wrap break-words">{text}</p>;
  }

  if (!report.items?.length) {
    return (
      <p className="text-sm text-foreground-secondary italic">
        No failed item was recorded with this inspection.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {report.items.map((item, i) => (
        <li key={`${item.label}-${i}`} className="text-sm">
          <span className="font-semibold text-foreground">{item.label}</span>
          <span className="text-foreground-secondary">
            {" — "}
            {item.remarks
              ? <span className="whitespace-pre-wrap break-words">{item.remarks}</span>
              : <em>No remark was recorded with this item.</em>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProblemRow({ item, onRaise, raising }) {
  const tracked = item.bucket === "tracked";
  return (
    <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">
            {item.plateNumber || `Vehicle #${item.vehicleId}`}
          </span>
          {item.vehicleName && (
            <span className="text-sm text-foreground-secondary">{item.vehicleName}</span>
          )}
          <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-[11px] font-bold">
            {item.inspectionType}
          </Badge>
          <span className="text-xs text-foreground-secondary font-medium">
            {formatDate(item.inspectionDate)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-foreground-secondary font-semibold uppercase tracking-wider">
            Severity:
          </span>
          <StatusBadge status={item.severityLabel} entity="severity" className="rounded-full px-2.5 py-0.5 font-bold" />
          {item.driverName && (
            <span className="text-foreground-secondary">Reported by {item.driverName}</span>
          )}
        </div>

        <div className="pt-1">
          <ReportBlock report={item.report} />
        </div>
      </div>

      <div className="sm:w-64 shrink-0">
        {tracked ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold tabular-nums">Work order #{item.workOrderId}</p>
            <StatusBadge
              status={item.workOrderStatus || "Scheduled"}
              entity="maintenance"
              className="rounded-full text-xs font-bold"
            />
            <Link
              href={`/maintenance?work_order_id=${item.workOrderId}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-bold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              Open work order <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <p className="text-xs text-foreground-secondary">
              Assigned mechanic: {item.assignedMechanicName || (item.assignedMechanicId ? `Mechanic #${item.assignedMechanicId}` : "Unassigned")}
            </p>
            <p className="text-xs text-foreground-secondary">
              {item.workOrderStatus === "Pending Inspection" ? "Next: Fleet Manager review. Approve completion or return the repair with a reason."
                : item.workOrderStatus === "Cancelled" ? "Next: Fleet Manager must review this cancelled ticket and confirm how the defect will be handled."
                  : item.workOrderStatus === "Completed" ? "Repair completed. Review the work order for the recorded outcome."
                    : !item.assignedMechanicId ? "Next: Fleet Manager assigns a mechanic in the work order."
                      : "Next: Assigned mechanic updates the repair and submits it for review."}
            </p>
            {item.repairCompletedAt && <p className="text-xs text-foreground-secondary">Last submitted: {formatDate(item.repairCompletedAt)}</p>}
            {!item.repairCompletedAt && item.repairStartedAt && <p className="text-xs text-foreground-secondary">Repair started: {formatDate(item.repairStartedAt)}</p>}
            {!item.repairCompletedAt && !item.repairStartedAt && item.assignedAt && <p className="text-xs text-foreground-secondary">Assigned: {formatDate(item.assignedAt)}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-foreground-secondary">Next: Fleet Manager triage. No repair owner is assigned until a work order is raised and assigned.</p>
            {["High", "Critical", "Major"].includes(item.severityLabel) && <p className="text-xs font-semibold text-danger-700">Review this safety finding with dispatch now. A failed inspection alone does not take the vehicle out of service.</p>}
            <Button
              size="sm"
              onClick={() => onRaise(item.inspectionId)}
              disabled={raising}
              className={cn(
                "rounded-2xl h-9 px-4 text-xs font-bold shadow-xs cursor-pointer",
                heroButtonPrimaryClass
              )}
            >
              <Wrench className="w-4 h-4 mr-2" />
              {raising ? "Raising…" : "Raise work order"}
            </Button>
            {item.bucket === "reported_untracked" ? (
              <>
                {/* Reported (Post-Shift) rows take the End Duty branch of
                    ensureInspectionMaintenance, not the checklist one: a
                    severe-keyword match files In Progress (grounded at once),
                    and even a routine filing is dated today, which
                    /api/vehicles/available reads as out of service (Scheduled
                    AND maintenance_date <= CURRENT_DATE). Say so next to the
                    button, or the office will assume the vehicle stayed
                    dispatchable and skip telling dispatch. */}
                <p className="text-[11px] leading-snug text-foreground-secondary">
                  Raising this can take the vehicle out of service. Check the
                  register after raising and tell dispatch.
                </p>
              </>
            ) : (
              <>
                {/* True as of Amendment 15: the payload is dated tomorrow, so the
                    Scheduled row does not satisfy the `<= CURRENT_DATE` arm of
                    /api/vehicles/available. Stated next to the button because a
                    manager who assumes the click grounded the vehicle will skip
                    telling dispatch — and today that would be the wrong call. */}
                <p className="text-[11px] leading-snug text-foreground-secondary">
                  Files as <strong>Scheduled</strong> for triage and is dated from tomorrow.
                  It does <strong>not</strong> take the vehicle out of service.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, description, count, danger, rows, empty, onRaise, raisingId }) {
  return (
    <Card className={cn("border-0 shadow-xs rounded-3xl overflow-hidden", danger && count > 0 && "border border-danger/30")}>
      <CardHeader className="px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={cn(
                "p-2 rounded-xl",
                danger && count > 0 ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"
              )}
            >
              <Icon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <CardTitle className={cn("text-sm font-bold", danger && count > 0 && "text-danger")}>
                {title}
              </CardTitle>
              <CardDescription className="text-xs">{description}</CardDescription>
            </div>
          </div>
          <span className="text-2xl font-medium font-data text-foreground">{count}</span>
        </div>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-border/50">
        {rows.length ? (
          rows.map((item) => (
            <ProblemRow
              key={item.inspectionId}
              item={item}
              onRaise={onRaise}
              raising={raisingId === item.inspectionId}
            />
          ))
        ) : (
          <div className="px-5 py-6">
            <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function VehicleProblemsPage() {
  useRequireRole();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["vehicle-problems", page],
    queryFn: () => getVehicleProblems({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  });

  const items = data?.items || [];
  const counts = data?.counts || { reportedUntracked: 0, failedUntracked: 0, tracked: 0 };

  const raiseMutation = useMutation({
    mutationFn: createInspectionWorkOrder,
    onSuccess: (res) => {
      if (res?.created) {
        toast.success(`Work order #${res.workOrder?.maintenance_id} raised`);
      } else {
        toast.success("A repair ticket already exists for this inspection");
      }
      queryClient.invalidateQueries({ queryKey: ["vehicle-problems"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-problem-count"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (err) => toast.error(err?.message || "Could not raise the work order"),
  });

  const reported = items.filter((i) => i.bucket === "reported_untracked");
  const failed = items.filter((i) => i.bucket === "failed_untracked");
  const tracked = items.filter((i) => i.bucket === "tracked");

  const onRaise = (inspectionId) => raiseMutation.mutate(inspectionId);
  const raisingId = raiseMutation.isPending ? raiseMutation.variables : null;

  if (isError) {
    return (
      <div className="space-y-6 pb-12 w-full">
        <EmptyState
          icon={TriangleAlert}
          title="Could not load the vehicle problem queue"
          description={error?.message || "Something went wrong reading the queue."}
          tone="danger"
          action={
            <Button onClick={() => refetch()} className="rounded-2xl text-xs font-bold mt-2">
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 w-full">
      <HeroHeader
        icon={ShieldAlert}
        title="Vehicle Problem Queue"
        badge="Inspections awaiting a repair ticket"
        description="Review driver findings, assign repair follow-up and check work awaiting approval. Untracked findings appear first, oldest first. Counts cover the full queue; sections show the current page."
        actions={
          <Link href="/maintenance">
            <Button
              variant="outline"
              size="sm"
              className={cn("rounded-2xl h-10 px-4 text-xs font-bold cursor-pointer")}
            >
              Maintenance register <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        }
      />

      <StatGrid cols={3}>
        <StatCard
          icon={ShieldAlert}
          label="Reported defects with no work order"
          value={isLoading || isError ? "—" : counts.reportedUntracked}
          trend="Driver-reported problems nobody is following up"
          tone="danger"
        />
        <StatCard
          icon={ClipboardList}
          label="Failed inspections with no work order"
          value={isLoading || isError ? "—" : counts.failedUntracked}
          trend="Fleet Manager triage needed; a notification does not confirm action"
          tone="warning"
        />
        <StatCard
          icon={Wrench}
          label="With a repair ticket"
          value={isLoading || isError ? "—" : counts.tracked}
          trend="Check assignment, repair progress and review status"
          tone="success"
        />
      </StatGrid>

      {isLoading ? <p role="status" className="py-6 text-sm text-foreground-secondary">Loading vehicle problems…</p> : <>
      <Section
        icon={ShieldAlert}
        title="Reported defects with no work order"
        description="A driver reported a fault and the automatic raise did not produce a ticket."
        count={reported.length}
        danger
        rows={reported}
        empty={{
          icon: ShieldAlert,
          title: "No untracked reported defects on this page",
          description: "Use the page controls to review other records when the full queue count is higher.",
        }}
        onRaise={onRaise}
        raisingId={raisingId}
      />

      <Section
        icon={ClipboardList}
        title="Failed inspections with no work order"
        description="Fleet Manager reviews the finding and decides the repair and dispatch response."
        count={failed.length}
        rows={failed}
        empty={{
          icon: ClipboardList,
          title: "No failed inspections awaiting a ticket on this page",
          description: "Failed Pre-Shift and Pre-Trip inspections appear here for office follow-up.",
        }}
        onRaise={onRaise}
        raisingId={raisingId}
      />

      <Section
        icon={Wrench}
        title="With a repair ticket"
        description="A ticket exists. Check who owns the repair and what needs to happen next."
        count={tracked.length}
        rows={tracked}
        empty={{
          icon: Wrench,
          title: "No linked work orders on this page",
          description: "Problems move here once a work order is raised for them.",
        }}
        onRaise={onRaise}
        raisingId={raisingId}
      />
      </>}
      {((data?.total ?? 0) > PAGE_SIZE || page > 1) && (
        <nav aria-label="Problem queue pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-4">
          <p aria-live="polite" className="text-xs text-foreground-secondary">{isLoading ? "Loading page…" : `Page ${page} of ${Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))} · ${data?.total ?? 0} problems`}</p>
          <div className="flex gap-2">
            <Button variant="outline" aria-label="Previous page" disabled={page <= 1 || isLoading} onClick={() => setPage(value => value - 1)} className="min-h-[44px]">Previous</Button>
            <Button variant="outline" aria-label="Next page" disabled={isLoading || page * PAGE_SIZE >= (data?.total ?? 0)} onClick={() => setPage(value => value + 1)} className="min-h-[44px]">Next</Button>
          </div>
        </nav>
      )}
    </div>
  );
}
