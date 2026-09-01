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
  useRequireRole();
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
        <DialogContent className="max-w-lg w-[95vw] md:w-[480px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
          {selectedRequest && (
            <>
              <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center text-base font-bold shadow-2xs">
                    {selectedRequest.driver?.first_name?.[0]}{selectedRequest.driver?.last_name?.[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <DialogTitle className="text-base font-bold text-foreground">
                        {selectedRequest.driver?.first_name} {selectedRequest.driver?.last_name}
                      </DialogTitle>
                      <Badge variant={selectedRequest.status === "Approved" ? "success" : selectedRequest.status === "Declined" ? "danger" : "secondary"} className="rounded-full text-[10px] font-bold">
                        {selectedRequest.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-foreground-muted mt-0.5 flex items-center gap-1.5">
                      <IdCard className="w-3.5 h-3.5" /> License: <span className="font-data font-bold text-foreground">{selectedRequest.driver?.license_number || "—"}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
                  <div className="rounded-xl bg-surface p-4 border border-border/50 space-y-3.5">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">Leave Type</span>
                        <p className="font-bold text-foreground text-sm">{selectedRequest.leave_type || "Standard Leave"}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">Status Code</span>
                        <p className="font-bold text-foreground text-sm">{selectedRequest.status || "Pending"}</p>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-border/50">
                      <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider flex items-center gap-1">
                        <CalendarDays className="w-3 h-3 text-primary" /> Approved Date Range
                      </span>
                      <div className="p-2.5 rounded-xl bg-muted/40 border border-border/60 text-xs font-semibold text-foreground flex items-center justify-between">
                        <span>{fmtDate(selectedRequest.start_date)} {selectedRequest.start_time ? `(${selectedRequest.start_time})` : ""}</span>
                        <span className="text-primary font-bold">➔</span>
                        <span>{fmtDate(selectedRequest.end_date)} {selectedRequest.end_time ? `(${selectedRequest.end_time})` : ""}</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-border/50">
                      <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                        Reason & Notes
                      </span>
                      <p className="text-xs text-foreground-secondary leading-relaxed p-3 rounded-xl bg-muted/30 border border-border/60">
                        {selectedRequest.reason || "No reason specified by driver."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-3.5 border-t border-border/70 bg-surface/90 backdrop-blur-md flex justify-end">
                <Button variant="outline" className="h-9 px-4 text-xs font-semibold" onClick={() => setSelectedRequest(null)}>
                  Close
                </Button>
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
