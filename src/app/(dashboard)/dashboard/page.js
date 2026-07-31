"use client";

import { useQuery } from "@tanstack/react-query";
import { getAiInsights } from "@/services/ai.service";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Truck,
  Users,
  CalendarCheck,
  Send,
  Fuel,
  DollarSign,
  Wrench,
  Activity,
  TrendingUp,
  AlertTriangle,
  MapPin,
  Clock,
} from "lucide-react";

const kpis = [
  { label: "Total Vehicles", value: "24", icon: Truck, trend: "+2 this month" },
  { label: "Available", value: "8", icon: Truck, trend: "33% of fleet" },
  { label: "In Use", value: "12", icon: Activity, trend: "50% utilization" },
  { label: "Under Maintenance", value: "4", icon: Wrench, trend: "2 due this week" },
  { label: "Drivers on Duty", value: "10", icon: Users, trend: "5 available" },
  { label: "Active Trips", value: "7", icon: Send, trend: "3 high priority" },
  { label: "Pending Reservations", value: "5", icon: CalendarCheck, trend: "2 for today" },
  { label: "Dispatches Today", value: "15", icon: Send, trend: "92% on time" },
  { label: "Fuel Consumed", value: "185 L", icon: Fuel, trend: "₱12,450 today" },
  { label: "Transport Cost", value: "₱45.2K", icon: DollarSign, trend: "+8% vs last week" },
  { label: "Maintenance Due", value: "3", icon: Clock, trend: "₱18K estimated" },
  { label: "Fleet Utilization", value: "76%", icon: TrendingUp, trend: "+5% improvement" },
];

const recentActivities = [
  { time: "2 min ago", action: "Trip #142 completed", detail: "Vehicle PNG-123 · 45 km", type: "success" },
  { time: "15 min ago", action: "Reservation #89 approved", detail: "Guest: Maria Santos · Sedan", type: "info" },
  { time: "32 min ago", action: "Maintenance completed", detail: "Vehicle ABC-456 · Oil Change", type: "info" },
  { time: "1 hr ago", action: "Driver checked in", detail: "Juan Dela Cruz · QR Code", type: "success" },
  { time: "2 hrs ago", action: "Fuel request approved", detail: "Vehicle XYZ-789 · 50L Diesel", type: "warning" },
  { time: "3 hrs ago", action: "New reservation created", detail: "Pickup: Lobby · 2:00 PM", type: "info" },
];

export default function DashboardPage() {
  const { employee } = useAuth();

  const { data: insightsData, isLoading: isLoadingInsights } = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => getAiInsights(),
  });

  const insights = Array.isArray(insightsData)
    ? insightsData
    : Array.isArray(insightsData?.insights)
    ? insightsData.insights
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">
            Welcome back{employee ? `, ${employee.first_name}` : ""}
          </p>
        </div>
        <Badge variant="outline" className="h-7 gap-1.5 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          System Online
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <kpi.icon className="w-3.5 h-3.5 text-foreground-muted" />
                <span className="text-[11px] text-foreground-secondary">{kpi.label}</span>
              </div>
              <p className="text-xl font-semibold text-foreground font-data">{kpi.value}</p>
              <p className="text-[11px] text-foreground-muted mt-0.5">{kpi.trend}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Reservation Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] flex items-center justify-center bg-hover rounded-md text-foreground-muted">
              <div className="text-center">
                <BarChart3Icon />
                <p className="text-sm mt-2">Chart loaded with Recharts</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fleet Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] flex items-center justify-center bg-hover rounded-md text-foreground-muted">
              <div className="text-center">
                <DonutIcon />
                <p className="text-sm mt-2">Chart loaded with Recharts</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Live GPS Tracking</CardTitle>
            <Badge variant="success" className="gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              7 active
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] bg-hover rounded-md flex items-center justify-center text-foreground-muted">
              <div className="text-center">
                <MapPin className="w-6 h-6 mx-auto mb-2" />
                <p className="text-sm">Interactive map loaded with React Leaflet</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {recentActivities.map((activity, i) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3 hover:bg-hover transition-colors">
                  <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    activity.type === "success" ? "bg-success" :
                    activity.type === "warning" ? "bg-warning" : "bg-info"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{activity.action}</p>
                    <p className="text-xs text-foreground-muted">{activity.detail}</p>
                  </div>
                  <span className="text-[11px] text-foreground-muted flex-shrink-0">{activity.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-foreground-muted" />
            <CardTitle>AI Operational Insights</CardTitle>
            <Badge variant="outline" className="text-[10px]">AI</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {isLoadingInsights ? (
              [1, 2, 3].map((n) => (
                <div key={n} className="p-4 rounded-xl border border-border bg-surface animate-pulse space-y-3">
                  <div className="h-4 bg-muted/60 rounded w-1/3" />
                  <div className="h-4 bg-muted/40 rounded w-3/4" />
                  <div className="h-3 bg-muted/30 rounded w-full" />
                </div>
              ))
            ) : insights.length === 0 ? (
              <p className="text-xs text-foreground-muted py-4 col-span-full text-center">
                No active AI operational insights. System operates within optimal metrics.
              </p>
            ) : (
              insights.slice(0, 3).map((insight, i) => {
                const sev = (insight.severity || insight.impact || "low").toLowerCase();
                return (
                  <Link key={i} href="/ai/insights" className="block p-4 rounded-xl border border-border bg-surface hover:border-primary/50 hover:shadow-sm transition-all">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className={`w-3.5 h-3.5 ${sev === "high" || sev === "critical" ? "text-danger" : sev === "medium" ? "text-warning" : "text-primary"}`} />
                      <Badge variant={sev === "high" || sev === "critical" ? "danger" : sev === "medium" ? "warning" : "default"} className="text-[10px] capitalize">
                        {sev} Priority
                      </Badge>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground mb-1">{insight.title}</h4>
                    <p className="text-xs text-foreground-secondary mb-2 leading-relaxed">{insight.summary || insight.description}</p>
                    <p className="text-[10px] font-medium text-primary mt-1 flex items-center gap-1">
                      View in AI Insights →
                    </p>
                  </Link>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BarChart3Icon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="6" width="4" height="14" rx="1" />
      <rect x="17" y="9" width="4" height="11" rx="1" />
    </svg>
  );
}

function DonutIcon() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}
