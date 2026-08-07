"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import Link from "next/link";
import { getAllIncidents } from "@/services/driver.service";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { AlertTriangle, Truck, Wrench, AlertCircle, MapPin, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useRequireRole } from "@/lib/auth/role-guard";
import { HeroHeader } from "@/components/ui/hero-header";
import { DataTable } from "@/components/tables/data-table";
import { useRouter } from "next/navigation";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

const SEVERITY_VARIANT = {
  Minor: "info",
  Moderate: "warning",
  Major: "warning",
  Critical: "danger",
};

export default function IncidentsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "dispatcher", "management"]);
  const router = useRouter();

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

  const columns = [
    {
      key: "incident_type",
      label: "Incident Type",
      sortable: true,
      render: (val, row) => (
        <div>
          <p className="font-bold text-sm text-foreground">{val || "Incident"}</p>
          {row.location && (
            <p className="flex items-center gap-1 text-xs text-foreground-muted font-medium mt-0.5">
              <MapPin className="w-3 h-3 text-danger shrink-0" />
              <span className="truncate max-w-[200px]">{row.location}</span>
            </p>
          )}
          {row.description && (
            <p className="text-xs text-foreground-secondary mt-1 line-clamp-2 max-w-[300px]">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: "driver",
      label: "Driver",
      render: (_, row) => {
        const d = row.driver;
        if (!d) return <span className="text-xs text-foreground-muted italic font-medium">—</span>;
        const name = `${d.first_name || ""} ${d.last_name || ""}`.trim();
        const initials = [d.first_name?.[0], d.last_name?.[0]].filter(Boolean).join("").toUpperCase();
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs">
              {initials || "DR"}
            </div>
            <div>
              <Link href={`/drivers/${d.driver_id}`} className="font-bold text-sm text-foreground hover:text-primary transition-colors">
                {name}
              </Link>
              <p className="text-xs text-foreground-muted font-medium">Reporting driver</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "vehicle_id",
      label: "Vehicle",
      render: (val) =>
        val ? (
          <span className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
            #{val}
          </span>
        ) : (
          <span className="text-xs text-foreground-muted font-medium">—</span>
        ),
    },
    {
      key: "severity",
      label: "Severity",
      sortable: true,
      render: (val) => (
        <Badge variant={SEVERITY_VARIANT[val] || "secondary"} className="rounded-full px-3 py-1 text-xs font-bold">
          {val || "Minor"}
        </Badge>
      ),
    },
    {
      key: "reported_at",
      label: "Date",
      sortable: true,
      render: (val) => (
        <span className="font-data font-bold text-xs text-foreground">
          {val ? new Date(val).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (val) => <StatusBadge status={val || "Open"} entity="incident" className="rounded-full px-3 py-1 text-xs font-bold" />,
    },
  ];

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={AlertTriangle}
        title="Fleet Incidents Registry"
        badge="Driver Reports"
        description="Driver-reported incidents across the fleet. Read-only audit log."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 select-none">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Total Incidents</span>
            <div className="p-2 rounded-2xl bg-primary/10 text-primary border border-primary/20"><AlertTriangle className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{isLoading ? "-" : incidents.length}</div>
          </div>
        </div>

        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 select-none">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Open</span>
            <div className="p-2 rounded-2xl bg-warning/10 text-warning border border-warning/20"><AlertCircle className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{isLoading ? "-" : counts.Open}</div>
          </div>
        </div>

        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 select-none">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Critical / Major</span>
            <div className="p-2 rounded-2xl bg-danger/10 text-danger border border-danger/20"><Wrench className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{isLoading ? "-" : counts.Critical + counts.Major}</div>
          </div>
        </div>

        <div className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 select-none">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Breakdowns</span>
            <div className="p-2 rounded-2xl bg-info/10 text-info border border-info/20"><Truck className="w-4 h-4" /></div>
          </div>
          <div>
            <div className="text-3xl font-black text-foreground font-data">{isLoading ? "-" : incidents.filter((i) => /breakdown|mechanical|engine/i.test(i.incident_type || "")).length}</div>
          </div>
        </div>
      </div>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={incidents}
            pageSize={10}
            title="All Incidents Registry"
            description="Driver-reported incidents across the fleet."
            icon={AlertTriangle}
            context="Incidents Log"
            searchPlaceholder="Search incidents by type, location, or description..."
            isLoading={isLoading}
            emptyTitle="No incidents reported"
            emptyDescription="Driver incident reports will appear here."
          />
        </CardContent>
      </Card>
    </div>
  );
}
