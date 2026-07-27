"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard,
  Truck,
  CalendarCheck,
  Send,
  Users,
  Route,
  Fuel,
  Wrench,
  MapPin,
  BarChart3,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CarFront,
  Brain,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    href: "/fleet",
    label: "Fleet",
    icon: Truck,
    children: [
      { href: "/fleet", label: "Dashboard" },
      { href: "/fleet/vehicles", label: "Vehicles" },
      { href: "/fleet/categories", label: "Categories" },
      { href: "/fleet/maintenance", label: "Maintenance" },
      { href: "/fleet/inspections", label: "Inspections" },
      { href: "/fleet/documents", label: "Documents" },
    ],
  },
  {
    href: "/reservations",
    label: "Reservations",
    icon: CalendarCheck,
    children: [
      { href: "/reservations", label: "All Reservations" },
      { href: "/reservations/new", label: "New Reservation" },
    ],
  },
  {
    href: "/dispatch",
    label: "Dispatch",
    icon: Send,
    children: [
      { href: "/dispatch", label: "Board" },
    ],
  },
  { href: "/routes", label: "Routes", icon: Route },
  {
    href: "/drivers",
    label: "Drivers",
    icon: Users,
    children: [
      { href: "/drivers", label: "All Drivers" },
      { href: "/drivers/attendance", label: "Attendance" },
      { href: "/drivers/incidents", label: "Incidents" },
    ],
  },
  { href: "/trips", label: "Trips", icon: Route },
  {
    href: "/fuel",
    label: "Fuel",
    icon: Fuel,
    children: [
      { href: "/fuel", label: "Records" },
      { href: "/fuel/requests", label: "Requests" },
      { href: "/fuel/stations", label: "Stations" },
      { href: "/fuel/analytics", label: "Analytics" },
    ],
  },
  { href: "/maintenance", label: "Maintenance", icon: Wrench },
  {
    href: "/tracking/live-map",
    label: "GPS Tracking",
    icon: MapPin,
    children: [
      { href: "/tracking/live-map", label: "Live Map" },
      { href: "/tracking/history", label: "Route History" },
      { href: "/tracking/geofences", label: "Geofences" },
    ],
  },
  {
    href: "/ai",
    label: "AI & Automation",
    icon: Brain,
    children: [
      { href: "/ai", label: "Dashboard" },
      { href: "/ai/insights", label: "Insights" },
      { href: "/ai/automation", label: "Automation" },
      { href: "/ai/predictive-maintenance", label: "Predictive Maint." },
      { href: "/ai/settings", label: "Settings" },
    ],
  },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  {
    href: "/notifications",
    label: "Notifications",
    icon: Bell,
    children: [
      { href: "/notifications", label: "All Notifications" },
      { href: "/notifications/preferences", label: "Preferences" },
      { href: "/notifications/templates", label: "Templates" },
    ],
  },
  {
    href: "/settings/general",
    label: "Settings",
    icon: Settings,
    children: [
      { href: "/settings/general", label: "General" },
      { href: "/settings/profile", label: "Profile" },
      { href: "/settings/security", label: "Security" },
      { href: "/settings/api", label: "API Keys" },
    ],
  },
];

export function Sidebar({ collapsed, setCollapsed }) {
  const pathname = usePathname();
  const router = useRouter();
  const [expandedItems, setExpandedItems] = useState({});

  const toggleExpand = (href) => {
    setExpandedItems((prev) => ({ ...prev, [href]: !prev[href] }));
  };

  const isParentActive = (item) => {
    if (!item.children) return pathname === item.href;
    if (item.href === "/fleet") return pathname.startsWith("/fleet");
    if (item.href === "/drivers") return pathname.startsWith("/drivers");
    if (item.href === "/fuel") return pathname.startsWith("/fuel");
    if (item.href === "/ai") return pathname.startsWith("/ai");
    if (item.href === "/notifications") return pathname.startsWith("/notifications");
    if (item.href === "/settings/general") return pathname.startsWith("/settings");
    return pathname === item.href;
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-full flex-col bg-sidebar transition-all duration-300",
        collapsed ? "w-[72px]" : "w-64"
      )}
    >
      <div className={cn(
        "flex h-16 items-center border-b border-white/10 px-4",
        collapsed ? "justify-center" : "justify-between"
      )}>
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <CarFront className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold text-white">FleetOps</span>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 hover:bg-sidebar-hover hover:text-white transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = isParentActive(item);
          const isExpanded = expandedItems[item.href];

          if (item.children && !collapsed) {
            return (
              <div key={item.href}>
                <button
                  onClick={() => toggleExpand(item.href)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-sidebar-active text-white"
                      : "text-white/60 hover:bg-sidebar-hover hover:text-white"
                  )}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {isExpanded && (
                  <div className="ml-8 mt-1 space-y-1">
                    {item.children.map((child) => {
                      const isChildActive = pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "flex items-center rounded-lg px-3 py-2 text-sm transition-all duration-200",
                            isChildActive
                              ? "bg-sidebar-active/60 text-white"
                              : "text-white/50 hover:text-white hover:bg-sidebar-hover"
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  collapsed && "justify-center px-2",
                  isActive
                    ? "bg-sidebar-active text-white"
                    : "text-white/60 hover:bg-sidebar-hover hover:text-white"
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className={cn(
        "border-t border-white/10 p-4",
        collapsed && "flex justify-center px-2"
      )}>
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 ring-2 ring-white/20">
              <AvatarFallback className="bg-primary/20 text-primary text-xs">SA</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">System Admin</p>
              <p className="text-xs text-white/50 truncate">admin@fleetops.com</p>
            </div>
          </div>
        ) : (
          <Avatar className="h-8 w-8 ring-2 ring-white/20">
            <AvatarFallback className="bg-primary/20 text-primary text-xs">SA</AvatarFallback>
          </Avatar>
        )}
      </div>
    </aside>
  );
}

export function TopNav({ collapsed }) {
  const pathname = usePathname();
  const { signOut, user, employee } = useAuth();
  const [dateTime, setDateTime] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setDateTime(
        now.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }) +
          " | " +
          now.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })
      );
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/80 backdrop-blur-xl px-6 transition-all duration-300",
        collapsed ? "left-[72px]" : "left-64"
      )}
    >
      <div className="flex-1">
        <h2 className="text-sm font-medium text-foreground capitalize">
          {pathname === "/dashboard"
            ? "Dashboard"
            : pathname
                .split("/")
                .filter(Boolean)
                .pop()
                ?.replace(/-/g, " ") || "Dashboard"}
        </h2>
      </div>

      <div className="flex items-center gap-3 text-sm text-foreground-secondary">
        <span>{dateTime}</span>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="h-8 px-3 cursor-pointer hover:bg-hover transition-colors">
          <Bell className="h-4 w-4 mr-1.5" />
          <span className="text-xs">3</span>
        </Badge>

        <Avatar className="h-8 w-8 cursor-pointer ring-2 ring-border hover:ring-primary transition-all">
          <AvatarFallback className="bg-primary/10 text-primary text-xs">
            {employee ? getInitials(employee.first_name + " " + employee.last_name) : "U"}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
