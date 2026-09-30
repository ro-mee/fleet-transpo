"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditLogDetail, getAuditLogs } from "@/services/audit.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getInitials } from "@/lib/utils";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Filter,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatResourceName(resource) {
  if (!resource) return "System Resource";
  return resource.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function actionTone(action) {
  const value = (action || "").toLowerCase();
  if (value === "create") return "success";
  if (["delete", "cancel", "reject", "sensitive_access_denied"].includes(value)) return "danger";
  if (["update", "assign", "approve", "dispatch"].includes(value)) return "warning";
  return "default";
}

export default function SystemAuditPage() {
  const emptyFilters = { action: "", resource: "", from: "", to: "", employee_id: "" };
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState({});
  const [cursor, setCursor] = useState(null);
  const [cursorStack, setCursorStack] = useState([]);
  const [openId, setOpenId] = useState(null);
  const pageNumber = cursorStack.length + 1;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", applied, cursor],
    queryFn: () => getAuditLogs({ ...applied, cursor: cursor || undefined, limit: PAGE_SIZE }),
    refetchOnWindowFocus: false,
  });
  const logs = data?.logs ?? [];

  const detailQuery = useQuery({
    queryKey: ["audit-log-detail", openId],
    queryFn: () => getAuditLogDetail(openId),
    enabled: openId != null,
    refetchOnWindowFocus: false,
  });

  const applyFilters = () => {
    setApplied(Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "")));
    setCursor(null);
    setCursorStack([]);
    setOpenId(null);
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setApplied({});
    setCursor(null);
    setCursorStack([]);
    setOpenId(null);
  };

  const goNext = () => {
    if (!data?.nextCursor) return;
    setCursorStack((stack) => [...stack, cursor]);
    setCursor(data.nextCursor);
    setOpenId(null);
  };

  const goPrevious = () => {
    if (cursorStack.length === 0) return;
    setCursor(cursorStack[cursorStack.length - 1] || null);
    setCursorStack((stack) => stack.slice(0, -1));
    setOpenId(null);
  };

  return (
    <div className="space-y-6 pb-12 w-full">
      <HeroHeader
        icon={ShieldCheck}
        title="System Audit & Ledger Trail"
        badge="Compliance Ledger"
        description="Review recorded changes and security events across FleetOps."
        actions={(
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
        )}
      />

      <Card className="border border-border/80 shadow-xs rounded-3xl p-5 bg-surface">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wider">
              <Filter className="w-4 h-4 text-primary" /> Filter Audit Trail
            </div>
            <span className="text-xs text-foreground-muted">Pages load 25 entries at a time</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">Action Type</label>
              <Select
                value={filters.action || "all"}
                onValueChange={(value) => setFilters((current) => ({ ...current, action: value === "all" ? "" : value }))}
              >
                <SelectTrigger className="w-full rounded-2xl h-10 text-xs bg-surface border border-border/80 text-foreground px-3 font-semibold">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {(data?.actions ?? []).map((action) => <SelectItem key={action} value={action}>{action}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">Target Resource</label>
              <Select
                value={filters.resource || "all"}
                onValueChange={(value) => setFilters((current) => ({ ...current, resource: value === "all" ? "" : value }))}
              >
                <SelectTrigger className="w-full rounded-2xl h-10 text-xs bg-surface border border-border/80 text-foreground px-3 font-semibold">
                  <SelectValue placeholder="All Resources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Resources</SelectItem>
                  {(data?.resources ?? []).map((resource) => (
                    <SelectItem key={resource} value={resource}>{formatResourceName(resource)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">Actor Employee ID</label>
              <Input
                inputMode="numeric"
                value={filters.employee_id}
                onChange={(event) => setFilters((current) => ({ ...current, employee_id: event.target.value.replace(/\D/g, "") }))}
                placeholder="Any actor"
                className="rounded-2xl h-10 text-xs"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">Start Date</label>
              <DatePicker value={filters.from} onChange={(value) => setFilters((current) => ({ ...current, from: value }))} placeholder="Pick start date..." />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">End Date</label>
              <DatePicker value={filters.to} onChange={(value) => setFilters((current) => ({ ...current, to: value }))} placeholder="Pick end date..." />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={applyFilters} className="rounded-full h-9 px-5 text-xs font-semibold shadow-2xs cursor-pointer">
              <Search className="w-3.5 h-3.5 mr-1.5" /> Apply Filters
            </Button>
            <Button variant="outline" onClick={resetFilters} className="rounded-full h-9 px-4 text-xs font-semibold cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset
            </Button>
            <span className="ml-auto text-xs font-semibold text-foreground-muted font-data">{logs.length} entries on this page</span>
          </div>
        </div>
      </Card>

      <Card className="border border-border/80 shadow-xs rounded-3xl overflow-hidden bg-surface flex flex-col">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <FileText className="w-4 h-4 text-primary" /> Audit Stream Logs
          </CardTitle>
          <span className="text-xs font-semibold text-foreground-muted font-data">Page {pageNumber}</span>
        </CardHeader>

        <CardContent className="p-0 flex-1">
          {isLoading ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-14 w-full rounded-2xl" />
              <Skeleton className="h-14 w-full rounded-2xl" />
              <Skeleton className="h-14 w-full rounded-2xl" />
            </div>
          ) : isError ? (
            <div className="p-6 text-sm text-danger">Could not load audit entries: {error?.message || "Request failed"}</div>
          ) : logs.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No audit entries found" description="Try changing the filters or date range." variant="waiting" size="compact" />
          ) : (
            <div className="divide-y divide-border/60">
              {logs.map((log) => {
                const userFullName = log.first_name && log.last_name
                  ? `${log.first_name} ${log.last_name}`
                  : log.email || `Employee #${log.employee_id ?? "?"}`;
                const isOpen = openId === log.log_id;

                return (
                  <div key={log.log_id} className="px-6 py-4 hover:bg-muted/20 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <Avatar className="h-9 w-9 shrink-0 border border-border/60">
                          <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">{getInitials(userFullName)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <Badge variant={actionTone(log.action)} className="rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0">{log.action}</Badge>
                            <span className="text-sm font-bold text-foreground tracking-tight">{formatResourceName(log.resource)}</span>
                            {log.resource_id != null && (
                              <span className="text-xs font-semibold font-data text-foreground-muted bg-muted/80 px-2.5 py-0.5 rounded-xl border border-border/60">#{log.resource_id}</span>
                            )}
                          </div>
                          <p className="text-xs text-foreground-secondary font-medium mt-1 flex items-center gap-1.5 flex-wrap">
                            <span>Executed by</span>
                            <span className="font-semibold text-foreground bg-muted/40 px-2 py-0.5 rounded-lg border border-border/40">{userFullName}</span>
                            {log.ip_address && <span className="text-[11px] font-data text-foreground-muted bg-muted/30 px-2 py-0.5 rounded-lg border border-border/40">IP: {log.ip_address}</span>}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-3 shrink-0">
                        <span className="text-xs font-semibold font-data text-foreground-secondary bg-muted/40 px-3.5 py-1.5 rounded-xl border border-border/60 inline-flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-primary" /> {formatTime(log.created_at)}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-expanded={isOpen}
                          onClick={() => setOpenId(isOpen ? null : log.log_id)}
                          className="rounded-xl text-xs"
                        >
                          Details <ChevronDown className={cn("w-3.5 h-3.5 ml-1 transition-transform", isOpen && "rotate-180")} />
                        </Button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-4 ml-0 sm:ml-12 rounded-2xl border border-border/70 bg-muted/20 p-4">
                        {detailQuery.isLoading ? (
                          <Skeleton className="h-20 w-full rounded-xl" />
                        ) : detailQuery.isError ? (
                          <p className="text-xs text-danger">Could not load entry details: {detailQuery.error?.message || "Request failed"}</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div>
                              <h3 className="font-semibold mb-2">Before (redacted)</h3>
                              <pre className="whitespace-pre-wrap break-words rounded-xl bg-background p-3 text-[11px]">{JSON.stringify(detailQuery.data?.old_values ?? {}, null, 2)}</pre>
                            </div>
                            <div>
                              <h3 className="font-semibold mb-2">After (redacted)</h3>
                              <pre className="whitespace-pre-wrap break-words rounded-xl bg-background p-3 text-[11px]">{JSON.stringify(detailQuery.data?.new_values ?? {}, null, 2)}</pre>
                            </div>
                            <p className="md:col-span-2 text-[11px] text-foreground-muted">Sensitive, free-text, and oversized legacy fields are withheld.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>

        <div className="p-4 border-t border-border/60 bg-muted/20 flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-foreground-muted font-data">Page {pageNumber} · {logs.length} entries</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goPrevious} disabled={cursorStack.length === 0 || isFetching} className="h-8 px-3 text-xs font-semibold rounded-xl">
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            <Button variant="outline" size="sm" onClick={goNext} disabled={!data?.hasMore || isFetching} className="h-8 px-3 text-xs font-semibold rounded-xl">
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
