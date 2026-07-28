"use client";

import { useAuth } from "@/hooks/use-auth";
import { hasRole, canAccessRoute, NAV_ROLES } from "@/lib/auth/role-guard";

export function useRoleAccess() {
  const { employee } = useAuth();

  const canAccess = (pathname) => canAccessRoute(employee, pathname);

  const hasRoleAccess = (...roles) => hasRole(employee, roles.flat());

  const can = (resource, action) => {
    if (!employee || !employee.roles) return false;
    const userRole = employee.roles.role_name;
    return false;
  };

  return {
    employee,
    role: employee?.roles?.role_name ?? null,
    canAccess,
    can,
    hasRoleAccess,
    NAV_ROLES,
  };
}

export function useRequireRole(requiredRoles) {
  const { employee } = useAuth();
  const allowed = hasRole(employee, requiredRoles);
  return { allowed, role: employee?.roles?.role_name ?? null };
}