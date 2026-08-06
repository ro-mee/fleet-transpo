"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getUvvrpBoard } from "@/services/uvvrp.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";

const ACTION_TONE = {
  blocked: "danger",
  warned: "warning",
  pending_approval: "info",
  approved: "success",
  denied: "danger",
};

export default function UvvrpBoardPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["uvvrp-board", date],
    queryFn: () => getUvvrpBoard({ date }),
  });

  const restrictedToday = useMemo(() => data?.restrictedToday || [], [data]);
  const exemptions = useMemo(() => data?.exemptions || [], [data]);
  const upcoming = useMemo(() => data?.upcoming || [], [data]);
  const violations = useMemo(() => data?.violations || [], [data]);
  const dispatchesAffected = useMemo(() => data?.dispatchesAffected || [], [data]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const kpis = [
    {
      label: "Policy Status",
      value: data?.enabled ? "Active" : "Disabled",
      icon: ShieldCheck,
      tone: data?.enabled ? "success" : "danger",
      trend: data?.enabled ? "UVVRP Rule Enforcement Active" : "Coding Enforcement Off",
    },
    {
      label: "Restricted Vehicles",
      value: restrictedToday.filter((v) => !v.exempt).length,
      icon: Car,
      tone: "warning",
      trend: `Restricted on ${date}`,
    },
    {
      label: "Active Exemptions",
      value: exemptions.length,
      icon: CheckCircle2,
      tone: "info",
      trend: "Pre-approved fleet passes",
    },
    {
      label: "Coding Violations",
      value: violations.length,
      icon: AlertTriangle,
      tone: "danger",
      trend: `${dispatchesAffected.length} dispatches flagged`,
    },
  ];

  return (
    <div className="space-y-6 pb-6">
      {/* Header */}
      <PageHeader
        eyebrow="Compliance & Governance"
        title="Number Coding Board (UVVRP)"
        description="Unified Vehicle Volume Reduction Program rules, daily restrictions, and exemption overrides."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 px-3 py-1 text-xs">
              <MapPin className="w-3.5 h-3.5 text-primary" />
              {data?.location || "Metro Manila"}
            </Badge>
            <Badge variant="secondary" className="gap-1 px-3 py-1 text-xs capitalize">
              <ShieldCheck className="w-3.5 h-3.5 text-info" />
              Response: {data?.response || "Block"}
            </Badge>
          </div>
        }
      />

      {/* KPI Cards */}
      {isLoading ? (
        <StatsGridSkeleton count={4} gridClass="md:grid-cols-2 lg:grid-cols-4" />
      ) : (
        <StatGrid cols={4}>
          {kpis.map((k) => (
            <StatCard key={k.label} icon={k.icon} label={k.label} value={k.value} tone={k.tone} trend={k.trend} />
          ))}
        </StatGrid>
      )}

      {/* Main Grid Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Panel 1: Restricted Today */}
        <Card className="lg:col-span-1 shadow-xs border-border flex flex-col">
          <CardHeader className="flex-row items-center justify-between pb-3 border-b border-border/60">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Car className="h-4 w-4 text-warning" /> Restricted Vehicles
            </CardTitle>
            <div className="relative">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-8 rounded-lg border border-border bg-hover/50 px-2.5 text-xs text-foreground font-medium focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 flex flex-col justify-between">
            {isError ? (
              <div className="p-8 text-center text-sm text-foreground-secondary">
                Could not load restriction data.{" "}
                <button onClick={() => refetch()} className="text-primary hover:underline font-semibold">
                  Retry
                </button>
              </div>
            ) : restrictedToday.length === 0 ? (
              <div className="p-6 text-center text-foreground-muted my-auto">
                <div className="w-10 h-10 rounded-full bg-success/10 text-success flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <p className="text-xs font-bold text-foreground">No vehicles restricted</p>
                <p className="text-[11px] text-foreground-muted mt-1 max-w-[240px] mx-auto">
                  No fleet vehicles are restricted by number coding for <span className="font-semibold text-foreground">{date}</span>.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[380px] overflow-y-auto">
                {restrictedToday.map((v) => (
                  <div key={v.vehicle_id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-hover/50 transition-colors">
                    <div>
                      <p className="text-sm font-bold text-foreground font-data">{v.plate_number}</p>
                      <p className="text-[11px] text-foreground-muted capitalize">{v.vehicle_status || "Active"}</p>
                    </div>
                    {v.exempt ? (
                      <Badge variant="success" className="text-[10px]">Exempt</Badge>
                    ) : (
                      <Badge variant="danger" className="text-[10px]">Coding Restricted</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="p-3 bg-muted/20 border-t border-border/60 text-[11px] text-foreground-muted text-center">
              Selected Date: <span className="font-medium text-foreground">{date}</span>
            </div>
          </CardContent>
        </Card>

        {/* Panel 2: Upcoming Weekly Restrictions */}
        <Card className="lg:col-span-1 shadow-xs border-border flex flex-col">
          <CardHeader className="pb-3 border-b border-border/60">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Calendar className="h-4 w-4 text-primary" /> 7-Day Restriction Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            {upcoming.length === 0 ? (
              <EmptyState icon={Calendar} title="No restrictions scheduled" description="Upcoming coding windows will appear here." className="py-12" />
            ) : (
              <div className="divide-y divide-border/60 max-h-[380px] overflow-y-auto">
                {upcoming.map((u) => {
                  const isToday = u.date === todayStr;
                  const hasCoding = u.digits.length > 0;

                  return (
                    <div
                      key={u.date}
                      className={cn(
                        "flex items-center justify-between gap-3 px-4 py-2.5 transition-colors",
                        isToday ? "bg-primary/[0.04] font-medium" : "hover:bg-hover/40"
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          hasCoding ? "bg-warning" : "bg-foreground-muted/30"
                        )} />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className={cn("text-xs font-bold", isToday ? "text-primary" : "text-foreground")}>
                              {u.weekday}
                            </p>
                            {isToday && (
                              <Badge variant="primary" className="text-[9px] px-1 py-0 font-bold uppercase">
                                Today
                              </Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-foreground-muted">{u.date}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={cn(
                          "text-xs block font-bold",
                          hasCoding ? "text-warning-dark dark:text-warning" : "text-foreground-muted"
                        )}>
                          {hasCoding ? `Ends ${u.digits.join(", ")}` : "No Coding"}
                        </span>
                        <span className="text-[10px] text-foreground-muted block">
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

        {/* Panel 3: Approved Exemptions */}
        <Card className="lg:col-span-1 shadow-xs border-border flex flex-col">
          <CardHeader className="pb-3 border-b border-border/60">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-info" /> Approved Exemptions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            {exemptions.length === 0 ? (
              <div className="p-6 text-center text-foreground-muted my-auto">
                <div className="w-10 h-10 rounded-full bg-info/10 text-info flex items-center justify-center mx-auto mb-3">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <p className="text-xs font-bold text-foreground">No active exemptions</p>
                <p className="text-[11px] text-foreground-muted mt-1 max-w-[240px] mx-auto">
                  Exempted vehicles with approved coding passes will appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[380px] overflow-y-auto">
                {exemptions.map((ex) => (
                  <div key={ex.exemption_id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-hover/50 transition-colors">
                    <div>
                      <p className="text-sm font-bold text-foreground font-data">{ex.plate_number || `Vehicle #${ex.vehicle_id}`}</p>
                      <p className="text-[11px] text-foreground-muted capitalize">{ex.category || "Official Exemption"}</p>
                    </div>
                    <Badge variant="success" className="text-[10px]">Active Pass</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Violation History Table */}
      <Card className="shadow-xs border-border">
        <CardHeader className="pb-3 border-b border-border/60 flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-danger" /> Coding Violation &amp; Override Audit History
          </CardTitle>
          <Badge variant="outline" className="text-xs font-medium">
            {dispatchesAffected.length} Dispatches Flagged
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {violations.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No coding violations recorded" description="Coding enforcement events will appear here as dispatches occur." className="py-12" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-foreground-muted bg-muted/20">
                    <th className="px-5 py-3 font-semibold">Vehicle</th>
                    <th className="px-5 py-3 font-semibold">Weekday</th>
                    <th className="px-5 py-3 font-semibold">Ending Digit</th>
                    <th className="px-5 py-3 font-semibold">Scheduled Departure</th>
                    <th className="px-5 py-3 font-semibold">Action Taken</th>
                    <th className="px-5 py-3 font-semibold">Authorized By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {violations.map((v) => (
                    <tr key={v.violation_id} className="hover:bg-hover/50 transition-colors align-top">
                      <td className="px-5 py-3 font-bold text-foreground font-data">{v.plate_number || `Vehicle #${v.vehicle_id}`}</td>
                      <td className="px-5 py-3 text-foreground font-medium">{v.weekday || "—"}</td>
                      <td className="px-5 py-3 text-foreground">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-hover text-xs font-bold text-foreground">
                          {v.plate_digit ?? "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-foreground-secondary font-data">
                        {v.scheduled_departure ? new Date(v.scheduled_departure).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={v.action} entity="dispatch" />
                      </td>
                      <td className="px-5 py-3 text-xs">
                        {v.decided_by_user ? (
                          <span className="font-semibold text-foreground">{v.decided_by_user.first_name} {v.decided_by_user.last_name}</span>
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

