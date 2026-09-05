"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditLogs } from "@/services/audit.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DatePicker } from "@/components/ui/date-picker";
import { getInitials } from "@/lib/utils";
import {
  ShieldCheck,
  RefreshCw,
  Filter,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ChevronLeft,
  ChevronRight,
  Search,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatResourceName(resource) {
  if (!resource) return "System Resource";
  return resource
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function actionTone(action) {
  const a = (action || "").toLowerCase();
  if (a === "create") return "success";
  if (a === "delete" || a === "cancel" || a === "reject") return "danger";
  if (a === "update" || a === "assign" || a === "approve" || a === "dispatch") return "warning";
  return "default";
}

const PAGE_SIZE = 10;

export default function SystemAuditPage() {
  const [filters, setFilters] = useState({ action: "", resource: "", from: "", to: "" });
  const [applied, setApplied] = useState({});
  const [quickFilter, setQuickFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", applied],
    queryFn: () => getAuditLogs(applied),
  });

  const logs = useMemo(() => data?.logs ?? [], [data]);
  const total = data?.total ?? 0;

  const applyFilters = () => {
    setApplied(filters);
    setCurrentPage(1);
  };

  const filteredLogs = useMemo(() => {
    if (quickFilter === "all") return logs;
    if (quickFilter === "create") return logs.filter((l) => (l.action || "").toLowerCase() === "create");
    if (quickFilter === "update") return logs.filter((l) => ["update", "assign", "approve", "dispatch"].includes((l.action || "").toLowerCase()));
    if (quickFilter === "delete") return logs.filter((l) => ["delete", "cancel", "reject"].includes((l.action || "").toLowerCase()));
    return logs;
  }, [logs, quickFilter]);

  // Reset page when quickFilter changes (render-adjust pattern).
  const [prevQuickFilter, setPrevQuickFilter] = useState(quickFilter);
  if (prevQuickFilter !== quickFilter) {
    setPrevQuickFilter(quickFilter);
    setCurrentPage(1);
  }

  const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE) || 1;
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLogs.slice(start, start + PAGE_SIZE);
  }, [filteredLogs, currentPage]);

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
        <button
          type="button"
          onClick={() => setQuickFilter("all")}
          className={cn(
            "p-5 rounded-3xl border bg-surface shadow-xs flex flex-col justify-between space-y-3 transition-all text-left cursor-pointer",
            quickFilter === "all" ? "border-primary ring-2 ring-primary/20" : "border-border/80 hover:border-primary/50"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wider">Total Audit Entries</span>
            <div className="p-2 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data">{total || logs.length}</div>
            <p className="text-[11px] text-primary font-medium mt-1">Logged mutations</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setQuickFilter("create")}
          className={cn(
            "p-5 rounded-3xl border bg-surface shadow-xs flex flex-col justify-between space-y-3 transition-all text-left cursor-pointer",
            quickFilter === "create" ? "border-success ring-2 ring-success/20" : "border-border/80 hover:border-success/50"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">Create Events</span>
            <div className="p-2 rounded-2xl bg-success/10 text-success border border-success/20">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data">{stats.creates}</div>
            <p className="text-[11px] text-success font-medium mt-1">New entity creations</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setQuickFilter("update")}
          className={cn(
            "p-5 rounded-3xl border bg-surface shadow-xs flex flex-col justify-between space-y-3 transition-all text-left cursor-pointer",
            quickFilter === "update" ? "border-warning ring-2 ring-warning/20" : "border-border/80 hover:border-warning/50"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">Updates &amp; Dispatches</span>
            <div className="p-2 rounded-2xl bg-warning/10 text-warning border border-warning/20">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data">{stats.updates}</div>
            <p className="text-[11px] text-warning font-medium mt-1">State &amp; assignment changes</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setQuickFilter("delete")}
          className={cn(
            "p-5 rounded-3xl border bg-surface shadow-xs flex flex-col justify-between space-y-3 transition-all text-left cursor-pointer",
            quickFilter === "delete" ? "border-danger ring-2 ring-danger/20" : "border-border/80 hover:border-danger/50"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground-secondary uppercase tracking-wider">Deletions &amp; Rejections</span>
            <div className="p-2 rounded-2xl bg-danger/10 text-danger border border-danger/20">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data">{stats.deletes}</div>
            <p className="text-[11px] text-danger font-semibold mt-1">System deletions / cancellations</p>
          </div>
        </button>
      </div>

      {/* ── HIGH-CONTRAST SMART SELECT FILTER CARD ── */}
      <Card className="border border-border/80 shadow-xs rounded-3xl p-5 bg-surface">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wider">
              <Filter className="w-4 h-4 text-primary" /> Filter Audit Trail
            </div>

            {/* ── HIGH-CONTRAST QUICK TABS ── */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setQuickFilter("all")}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border shadow-2xs",
                  quickFilter === "all"
                    ? "bg-foreground text-background border-foreground"
                    : "bg-muted/40 border-border/60 text-foreground-secondary hover:text-foreground hover:bg-muted font-medium"
                )}
              >
                All Logs ({logs.length})
              </button>
              <button
                type="button"
                onClick={() => setQuickFilter("create")}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border shadow-2xs",
                  quickFilter === "create"
                    ? "bg-success text-white border-success"
                    : "bg-muted/40 border-border/60 text-foreground-secondary hover:text-foreground hover:bg-muted font-medium"
                )}
              >
                Creates ({stats.creates})
              </button>
              <button
                type="button"
                onClick={() => setQuickFilter("update")}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border shadow-2xs",
                  quickFilter === "update"
                    ? "bg-warning text-white border-warning"
                    : "bg-muted/40 border-border/60 text-foreground-secondary hover:text-foreground hover:bg-muted font-medium"
                )}
              >
                Updates ({stats.updates})
              </button>
              <button
                type="button"
                onClick={() => setQuickFilter("delete")}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border shadow-2xs",
                  quickFilter === "delete"
                    ? "bg-danger text-white border-danger"
                    : "bg-muted/40 border-border/60 text-foreground-secondary hover:text-foreground hover:bg-muted font-medium"
                )}
              >
                Deletions ({stats.deletes})
              </button>
            </div>
          </div>

          {/* ── SMART SELECT FILTERS ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">Action Type</label>
              <select
                value={filters.action}
                onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                className="w-full rounded-2xl h-10 text-xs bg-surface border border-border/80 text-foreground px-3 font-semibold cursor-pointer outline-none focus:border-primary/60"
              >
                <option value="">All Actions</option>
                <option value="create">CREATE</option>
                <option value="update">UPDATE</option>
                <option value="delete">DELETE</option>
                <option value="assign">ASSIGN</option>
                <option value="dispatch">DISPATCH</option>
                <option value="reject">REJECT</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">Target Resource</label>
              <select
                value={filters.resource}
                onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
                className="w-full rounded-2xl h-10 text-xs bg-surface border border-border/80 text-foreground px-3 font-semibold cursor-pointer outline-none focus:border-primary/60"
              >
                <option value="">All Resources</option>
                <option value="transportation_requests">Transportation Requests</option>
                <option value="driver_assignments">Driver Assignments</option>
                <option value="fuel_logs">Fuel Logs</option>
                <option value="vehicles">Vehicles</option>
                <option value="trips">Trips</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">Start Date</label>
              <DatePicker
                value={filters.from}
                onChange={(val) => setFilters({ ...filters, from: val })}
                placeholder="Pick start date..."
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">End Date</label>
              <DatePicker
                value={filters.to}
                onChange={(val) => setFilters({ ...filters, to: val })}
                placeholder="Pick end date..."
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={applyFilters} className="rounded-full h-9 px-5 text-xs font-semibold shadow-2xs cursor-pointer">
              <Search className="w-3.5 h-3.5 mr-1.5" /> Apply Filters
            </Button>
            <Button
              variant="outline"
              onClick={() => { setFilters({ action: "", resource: "", from: "", to: "" }); setApplied({}); setQuickFilter("all"); setCurrentPage(1); }}
              className="rounded-full h-9 px-4 text-xs font-semibold cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset
            </Button>
            <span className="ml-auto text-xs font-semibold text-foreground-muted font-data">{filteredLogs.length} Filtered Entries</span>
          </div>
        </div>
      </Card>

      {/* ── AUDIT EVENT LOGS LIST CARD WITH HIGH-CONTRAST PAGINATION ── */}
      <Card className="border border-border/80 shadow-xs rounded-3xl overflow-hidden bg-surface flex flex-col">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <FileText className="w-4 h-4 text-primary" /> Audit Stream Logs
          </CardTitle>
          <span className="text-xs font-semibold text-foreground-muted font-data">
            Showing Page {currentPage} of {totalPages}
          </span>
        </CardHeader>

        <CardContent className="p-0 flex-1">
          {isLoading ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-14 w-full rounded-2xl" />
              <Skeleton className="h-14 w-full rounded-2xl" />
              <Skeleton className="h-14 w-full rounded-2xl" />
            </div>
          ) : paginatedLogs.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No audit entries found"
              description="Tracked system mutations will appear here as actions are executed."
              variant="waiting"
              size="compact"
            />
          ) : (
            <div className="divide-y divide-border/60">
              {paginatedLogs.map((log) => {
                const userFullName = log.first_name && log.last_name
                  ? `${log.first_name} ${log.last_name}`
                  : log.email || `Employee #${log.employee_id ?? "?"}`;

                return (
                  <div key={log.log_id} className="px-6 py-4 hover:bg-muted/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <Avatar className="h-9 w-9 shrink-0 border border-border/60">
                        <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                          {getInitials(userFullName)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <Badge variant={actionTone(log.action)} className="rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0">
                            {log.action}
                          </Badge>
                          <span className="text-sm font-bold text-foreground tracking-tight">
                            {formatResourceName(log.resource)}
                          </span>
                          {log.resource_id != null && (
                            <span className="text-xs font-semibold font-data text-foreground-muted bg-muted/80 px-2.5 py-0.5 rounded-xl border border-border/60">
                              #{log.resource_id}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-foreground-secondary font-medium mt-1 flex items-center gap-1.5 flex-wrap">
                          <span>Executed by</span>
                          <span className="font-semibold text-foreground bg-muted/40 px-2 py-0.5 rounded-lg border border-border/40">
                            {userFullName}
                          </span>
                          {log.ip_address && (
                            <span className="text-[11px] font-data text-foreground-muted bg-muted/30 px-2 py-0.5 rounded-lg border border-border/40">
                              IP: {log.ip_address}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right sm:text-right">
                      <span className="text-xs font-semibold font-data text-foreground-secondary bg-muted/40 px-3.5 py-1.5 rounded-xl border border-border/60 inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-primary" />
                        {formatTime(log.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>

        {/* ── HIGH-CONTRAST PAGINATION FOOTER BAR ── */}
        {!isLoading && filteredLogs.length > 0 && (
          <div className="p-4 border-t border-border/60 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs font-semibold text-foreground-muted font-data">
              Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filteredLogs.length)} to{" "}
              {Math.min(currentPage * PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length} entries
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-8 px-3 text-xs font-semibold rounded-xl cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                  .map((p, idx, arr) => {
                    const prev = arr[idx - 1];
                    const showEllipsis = prev && p - prev > 1;
                    return (
                      <span key={p} className="flex items-center gap-1">
                        {showEllipsis && <span className="px-1 text-xs text-foreground-muted">...</span>}
                        <button
                          type="button"
                          onClick={() => setCurrentPage(p)}
                          className={cn(
                            "h-8 w-8 rounded-xl text-xs font-bold transition-all cursor-pointer border shadow-2xs",
                            currentPage === p
                              ? "bg-foreground text-background border-foreground font-black"
                              : "bg-surface text-foreground-secondary border-border/60 hover:border-primary/40 hover:text-foreground font-medium"
                          )}
                        >
                          {p}
                        </button>
                      </span>
                    );
                  })}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-8 px-3 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
