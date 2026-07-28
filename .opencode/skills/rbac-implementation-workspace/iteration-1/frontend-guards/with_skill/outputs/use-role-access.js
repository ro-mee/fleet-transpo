"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { hasRole, canAccessRoute, filterNavByRole, NAV_ROLES } from "@/lib/auth/role-guard";

export function useRoleAccess() {
  const { employee } = useAuth();

  const canAccess = (pathname) => canAccessRoute(employee, pathname);

  const hasRoleAccess = (...roles) => hasRole(employee, roles.flat());

  const filterNav = (navGroups) => filterNavByRole(employee, navGroups);

  return {
    employee,
    role: employee?.roles?.role_name ?? null,
    canAccess,
    hasRoleAccess,
    filterNav,
    NAV_ROLES,
  };
}

export function useRequireRole(requiredRoles) {
  const { employee, loading } = useAuth();
  const router = useRouter();
  const allowed = hasRole(employee, requiredRoles);

  useEffect(() => {
    if (loading) return;
    if (!employee || !allowed) {
      router.replace("/dashboard");
    }
  }, [employee, allowed, loading, router]);

  return { allowed, loading, role: employee?.roles?.role_name ?? null };
}