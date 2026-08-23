import {
  Truck,
  CheckCircle2,
  Wrench,
  Users,
  Navigation,
  CalendarCheck,
  Send,
  TrendingUp,
  MapPin,
  BarChart3,
  Inbox,
  Bell,
  Brain,
  Plus,
  ClipboardList,
  UserCog,
  KeyRound,
  FileBarChart,
  Target,
  Gauge,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

const opsQueries = [
  "vehicles",
  "driverStats",
  "trips",
  "activeTrips",
  "reservations",
  "insights",
];

// Only roles whose sections actually render a map should poll GPS locations.
const opsQueriesWithMap = [...opsQueries, "locations"];

export const DASHBOARD_CONFIGS = {
  system_admin: {
    title: "System Console",
    description: "Platform health, security and configuration at a glance.",
    queries: ["notifications", "audit", "activity"],
    kpis: [
      { label: "Integration OK (24h)", stat: "integrationOk", icon: CheckCircle2, tone: "success", trend: "processed", href: "/settings/api" },
      { label: "Integration Failed", stat: "integrationFailed", icon: Wrench, tone: "danger", trend: "last 24h", href: "/settings/api" },
      { label: "Automation OK", stat: "automationOk", icon: Brain, tone: "success", trend: "successful runs", href: "/settings/ai/logs" },
      { label: "Automation Failed", stat: "automationFailed", icon: AlertTriangle, tone: "danger", trend: "last 24h", href: "/settings/ai/logs" },
      { label: "Audit Entries", stat: "auditTotal", icon: ShieldCheck, tone: "primary", trend: "tracked actions", href: "/system/audit" },
      { label: "Notifications (24h)", stat: "notifications24h", icon: Bell, tone: "info", trend: "sent today", href: "/notifications" },
    ],
    quickActions: [
      { label: "Audit Logs", href: "/system/audit", icon: ShieldCheck },
      { label: "Add User", href: "/settings/users/new", icon: UserCog },
      { label: "API & Integrations", href: "/settings/api", icon: KeyRound },
      { label: "AI Logs", href: "/settings/ai/logs", icon: Brain },
    ],
    sections: [
      { type: "platform-activity", span: 2 },
      { type: "notifications" },
      { type: "audit", span: 3 },
    ],
  },
  admin: {
    title: "Operations Center",
    description: "Live fleet status, trips and requests across the operation.",
    queries: opsQueriesWithMap,
    kpis: [
      { label: "Total Vehicles", stat: "totalVehicles", icon: Truck, tone: "primary", trend: "in the fleet" },
      { label: "Available", stat: "available", icon: CheckCircle2, tone: "success", trend: "ready for dispatch" },
      { label: "Under Maintenance", stat: "maintenance", icon: Wrench, tone: "warning", trend: "needs attention" },
      { label: "Drivers Available", stat: "driversAvailable", icon: Users, tone: "primary", trend: "ready now" },
      { label: "Active Trips", stat: "activeTrips", icon: Navigation, tone: "info", trend: "in motion now" },
      { label: "Open Requests", stat: "openRequests", icon: CalendarCheck, tone: "warning", trend: "awaiting handling" },
      { label: "Trips Today", stat: "tripsToday", icon: Send, tone: "primary", trend: "started or scheduled" },
      { label: "Fleet Availability", stat: "utilization", icon: TrendingUp, tone: "success", trend: "of fleet ready" },
    ],
    quickActions: [
      { label: "Add Vehicle", href: "/fleet/vehicles/new", icon: Plus },
      { label: "Request Queue", href: "/reservations/queue", icon: Inbox },
      { label: "Dispatch", href: "/dispatch", icon: Send },
      { label: "Live Map", href: "/tracking/live-map", icon: MapPin },
    ],
    sections: [
      { type: "area", span: 2 },
      { type: "pie" },
      { type: "map", span: 2 },
      { type: "activity" },
      { type: "insights", span: 3 },
    ],
  },
  fleet_manager: {
    title: "Fleet Operations",
    description: "Fleet health, maintenance pressure and driver availability.",
    queries: opsQueries,
    kpis: [
      { label: "Available", stat: "available", icon: CheckCircle2, tone: "success", trend: "ready to deploy" },
      { label: "Under Maintenance", stat: "maintenance", icon: Wrench, tone: "warning", trend: "needs attention" },
      { label: "Fleet Availability", stat: "utilization", icon: Gauge, tone: "primary", trend: "of fleet ready" },
      { label: "Drivers Available", stat: "driversAvailable", icon: Users, tone: "primary", trend: "ready now" },
      { label: "Active Trips", stat: "activeTrips", icon: Navigation, tone: "info", trend: "in motion" },
      { label: "Open Requests", stat: "openRequests", icon: Inbox, tone: "warning", trend: "awaiting handling" },
    ],
    quickActions: [
      { label: "Fleet", href: "/fleet/vehicles", icon: Truck },
      { label: "Add Vehicle", href: "/fleet/vehicles/new", icon: Plus },
      { label: "Maintenance", href: "/maintenance", icon: Wrench },
      { label: "Drivers", href: "/drivers", icon: Users },
    ],
    sections: [
      { type: "pie" },
      { type: "area", span: 2 },
      { type: "activity" },
      { type: "queue", span: 2 },
      { type: "insights", span: 3 },
    ],
  },
  dispatcher: {
    title: "Transportation Operations",
    description: "The dispatch floor: requests, trips in motion and live position.",
    queries: opsQueriesWithMap,
    kpis: [
      { label: "Open Requests", stat: "openRequests", icon: Inbox, tone: "warning", trend: "awaiting action", href: "/reservations/queue" },
      { label: "Due Today", stat: "todayRequests", icon: CalendarCheck, tone: "warning", trend: "pickups scheduled" },
      { label: "Active Trips", stat: "activeTrips", icon: Navigation, tone: "info", trend: "in motion now" },
      { label: "Available Vehicles", stat: "available", icon: CheckCircle2, tone: "success", trend: "ready to assign", href: "/fleet/vehicles" },
      { label: "Drivers Available", stat: "driversAvailable", icon: Users, tone: "primary", trend: "ready now" },
    ],
    quickActions: [
      { label: "Dispatch Board", href: "/dispatch", icon: Send },
      { label: "Request Queue", href: "/reservations/queue", icon: Inbox },
      { label: "Trips Hub", href: "/trips", icon: Navigation },
      { label: "Live Map", href: "/tracking/live-map", icon: MapPin },
    ],
    sections: [
      { type: "queue", span: 2 },
      { type: "availability" },
      { type: "map", span: 2 },
      { type: "pie" },
      { type: "activity" },
      { type: "insights", span: 3 },
    ],
  },
  management: {
    title: "Executive Center",
    description: "Operational and reporting picture for leadership.",
    queries: opsQueries,
    kpis: [
      { label: "Trips Today", stat: "tripsToday", icon: Send, tone: "primary", trend: "started or scheduled" },
      { label: "Fleet Availability", stat: "utilization", icon: Gauge, tone: "success", trend: "of fleet ready" },
      { label: "Under Maintenance", stat: "maintenance", icon: Wrench, tone: "warning", trend: "needs attention" },
      { label: "Drivers Available", stat: "driversAvailable", icon: Users, tone: "primary", trend: "ready now" },
      { label: "Active Trips", stat: "activeTrips", icon: Navigation, tone: "info", trend: "in motion" },
      { label: "Open Requests", stat: "openRequests", icon: Inbox, tone: "warning", trend: "awaiting handling" },
    ],
    quickActions: [
      { label: "Reports", href: "/reports", icon: FileBarChart },
      { label: "Analytics", href: "/analytics", icon: BarChart3 },
      { label: "AI Insights", href: "/ai/insights", icon: Target },
      { label: "Trips", href: "/trips", icon: ClipboardList },
    ],
    sections: [
      { type: "area", span: 2 },
      { type: "pie" },
      { type: "activity", span: 2 },
      { type: "queue" },
      { type: "insights", span: 3 },
    ],
  },
};

export function getDashboardConfig(role) {
  return DASHBOARD_CONFIGS[role] || DASHBOARD_CONFIGS.admin;
}
