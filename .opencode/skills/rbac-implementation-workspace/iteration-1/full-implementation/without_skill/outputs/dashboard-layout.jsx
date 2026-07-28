"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar, TopNav } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/use-role-access";
import { NAV_ROLES } from "@/lib/auth/role-guard";

const authRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];

function isRestrictedRoute(pathname) {
  const entry = Object.keys(NAV_ROLES).find(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  if (!entry) return false;
  const roles = NAV_ROLES[entry];
  return !roles.includes("*");
}

function RouteGuard({ pathname, children }) {
  const { userRole, loading } = useRoleAccess();
  const router = useRouter();

  useEffect(() => {
    if (loading || !userRole) return;

    const entry = Object.entries(NAV_ROLES).find(
      ([route]) => pathname === route || pathname.startsWith(route + "/")
    );

    if (!entry) return;

    const [, allowedRoles] = entry;
    if (allowedRoles.includes("*")) return;
    if (allowedRoles.includes(userRole)) return;

    router.replace("/dashboard");
  }, [pathname, userRole, loading, router]);

  if (loading) return null;

  const entry = Object.entries(NAV_ROLES).find(
    ([route]) => pathname === route || pathname.startsWith(route + "/")
  );

  if (entry) {
    const [, allowedRoles] = entry;
    if (!allowedRoles.includes("*") && !allowedRoles.includes(userRole)) {
      return null;
    }
  }

  return <>{children}</>;
}

export function DashboardLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  if (authRoutes.includes(pathname)) {
    return <>{children}</>;
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
          <ErrorBoundary>
            <RouteGuard pathname={pathname}>{children}</RouteGuard>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
