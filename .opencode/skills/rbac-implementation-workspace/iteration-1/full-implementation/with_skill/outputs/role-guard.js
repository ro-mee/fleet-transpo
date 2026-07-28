import { ROLES } from "@/lib/constants";

export const NAV_ROLES = {
  "/dashboard": ["*"],
  "/fleet": ["admin", "system_admin", "fleet_manager"],
  "/fleet/vehicles": ["admin", "system_admin", "fleet_manager"],
  "/fleet/categories": ["admin", "system_admin", "fleet_manager"],
  "/fleet/maintenance": ["admin", "system_admin", "fleet_manager"],
  "/reservations": ["*"],
  "/dispatch": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/routes": ["*"],
  "/drivers": ["admin", "system_admin", "fleet_manager"],
  "/trips": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/fuel": ["admin", "system_admin", "fleet_manager", "driver"],
  "/maintenance": ["admin", "system_admin", "fleet_manager"],
  "/tracking/live-map": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/ai": ["admin", "system_admin", "fleet_manager", "management"],
  "/reports": ["admin", "system_admin", "fleet_manager", "management"],
  "/analytics": ["admin", "system_admin", "fleet_manager", "management"],
  "/notifications": ["*"],
  "/settings/general": ["admin", "system_admin"],
};

const ALL_WILDCARD = "*";

export function hasRole(employee, requiredRoles) {
  if (!employee || !employee.roles) return false;
  const userRole = employee.roles.role_name;
  if (requiredRoles.includes(ALL_WILDCARD)) return true;
  return requiredRoles.includes(userRole);
}

export function canAccessRoute(employee, pathname) {
  const routeKey = Object.keys(NAV_ROLES).find(
    (key) => pathname === key || pathname.startsWith(key + "/")
  );
  if (!routeKey) return false;
  return hasRole(employee, NAV_ROLES[routeKey]);
}

export function filterNavByRole(employee, navGroups) {
  const userRole = employee?.roles?.role_name;
  if (!userRole) return [];

  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const allowed = NAV_ROLES[item.href];
        if (!allowed) return true;
        if (allowed.includes(ALL_WILDCARD)) return true;
        return allowed.includes(userRole);
      }),
    }))
    .filter((group) => group.items.length > 0);
}