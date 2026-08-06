// Workspace identity + role-specific navigation for the multi-workspace shell.
//
// Each role gets its own application identity (name, tagline, accent) and a
// navigation list that contains ONLY the modules relevant to that job. Items are
// still passed through filterNavItems (NAV_ROLES) so the enforced boundary and
// the visible UI can never disagree, but a role's sidebar never lists modules
// outside its workspace — nothing is shown in a disabled state.
//
// Pure data + icon refs: imported by client shell components. No server deps.
import {
  LayoutDashboard,
  Truck,
  CalendarCheck,
  Inbox,
  Send,
  Users,
  Route,
  Fuel,
  Wrench,
  MapPin,
  BarChart3,
  Bell,
  Settings,
  Brain,
  ShieldCheck,
  UserCog,
  KeyRound,
  ClipboardList,
  Gauge,
  Database,
  Navigation,
} from "lucide-react";

const overview = (home, homeLabel, homeIcon = LayoutDashboard) => [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: homeLabel, icon: homeIcon },
    ],
  },
];

export const WORKS = {
  system_admin: {
    name: "System Console",
    tagline: "Platform control, security and configuration.",
    accent: "neutral",
    home: "/dashboard",
    nav: [
      ...overview("/dashboard", "System Dashboard", LayoutDashboard),
      {
        label: "Administration",
        items: [
          { href: "/system/audit", label: "Audit Logs", icon: ShieldCheck },
          { href: "/settings/users/new", label: "User Management", icon: UserCog },
          { href: "/settings/api", label: "API & Integrations", icon: KeyRound },
          { href: "/settings/ai", label: "AI Providers", icon: Brain },
          { href: "/settings/ai/logs", label: "AI & Automation Logs", icon: Database },
          { href: "/settings/general", label: "System Settings", icon: Settings },
        ],
      },
    ],
  },
  admin: {
    name: "Operations Center",
    tagline: "Fleet, transportation and operations oversight.",
    accent: "primary",
    home: "/dashboard",
    nav: [
      ...overview("/dashboard", "Operations Dashboard", LayoutDashboard),
      {
        label: "Fleet Operations",
        items: [
          { href: "/fleet/vehicles", label: "Vehicle Management", icon: Truck },
          { href: "/drivers", label: "Driver Management", icon: Users },
          { href: "/drivers/performance", label: "Driver Performance & Feedback", icon: Gauge },
          { href: "/fleet/documents", label: "Document Expiration", icon: ShieldCheck },
        ],
      },
      {
        label: "Transportation",
        items: [
          { href: "/reservations", label: "Reservations", icon: CalendarCheck },
          { href: "/reservations/queue", label: "Request Queue", icon: Inbox },
          { href: "/dispatch", label: "Dispatch", icon: Send },
          { href: "/trips", label: "Trips", icon: ClipboardList },
        ],
      },
      {
        label: "Operations",
        items: [
          { href: "/fuel", label: "Fuel", icon: Fuel },
          {
            href: "/maintenance",
            label: "Maintenance",
            icon: Wrench,
            children: [
              { href: "/maintenance", label: "Records" },
              { href: "/maintenance/predictive", label: "Predictive" },
            ],
          },
          { href: "/tracking/live-map", label: "Live GPS Tracking", icon: MapPin },
        ],
      },
      {
        label: "Insights",
        items: [
          { href: "/reports", label: "Reports", icon: BarChart3 },
          { href: "/analytics", label: "Analytics", icon: BarChart3 },
          { href: "/ai/insights", label: "AI Insights", icon: Brain },
        ],
      },
      {
        label: "Administration",
        items: [
          {
            href: "/settings/general",
            label: "Settings",
            icon: Settings,
            children: [
              { href: "/settings/general", label: "General" },
              { href: "/settings/users/new", label: "Add User" },
              { href: "/settings/api", label: "API Access" },
            ],
          },
        ],
      },
    ],
  },
  fleet_manager: {
    name: "Fleet Operations",
    tagline: "Fleet health, vehicles and readiness.",
    accent: "success",
    home: "/dashboard",
    nav: [
      ...overview("/dashboard", "Fleet Dashboard", LayoutDashboard),
      {
        label: "Fleet Operations",
        items: [
          { href: "/fleet/vehicles", label: "Vehicle Management", icon: Truck },
          { href: "/fleet/documents", label: "Document Expiration", icon: ShieldCheck },
          { href: "/drivers", label: "Driver Management", icon: Users },
        ],
      },
      {
        label: "Operations",
        items: [
          { href: "/maintenance", label: "Maintenance", icon: Wrench },
          { href: "/maintenance/predictive", label: "Predictive Maintenance", icon: Wrench },
          { href: "/fuel", label: "Fuel Monitoring", icon: Fuel },
        ],
      },
      {
        label: "Insights",
        items: [
          { href: "/reports", label: "Fleet Reports & Analytics", icon: BarChart3 },
        ],
      },
    ],
  },
  dispatcher: {
    name: "Transportation Operations",
    tagline: "Real-time trip execution and coordination.",
    accent: "warning",
    home: "/dashboard",
    nav: [
      ...overview("/dashboard", "Dispatch Dashboard", LayoutDashboard),
      {
        label: "Transportation",
        items: [
          { href: "/reservations/queue", label: "Reservation Queue", icon: Inbox },
          { href: "/dispatch", label: "Dispatch Board", icon: Send },
          { href: "/dispatch/calendar", label: "Dispatch Calendar", icon: CalendarCheck },
          { href: "/trips/active", label: "Active Trips", icon: ClipboardList },
          { href: "/trips", label: "Trips", icon: Route },
        ],
      },
      {
        label: "Operations",
        items: [
          { href: "/routes", label: "Routes", icon: Route },
          { href: "/tracking/live-map", label: "Live GPS Tracking", icon: MapPin },
          { href: "/tracking/history", label: "Trip Timeline", icon: ClipboardList },
        ],
      },
      {
        label: "Insights",
        items: [
          { href: "/reports", label: "Fleet Reports", icon: BarChart3 },
        ],
      },
    ],
  },
  driver: {
    name: "Driver Workspace",
    tagline: "Your trips, vehicle and reporting.",
    accent: "info",
    home: "/driver",
    nav: [
      {
        label: "Overview",
        items: [{ href: "/driver", label: "My Dashboard", icon: LayoutDashboard }],
      },
    ],
  },
  management: {
    name: "Executive Center",
    tagline: "Performance, reporting and strategic insight.",
    accent: "neutral",
    home: "/dashboard",
    nav: [
      ...overview("/dashboard", "Executive Dashboard", LayoutDashboard),
      {
        label: "Insights & Reports",
        items: [
          { href: "/executive", label: "Executive KPI Center", icon: LayoutDashboard },
          { href: "/reports", label: "Reports & Analytics Hub", icon: BarChart3 },
        ],
      },
      {
        label: "Monitoring",
        items: [
          { href: "/tracking/history", label: "Operational Review", icon: ClipboardList },
        ],
      },
    ],
  },
};

export function getWorkspace(role) {
  return WORKS[role] || WORKS.admin;
}
