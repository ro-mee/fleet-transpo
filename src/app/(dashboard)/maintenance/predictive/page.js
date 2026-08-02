"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, TONE_CHIP } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { formatDate } from "@/lib/utils";
import { Wrench, AlertTriangle, CheckCircle2, CalendarDays, Gauge, Activity } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";

function riskTone(risk) {
  const r = (risk || "low").toLowerCase();
  if (r === "overdue" || r === "critical") return "danger";
  if (r === "high") return "warning";
  if (r === "medium") return "info";
  return "success";
}

export default function PredictiveMaintenancePage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const { data: predictions = [], isLoading } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });

  const overdue = predictions.filter((p) => p.risk === "overdue").length;
  const critical = predictions.filter((p) => p.risk === "critical").length;
  const high = predictions.filter((p) => p.risk === "high").length;
  const healthy = predictions.filter((p) => p.risk === "low").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI & Automation"
        title="Predictive Maintenance"
        description="AI-powered maintenance predictions and scheduling."
      />

      <StatGrid cols={4}>
        <StatCard icon={AlertTriangle} label="Overdue" value={overdue} tone="danger" trend="service window passed" />
        <StatCard icon={CalendarDays} label="Critical (7 days)" value={critical} tone="danger" trend="due within a week" />
        <StatCard icon={Activity} label="High (30 days)" value={high} tone="warning" trend="due within a month" />
        <StatCard icon={CheckCircle2} label="Healthy" value={healthy} tone="success" trend="in good standing" />
      </StatGrid>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Maintenance Predictions ({predictions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-4 p-4 rounded-lg border border-border/60">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : predictions.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No vehicles in the system"
              description="Add vehicles to receive AI-powered maintenance predictions and service scheduling."
            />
          ) : (
            <div className="space-y-2">
              {predictions.map((p) => {
                const tone = riskTone(p.risk);
                return (
                  <div key={p.vehicle_id} className="flex items-start gap-4 p-4 rounded-lg border border-border/60 bg-surface hover:shadow-sm transition-all">
                    <div className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg", TONE_CHIP[tone])}>
                      <Wrench className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-data text-sm font-semibold text-foreground">{p.plate_number}</h4>
                        <span className="text-xs text-foreground-muted">{p.vehicle_name}</span>
                        <StatusBadge status={p.risk} entity="risk" className="text-[11px]">
                          {p.risk === "overdue" ? "Overdue" : `${p.daysToService} days`}
                        </StatusBadge>
                      </div>
                      <p className="text-sm text-foreground-secondary mt-1 leading-relaxed">{p.recommendation}</p>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-foreground-muted">
                        <span className="flex items-center gap-1">
                          <Gauge className="w-3.5 h-3.5" /> {p.mileage?.toLocaleString()} km
                        </span>
                        {p.next_service_date && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-3.5 h-3.5" /> Next: {formatDate(p.next_service_date)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-28 flex-shrink-0">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="font-data text-sm font-semibold text-foreground">{p.score}/100</span>
                        <span className="text-[11px] text-foreground-muted">Health</span>
                      </div>
                      <ProgressBar value={p.score} tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "info" ? "info" : "success"} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
