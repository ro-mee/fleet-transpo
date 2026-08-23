"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useRoleAccess } from "@/hooks/use-role-access";
import { getDriverLeaveRequests, reviewDriverLeave } from "@/services/driver.service";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarClock, Loader2, CheckCircle2, XCircle, User, IdCard, CalendarDays } from "lucide-react";

const FILTERS = ["Pending", "Approved", "Declined", "All"];

function fmtDate(value) {
  if (!value) return "—";
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
  const [y, m, d] = s.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(y, m - 1, d));
}

export default function DriverLeaveRequestsPage() {
  useRequireRole(["system_admin", "admin", "fleet_manager"]);
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  const [filter, setFilter] = useState("Pending");
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [declining, setDeclining] = useState(null);

  const { data: leave = [], isLoading, isError } = useQuery({
    queryKey: ["all-leave-requests"],
    queryFn: () => getDriverLeaveRequests(),
  });

  const review = useMutation({
    mutationFn: ({ id, status, notes }) => reviewDriverLeave(id, status, notes),
    onSuccess: (_data, vars) => {
      toast.success(vars.status === "Declined" ? "Leave request declined" : "Leave request updated");
      queryClient.invalidateQueries({ queryKey: ["all-leave-requests"] });
    },
    onError: (err) => toast.error(err.message || "Failed to update request"),
  });

  const rows = filter === "All" ? leave : leave.filter((l) => l.status === filter);
  const pendingCount = leave.filter((l) => l.status === "Pending").length;

  return (
    <div className="space-y-6 w-full">
      <HeroHeader
        icon={CalendarClock}
        title="Driver Leave Requests"
        badge="Approvals"
        description="Approve or decline driver leave. Approved leave blocks that driver from assignment."
      />

      {isLoading ? (
        <div className="h-64 bg-muted rounded-3xl animate-pulse" />
      ) : isError ? (
        <EmptyState icon={CalendarClock} title="Could not load leave requests" description="Try again shortly." />
      ) : (
        <Card className="border-0 shadow-sm rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <CalendarClock className="w-4 h-4 text-primary" />
                {pendingCount > 0 ? `${pendingCount} request${pendingCount === 1 ? "" : "s"} awaiting review` : "No pending requests"}
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {FILTERS.map((f) => (
                  <Button
                    key={f}
                    variant={filter === f ? "default" : "outline"}
                    size="sm"
                    className="h-8 rounded-full text-xs px-3"
                    onClick={() => setFilter(f)}
                  >
                    {f}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {rows.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title={`No ${filter === "All" ? "" : filter.toLowerCase()} requests`}
                description={filter === "Pending" ? "You're all caught up." : "No requests in this state."}
              />
            ) : (
              <div className="space-y-2.5">
                {rows.map((l) => (
                  <div key={l.leave_request_id} className="p-4 rounded-2xl border border-border bg-surface flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-foreground text-sm">
                          {l.driver?.first_name} {l.driver?.last_name}
                        </span>
                        <Badge variant={l.status === "Approved" ? "success" : l.status === "Declined" ? "danger" : "secondary"} className="rounded-full text-xs">
                          {l.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-foreground-secondary font-medium">
                        {fmtDate(l.start_date)} {l.start_time ? `(${l.start_time})` : ""} – {fmtDate(l.end_date)} {l.end_time ? `(${l.end_time})` : ""}
                        {l.leave_type ? ` · ${l.leave_type}` : ""}
                      </p>
                      {l.reason && <p className="text-xs text-foreground-muted truncate max-w-xl">{l.reason}</p>}
                    </div>
                    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 shrink-0">
                      {l.status === "Pending" && can("driver_leave_requests", "update") && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-xl text-xs text-danger border-danger/30 hover:bg-danger/10"
                            disabled={review.isPending}
                            onClick={() => setDeclining(l)}
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" /> Decline
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 rounded-xl text-xs"
                            disabled={review.isPending}
                            onClick={() => review.mutate({ id: l.leave_request_id, status: "Approved" })}
                          >
                            {review.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                        </div>
                      )}
                      {l.status !== "Pending" && (
                        <span className="text-[11px] text-foreground-muted mr-2">Reviewed</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-xl text-xs font-semibold text-primary hover:bg-primary/10"
                        onClick={() => setSelectedRequest(l)}
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedRequest} onOpenChange={(open) => !open && setSelectedRequest(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl overflow-hidden border-border/60 shadow-lg p-0">
          {selectedRequest && (
            <>
              <div className="bg-muted/30 p-6 border-b border-border/40">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" /> Driver & Leave Details
                  </DialogTitle>
                </DialogHeader>
                <div className="mt-4 flex items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-xl font-bold">
                    {selectedRequest.driver?.first_name?.[0]}{selectedRequest.driver?.last_name?.[0]}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">
                      {selectedRequest.driver?.first_name} {selectedRequest.driver?.last_name}
                    </h3>
                    <p className="text-sm font-medium text-foreground-secondary flex items-center gap-1.5 mt-1">
                      <IdCard className="w-4 h-4 text-foreground-muted" /> License: <span className="font-data font-bold">{selectedRequest.driver?.license_number || "—"}</span>
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-4 bg-surface">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Leave Type</span>
                    <p className="font-bold text-sm text-foreground">{selectedRequest.leave_type || "—"}</p>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Status</span>
                    <div>
                      <Badge variant={selectedRequest.status === "Approved" ? "success" : selectedRequest.status === "Declined" ? "danger" : "secondary"} className="rounded-full text-xs">
                        {selectedRequest.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5" /> Date Range
                    </span>
                    <p className="font-medium text-sm text-foreground bg-muted/20 p-2.5 rounded-xl border border-border/40">
                      {fmtDate(selectedRequest.start_date)} {selectedRequest.start_time ? `(${selectedRequest.start_time})` : ""} <span className="text-border mx-1">➔</span> {fmtDate(selectedRequest.end_date)} {selectedRequest.end_time ? `(${selectedRequest.end_time})` : ""}
                    </p>
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">Reason</span>
                    <p className="font-medium text-sm text-foreground-secondary bg-muted/20 p-2.5 rounded-xl border border-border/40">
                      {selectedRequest.reason || "No reason provided."}
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-muted/10 border-t border-border/40 flex justify-end">
                <Button variant="outline" className="rounded-xl shadow-xs h-9 px-4 text-xs font-semibold" onClick={() => setSelectedRequest(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!declining}
        onOpenChange={(open) => {
          if (!open) setDeclining(null);
        }}
        variant="danger"
        title="Decline this leave request?"
        message={
          declining
            ? `${declining.driver?.first_name || "This driver"} ${declining.driver?.last_name || ""} — ${fmtDate(declining.start_date)} to ${fmtDate(declining.end_date)}. The driver will be returned to the available pool.`
            : ""
        }
        confirmLabel="Decline request"
        requireReason
        reasonLabel="Reason for declining"
        reasonPlaceholder="Explain why this leave is being declined"
        loading={review.isPending}
        onConfirm={(reason) => {
          if (!declining) return;
          review.mutate(
            { id: declining.leave_request_id, status: "Declined", notes: reason },
            { onSettled: () => setDeclining(null) }
          );
        }}
      />
    </div>
  );
}