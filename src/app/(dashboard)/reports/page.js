"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getFleetUtilizationReport,
  getFuelConsumptionReport,
  getMaintenanceReport,
  getDriverPerformanceReport,
  getFinancialSummary,
} from "@/services/report.service";
import { formatCurrency, formatDistance } from "@/lib/utils";
import {
  BarChart3, Truck, Fuel, Wrench, Users, DollarSign,
  Download, CalendarDays, TrendingUp, PieChart,
} from "lucide-react";

const reportTypes = [
  { id: "fleet", label: "Fleet Utilization", icon: Truck, color: "text-primary", bg: "bg-primary/10" },
  { id: "fuel", label: "Fuel Consumption", icon: Fuel, color: "text-warning", bg: "bg-warning/10" },
  { id: "maintenance", label: "Maintenance Cost", icon: Wrench, color: "text-danger", bg: "bg-danger/10" },
  { id: "drivers", label: "Driver Performance", icon: Users, color: "text-info", bg: "bg-info/10" },
  { id: "financial", label: "Financial Summary", icon: DollarSign, color: "text-success", bg: "bg-success/10" },
];

export default function ReportsPage() {
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

  const active = reportTypes.find((r) => r.id === selectedReport);
  const Icon = active?.icon || BarChart3;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-foreground-secondary mt-1">Generate and export operational reports</p>
        </div>
        <Button variant="outline" className="h-10">
          <Download className="w-4 h-4 mr-2" />
          Export PDF
        </Button>
      </div>

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

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-foreground-secondary">
          <CalendarDays className="w-4 h-4" />
          <span>From:</span>
        </div>
        <Input
          type="date"
          value={dateRange.from}
          onChange={(e) => setDateRange((p) => ({ ...p, from: e.target.value }))}
          className="w-44 h-9"
        />
        <span className="text-foreground-muted text-sm">to</span>
        <Input
          type="date"
          value={dateRange.to}
          onChange={(e) => setDateRange((p) => ({ ...p, to: e.target.value }))}
          className="w-44 h-9"
        />
      </div>

      {selectedReport === "fleet" && fleetReport && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{fleetReport.utilization}%</p>
                <p className="text-xs text-foreground-muted">Fleet Utilization</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{fleetReport.totalTrips}</p>
                <p className="text-xs text-foreground-muted">Total Trips</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{formatDistance(fleetReport.totalDistance)}</p>
                <p className="text-xs text-foreground-muted">Total Distance</p>
              </CardContent>
            </Card>
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Trips by Vehicle</CardTitle>
            </CardHeader>
            <CardContent>
              {fleetReport.byVehicle.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-4">No data for selected period</p>
              ) : (
                <div className="space-y-3">
                  {fleetReport.byVehicle.map((v) => (
                    <div key={v.plate} className="flex items-center gap-4">
                      <span className="text-sm font-medium w-24">{v.plate}</span>
                      <div className="flex-1 bg-muted rounded-full h-2.5">
                        <div className="bg-primary h-2.5 rounded-full" style={{ width: `${Math.min((v.trips / Math.max(...fleetReport.byVehicle.map((x) => x.trips))) * 100, 100)}%` }} />
                      </div>
                      <span className="text-xs text-foreground-muted w-20 text-right">{v.trips} trips</span>
                      <span className="text-xs text-foreground-muted w-24 text-right">{formatDistance(v.distance)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {selectedReport === "fuel" && fuelReport && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{fuelReport.totalLiters.toFixed(1)} L</p>
                <p className="text-xs text-foreground-muted">Total Fuel</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{formatCurrency(fuelReport.totalCost)}</p>
                <p className="text-xs text-foreground-muted">Total Cost</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{formatCurrency(fuelReport.avgCost)}/L</p>
                <p className="text-xs text-foreground-muted">Avg Cost per Liter</p>
              </CardContent>
            </Card>
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Monthly Fuel Consumption</CardTitle>
            </CardHeader>
            <CardContent>
              {fuelReport.monthlyData.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-4">No data for selected period</p>
              ) : (
                <div className="space-y-3">
                  {fuelReport.monthlyData.map((m) => {
                    const maxLiters = Math.max(...fuelReport.monthlyData.map((x) => x.liters));
                    return (
                      <div key={m.month}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium">{m.month}</span>
                          <span className="text-foreground-muted">{formatCurrency(m.cost)}</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5">
                          <div className="bg-warning h-2.5 rounded-full" style={{ width: `${(m.liters / maxLiters) * 100}%` }} />
                        </div>
                        <div className="text-xs text-foreground-muted mt-0.5">{m.liters.toFixed(1)} L</div>
                      </div>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{formatCurrency(maintReport.totalCost)}</p>
                <p className="text-xs text-foreground-muted">Total Maintenance Cost</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{maintReport.totalRecords}</p>
                <p className="text-xs text-foreground-muted">Total Records</p>
              </CardContent>
            </Card>
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Cost by Type</CardTitle>
            </CardHeader>
            <CardContent>
              {maintReport.byType.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-4">No data for selected period</p>
              ) : (
                <div className="space-y-3">
                  {maintReport.byType.map((t) => {
                    const maxCost = Math.max(...maintReport.byType.map((x) => x.cost));
                    return (
                      <div key={t.type}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium">{t.type}</span>
                          <span className="text-foreground-muted">{formatCurrency(t.cost)} ({t.count})</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5">
                          <div className="bg-danger h-2.5 rounded-full" style={{ width: `${(t.cost / maxCost) * 100}%` }} />
                        </div>
                      </div>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{driverReport.totalDrivers}</p>
                <p className="text-xs text-foreground-muted">Total Drivers</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{driverReport.avgScore}/100</p>
                <p className="text-xs text-foreground-muted">Average Performance Score</p>
              </CardContent>
            </Card>
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Top Performing Drivers</CardTitle>
            </CardHeader>
            <CardContent>
              {driverReport.topDrivers.length === 0 ? (
                <p className="text-sm text-foreground-muted text-center py-4">No performance data available</p>
              ) : (
                <div className="space-y-3">
                  {driverReport.topDrivers.map((d, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <span className="text-sm font-bold text-foreground-muted w-6">#{i + 1}</span>
                      <span className="text-sm font-medium flex-1">{d.name}</span>
                      <div className="w-32 bg-muted rounded-full h-2.5">
                        <div className="bg-success h-2.5 rounded-full" style={{ width: `${d.score}%` }} />
                      </div>
                      <span className="text-sm font-bold w-12 text-right">{d.score}</span>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{formatCurrency(financialReport.totalCost)}</p>
                <p className="text-xs text-foreground-muted">Total Operational Cost</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{formatCurrency(financialReport.tripCost)}</p>
                <p className="text-xs text-foreground-muted">Trip Costs</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{formatCurrency(financialReport.fuelCost)}</p>
                <p className="text-xs text-foreground-muted">Fuel Costs</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{formatCurrency(financialReport.maintCost)}</p>
                <p className="text-xs text-foreground-muted">Maintenance Costs</p>
              </CardContent>
            </Card>
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Cost Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { label: "Trip Costs", value: financialReport.tripCost, pct: financialReport.totalCost ? (financialReport.tripCost / financialReport.totalCost) * 100 : 0, color: "bg-primary" },
                  { label: "Fuel Costs", value: financialReport.fuelCost, pct: financialReport.totalCost ? (financialReport.fuelCost / financialReport.totalCost) * 100 : 0, color: "bg-warning" },
                  { label: "Maintenance Costs", value: financialReport.maintCost, pct: financialReport.totalCost ? (financialReport.maintCost / financialReport.totalCost) * 100 : 0, color: "bg-danger" },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{item.label}</span>
                      <span className="text-foreground-muted">{formatCurrency(item.value)} ({Math.round(item.pct)}%)</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-3">
                      <div className={`${item.color} h-3 rounded-full`} style={{ width: `${item.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">Cost per km</span>
                  <span className="font-bold">{formatCurrency(financialReport.costPerKm)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="font-semibold">Total Distance</span>
                  <span>{formatDistance(financialReport.totalDistance)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
