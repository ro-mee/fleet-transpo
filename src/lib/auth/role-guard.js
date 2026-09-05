"use client";

import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getRequiredRolesForPath } from "@/lib/auth/permissions";
import { saveReturnTo } from "@/lib/auth/return-to";

// The permission data and predicates live in ./permissions.js, which imports no
// React and no next/navigation — so server routes and verification harnesses can
// read the same matrix this file's consumers use. Re-exported here so existing
// client imports of role-guard keep resolving unchanged.
export {
  NAV_ROLES,
  hasRole,
  can,
  rolesFor,
  filterNavItems,
  getRequiredRolesForPath,
} from "@/lib/auth/permissions";

export function useRequireRole() {
  const { employee, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname() || "";
  const requiredRoles = getRequiredRolesForPath(pathname);
  const role = employee?.roles?.role_name;

  const isOpenRoute = requiredRoles.includes("*");
  // No session (employee is null) is NOT the same as a session with no role.
  // The latter must surface role-configuration handling, never a /login loop.
  const missingRole = !loading && !!employee && !role;
  const isAuthorized = !loading && (isOpenRoute || (role && requiredRoles.includes(role)));

  useEffect(() => {
    if (loading || isOpenRoute) return;
    if (!employee) {
      // Logged out on a protected route: remember where to return, then login.
      saveReturnTo();
      router.replace("/login");
      return;
    }
    if (missingRole) return;
    if (!isAuthorized) {
      router.replace(role === 'driver' ? '/driver' : '/dashboard');
    }
  }, [loading, isOpenRoute, employee, missingRole, isAuthorized, router, role]);

  return { authorized: isAuthorized, role, loading, missingRole };
}
