"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useRoleAccess } from "@/hooks/use-role-access";
import { getDriverLeaveRequests, reviewDriverLeave } from "@/services/driver.service";
import { CalendarClock, Loader2, CheckCircle2, XCircle } from "lucide-react";

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

  const { data: leave = [], isLoading, isError } = useQuery({
    queryKey: ["all-leave-requests"],
    queryFn: () => getDriverLeaveRequests(),
  });

  const review = useMutation({
    mutationFn: ({ id, status }) => reviewDriverLeave(id, status),
    onSuccess: () => {
      toast.success("Leave request updated");
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
                        {fmtDate(l.start_date)} – {fmtDate(l.end_date)}
                        {l.leave_type ? ` · ${l.leave_type}` : ""}
                      </p>
                      {l.reason && <p className="text-xs text-foreground-muted truncate max-w-xl">{l.reason}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {l.status === "Pending" && can("driver_leave_requests", "update") && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-xl text-xs text-danger border-danger/30 hover:bg-danger/10"
                            disabled={review.isPending}
                            onClick={() => review.mutate({ id: l.leave_request_id, status: "Declined" })}
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
                        </>
                      )}
                      {l.status !== "Pending" && (
                        <span className="text-[11px] text-foreground-muted">Reviewed</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}