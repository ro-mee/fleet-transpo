"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getDriverPerformanceReport } from "@/services/report.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { Users, TrendingUp, AlertTriangle, Star } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export default function DriverPerformancePage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["driver-performance"],
    queryFn: () => getDriverPerformanceReport(),
  });

  const details = data?.details || [];
  const kpis = [
    { label: "Total Drivers", value: data?.totalDrivers ?? 0, icon: Users, tone: "primary" },
    { label: "Avg Performance Score", value: data?.avgScore ?? 0, icon: TrendingUp, tone: "success" },
    { label: "Drivers with Incidents", value: details.filter((d) => d.incidents > 0).length, icon: AlertTriangle, tone: "danger" },
    { label: "Top-Rated", value: details.filter((d) => d.rating >= 4).length, icon: Star, tone: "info" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Driver Performance Center" description="On-time rate, completed trips, incidents and performance scores per driver." />

      {isLoading ? (
        <StatsGridSkeleton count={4} gridClass="md:grid-cols-2 lg:grid-cols-4" />
      ) : (
        <StatGrid cols={4}>
          {kpis.map((k) => (
            <StatCard key={k.label} icon={k.icon} label={k.label} value={k.value} tone={k.tone} />
          ))}
        </StatGrid>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Driver Rankings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-foreground-muted">Loading…</div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-foreground-secondary">
              Could not load performance data.{" "}
              <button onClick={() => refetch()} className="text-primary hover:underline">
                Retry
              </button>
            </div>
          ) : details.length === 0 ? (
            <EmptyState icon={Users} title="No driver performance data" description="Completed trips will populate driver scores." className="py-16" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-foreground-muted">
                    <th className="px-5 py-3 font-medium">Driver</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Trips</th>
                    <th className="px-5 py-3 font-medium">On-time</th>
                    <th className="px-5 py-3 font-medium">Distance (km)</th>
                    <th className="px-5 py-3 font-medium">Incidents</th>
                    <th className="px-5 py-3 font-medium">Cost/km</th>
                    <th className="px-5 py-3 font-medium">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {details.map((d) => (
                    <tr key={d.driver_id} className="hover:bg-hover transition-colors">
                      <td className="px-5 py-3">
                        <Link href={`/drivers/${d.driver_id}`} className="font-medium text-foreground hover:underline">
                          {d.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3"><Badge variant="secondary">{d.driver_status || "—"}</Badge></td>
                      <td className="px-5 py-3 text-foreground">{d.total_trips}</td>
                      <td className="px-5 py-3 text-foreground">{(d.on_time_rate * 100).toFixed(0)}%</td>
                      <td className="px-5 py-3 text-foreground">{d.total_distance.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        {d.incidents > 0 ? <Badge variant="danger">{d.incidents}</Badge> : <span className="text-foreground-muted">0</span>}
                      </td>
                      <td className="px-5 py-3 text-foreground">${d.cost_per_km.toFixed(2)}</td>
                      <td className="px-5 py-3">
                        <Badge variant={d.performance_score >= 70 ? "success" : d.performance_score >= 40 ? "warning" : "danger"}>
                          {d.performance_score}
                        </Badge>
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
