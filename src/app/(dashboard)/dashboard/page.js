"use client";

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
import { motion } from "framer-motion";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

const kpis = [
  { label: "Total Vehicles", value: "24", icon: Truck, trend: "+2 this month", color: "text-primary", bg: "bg-primary/10" },
  { label: "Available", value: "8", icon: Truck, trend: "33% of fleet", color: "text-success", bg: "bg-success/10" },
  { label: "In Use", value: "12", icon: Activity, trend: "50% utilization", color: "text-warning", bg: "bg-warning/10" },
  { label: "Under Maintenance", value: "4", icon: Wrench, trend: "2 due this week", color: "text-danger", bg: "bg-danger/10" },
  { label: "Drivers on Duty", value: "10", icon: Users, trend: "5 available", color: "text-primary", bg: "bg-primary/10" },
  { label: "Active Trips", value: "7", icon: Send, trend: "3 high priority", color: "text-success", bg: "bg-success/10" },
  { label: "Pending Reservations", value: "5", icon: CalendarCheck, trend: "2 for today", color: "text-warning", bg: "bg-warning/10" },
  { label: "Dispatches Today", value: "15", icon: Send, trend: "92% on time", color: "text-primary", bg: "bg-primary/10" },
  { label: "Fuel Consumed", value: "185 L", icon: Fuel, trend: "₱12,450 today", color: "text-amber-600", bg: "bg-amber-50" },
  { label: "Transport Cost", value: "₱45.2K", icon: DollarSign, trend: "+8% vs last week", color: "text-danger", bg: "bg-danger/10" },
  { label: "Maintenance Due", value: "3", icon: Clock, trend: "₱18K estimated", color: "text-warning", bg: "bg-warning/10" },
  { label: "Fleet Utilization", value: "76%", icon: TrendingUp, trend: "+5% improvement", color: "text-success", bg: "bg-success/10" },
];

const recentActivities = [
  { time: "2 min ago", action: "Trip #142 completed", detail: "Vehicle PNG-123 · 45 km", type: "success" },
  { time: "15 min ago", action: "Reservation #89 approved", detail: "Guest: Maria Santos · Sedan", type: "info" },
  { time: "32 min ago", action: "Maintenance completed", detail: "Vehicle ABC-456 · Oil Change", type: "info" },
  { time: "1 hr ago", action: "Driver checked in", detail: "Juan Dela Cruz · QR Code", type: "success" },
  { time: "2 hrs ago", action: "Fuel request approved", detail: "Vehicle XYZ-789 · 50L Diesel", type: "warning" },
  { time: "3 hrs ago", action: "New reservation created", detail: "Pickup: Lobby · 2:00 PM", type: "info" },
];

const aiInsights = [
  { title: "Fleet utilization can improve", description: "3 vehicles underutilized this week. Consider reassigning.", impact: "high", savings: "₱12K potential savings" },
  { title: "Maintenance peak predicted", description: "4 vehicles due for service next week. Schedule now to avoid downtime.", impact: "medium", savings: "Prevent 8 hrs downtime" },
  { title: "Fuel efficiency declining", description: "Vehicle ABC-456 shows 18% drop in fuel efficiency. Inspection recommended.", impact: "high", savings: "₱6.5K monthly savings" },
];

export default function DashboardPage() {
  const { employee } = useAuth();

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-foreground-secondary mt-1">
            Welcome back{employee ? `, ${employee.first_name}` : ""}! Here&apos;s your fleet overview.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="h-9 px-4 text-sm gap-2">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            System Online
          </Badge>
        </div>
      </div>

      <motion.div variants={item} className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm card-hover">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2 rounded-xl ${kpi.bg}`}>
                  <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
              <p className="text-xs text-foreground-secondary mt-1">{kpi.label}</p>
              <p className="text-[10px] text-foreground-muted mt-0.5">{kpi.trend}</p>
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={item} className="lg:col-span-2">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Reservation Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px] flex items-center justify-center bg-muted/30 rounded-xl text-foreground-muted">
                <div className="text-center">
                  <BarChart3Icon />
                  <p className="text-sm mt-2">Chart loaded with Recharts</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Fleet Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px] flex items-center justify-center bg-muted/30 rounded-xl text-foreground-muted">
                <div className="text-center">
                  <DonutIcon />
                  <p className="text-sm mt-2">Chart loaded with Recharts</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div variants={item} className="lg:col-span-2">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">Live GPS Tracking</CardTitle>
              <Badge variant="success" className="text-xs gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                7 active
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] bg-muted/30 rounded-xl flex items-center justify-center text-foreground-muted">
                <div className="text-center">
                  <MapPin className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-sm">Interactive map loaded with React Leaflet</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {recentActivities.map((activity, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-hover transition-colors">
                    <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      activity.type === "success" ? "bg-success" :
                      activity.type === "warning" ? "bg-warning" : "bg-primary"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{activity.action}</p>
                      <p className="text-xs text-foreground-muted">{activity.detail}</p>
                    </div>
                    <span className="text-[10px] text-foreground-muted flex-shrink-0">{activity.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={item}>
        <Card className="border-0 shadow-sm bg-gradient-to-r from-primary/5 via-transparent to-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">AI Operational Insights</CardTitle>
              <Badge variant="default" className="text-[10px]">AI-powered</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {aiInsights.map((insight, i) => (
                <div key={i} className="p-4 rounded-xl bg-surface border border-border/50 hover:shadow-sm transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className={`w-4 h-4 ${
                      insight.impact === "high" ? "text-danger" : "text-warning"
                    }`} />
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      insight.impact === "high"
                        ? "bg-danger/10 text-danger"
                        : "bg-warning/10 text-warning"
                    }`}>
                      {insight.impact === "high" ? "High Impact" : "Medium Impact"}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">{insight.title}</h4>
                  <p className="text-xs text-foreground-secondary mb-2">{insight.description}</p>
                  <p className="text-xs font-medium text-success">{insight.savings}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

function BarChart3Icon() {
  return (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="6" width="4" height="14" rx="1" />
      <rect x="17" y="9" width="4" height="11" rx="1" />
    </svg>
  );
}

function DonutIcon() {
  return (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}
