"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDispatchesByStatus, updateDispatchStatus } from "@/services/dispatch.service";
import { formatDate, formatTime } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Send, Truck, Users, Clock, MapPin, ChevronRight } from "lucide-react";

const columns = [
  { id: "pending", label: "Pending", color: "bg-warning/10 border-warning/30 text-warning" },
  { id: "approved", label: "Approved", color: "bg-primary/10 border-primary/30 text-primary" },
  { id: "dispatched", label: "Dispatched", color: "bg-blue-100 border-blue-300 text-blue-700" },
  { id: "inProgress", label: "In Progress", color: "bg-success/10 border-success/30 text-success" },
  { id: "completed", label: "Completed", color: "bg-muted border-border text-foreground-muted" },
];

export default function DispatchPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher"]);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: dispatchGroups, isLoading } = useQuery({
    queryKey: ["dispatches-status"],
    queryFn: () => getDispatchesByStatus(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }) => updateDispatchStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dispatches-status"] }),
  });

  const getNextStatus = (currentStatus) => {
    const flow = ["Pending", "Approved", "Dispatched", "In Progress", "Completed"];
    const idx = flow.indexOf(currentStatus);
    return idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : null;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted rounded w-1/3 animate-pulse" />
        <div className="grid grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dispatch Board</h1>
          <p className="text-foreground-secondary mt-1">Drag and drop dispatch management</p>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 overflow-x-auto min-h-[600px]">
        {columns.map((col) => {
          const items = dispatchGroups?.[col.id] || [];
          return (
            <div key={col.id} className="min-w-[240px] flex flex-col">
              <div className={`flex items-center justify-between px-3 py-2 rounded-t-xl border ${col.color} bg-surface`}>
                <span className="text-xs font-semibold uppercase tracking-wider">{col.label}</span>
                <span className="text-xs font-medium opacity-70">{items.length}</span>
              </div>
              <div className="flex-1 bg-surface/50 border-x border-b border-border rounded-b-xl p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
                {items.length === 0 ? (
                  <div className="text-center py-8 text-xs text-foreground-muted">
                    <p>No dispatches</p>
                  </div>
                ) : (
                  items.map((dispatch) => (
                    <Card
                      key={dispatch.dispatch_id}
                      className="cursor-pointer hover:shadow-md transition-all"
                      onClick={() => router.push(`/dispatch/${dispatch.dispatch_id}`)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-data font-medium text-primary">
                            {dispatch.dispatch_number}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">{dispatch.priority || "Normal"}</Badge>
                        </div>

                        <div className="space-y-1.5">
                          {dispatch.vehicles && (
                            <div className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                              <Truck className="w-3 h-3" />
                              {dispatch.vehicles.plate_number}
                            </div>
                          )}
                          {dispatch.drivers?.employees && (
                            <div className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                              <Users className="w-3 h-3" />
                              {dispatch.drivers.employees.first_name} {dispatch.drivers.employees.last_name}
                            </div>
                          )}
                          {dispatch.scheduled_departure && (
                            <div className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                              <Clock className="w-3 h-3" />
                              {formatDateTime(dispatch.scheduled_departure)}
                            </div>
                          )}
                        </div>

                        {col.id !== "completed" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = getNextStatus(
                                dispatch.status === "Driver Accepted" || dispatch.status === "En Route"
                                  ? "In Progress"
                                  : dispatch.status
                              );
                              if (next) {
                                updateMutation.mutate({ id: dispatch.dispatch_id, status: next });
                              }
                            }}
                            className="w-full mt-2 text-[10px] text-primary hover:text-primary-dark flex items-center justify-center gap-1 py-1 rounded-lg hover:bg-primary/5 transition-colors"
                          >
                            Move forward <ChevronRight className="w-3 h-3" />
                          </button>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
