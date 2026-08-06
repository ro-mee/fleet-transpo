"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getFleetUtilizationReport,
  getFuelConsumptionReport,
  getMaintenanceReport,
  getDriverPerformanceReport,
  getFinancialSummary,
} from "@/services/report.service";
import { getPredictiveMaintenance } from "@/services/ai.service";
import { formatCurrency, formatDistance } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  BarChart3,
  Truck,
  Fuel,
  Wrench,
  Users,
  DollarSign,
  Calendar,
  Download,
  Activity,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Clock,
} from "lucide-react";

const tooltipStyle = {
  background: "var(--sf)",
  border: "1px solid var(--br)",
  borderRadius: "8px",
  fontSize: "12px",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
};

const PIE_COLORS = {
  Fuel: "#f59e0b",
  Maintenance: "#ef4444",
  Trips: "#3b82f6",
  Routine: "#10b981",
  Repair: "#f59e0b",
  Emergency: "#ef4444",
  Inspection: "#3b82f6",
  Other: "#9ca3af",
};

const REPORT_TYPES = [
  { id: "fleet", label: "Fleet Utilization", icon: Truck, tone: "primary" },
  { id: "fuel", label: "Fuel Consumption", icon: Fuel, tone: "warning" },
  { id: "maintenance", label: "Maintenance Audit", icon: Wrench, tone: "danger" },
  { id: "drivers", label: "Driver Compliance", icon: Users, tone: "info" },
  { id: "financial", label: "Financial Summary", icon: DollarSign, tone: "success" },
];

