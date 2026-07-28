"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import { useAuth } from "@/hooks/use-auth";
import { useRoleAccess } from "@/hooks/use-role-access";
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
  CarFront,
  Brain,
  Sun,
  Moon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";

const navGroups = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/fleet",
        label: "Fleet",
        icon: Truck,
        children: [
          { href: "/fleet", label: "Dashboard" },
          { href: "/fleet/vehicles", label: "Vehicles" },
          { href: "/fleet/categories", label: "Categories" },
          { href: "/fleet/maintenance", label: "Maintenance" },
        ],
      },
      { href: "/reservations", label: "Reservations", icon: CalendarCheck },
      { href: "/dispatch", label: "Dispatch", icon: Send },
      { href: "/routes", label: "Routes", icon: Route },
      { href: "/drivers", label: "Drivers", icon: Users },
      { href: "/trips", label: "Trips", icon: Route },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { href: "/fuel", label: "Fuel", icon: Fuel },
      { href: "/maintenance", label: "Maintenance", icon: Wrench },
      { href: "/tracking/live-map", label: "GPS Tracking", icon: MapPin },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/ai", label: "AI & Automation", icon: Brain },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/settings/general", label: "Settings", icon: Settings },
    ],
  },
];

function isActive(pathname, href) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/fleet") return pathname.startsWith("/fleet");
  if (href === "/drivers") return pathname.startsWith("/drivers");
  if (href === "/fuel") return pathname.startsWith("/fuel");
  if (href === "/ai") return pathname.startsWith("/ai");
  if (href === "/notifications") return pathname.startsWith("/notifications");
  if (href === "/settings/general") return pathname.startsWith("/settings");
  return pathname === href;
}

export function Sidebar({ collapsed, setCollapsed }) {
  const pathname = usePathname();
  const { employee } = useAuth();
  const { filterNav, userRole } = useRoleAccess();
  const visibleGroups = filterNav(navGroups);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-full flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200",
        collapsed ? "w-[72px]" : "w-60"
      )}
    >
      <div className={cn(
        "flex h-14 items-center border-b border-sidebar-border",
        collapsed ? "justify-center px-0" : "px-4"
      )}>
        {!collapsed ? (
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-foreground">
              <CarFront className="h-4 w-4 text-surface" />
            </div>
            <span className="text-base font-semibold tracking-tight text-foreground">{APP_NAME}</span>
          </Link>
        ) : (
          <Link href="/dashboard">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-foreground">
              <CarFront className="h-4 w-4 text-surface" />
            </div>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:text-foreground hover:bg-hover transition-colors cursor-pointer",
            collapsed ? "mt-4" : "ml-auto"
          )}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-none px-2 py-4 space-y-6">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <p className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                if (item.children && !collapsed) {
                  return (
                    <NavGroupItem
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      collapsed={collapsed}
                      userRole={userRole}
                    />
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors relative",
                      collapsed && "justify-center px-1",
                      active
                        ? "bg-hover text-foreground font-medium"
                        : "text-foreground-secondary hover:text-foreground hover:bg-hover"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    {active && !collapsed && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] bg-foreground rounded-r-full pointer-events-none" />
                    )}
                    {active && collapsed && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-foreground ring-2 ring-sidebar pointer-events-none" />
                    )}
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn(
        "border-t border-sidebar-border py-3",
        collapsed ? "flex justify-center px-2" : "px-3"
      )}>
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-hover text-foreground-secondary text-[11px]">
                {employee ? getInitials(employee.first_name + " " + employee.last_name) : "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate leading-tight">
                {employee ? employee.first_name + " " + employee.last_name : "User"}
              </p>
              <p className="text-[11px] text-foreground-muted truncate">
                {employee?.roles?.role_name ?? ""}
              </p>
            </div>
          </div>
        ) : (
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-hover text-foreground-secondary text-[11px]">
              {employee ? getInitials(employee.first_name + " " + employee.last_name) : "U"}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </aside>
  );
}

function NavGroupItem({ item, pathname, collapsed, userRole }) {
  const [expanded, setExpanded] = useState(
    pathname.startsWith(item.href) && item.href !== "/dashboard"
  );
  const active = isActive(pathname, item.href);

  const { canAccess } = useRoleAccess();

  if (collapsed) {
    return (
      <Link
        href={item.children?.[0]?.href || item.href}
        className={cn(
          "flex items-center justify-center rounded-md px-1 py-2 text-sm transition-colors relative",
          active
            ? "bg-hover text-foreground"
            : "text-foreground-secondary hover:text-foreground hover:bg-hover"
        )}
        title={item.label}
      >
        {active && (
          <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-foreground ring-2 ring-sidebar pointer-events-none" />
        )}
        <item.icon className="h-4 w-4" />
      </Link>
    );
  }

  const visibleChildren = item.children
    ? item.children.filter((child) => canAccess(child.href))
    : [];

  if (visibleChildren.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors relative cursor-pointer",
          active
            ? "bg-hover text-foreground font-medium"
            : "text-foreground-secondary hover:text-foreground hover:bg-hover"
        )}
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] bg-foreground rounded-r-full pointer-events-none" />
        )}
        <item.icon className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-foreground-muted transition-transform",
          expanded && "rotate-180"
        )} />
      </button>
      <div className={cn(
        "overflow-hidden transition-all duration-200",
        expanded ? "mt-0.5" : "h-0"
      )}>
        <div className="ml-6 space-y-0.5 border-l border-border pl-2">
          {visibleChildren.map((child) => {
            const isChildActive = pathname === child.href;
            return (
              <Link
                key={child.href}
                href={child.href}
                className={cn(
                  "block rounded px-2 py-1.5 text-sm transition-colors relative",
                  isChildActive
                    ? "text-foreground font-medium"
                    : "text-foreground-secondary hover:text-foreground"
                )}
              >
                {isChildActive && (
                  <span className="absolute left-[-9px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-foreground border-2 border-sidebar pointer-events-none" />
                )}
                {child.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TopNav({ collapsed }) {
  const pathname = usePathname();
  const { signOut, user, employee } = useAuth();
  const { theme, toggle } = useTheme();

  const segments = pathname.split("/").filter(Boolean);
  const pageTitle = segments.length > 0
    ? segments[segments.length - 1].replace(/-/g, " ")
    : "Dashboard";

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 flex h-14 items-center border-b border-border bg-surface transition-all duration-200",
        collapsed ? "left-[72px]" : "left-60"
      )}
    >
      <div className="flex items-center gap-2 px-6">
        {segments.map((seg, i) => {
          const href = "/" + segments.slice(0, i + 1).join("/");
          const label = seg.replace(/-/g, " ");
          const isLast = i === segments.length - 1;
          return (
            <span key={href} className="flex items-center gap-2">
              {i > 0 && <span className="text-foreground-muted text-xs">/</span>}
              {isLast ? (
                <span className="text-sm font-medium text-foreground capitalize">{label}</span>
              ) : (
                <Link href={href} className="text-xs text-foreground-muted hover:text-foreground capitalize">
                  {label}
                </Link>
              )}
            </span>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2 px-6">
        <button
          onClick={toggle}
          className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-hover transition-colors cursor-pointer"
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button className="relative flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-hover transition-colors cursor-pointer">
          <Bell className="h-4 w-4" />
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-surface">
            3
          </span>
        </button>

        <div className="h-5 w-px bg-border" />

        <Avatar className="h-7 w-7 cursor-pointer">
          <AvatarFallback className="bg-hover text-foreground-secondary text-[11px]">
            {employee ? getInitials(employee.first_name + " " + employee.last_name) : "U"}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
