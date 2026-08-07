"use client";

import { useQuery } from "@tanstack/react-query";
import { getDriverPerformanceReport } from "@/services/report.service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HeroHeader } from "@/components/ui/hero-header";
import { DataTable } from "@/components/tables/data-table";
import { Users, TrendingUp, AlertTriangle, Star, Award, Eye } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useRouter } from "next/navigation";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

export default function DriverPerformancePage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);
  const router = useRouter();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["driver-performance"],
    queryFn: () => getDriverPerformanceReport(),
  });

  const details = data?.details || [];
  const kpis = [
    { label: "Total Drivers", value: data?.totalDrivers ?? 0, icon: Users, tone: "primary", trend: "active in fleet" },
    { label: "Avg Performance Score", value: data?.avgScore ?? 0, icon: TrendingUp, tone: "success", trend: "overall efficiency" },
    { label: "Drivers with Incidents", value: details.filter((d) => d.incidents > 0).length, icon: AlertTriangle, tone: "danger", trend: "requires monitoring" },
    { label: "Top-Rated Drivers", value: details.filter((d) => d.rating >= 4).length, icon: Star, tone: "info", trend: "4.0+ rating" },
  ];

  const columns = [
    {
      key: "name",
      label: "Driver",
      sortable: true,
      render: (val, row) => {
        const initials = val ? val.split(" ").map((n) => n[0]).join("").slice(0, 2) : "DR";
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs">
              {initials}
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">{val}</p>
              <p className="text-xs text-foreground-muted font-medium">Performance scorecard</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "driver_status",
      label: "Status",
      render: (val) => (
        <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-bold">
          {val || "—"}
        </Badge>
      ),
    },
    {
      key: "total_trips",
      label: "Trips",
      sortable: true,
      render: (val) => <span className="font-data font-bold text-foreground text-xs">{val || 0}</span>,
    },
    {
      key: "on_time_rate",
      label: "On-time",
      sortable: true,
      render: (val) => <span className="font-data font-bold text-foreground text-xs">{(Number(val || 0) * 100).toFixed(0)}%</span>,
    },
    {
      key: "total_distance",
      label: "Distance (km)",
      sortable: true,
      render: (val) => <span className="font-data font-bold text-foreground text-xs">{Number(val || 0).toLocaleString()} km</span>,
    },
    {
      key: "incidents",
      label: "Incidents",
      sortable: true,
      render: (val) =>
        val > 0 ? (
          <Badge variant="danger" className="rounded-full px-3 py-1 text-xs font-bold">
            {val}
          </Badge>
        ) : (
          <span className="text-foreground-muted font-data text-xs font-semibold">0</span>
        ),
    },
    {
      key: "cost_per_km",
      label: "Cost/km",
      sortable: true,
      render: (val) => <span className="font-data font-bold text-foreground text-xs">₱{Number(val || 0).toFixed(2)}</span>,
    },
    {
      key: "performance_score",
      label: "Score",
      sortable: true,
      render: (val) => {
        const score = Number(val || 0);
        return (
          <Badge
            variant={score >= 70 ? "success" : score >= 40 ? "warning" : "danger"}
            className="rounded-full px-3 py-1 text-xs font-black font-data"
          >
            {score}
          </Badge>
        );
      },
    },
    {
      key: "actions",
      label: "",
      render: (_, row) => (
        <div className="inline-flex items-center rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
          <Tooltip content="View Driver Profile">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
              onClick={() => router.push(`/drivers/${row.driver_id}`)}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <HeroHeader
        icon={Award}
        title="Driver Performance Center"
        badge="Analytics"
        description="On-time rate, completed trips, incidents and performance scores per driver."
      />

      {/* ── KPI Stat Cards Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div
              key={k.label}
              className="p-5 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3 select-none"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">{k.label}</span>
                <div className="p-2 rounded-2xl bg-primary/10 text-primary border border-primary/20">
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-3xl font-black text-foreground font-data">
                  {isLoading ? "..." : k.value}
                </div>
                <p className="text-[11px] font-semibold text-primary mt-1">
                  {k.trend}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Driver Rankings DataTable Card ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={details}
            pageSize={10}
            title="Driver Rankings & Scorecard"
            description={`${details.length} drivers evaluated in current performance period.`}
            icon={Award}
            context="Scorecard"
            searchPlaceholder="Search drivers by name..."
            isLoading={isLoading}
            onRowClick={(row) => router.push(`/drivers/${row.driver_id}`)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
