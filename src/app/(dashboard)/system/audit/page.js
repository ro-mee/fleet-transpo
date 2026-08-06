"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditLogs } from "@/services/audit.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, RefreshCw } from "lucide-react";

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function actionTone(action) {
  const a = (action || "").toLowerCase();
  if (a === "create") return "success";
  if (a === "delete" || a === "cancel" || a === "reject") return "danger";
  if (a === "update" || a === "assign" || a === "approve" || a === "dispatch") return "warning";
  return "default";
}

export default function SystemAuditPage() {
  const [filters, setFilters] = useState({ action: "", resource: "", from: "", to: "" });
  const [applied, setApplied] = useState({});

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", applied],
    queryFn: () => getAuditLogs(applied),
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  const applyFilters = () => setApplied(filters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Every tracked mutation across the platform — who, what, and when."
      />

      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input placeholder="Action (create, update…)" value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
            <Input placeholder="Resource (vehicles, fuel…)" value={filters.resource}
              onChange={(e) => setFilters({ ...filters, resource: e.target.value })} />
            <Input type="date" value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            <Input type="date" value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button onClick={applyFilters}>Apply</Button>
            <Button variant="outline" onClick={() => { setFilters({ action: "", resource: "", from: "", to: "" }); setApplied({}); }}>
              Reset
            </Button>
            <Button variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? "h-4 w-4 mr-1 animate-spin" : "h-4 w-4 mr-1"} />
              Refresh
            </Button>
            <span className="ml-auto text-xs text-foreground-muted">{total} entries</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-foreground-muted" />
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : logs.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No audit entries"
              description="Tracked mutations will appear here. Try clearing the filters." className="py-16" />
          ) : (
            <div className="divide-y divide-border">
              {logs.map((log) => (
                <div key={log.log_id} className="px-5 py-3.5 hover:bg-hover transition-colors">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="text-[11px]" variant={actionTone(log.action)}>{log.action}</Badge>
                    <span className="text-sm font-medium text-foreground">{log.resource}</span>
                    {log.resource_id != null && (
                      <span className="text-xs text-foreground-muted">#{log.resource_id}</span>
                    )}
                    <span className="text-[11px] text-foreground-muted ml-auto">{formatTime(log.created_at)}</span>
                  </div>
                  <div className="mt-1 text-xs text-foreground-secondary">
                    <span className="text-foreground-muted">by</span>{" "}
                    {log.first_name && log.last_name
                      ? `${log.first_name} ${log.last_name}`
                      : log.email || `employee #${log.employee_id ?? "?"}`}
                    {log.ip_address ? ` · ${log.ip_address}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
