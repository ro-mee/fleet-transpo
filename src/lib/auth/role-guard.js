"use client";

import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The permission data and predicates live in ./permissions.js, which imports no
// React and no next/navigation — so server routes and verification harnesses can
// read the same matrix this file's consumers use. Re-exported here so existing
// client imports of role-guard keep resolving unchanged.
export {
  NAV_ROLES,
  hasRole,
  can,
  filterNavItems,
  getRequiredRolesForPath,
} from "@/lib/auth/permissions";

export function useRequireRole(requiredRoles) {
  const { employee, loading } = useAuth();
  const router = useRouter();
  const role = employee?.roles?.role_name;

  const isAuthorized = !loading && (requiredRoles.includes('*') || (role && requiredRoles.includes(role)));

  useEffect(() => {
    if (loading) return;
    if (!isAuthorized) {
      router.replace(role === 'driver' ? '/driver' : '/dashboard');
    }
  }, [loading, isAuthorized, router, role]);

  return { authorized: isAuthorized, role };
}
