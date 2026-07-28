"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, TopNav } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { cn } from "@/lib/utils";
import { useRequireRole } from "@/hooks/use-role-access";

const authRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];

const protectedRoutes = {
  '/settings': ['admin', 'system_admin'],
  '/dispatch': ['admin', 'system_admin', 'fleet_manager', 'dispatcher'],
  '/drivers': ['admin', 'system_admin', 'fleet_manager'],
  '/fleet': ['admin', 'system_admin', 'fleet_manager'],
  '/trips': ['admin', 'system_admin', 'fleet_manager', 'dispatcher'],
  '/fuel': ['admin', 'system_admin', 'fleet_manager', 'driver'],
  '/maintenance': ['admin', 'system_admin', 'fleet_manager'],
  '/ai': ['admin', 'system_admin', 'fleet_manager', 'management'],
  '/tracking': ['admin', 'system_admin', 'fleet_manager', 'dispatcher'],
  '/reports': ['admin', 'system_admin', 'fleet_manager', 'management'],
  '/analytics': ['admin', 'system_admin', 'fleet_manager', 'management'],
};

export function DashboardLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  if (authRoutes.includes(pathname)) {
    return <>{children}</>;
  }

  const entry = Object.entries(protectedRoutes).find(([route]) =>
    pathname === route || pathname.startsWith(route + '/')
  );

  if (entry) {
    const [, allowedRoles] = entry;
    useRequireRole(allowedRoles);
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <TopNav collapsed={collapsed} />
      <main
        className={cn(
          "pt-16 min-h-screen transition-all duration-300",
          collapsed ? "pl-[72px]" : "pl-64"
        )}
      >
        <div className="p-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
