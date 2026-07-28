"use client";

import { useAuth } from "@/hooks/use-auth";
import { hasRole, can, filterNavItems, NAV_ROLES, getRequiredRolesForPath, useRequireRole } from "@/lib/auth/role-guard";

export { useRequireRole };

export function useRoleAccess() {
  const { user, employee, loading } = useAuth();

  return {
    user,
    employee,
    loading,
    userRole: employee?.roles?.role_name || null,
    hasRole: (roleOrRoles) => hasRole(employee, roleOrRoles),
    can: (resource, action) => can(employee, resource, action),
    canAccess: (pathname) => {
      const required = getRequiredRolesForPath(pathname);
      if (required.includes("*")) return true;
      return hasRole(employee, required);
    },
    filterNav: (navGroups) => filterNavItems(navGroups, employee),
    filterNavItems: (navGroups) => filterNavItems(navGroups, employee),
  };
}
