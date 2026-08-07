"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { useMemo, useState } from "react";
import { getUvvrpBoard } from "@/services/uvvrp.service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DatePicker } from "@/components/ui/date-picker";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Car,
  ShieldCheck,
  AlertTriangle,
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  XCircle,
  FileCheck,
  RefreshCw,
  Sparkles,
  ShieldAlert,
  SlidersHorizontal,
  ChevronRight,
  UserCheck,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function UvvrpBoardPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["uvvrp-board", date],
    queryFn: () => getUvvrpBoard({ date }),
  });

  const restrictedToday = useMemo(() => data?.restrictedToday || [], [data]);
  const exemptions = useMemo(() => data?.exemptions || [], [data]);
  const upcoming = useMemo(() => data?.upcoming || [], [data]);
  const violations = useMemo(() => data?.violations || [], [data]);
  const dispatchesAffected = useMemo(() => data?.dispatchesAffected || [], [data]);

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* ── TOP HERO HEADER & CONTROL BAR ── */}
      <HeroHeader
        icon={ShieldCheck}
        title="Number Coding Board (UVVRP)"
        badge={data?.location || "Metro Manila"}
        description="Unified Vehicle Volume Reduction Program daily restrictions, 7-day windows, and exemption overrides."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className={cn("rounded-2xl h-10 px-4 text-xs font-semibold", heroButtonOutlineClass)}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-2", isFetching && "animate-spin")} />
            Sync Real-Time
          </Button>
        }
      />

      {/* ── KPI STAT CARDS ── */}
      {isLoading ? (
        <StatsGridSkeleton count={4} gridClass="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* KPI 1: Policy Status */}
          <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Policy Status</span>
              <div className="p-2 rounded-xl bg-success/10 text-success">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-foreground">Active</span>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success"></span>
                </span>
              </div>
              <p className="text-[11px] text-foreground-muted mt-1 font-medium">UVVRP Rule Enforcement Enabled</p>
            </div>
          </div>

          {/* KPI 2: Restricted Vehicles */}
          <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Restricted Vehicles</span>
              <div className="p-2 rounded-xl bg-warning/10 text-warning">
                <Car className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-black text-foreground font-data">
                {restrictedToday.filter((v) => !v.exempt).length}
              </div>
              <p className="text-[11px] text-warning font-semibold mt-1">Restricted on {date}</p>
            </div>
          </div>

          {/* KPI 3: Active Exemptions */}
          <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Active Exemptions</span>
              <div className="p-2 rounded-xl bg-info/10 text-info">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-black text-foreground font-data">
                {exemptions.length}
              </div>
              <p className="text-[11px] text-info font-medium mt-1">Pre-approved fleet passes</p>
            </div>
          </div>

          {/* KPI 4: Coding Violations */}
          <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Coding Violations</span>
              <div className="p-2 rounded-xl bg-danger/10 text-danger">
                <AlertTriangle className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl font-black text-foreground font-data">
                {violations.length}
              </div>
              <p className="text-[11px] text-danger font-semibold mt-1">{dispatchesAffected.length} dispatches flagged</p>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN 3-COLUMN PANELS GRID ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* PANEL 1: Restricted Vehicles (4 Cols) */}
        <Card className="lg:col-span-4 border-0 shadow-xs rounded-3xl overflow-hidden flex flex-col">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <Car className="w-4 h-4 text-warning" /> Restricted Vehicles
              </CardTitle>

              {/* Custom DatePicker */}
              <div className="w-[180px]">
                <DatePicker
                  id="uvvrp-date"
                  label="Target Date"
                  value={date}
                  onChange={(val) => val && setDate(val)}
                  className="py-1 min-h-[38px] text-xs"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0 flex-1 flex flex-col justify-between min-h-[320px]">
            {isError ? (
              <div className="p-8 text-center text-sm text-foreground-secondary">
                Could not load restriction data.{" "}
                <button onClick={() => refetch()} className="text-primary hover:underline font-semibold">
                  Retry
                </button>
              </div>
            ) : restrictedToday.length === 0 ? (
              <div className="p-8 text-center my-auto">
                <div className="w-12 h-12 rounded-2xl bg-success/15 text-success border border-success/20 flex items-center justify-center mx-auto mb-3 shadow-xs">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-extrabold text-foreground">No Vehicles Restricted</h4>
                <p className="text-xs text-foreground-muted mt-1 max-w-[260px] mx-auto">
                  All active fleet vehicles are eligible for dispatch on <span className="font-bold text-foreground">{date}</span>.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {restrictedToday.map((v) => (
                  <div key={v.vehicle_id} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover/50 transition-colors">
                    <div>
                      <p className="text-sm font-bold text-foreground font-data">{v.plate_number}</p>
                      <p className="text-xs text-foreground-muted capitalize">{v.vehicle_name || v.vehicle_status || "Active"}</p>
                    </div>
                    {v.exempt ? (
                      <Badge variant="success" className="text-[11px] font-bold px-2.5 py-0.5 rounded-full">Exempt Pass</Badge>
                    ) : (
                      <Badge variant="danger" className="text-[11px] font-bold px-2.5 py-0.5 rounded-full">Coding Restricted</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="p-3 bg-muted/20 border-t border-border/60 text-xs text-foreground-muted text-center font-medium">
              Selected Target: <span className="font-bold text-foreground">{date}</span>
            </div>
          </CardContent>
        </Card>

        {/* PANEL 2: 7-Day Restriction Schedule (4 Cols) */}
        <Card className="lg:col-span-4 border-0 shadow-xs rounded-3xl overflow-hidden flex flex-col">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Calendar className="w-4 h-4 text-primary" /> 7-Day Restriction Schedule
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0 flex-1 min-h-[320px]">
            {upcoming.length === 0 ? (
              <EmptyState icon={Calendar} title="No restrictions scheduled" description="Upcoming coding windows will appear here." className="py-12" />
            ) : (
              <div className="divide-y divide-border/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {upcoming.map((u) => {
                  const isToday = u.date === todayStr;
                  const hasCoding = u.digits.length > 0;

                  return (
                    <div
                      key={u.date}
                      className={cn(
                        "flex items-center justify-between gap-3 px-4 py-2.5 transition-colors",
                        isToday ? "bg-primary/10 border-l-4 border-l-primary font-medium" : "hover:bg-hover/40"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-2.5 h-2.5 rounded-full shrink-0",
                          hasCoding ? "bg-warning" : "bg-foreground-muted/30"
                        )} />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className={cn("text-xs font-extrabold", isToday ? "text-primary" : "text-foreground")}>
                              {u.weekday}
                            </p>
                            {isToday && (
                              <span className="bg-primary text-white dark:text-slate-950 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                                Today
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-foreground-muted font-data">{u.date}</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className={cn(
                          "text-xs block font-extrabold",
                          hasCoding ? "text-warning" : "text-foreground-muted"
                        )}>
                          {hasCoding ? `Ends ${u.digits.join(", ")}` : "No Coding"}
                        </span>
                        <span className="text-[11px] text-foreground-muted block font-medium">
                          {u.restrictedCount} vehicle{u.restrictedCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* PANEL 3: Approved Exemptions (4 Cols) */}
        <Card className="lg:col-span-4 border-0 shadow-xs rounded-3xl overflow-hidden flex flex-col">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <ShieldCheck className="w-4 h-4 text-info" /> Approved Exemptions
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0 flex-1 min-h-[320px]">
            {exemptions.length === 0 ? (
              <div className="p-8 text-center my-auto">
                <div className="w-12 h-12 rounded-2xl bg-info/15 text-info border border-info/20 flex items-center justify-center mx-auto mb-3 shadow-xs">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-extrabold text-foreground">No Active Exemptions</h4>
                <p className="text-xs text-foreground-muted mt-1 max-w-[260px] mx-auto">
                  Pre-approved fleet passes and special coding exemptions will appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {exemptions.map((ex) => (
                  <div key={ex.exemption_id} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover/50 transition-colors">
                    <div>
                      <p className="text-sm font-bold text-foreground font-data">{ex.plate_number || `Vehicle #${ex.vehicle_id}`}</p>
                      <p className="text-xs text-foreground-muted capitalize">{ex.category || "Official Exemption Pass"}</p>
                    </div>
                    <Badge variant="success" className="text-[11px] font-bold px-2.5 py-0.5 rounded-full">Active Pass</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── AUDIT HISTORY TABLE ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
              <AlertTriangle className="w-4 h-4 text-danger" /> Coding Violation &amp; Override Audit History
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Historical record of dispatch attempts blocked or authorized during restriction windows.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs font-bold rounded-full px-3 py-1">
            {dispatchesAffected.length} Flagged Events
          </Badge>
        </CardHeader>

        <CardContent className="p-0">
          {violations.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No coding violations recorded" description="Coding enforcement events will appear here as dispatches occur." className="py-12" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-bold uppercase tracking-wider text-foreground-muted bg-surface/50">
                    <th className="px-5 py-3 font-bold">Vehicle Plate</th>
                    <th className="px-5 py-3 font-bold">Weekday</th>
                    <th className="px-5 py-3 font-bold">Plate Digit</th>
                    <th className="px-5 py-3 font-bold">Scheduled Departure</th>
                    <th className="px-5 py-3 font-bold">Action Taken</th>
                    <th className="px-5 py-3 font-bold">Authorized By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {violations.map((v) => (
                    <tr key={v.violation_id} className="hover:bg-hover/50 transition-colors align-middle">
                      <td className="px-5 py-3.5 font-bold text-foreground font-data">{v.plate_number || `Vehicle #${v.vehicle_id}`}</td>
                      <td className="px-5 py-3.5 text-foreground font-semibold">{v.weekday || "—"}</td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-hover border border-border text-xs font-extrabold text-foreground font-data">
                          {v.plate_digit ?? "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-foreground-secondary font-data font-semibold">
                        {v.scheduled_departure ? new Date(v.scheduled_departure).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={v.action} entity="dispatch" />
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        {v.decided_by_user ? (
                          <span className="font-semibold text-foreground flex items-center gap-1.5">
                            <UserCheck className="w-3.5 h-3.5 text-primary" />
                            {v.decided_by_user.first_name} {v.decided_by_user.last_name}
                          </span>
                        ) : (
                          <span className="text-foreground-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
