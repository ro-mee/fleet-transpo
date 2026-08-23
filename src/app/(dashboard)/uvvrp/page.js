"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { useMemo, useState } from "react";
import { getUvvrpBoard } from "@/services/uvvrp.service";
import { getUvvrpPolicy } from "@/services/settings.service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DatePicker } from "@/components/ui/date-picker";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
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
  const [date, setDate] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["uvvrp-board", date],
    queryFn: () => getUvvrpBoard(date ? { date } : {}),
  });

  // The board must tell the truth about enforcement: read the live policy
  // instead of hardcoding "Active" — an admin who disabled coding should see
  // that here, not a green badge that lies.
  const { data: policy } = useQuery({
    queryKey: ["uvvrp-policy"],
    queryFn: getUvvrpPolicy,
  });
  const policyEnabled = Boolean(policy?.enabled);

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
            className={cn("rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer", heroButtonOutlineClass)}
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
        <StatGrid cols={4}>
          <StatCard
            icon={ShieldCheck}
            label="Policy Status"
            value={policyEnabled ? "Active" : "Disabled"}
            trend={policyEnabled ? "UVVRP rule enforcement is on — dispatches are blocked for restricted plates" : "Coding rules are configured but NOT enforced"}
            tone={policyEnabled ? "success" : "neutral"}
          />
          <StatCard icon={Car} label="Restricted Vehicles" value={restrictedToday.filter((v) => !v.exempt).length} trend={`Restricted on ${date || todayStr}`} tone="warning" />
          <StatCard icon={CheckCircle2} label="Active Exemptions" value={exemptions.length} trend="Pre-approved fleet passes" tone="info" />
          <StatCard icon={AlertTriangle} label="Coding Violations" value={violations.length} trend={`${dispatchesAffected.length} dispatches flagged`} tone="danger" />
        </StatGrid>
      )}

      {/* ── MAIN 3-COLUMN PANELS GRID ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* PANEL 1: Restricted Vehicles (4 Cols) */}
        <Card className="lg:col-span-4 border-0 shadow-xs rounded-3xl overflow-hidden flex flex-col bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <Car className="w-4 h-4 text-warning" /> Restricted Vehicles
              </CardTitle>

              {/* Custom DatePicker without floating label */}
              <div className="w-[160px]">
                <DatePicker
                  id="uvvrp-date"
                  label={null}
                  value={date}
                  onChange={(val) => setDate(val || "")}
                  placeholder="Select Date..."
                  className="py-1 min-h-[36px] text-xs font-medium"
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
                <h4 className="text-sm font-semibold text-foreground">No Vehicles Restricted</h4>
                <p className="text-xs text-foreground-muted mt-1 max-w-[260px] mx-auto">
                  All active fleet vehicles are eligible for dispatch on <span className="font-semibold text-foreground">{date || todayStr}</span>.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {restrictedToday.map((v) => (
                  <div key={v.vehicle_id} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover/50 transition-colors">
                    <div>
                      <p className="text-sm font-semibold text-foreground font-data">{v.plate_number}</p>
                      <p className="text-xs text-foreground-muted capitalize font-normal">{v.vehicle_name || v.vehicle_status || "Active"}</p>
                    </div>
                    {v.exempt ? (
                      <Badge variant="success" className="text-[11px] font-medium px-2.5 py-0.5 rounded-full">Exempt Pass</Badge>
                    ) : (
                      <Badge variant="danger" className="text-[11px] font-medium px-2.5 py-0.5 rounded-full">Coding Restricted</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="p-3 bg-muted/20 border-t border-border/60 text-xs text-foreground-muted text-center font-medium">
              Selected Target: <span className="font-semibold text-foreground font-data">{date || todayStr}</span>
            </div>
          </CardContent>
        </Card>

        {/* PANEL 2: 7-Day Restriction Schedule (4 Cols) */}
        <Card className="lg:col-span-4 border-0 shadow-xs rounded-3xl overflow-hidden flex flex-col bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
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
                            <p className={cn("text-xs font-semibold", isToday ? "text-primary" : "text-foreground")}>
                              {u.weekday}
                            </p>
                            {isToday && (
                              <span className="bg-primary text-white dark:text-slate-950 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                Today
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-foreground-muted font-data">{u.date}</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className={cn(
                          "text-xs block font-semibold",
                          hasCoding ? "text-warning" : "text-foreground-muted"
                        )}>
                          {hasCoding ? `Ends ${u.digits.join(", ")}` : "No Coding"}
                        </span>
                        <span className="text-[11px] text-foreground-muted block font-normal">
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
        <Card className="lg:col-span-4 border-0 shadow-xs rounded-3xl overflow-hidden flex flex-col bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <ShieldCheck className="w-4 h-4 text-info" /> Approved Exemptions
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0 flex-1 min-h-[320px]">
            {exemptions.length === 0 ? (
              <div className="p-8 text-center my-auto">
                <div className="w-12 h-12 rounded-2xl bg-info/15 text-info border border-info/20 flex items-center justify-center mx-auto mb-3 shadow-xs">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-semibold text-foreground">No Active Exemptions</h4>
                <p className="text-xs text-foreground-muted mt-1 max-w-[260px] mx-auto">
                  Pre-approved fleet passes and special coding exemptions will appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {exemptions.map((ex) => (
                  <div key={ex.exemption_id} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover/50 transition-colors">
                    <div>
                      <p className="text-sm font-semibold text-foreground font-data">{ex.plate_number || `Vehicle #${ex.vehicle_id}`}</p>
                      <p className="text-xs text-foreground-muted capitalize font-normal">{ex.category || "Official Exemption Pass"}</p>
                    </div>
                    <Badge variant="success" className="text-[11px] font-medium px-2.5 py-0.5 rounded-full">Active Pass</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── AUDIT HISTORY TABLE ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden bg-surface">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <AlertTriangle className="w-4 h-4 text-danger" /> Coding Violation &amp; Override Audit History
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Historical record of dispatch attempts blocked or authorized during restriction windows.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs font-semibold rounded-full px-3 py-1">
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
                  <tr className="border-b border-border/60 text-left text-xs font-medium uppercase tracking-wider text-foreground-muted bg-surface/50">
                    <th className="px-5 py-3 font-medium">Vehicle Plate</th>
                    <th className="px-5 py-3 font-medium">Weekday</th>
                    <th className="px-5 py-3 font-medium">Plate Digit</th>
                    <th className="px-5 py-3 font-medium">Scheduled Departure</th>
                    <th className="px-5 py-3 font-medium">Action Taken</th>
                    <th className="px-5 py-3 font-medium">Authorized By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {violations.map((v) => (
                    <tr key={v.violation_id} className="hover:bg-hover/50 transition-colors align-middle">
                      <td className="px-5 py-3.5 font-semibold text-foreground font-data">{v.plate_number || `Vehicle #${v.vehicle_id}`}</td>
                      <td className="px-5 py-3.5 text-foreground font-medium">{v.weekday || "—"}</td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-hover border border-border/60 text-xs font-semibold text-foreground font-data">
                          {v.plate_digit ?? "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-foreground-secondary font-data font-medium">
                        {v.scheduled_departure ? new Date(v.scheduled_departure).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={v.action} entity="dispatch" />
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        {v.decided_by_user ? (
                          <span className="font-medium text-foreground flex items-center gap-1.5">
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
