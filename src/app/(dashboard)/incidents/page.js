"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import Link from "next/link";
import { getAllIncidents } from "@/services/driver.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Truck, Wrench, AlertCircle } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

const SEVERITY_TONE = {
  Minor: "info",
  Moderate: "warning",
  Major: "warning",
  Critical: "danger",
};

export default function IncidentsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);

  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["all-incidents"],
    queryFn: () => getAllIncidents({ limit: 200 }),
  });

  const incidents = useMemo(() => [...(data || [])], [data]);

  const counts = useMemo(() => {
    const c = { Critical: 0, Major: 0, Moderate: 0, Minor: 0, Open: 0 };
    incidents.forEach((i) => {
      if (c[i.severity] != null) c[i.severity] += 1;
      if ((i.status || "").toLowerCase() === "open") c.Open += 1;
    });
    return c;
  }, [incidents]);

  const kpis = [
    { label: "Total Incidents", value: incidents.length, icon: AlertTriangle, tone: "primary" },
    { label: "Open", value: counts.Open, icon: AlertCircle, tone: "warning" },
    { label: "Critical / Major", value: counts.Critical + counts.Major, icon: Wrench, tone: "danger" },
    { label: "Breakdowns", value: incidents.filter((i) => /breakdown|mechanical|engine/i.test(i.incident_type || "")).length, icon: Truck, tone: "info" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Incidents" description="Driver-reported incidents across the fleet. Read-only." />

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
          <CardTitle className="text-base">All Incidents</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-foreground-muted">Loading…</div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-foreground-secondary">
              Could not load incidents.{" "}
              <button onClick={() => refetch()} className="text-primary hover:underline">
                Retry
              </button>
            </div>
          ) : incidents.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No incidents reported" description="Driver incident reports will appear here." className="py-16" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-foreground-muted">
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Driver</th>
                    <th className="px-5 py-3 font-medium">Vehicle</th>
                    <th className="px-5 py-3 font-medium">Severity</th>
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {incidents.map((inc) => (
                    <tr key={inc.incident_id} className="hover:bg-hover transition-colors align-top">
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">{inc.incident_type}</p>
                        {inc.location && <p className="text-xs text-foreground-muted truncate max-w-[200px]">{inc.location}</p>}
                        {inc.description && <p className="text-xs text-foreground-secondary mt-1 line-clamp-2 max-w-[300px]">{inc.description}</p>}
                      </td>
                      <td className="px-5 py-3">
                        {inc.driver ? (
                          <Link href={`/drivers/${inc.driver.driver_id}`} className="font-medium text-foreground hover:underline">
                            {inc.driver.first_name} {inc.driver.last_name}
                          </Link>
                        ) : (
                          <span className="text-foreground-muted">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {inc.vehicle_id ? (
                          <Link href={`/fleet/vehicles/${inc.vehicle_id}`} className="text-foreground hover:underline">
                            {inc.plate_number || `#${inc.vehicle_id}`}
                          </Link>
                        ) : (
                          <span className="text-foreground-muted">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge severity={SEVERITY_TONE[inc.severity] || "info"}>{inc.severity || "—"}</StatusBadge>
                      </td>
                      <td className="px-5 py-3 text-foreground">
                        {inc.incident_date ? new Date(inc.incident_date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={inc.status || "Open"} entity="reservation" /></td>
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
