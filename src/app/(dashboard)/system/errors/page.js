"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAppErrors, getAppError } from "@/services/errors.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";
import { cn } from "@/lib/utils";
import {
  Bug,
  RefreshCw,
  Search,
  RotateCcw,
  Download,
  ChevronDown,
  MonitorSmartphone,
  Server,
  Smartphone,
  Globe,
  Clock,
} from "lucide-react";
import Link from "next/link";

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sourceMeta(source) {
  switch (source) {
    case "server":
      return { icon: Server, label: "Server", badge: "bg-violet-50/90 text-violet-700 border-violet-200/70 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800/60" };
    case "web":
      return { icon: Globe, label: "Web", badge: "bg-sky-50/90 text-sky-700 border-sky-200/70 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60" };
    case "mobile":
      return { icon: Smartphone, label: "Mobile", badge: "bg-emerald-50/90 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60" };
    default:
      return { icon: MonitorSmartphone, label: source || "Unknown", badge: "" };
  }
}

function Stat({ label, value, hint }) {
  return (
    <Card className="rounded-2xl border-border/70">
      <CardContent className="px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground-muted">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-foreground-secondary">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function SystemErrorsPage() {
  useRequireRole();
  const [filters, setFilters] = useState({ source: "", from: "", to: "" });
  const [applied, setApplied] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["app-errors", applied],
    queryFn: () => getAppErrors({ ...applied, limit: 200 }),
  });

  const groups = data?.groups ?? [];
  const total = data?.total ?? 0;
  const occurrences = groups.reduce((sum, g) => sum + (Number(g.occurrences) || 0), 0);
  const latest = groups.length
    ? groups.reduce((a, b) => (new Date(a.last_seen) > new Date(b.last_seen) ? a : b)).last_seen
    : null;

  const applyFilters = () => {
    setApplied({ ...filters });
    setExpanded(null);
  };
  const resetFilters = () => {
    setFilters({ source: "", from: "", to: "" });
    setApplied({});
    setExpanded(null);
  };

  const [groupEvents, setGroupEvents] = useState({});
  const toggleGroup = async (fingerprint) => {
    if (expanded === fingerprint) {
      setExpanded(null);
      return;
    }
    setExpanded(fingerprint);
    if (groupEvents[fingerprint]) return;
    setGroupEvents((prev) => ({ ...prev, [fingerprint]: { loading: true, rows: [] } }));
    try {
      const res = await getAppErrors({ ...applied, fingerprint, limit: 50 });
      setGroupEvents((prev) => ({ ...prev, [fingerprint]: { loading: false, rows: res.events ?? [] } }));
    } catch {
      setGroupEvents((prev) => ({ ...prev, [fingerprint]: { loading: false, rows: [], failed: true } }));
    }
  };

  const openDetail = async (errorId) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await getAppError(errorId);
      setDetail(res.event ?? { loadFailed: true });
    } catch {
      setDetail({ loadFailed: true });
    } finally {
      setDetailLoading(false);
    }
  };

  const exportGroups = () => {
    exportToCSV(groups, "app-error-groups", [
      { label: "Fingerprint", key: "fingerprint" },
      { label: "Occurrences", key: "occurrences" },
      { label: "First seen", key: "first_seen" },
      { label: "Last seen", key: "last_seen" },
      { label: "Sample", key: "sample" },
    ]);
  };

  return (
    <div className="space-y-6 pb-12 w-full">
      <HeroHeader
        icon={Bug}
        title="Error Log"
        badge="System Health"
        description="Unexpected application and platform failures, grouped by occurrence. AI provider events live in AI Logs — this table only holds what no subsystem owns."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/settings/ai/logs"
              className="rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer inline-flex items-center border border-white/25 bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              View AI Logs
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={exportGroups}
              disabled={!groups.length}
              className="rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total events" value={isLoading ? "—" : total} hint="Unexpected failures recorded" />
        <Stat label="Occurrence groups" value={isLoading ? "—" : groups.length} hint="Distinct fingerprints (top 200)" />
        <Stat label="Latest occurrence" value={isLoading ? "—" : latest ? formatTime(latest) : "None"} hint={occurrences ? `${occurrences} grouped occurrences` : "Nothing recorded yet"} />
      </div>

      <Card className="rounded-3xl border-border/70 overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-sm font-bold">Filters</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[11px] font-semibold text-foreground-muted block mb-1">Source</label>
              <select
                value={filters.source}
                onChange={(e) => setFilters({ ...filters, source: e.target.value })}
                className="w-full rounded-2xl h-10 text-xs bg-surface border border-border/80 text-foreground px-3 font-semibold cursor-pointer outline-none focus:border-primary/60"
              >
                <option value="">All sources</option>
                <option value="server">Server</option>
                <option value="web">Web</option>
                <option value="mobile">Mobile</option>
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
            <Button variant="outline" onClick={resetFilters} className="rounded-full h-9 px-4 text-xs font-semibold cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset
            </Button>
            <Button
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-full h-9 px-4 text-xs font-semibold cursor-pointer ml-auto"
            >
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isFetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-border/70 overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="text-sm font-bold">Occurrences by fingerprint</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-16 w-full rounded-2xl" />
              <Skeleton className="h-16 w-full rounded-2xl" />
              <Skeleton className="h-16 w-full rounded-2xl" />
            </div>
          ) : isError ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-sm font-semibold text-danger">Error log is unavailable.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-full cursor-pointer">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={Bug}
              title="No application errors recorded"
              description="Unexpected server, web, or mobile failures will appear here grouped by occurrence."
              variant="waiting"
              size="compact"
            />
          ) : (
            <div className="divide-y divide-border/60">
              {groups.map((g) => {
                const fp = g.fingerprint;
                const isOpen = expanded === fp;
                const ge = groupEvents[fp];
                const sampleSource = String(fp).split("|")[0];
                const meta = sourceMeta(sampleSource);
                const SourceIcon = meta.icon;
                return (
                  <div key={fp}>
                    <button
                      onClick={() => toggleGroup(fp)}
                      className="w-full px-6 py-4 hover:bg-muted/40 transition-all flex items-center gap-3.5 text-left cursor-pointer"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background">
                        <SourceIcon className="h-4 w-4 text-foreground-secondary" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 flex-wrap">
                          <Badge className={cn("rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 border", meta.badge)}>
                            {meta.label}
                          </Badge>
                          <Badge variant="secondary" className="rounded-full px-3 py-0.5 text-[10px] font-bold tabular-nums shrink-0">
                            {g.occurrences} occurrence{g.occurrences === 1 ? "" : "s"}
                          </Badge>
                        </span>
                        <span className="mt-1 block truncate text-sm font-semibold text-foreground tracking-tight">
                          {g.sample || fp}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-foreground-muted">
                          <Clock className="h-3 w-3" />
                          First {formatTime(g.first_seen)} · Last {formatTime(g.last_seen)}
                        </span>
                      </span>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-foreground-muted transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="border-t border-border/60 bg-muted/20 px-6 py-3 space-y-2">
                        {!ge || ge.loading ? (
                          <div className="space-y-2 py-1">
                            <Skeleton className="h-12 w-full rounded-xl" />
                            <Skeleton className="h-12 w-full rounded-xl" />
                          </div>
                        ) : ge.failed ? (
                          <p className="text-xs text-danger font-medium py-2">
                            Could not load events.{" "}
                            <button onClick={() => toggleGroup(fp)} className="underline cursor-pointer">Retry</button>
                          </p>
                        ) : ge.rows.length === 0 ? (
                          <p className="text-xs text-foreground-muted py-2">No events in this window.</p>
                        ) : (
                          ge.rows.map((ev) => (
                            <div key={ev.error_id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface px-4 py-2.5">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-semibold text-foreground">{ev.message}</p>
                                <p className="mt-0.5 text-[11px] text-foreground-muted font-data">
                                  {formatTime(ev.created_at)}
                                  {ev.route ? ` · ${ev.route}` : ""}
                                  {ev.reporter_email ? ` · ${ev.reporter_email}` : ""}
                                </p>
                              </div>
                              {ev.has_stack ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openDetail(ev.error_id)}
                                  className="rounded-full h-8 px-3.5 text-[11px] font-semibold shrink-0 cursor-pointer"
                                >
                                  Stack
                                </Button>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detail !== null || detailLoading} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Error detail</DialogTitle>
            <DialogDescription>
              {detail && !detail.loadFailed
                ? `${detail.source} · ${detail.route || "unknown route"} · ${formatTime(detail.created_at)}`
                : detailLoading
                  ? "Loading…"
                  : "Could not load this event."}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-3">
            {detailLoading && !detail ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : detail && !detail.loadFailed ? (
              <>
                <p className="text-sm font-semibold text-foreground break-words">{detail.message}</p>
                {detail.reporter_email ? (
                  <p className="text-xs text-foreground-secondary">Reported by {detail.reporter_email}</p>
                ) : null}
                <pre className="max-h-80 overflow-auto rounded-2xl border border-border/60 bg-muted/30 p-4 text-[11px] leading-relaxed font-data whitespace-pre-wrap break-words">
                  {detail.stack || "No stack recorded."}
                </pre>
                <p className="text-[11px] text-foreground-muted font-data break-all">{detail.fingerprint}</p>
              </>
            ) : (
              <p className="text-sm text-danger font-medium">Could not load this event.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