export default function ReportsPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager", "management"]);

  const [selectedReport, setSelectedReport] = useState("fleet");
  const [preset, setPreset] = useState("month"); // 'today' | '7d' | 'month' | 'quarter' | 'custom'
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [activeKpi, setActiveKpi] = useState("all");

  const dateBounds = useMemo(() => {
    if (preset === "custom") {
      return {
        from: customRange.from || "1970-01-01",
        to: customRange.to || "2100-01-01",
      };
    }
    const now = new Date();
    const toStr = now.toISOString().substring(0, 10);
    if (preset === "today") {
      return { from: toStr, to: toStr };
    }
    if (preset === "7d") {
      const d = new Date(now);
      d.setDate(now.getDate() - 7);
      return { from: d.toISOString().substring(0, 10), to: toStr };
    }
    if (preset === "quarter") {
      const d = new Date(now);
      d.setMonth(now.getMonth() - 3);
      return { from: d.toISOString().substring(0, 10), to: toStr };
    }
    // Default 'month'
    const fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: fromDate.toISOString().substring(0, 10), to: toStr };
  }, [preset, customRange]);

  // Queries for reports
  const { data: fleetReport } = useQuery({
    queryKey: ["report-fleet", dateBounds],
    queryFn: () => getFleetUtilizationReport(dateBounds.from, dateBounds.to),
    enabled: selectedReport === "fleet",
  });

  const { data: fuelReport } = useQuery({
    queryKey: ["report-fuel", dateBounds],
    queryFn: () => getFuelConsumptionReport(dateBounds.from, dateBounds.to),
    enabled: selectedReport === "fuel",
  });

  const { data: maintReport } = useQuery({
    queryKey: ["report-maintenance", dateBounds],
    queryFn: () => getMaintenanceReport(dateBounds.from, dateBounds.to),
    enabled: selectedReport === "maintenance",
  });

  const { data: driverReport } = useQuery({
    queryKey: ["report-drivers", dateBounds],
    queryFn: () => getDriverPerformanceReport(dateBounds.from, dateBounds.to),
    enabled: selectedReport === "drivers",
  });

  const { data: financialReport } = useQuery({
    queryKey: ["report-financial", dateBounds],
    queryFn: () => getFinancialSummary(dateBounds.from, dateBounds.to),
    enabled: selectedReport === "financial",
  });

  const { data: predictionData } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });

  // Server-precomputed. The filter this replaces already used the lowercase
  // band names, so it counted 0 against the old service's capitalised ones.
  const maintDue =
    (predictionData?.summary?.overdue ?? 0) + (predictionData?.summary?.critical ?? 0);

  // Chart data calculations
  const fleetVehicleChartData = useMemo(() => {
    return (fleetReport?.byVehicle || []).slice(0, 10).map((v) => ({
      plate: v.plate || "Unknown",
      trips: v.trips || 0,
      distance: Math.round(v.distance || 0),
    }));
  }, [fleetReport]);

  const fuelMonthlyChartData = useMemo(() => {
    return (fuelReport?.monthlyData || []).map((m) => ({
      month: m.month,
      liters: Math.round(m.liters || 0),
      cost: Math.round(m.cost || 0),
    }));
  }, [fuelReport]);

  const maintTypePieData = useMemo(() => {
    return (maintReport?.byType || []).map((t) => ({
      name: t.type || "General Service",
      value: Math.round(t.cost || 0),
    }));
  }, [maintReport]);

  const driverChartData = useMemo(() => {
    return (driverReport?.topDrivers || []).slice(0, 8).map((d) => ({
      driver: d.name || `Driver #${d.driver_id}`,
      score: d.score || 0,
      trips: d.trips || 0,
    }));
  }, [driverReport]);

  const financialPieData = useMemo(() => {
    if (!financialReport) return [];
    return [
      { name: "Fuel", value: Math.round(financialReport.fuelCost || 0) },
      { name: "Maintenance", value: Math.round(financialReport.maintCost || 0) },
      { name: "Trips", value: Math.round(financialReport.tripCost || 0) },
    ].filter((item) => item.value > 0);
  }, [financialReport]);

  const handleExport = () => {
    let dataToExport = [];
    let cols = null;
    let filename = `report-${selectedReport}`;

    if (selectedReport === "fleet" && fleetReport) {
      dataToExport = fleetReport.byVehicle || [];
      cols = [
        { label: "Plate Number", key: "plate" },
        { label: "Total Trips", key: "trips" },
        { label: "Total Distance (km)", key: "distance" },
      ];
    } else if (selectedReport === "fuel" && fuelReport) {
      dataToExport = fuelReport.monthlyData || [];
      cols = [
        { label: "Month", key: "month" },
        { label: "Liters (L)", key: "liters" },
        { label: "Total Cost (₱)", key: "cost" },
      ];
    } else if (selectedReport === "maintenance" && maintReport) {
      dataToExport = maintReport.byType || [];
      cols = [
        { label: "Maintenance Type", key: "type" },
        { label: "Total Records", key: "count" },
        { label: "Total Expense (₱)", key: "cost" },
      ];
    } else if (selectedReport === "drivers" && driverReport) {
      dataToExport = driverReport.topDrivers || [];
      cols = [
        { label: "Driver Name", key: "name" },
        { label: "Performance Score", key: "score" },
        { label: "Completed Trips", key: "trips" },
      ];
    } else if (selectedReport === "financial" && financialReport) {
      dataToExport = [
        {
          total_cost: financialReport.totalCost,
          fuel_cost: financialReport.fuelCost,
          maint_cost: financialReport.maintCost,
          cost_per_km: financialReport.costPerKm,
          total_distance: financialReport.totalDistance,
        },
      ];
      cols = [
        { label: "Total Operational Cost (₱)", key: "total_cost" },
        { label: "Fuel Expenses (₱)", key: "fuel_cost" },
        { label: "Maintenance Expenses (₱)", key: "maint_cost" },
        { label: "Cost Per Km (₱/km)", key: "cost_per_km" },
        { label: "Total Distance (km)", key: "total_distance" },
      ];
    }

    exportToCSV(dataToExport, filename, cols);
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header & Controls ── */}
      <PageHeader
        eyebrow="Audit & Compliance"
        title="Enterprise Fleet Reports Hub"
        description="Formal operational reports across fleet utilization, fuel, maintenance, driver performance, and financial auditing."
        actions={
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" /> Export Report CSV
          </Button>
        }
      />

      {/* ── Date Range Presets Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-surface border border-border">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground-secondary">
          <Calendar className="w-4 h-4 text-primary" /> Report Timeframe:
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={preset === "today" ? "default" : "outline"}
            size="xs"
            className="h-8 text-xs px-3"
            onClick={() => setPreset("today")}
          >
            Today
          </Button>
          <Button
            variant={preset === "7d" ? "default" : "outline"}
            size="xs"
            className="h-8 text-xs px-3"
            onClick={() => setPreset("7d")}
          >
            Last 7 Days
          </Button>
          <Button
            variant={preset === "month" ? "default" : "outline"}
            size="xs"
            className="h-8 text-xs px-3"
            onClick={() => setPreset("month")}
          >
            This Month
          </Button>
          <Button
            variant={preset === "quarter" ? "default" : "outline"}
            size="xs"
            className="h-8 text-xs px-3"
            onClick={() => setPreset("quarter")}
          >
            This Quarter
          </Button>

          {preset === "custom" && (
            <div className="flex items-center gap-1.5 ml-2">
              <Input
                type="date"
                value={customRange.from}
                onChange={(e) => setCustomRange((p) => ({ ...p, from: e.target.value }))}
                className="w-36 h-8 text-xs"
              />
              <span className="text-xs text-foreground-muted">to</span>
              <Input
                type="date"
                value={customRange.to}
                onChange={(e) => setCustomRange((p) => ({ ...p, to: e.target.value }))}
                className="w-36 h-8 text-xs"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Report Type Selector Tabs ── */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {REPORT_TYPES.map((rt) => {
          const Icon = rt.icon;
          const active = selectedReport === rt.id;
          return (
            <Button
              key={rt.id}
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedReport(rt.id)}
              className="h-9 px-3 text-xs"
            >
              <Icon className="w-4 h-4 mr-1.5" />
              {rt.label}
            </Button>
          );
        })}
      </div>

      {/* ── TAB 1: FLEET UTILIZATION ── */}
      {selectedReport === "fleet" && (
        <div className="space-y-6">
          <StatGrid cols={3}>
            <StatCard
              icon={BarChart3}
              label="Fleet Utilization Rate"
              value={`${fleetReport?.utilization || 0}%`}
              tone="success"
              active={activeKpi === "utilization"}
              onClick={() => setActiveKpi((k) => (k === "utilization" ? "all" : "utilization"))}
            />
            <StatCard
              icon={Truck}
              label="Total Trips Executed"
              value={fleetReport?.totalTrips || 0}
              tone="primary"
              active={activeKpi === "trips"}
              onClick={() => setActiveKpi((k) => (k === "trips" ? "all" : "trips"))}
            />
            <StatCard
              icon={Truck}
              label="Total Fleet Distance"
              value={formatDistance(fleetReport?.totalDistance || 0)}
              tone="info"
              active={activeKpi === "distance"}
              onClick={() => setActiveKpi((k) => (k === "distance" ? "all" : "distance"))}
            />
          </StatGrid>

          <Card className="border border-border shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Vehicle Mileage &amp; Trip Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {fleetVehicleChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={fleetVehicleChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                      <XAxis dataKey="plate" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="trips" name="Trips Completed" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="distance" name="Distance (km)" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState icon={BarChart3} title="No utilization data for selected timeframe" description="Adjust your timeframe dates above." className="py-16" />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── TAB 2: FUEL CONSUMPTION ── */}
      {selectedReport === "fuel" && (
        <div className="space-y-6">
          <StatGrid cols={3}>
            <StatCard
              icon={Fuel}
              label="Total Fuel Consumed"
              value={`${(fuelReport?.totalLiters || 0).toFixed(1)} L`}
              tone="primary"
              active={activeKpi === "liters"}
              onClick={() => setActiveKpi((k) => (k === "liters" ? "all" : "liters"))}
            />
            <StatCard
              icon={DollarSign}
              label="Total Fuel Expense"
              value={formatCurrency(fuelReport?.totalCost || 0)}
              tone="warning"
              active={activeKpi === "fuelCost"}
              onClick={() => setActiveKpi((k) => (k === "fuelCost" ? "all" : "fuelCost"))}
            />
            <StatCard
              icon={Fuel}
              label="Avg Cost per Liter"
              value={`${formatCurrency(fuelReport?.avgCost || 0)}/L`}
              tone="info"
              active={activeKpi === "avgCost"}
              onClick={() => setActiveKpi((k) => (k === "avgCost" ? "all" : "avgCost"))}
            />
          </StatGrid>

          <Card className="border border-border shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-warning" /> Monthly Fuel Consumption &amp; Expense Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {fuelMonthlyChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={fuelMonthlyChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="liters" name="Fuel Liters (L)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="cost" name="Expense (₱)" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState icon={Fuel} title="No fuel logs found" description="Approved fuel logs will populate monthly consumption trends." className="py-16" />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── TAB 3: MAINTENANCE AUDIT ── */}
      {selectedReport === "maintenance" && (
        <div className="space-y-6">
          <StatGrid cols={3}>
            <StatCard
              icon={Wrench}
              label="Total Maintenance Cost"
              value={formatCurrency(maintReport?.totalCost || 0)}
              tone="danger"
              active={activeKpi === "maintCost"}
              onClick={() => setActiveKpi((k) => (k === "maintCost" ? "all" : "maintCost"))}
            />
            <StatCard
              icon={BarChart3}
              label="Total Maintenance Records"
              value={maintReport?.totalRecords || 0}
              tone="primary"
              active={activeKpi === "maintRecords"}
              onClick={() => setActiveKpi((k) => (k === "maintRecords" ? "all" : "maintRecords"))}
            />
            <StatCard
              icon={Clock}
              label="Vehicles Due for Service"
              value={maintDue}
              tone={maintDue > 0 ? "warning" : "success"}
              active={activeKpi === "maintDue"}
              onClick={() => setActiveKpi((k) => (k === "maintDue" ? "all" : "maintDue"))}
            />
          </StatGrid>

          <Card className="border border-border shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-danger" /> Maintenance Expense Breakdown by Service Type
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {maintTypePieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={maintTypePieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={65}
                        outerRadius={90}
                        paddingAngle={3}
                      >
                        {maintTypePieData.map((entry) => (
                          <Cell key={entry.name} fill={PIE_COLORS[entry.name] || "#9ca3af"} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState icon={Wrench} title="No maintenance cost records" description="Maintenance logs will populate cost distributions." className="py-16" />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── TAB 4: DRIVER COMPLIANCE ── */}
      {selectedReport === "drivers" && (
        <div className="space-y-6">
          <StatGrid cols={2}>
            <StatCard
              icon={Users}
              label="Total Active Drivers"
              value={driverReport?.totalDrivers || 0}
              tone="primary"
              active={activeKpi === "totalDrivers"}
              onClick={() => setActiveKpi((k) => (k === "totalDrivers" ? "all" : "totalDrivers"))}
            />
            <StatCard
              icon={UserCheck}
              label="Average Driver Performance Score"
              value={`${driverReport?.avgScore || 0}/100`}
              tone="success"
              active={activeKpi === "avgScore"}
              onClick={() => setActiveKpi((k) => (k === "avgScore" ? "all" : "avgScore"))}
            />
          </StatGrid>

          <Card className="border border-border shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-info" /> Top Performing Drivers Ranking
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {driverChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={driverChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" vertical={false} />
                      <XAxis dataKey="driver" tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--fg-muted)" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="score" name="Performance Score" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="trips" name="Completed Trips" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState icon={Users} title="No driver performance data" description="Driver metrics will appear once trips are completed." className="py-16" />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── TAB 5: FINANCIAL SUMMARY ── */}
      {selectedReport === "financial" && (
        <div className="space-y-6">
          <StatGrid cols={4}>
            <StatCard
              icon={DollarSign}
              label="Total Operational Cost"
              value={formatCurrency(financialReport?.totalCost || 0)}
              tone="success"
              active={activeKpi === "totalCost"}
              onClick={() => setActiveKpi((k) => (k === "totalCost" ? "all" : "totalCost"))}
            />
            <StatCard
              icon={Truck}
              label="Trip Costs"
              value={formatCurrency(financialReport?.tripCost || 0)}
              tone="primary"
              active={activeKpi === "tripCost"}
              onClick={() => setActiveKpi((k) => (k === "tripCost" ? "all" : "tripCost"))}
            />
            <StatCard
              icon={Fuel}
              label="Fuel Expenses"
              value={formatCurrency(financialReport?.fuelCost || 0)}
              tone="warning"
              active={activeKpi === "fuelCostFin"}
              onClick={() => setActiveKpi((k) => (k === "fuelCostFin" ? "all" : "fuelCostFin"))}
            />
            <StatCard
              icon={Wrench}
              label="Maintenance Expenses"
              value={formatCurrency(financialReport?.maintCost || 0)}
              tone="danger"
              active={activeKpi === "maintCostFin"}
              onClick={() => setActiveKpi((k) => (k === "maintCostFin" ? "all" : "maintCostFin"))}
            />
          </StatGrid>

          <Card className="border border-border shadow-xs">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-success" /> Financial Cost Allocation Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {financialPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={financialPieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={65}
                        outerRadius={90}
                        paddingAngle={3}
                      >
                        {financialPieData.map((entry) => (
                          <Cell key={entry.name} fill={PIE_COLORS[entry.name] || "#9ca3af"} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState icon={DollarSign} title="No cost records for selected period" description="Approved financial records will populate cost allocation." className="py-16" />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
