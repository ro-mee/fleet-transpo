"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getFleetUtilizationReport,
  getFuelConsumptionReport,
  getMaintenanceReport,
  getDriverPerformanceReport,
  getFinancialSummary,
} from "@/services/report.service";
import { formatCurrency, formatDistance } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import {
  BarChart3, Truck, Fuel, Wrench, Users, DollarSign,
  CalendarDays,
} from "lucide-react";

const reportTypes = [
  { id: "fleet", label: "Fleet Utilization", icon: Truck },
  { id: "fuel", label: "Fuel Consumption", icon: Fuel },
  { id: "maintenance", label: "Maintenance Cost", icon: Wrench },
  { id: "drivers", label: "Driver Performance", icon: Users },
  { id: "financial", label: "Financial Summary", icon: DollarSign },
];

export default function ReportsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);
  const [selectedReport, setSelectedReport] = useState("fleet");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });

  const { data: fleetReport } = useQuery({
    queryKey: ["report-fleet", dateRange],
    queryFn: () => getFleetUtilizationReport(dateRange.from || undefined, dateRange.to || undefined),
    enabled: selectedReport === "fleet",
  });

  const { data: fuelReport } = useQuery({
    queryKey: ["report-fuel", dateRange],
    queryFn: () => getFuelConsumptionReport(dateRange.from || undefined, dateRange.to || undefined),
    enabled: selectedReport === "fuel",
  });

  const { data: maintReport } = useQuery({
    queryKey: ["report-maintenance", dateRange],
    queryFn: () => getMaintenanceReport(dateRange.from || undefined, dateRange.to || undefined),
    enabled: selectedReport === "maintenance",
  });

  const { data: driverReport } = useQuery({
    queryKey: ["report-drivers", dateRange],
    queryFn: () => getDriverPerformanceReport(dateRange.from || undefined, dateRange.to || undefined),
    enabled: selectedReport === "drivers",
  });

  const { data: financialReport } = useQuery({
    queryKey: ["report-financial", dateRange],
    queryFn: () => getFinancialSummary(dateRange.from || undefined, dateRange.to || undefined),
    enabled: selectedReport === "financial",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        description="Operational reports across fleet utilization, fuel, maintenance, drivers, and cost."
        actions={
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-foreground-secondary">
              <CalendarDays className="w-4 h-4" />
              From
            </span>
            <Input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange((p) => ({ ...p, from: e.target.value }))}
              className="w-40 h-9"
            />
            <span className="text-foreground-muted text-xs">to</span>
            <Input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange((p) => ({ ...p, to: e.target.value }))}
              className="w-40 h-9"
            />
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {reportTypes.map((rt) => (
          <Button
            key={rt.id}
            variant={selectedReport === rt.id ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedReport(rt.id)}
            className="h-9"
          >
            <rt.icon className="w-4 h-4 mr-1.5" />
            {rt.label}
          </Button>
        ))}
      </div>

      {selectedReport === "fleet" && fleetReport && (
        <div className="space-y-6">
          <StatGrid cols={3}>
            <StatCard icon={BarChart3} label="Fleet Utilization" value={`${fleetReport.utilization}%`} tone="success" />
            <StatCard icon={Truck} label="Total Trips" value={fleetReport.totalTrips} tone="primary" />
            <StatCard icon={Truck} label="Total Distance" value={formatDistance(fleetReport.totalDistance)} tone="info" />
          </StatGrid>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Trips by Vehicle</CardTitle>
            </CardHeader>
            <CardContent>
              {fleetReport.byVehicle.length === 0 ? (
                <EmptyState icon={BarChart3} title="No data for selected period" description="Adjust the date range to see trip distribution." />
              ) : (
                <div className="space-y-3">
                  {fleetReport.byVehicle.map((v) => {
                    const maxTrips = Math.max(...fleetReport.byVehicle.map((x) => x.trips));
                    return (
                      <div key={v.plate} className="flex items-center gap-4">
                        <span className="text-sm font-medium w-24 font-data">{v.plate}</span>
                        <ProgressBar className="flex-1" tone="primary" value={(v.trips / maxTrips) * 100} valueLabel={`${v.trips} trips`} />
                        <span className="text-xs text-foreground-muted w-24 text-right font-data">{formatDistance(v.distance)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {selectedReport === "fuel" && fuelReport && (
        <div className="space-y-6">
          <StatGrid cols={3}>
            <StatCard icon={Fuel} label="Total Fuel" value={`${fuelReport.totalLiters.toFixed(1)} L`} tone="primary" />
            <StatCard icon={DollarSign} label="Total Cost" value={formatCurrency(fuelReport.totalCost)} tone="warning" />
            <StatCard icon={Fuel} label="Avg Cost per Liter" value={`${formatCurrency(fuelReport.avgCost)}/L`} tone="info" />
          </StatGrid>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Monthly Fuel Consumption</CardTitle>
            </CardHeader>
            <CardContent>
              {fuelReport.monthlyData.length === 0 ? (
                <EmptyState icon={Fuel} title="No data for selected period" description="Adjust the date range to see consumption trends." />
              ) : (
                <div className="space-y-3">
                  {fuelReport.monthlyData.map((m) => {
                    const maxLiters = Math.max(...fuelReport.monthlyData.map((x) => x.liters));
                    return (
                      <ProgressBar
                        key={m.month}
                        tone="warning"
                        value={(m.liters / maxLiters) * 100}
                        label={`${m.month} · ${m.liters.toFixed(1)} L`}
                        valueLabel={formatCurrency(m.cost)}
                      />
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {selectedReport === "maintenance" && maintReport && (
        <div className="space-y-6">
          <StatGrid cols={2}>
            <StatCard icon={Wrench} label="Total Maintenance Cost" value={formatCurrency(maintReport.totalCost)} tone="danger" />
            <StatCard icon={BarChart3} label="Total Records" value={maintReport.totalRecords} tone="primary" />
          </StatGrid>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Cost by Type</CardTitle>
            </CardHeader>
            <CardContent>
              {maintReport.byType.length === 0 ? (
                <EmptyState icon={Wrench} title="No data for selected period" description="Adjust the date range to see maintenance costs." />
              ) : (
                <div className="space-y-3">
                  {maintReport.byType.map((t) => {
                    const maxCost = Math.max(...maintReport.byType.map((x) => x.cost));
                    return (
                      <ProgressBar
                        key={t.type}
                        tone="danger"
                        value={(t.cost / maxCost) * 100}
                        label={`${t.type} · ${t.count} record${t.count === 1 ? "" : "s"}`}
                        valueLabel={formatCurrency(t.cost)}
                      />
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {selectedReport === "drivers" && driverReport && (
        <div className="space-y-6">
          <StatGrid cols={2}>
            <StatCard icon={Users} label="Total Drivers" value={driverReport.totalDrivers} tone="primary" />
            <StatCard icon={BarChart3} label="Average Performance Score" value={`${driverReport.avgScore}/100`} tone="success" />
          </StatGrid>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Top Performing Drivers</CardTitle>
            </CardHeader>
            <CardContent>
              {driverReport.topDrivers.length === 0 ? (
                <EmptyState icon={Users} title="No performance data available" description="Driver scores will appear once trips are recorded." />
              ) : (
                <div className="space-y-3">
                  {driverReport.topDrivers.map((d, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <span className="text-sm font-bold text-foreground-muted w-6">#{i + 1}</span>
                      <span className="text-sm font-medium flex-1">{d.name}</span>
                      <ProgressBar className="w-40" tone="success" value={d.score} />
                      <span className="text-sm font-bold w-12 text-right font-data">{d.score}</span>
                      <span className="text-xs text-foreground-muted w-16 text-right">{d.trips} trips</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {selectedReport === "financial" && financialReport && (
        <div className="space-y-6">
          <StatGrid cols={4}>
            <StatCard icon={DollarSign} label="Total Operational Cost" value={formatCurrency(financialReport.totalCost)} tone="success" />
            <StatCard icon={Truck} label="Trip Costs" value={formatCurrency(financialReport.tripCost)} tone="primary" />
            <StatCard icon={Fuel} label="Fuel Costs" value={formatCurrency(financialReport.fuelCost)} tone="warning" />
            <StatCard icon={Wrench} label="Maintenance Costs" value={formatCurrency(financialReport.maintCost)} tone="danger" />
          </StatGrid>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Cost Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {financialReport.totalCost === 0 ? (
                <EmptyState icon={DollarSign} title="No cost data for selected period" description="Approved expenses will populate this breakdown." />
              ) : (
                <div className="space-y-4">
                  {[
                    { label: "Trip Costs", value: financialReport.tripCost, pct: (financialReport.tripCost / financialReport.totalCost) * 100, tone: "primary" },
                    { label: "Fuel Costs", value: financialReport.fuelCost, pct: (financialReport.fuelCost / financialReport.totalCost) * 100, tone: "warning" },
                    { label: "Maintenance Costs", value: financialReport.maintCost, pct: (financialReport.maintCost / financialReport.totalCost) * 100, tone: "danger" },
                  ].map((item) => (
                    <ProgressBar
                      key={item.label}
                      tone={item.tone}
                      value={item.pct}
                      label={`${item.label} · ${formatCurrency(item.value)}`}
                      valueLabel={`${Math.round(item.pct)}%`}
                    />
                  ))}
                  <div className="pt-4 border-t border-border space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground-secondary">Cost per km</span>
                      <span className="font-data font-semibold text-foreground">{formatCurrency(financialReport.costPerKm)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground-secondary">Total Distance</span>
                      <span className="font-data font-semibold text-foreground">{formatDistance(financialReport.totalDistance)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
