"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditLogs } from "@/services/audit.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, RefreshCw, Filter, Clock, CheckCircle2, AlertTriangle, UserCheck, Layers, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

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

  const stats = useMemo(() => {
    const creates = logs.filter((l) => (l.action || "").toLowerCase() === "create").length;
    const updates = logs.filter((l) => ["update", "assign", "approve", "dispatch"].includes((l.action || "").toLowerCase())).length;
    const deletes = logs.filter((l) => ["delete", "cancel", "reject"].includes((l.action || "").toLowerCase())).length;
    return { creates, updates, deletes };
  }, [logs]);

  return (
    <div className="space-y-6 pb-12 w-full select-none">
      {/* ── HERO HEADER BAR ── */}
      <HeroHeader
        icon={ShieldCheck}
        title="System Audit & Ledger Trail"
        badge="Compliance Ledger"
        description="Immutable record of system mutations across vehicles, dispatches, driver assignments, and security events."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className={cn("rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer", heroButtonOutlineClass)}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-2", isFetching && "animate-spin")} />
            Refresh Audit Stream
          </Button>
        }
      />

      {/* ── KPI STATS CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-primary/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Total Audit Entries</span>
            <div className="p-2 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{total || logs.length}</div>
            <p className="text-[11px] text-primary font-medium mt-1">Logged mutations</p>
          </div>
        </div>

        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-success/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Create Events</span>
            <div className="p-2 rounded-2xl bg-success/10 text-success border border-success/20">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{stats.creates}</div>
            <p className="text-[11px] text-success font-semibold mt-1">New entity creations</p>
          </div>
        </div>

        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-warning/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Updates &amp; Dispatches</span>
            <div className="p-2 rounded-2xl bg-warning/10 text-warning border border-warning/20">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{stats.updates}</div>
            <p className="text-[11px] text-warning font-semibold mt-1">State &amp; assignment changes</p>
          </div>
        </div>

        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 hover:border-danger/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Deletions &amp; Rejections</span>
            <div className="p-2 rounded-2xl bg-danger/10 text-danger border border-danger/20">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{stats.deletes}</div>
            <p className="text-[11px] text-danger font-semibold mt-1">System deletions / cancellations</p>
          </div>
        </div>
      </div>

      {/* ── SEARCH & FILTER CARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl p-5 bg-surface">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider border-b border-border/60 pb-3">
            <Filter className="w-4 h-4 text-primary" /> Filter Audit Trail
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <Input
              placeholder="Action (create, update…)"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="rounded-2xl h-10 text-xs"
            />
            <Input
              placeholder="Resource (vehicles, fuel…)"
              value={filters.resource}
              onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
              className="rounded-2xl h-10 text-xs"
            />
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="rounded-2xl h-10 text-xs"
            />
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="rounded-2xl h-10 text-xs"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={applyFilters} className="rounded-full h-9 px-5 text-xs font-bold shadow-2xs cursor-pointer">
              Apply Filters
            </Button>
            <Button
              variant="outline"
              onClick={() => { setFilters({ action: "", resource: "", from: "", to: "" }); setApplied({}); }}
              className="rounded-full h-9 px-4 text-xs font-bold cursor-pointer"
            >
              Reset
            </Button>
            <span className="ml-auto text-xs font-bold text-foreground-muted font-data">{total} Total Entries</span>
          </div>
        </div>
      </Card>

      {/* ── AUDIT EVENT LOGS LIST CARD ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <FileText className="w-4 h-4 text-primary" /> Audit Stream Logs
          </CardTitle>
          <span className="text-xs font-bold text-foreground-muted font-data">Chronological Sequence</span>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-14 w-full rounded-2xl" />
              <Skeleton className="h-14 w-full rounded-2xl" />
              <Skeleton className="h-14 w-full rounded-2xl" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No audit entries found"
              description="Tracked system mutations will appear here as actions are executed."
              className="py-16"
            />
          ) : (
            <div className="divide-y divide-border/60">
              {logs.map((log) => (
                <div key={log.log_id} className="px-6 py-4 hover:bg-muted/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Badge variant={actionTone(log.action)} className="rounded-full px-3 py-1 text-[11px] font-extrabold uppercase shrink-0">
                      {log.action}
                    </Badge>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold text-foreground">{log.resource}</span>
                        {log.resource_id != null && (
                          <span className="text-xs font-bold font-data text-foreground-muted bg-muted/60 px-2 py-0.5 rounded-lg border border-border/60">
                            #{log.resource_id}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-foreground-secondary font-medium mt-1">
                        Executed by{" "}
                        <span className="font-bold text-foreground">
                          {log.first_name && log.last_name
                            ? `${log.first_name} ${log.last_name}`
                            : log.email || `Employee #${log.employee_id ?? "?"}`}
                        </span>
                        {log.ip_address ? ` · IP: ${log.ip_address}` : ""}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold font-data text-foreground-muted shrink-0 bg-muted/30 px-3 py-1.5 rounded-xl border border-border/60">
                    {formatTime(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
