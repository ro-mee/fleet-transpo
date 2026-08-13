// Pure permission data and predicates: no React, no next/navigation imports.
//
// Split out of role-guard.js so the authorization matrix can be imported from
// anywhere — server routes, client components, and verification harnesses.
// role-guard.js re-exports all of it, so existing client imports keep working
// unchanged.
//
// Scope: this matrix decides what the UI offers. The enforced boundary is
// requireAuth(req, [roles]) in each API route, because RLS is inert in this
// deployment (docs/rbac-model.md). scripts/verify-rbac.mjs asserts the two
// layers agree, so a verb can never be merely hidden while its endpoint stays
// open.

import { ROLES } from "@/lib/constants";

export const NAV_ROLES = {
  "/dashboard": ["system_admin", "admin", "fleet_manager", "dispatcher", "management"],
  "/driver": ["driver"],
  "/driver/trips": ["driver"],
  "/driver/vehicle": ["driver"],
  "/driver/fuel": ["driver"],
  "/driver/incidents": ["driver"],
  "/driver/profile": ["driver"],
  "/fleet": ["admin", "system_admin", "fleet_manager"],
  "/fleet/vehicles": ["admin", "system_admin", "fleet_manager"],
  "/fleet/availability": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/fleet/documents": ["admin", "system_admin", "fleet_manager"],
  "/fleet/categories": ["admin", "system_admin", "fleet_manager"],
  "/reservations": ["*"],
  "/reservations/queue": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/dispatch": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/incidents": ["admin", "system_admin", "fleet_manager", "dispatcher", "management"],
  "/uvvrp": ["admin", "system_admin", "fleet_manager", "dispatcher", "management"],
  "/drivers": ["admin", "system_admin", "fleet_manager"],
  "/drivers/availability": ["admin", "system_admin", "fleet_manager", "dispatcher", "management"],
  "/drivers/performance": ["admin", "system_admin", "fleet_manager", "management"],
  "/executive": ["admin", "management"],
  "/trips": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/tracking": ["admin", "system_admin", "fleet_manager", "dispatcher", "management"],
  "/tracking/live-map": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/tracking/history": ["admin", "system_admin", "fleet_manager", "dispatcher", "management"],
  "/routes": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/fuel": ["admin", "system_admin", "fleet_manager", "driver"],
  "/fuel/analytics": ["admin", "system_admin", "fleet_manager", "management"],
  "/maintenance": ["admin", "system_admin", "fleet_manager"],
  "/maintenance/predictive": ["admin", "system_admin", "fleet_manager"],
  "/ai": ["admin", "system_admin", "fleet_manager", "management"],
  "/ai/insights": ["admin", "system_admin", "fleet_manager", "management"],
  "/ai/predictive-maintenance": ["admin", "system_admin", "fleet_manager"],
  "/reports": ["admin", "system_admin", "fleet_manager", "management"],
  "/reports/cost": ["admin", "system_admin", "fleet_manager", "management"],
  "/analytics": ["admin", "system_admin", "fleet_manager", "management"],
  "/notifications": ["*"],
  "/notifications/templates": ["admin", "system_admin"],
  "/notifications/preferences": ["*"],
  "/system/audit": ["system_admin"],
  "/settings/general": ["admin", "system_admin"],
  "/settings/number-coding": ["admin", "system_admin"],
  "/settings/dispatch": ["admin", "system_admin"],
  "/settings/users/new": ["admin", "system_admin"],
  "/settings/ai": ["admin", "system_admin", "fleet_manager"],
  "/settings/ai/logs": ["admin", "system_admin", "fleet_manager"],
  "/settings/profile": ["*"],
  "/settings/security": ["*"],
  "/settings/api": ["admin", "system_admin"],
};

export function hasRole(employee, roleOrRoles) {
  if (!employee || !employee.roles) return false;
  const userRole = employee.roles.role_name;
  const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  return roles.includes("*") || roles.includes(userRole);
}

// Beyond CRUD, `reservations` carries lifecycle verbs — approve, assign,
// dispatch, cancel, reschedule. They are separate from `update` because moving a
// request through its lifecycle is a different authority than editing its
// fields. The split was originally drawn for the front-desk roles, which
// authored requests but were never allowed to approve or assign one; those roles
// were removed in migration 022 and the distinction is now carried by
// management, which observes without acting. Its denials are written out
// explicitly rather than left to an omitted key, so the boundary is readable
// here — as is `driver: reservations.read = false`.
const MATRIX = {
  admin: {
    vehicles: { create: true, read: true, update: true, delete: true },
    driver_assignments: { create: true, read: true, update: true, delete: true },
    // Day-scoped substitute driver coverage (migration 032) follows the same
    // fleet-management authority as the custodial pairing it complements.
    substitute_driver_schedules: { create: true, read: true, update: true, delete: true },
    reservations: {
      create: true, read: true, update: true, delete: true,
      approve: true, assign: true, dispatch: true, cancel: true, reschedule: true,
    },
    dispatch: { create: true, read: true, update: true, delete: true },
    drivers: { create: true, read: true, update: true, delete: true },
    trips: { create: true, read: true, update: true, delete: true },
    maintenance: { create: true, read: true, update: true, delete: true },
    fuel: { create: true, read: true, update: true, delete: true },
    routes: { create: true, read: true, update: true, delete: true },
    categories: { create: true, read: true, update: true, delete: true },
    reports: { create: true, read: true, update: true, delete: false },
    analytics: { read: true },
    ai: { read: true },
    employees: { create: true, read: true, update: true, delete: false },
    system: { read: true },
  },
  fleet_manager: {
    vehicles: { create: true, read: true, update: true, delete: false },
    // Custodial pairing is a fleet-management decision, so fleet_manager writes
    // it. delete:true is not a row deletion — releasing a pairing closes its
    // interval (see /api/driver-assignments/[id]).
    driver_assignments: { create: true, read: true, update: true, delete: true },
    substitute_driver_schedules: { create: true, read: true, update: true, delete: true },
    reservations: {
      create: true, read: true, update: true, delete: false,
      approve: true, assign: true, dispatch: true, cancel: true, reschedule: true,
    },
    dispatch: { create: true, read: true, update: true, delete: false },
    drivers: { create: true, read: true, update: true, delete: false },
    trips: { create: true, read: true, update: true, delete: false },
    maintenance: { create: true, read: true, update: true, delete: false },
    fuel: { create: true, read: true, update: true, delete: false },
    routes: { create: true, read: true, update: true, delete: false },
    categories: { create: true, read: true, update: true, delete: false },
    reports: { create: true, read: true, update: true, delete: false },
    analytics: { read: true },
    ai: { read: true },
    employees: { read: true },
    system: { read: false },
  },
  dispatcher: {
    vehicles: { read: true },
    // Read-only: a dispatcher must SEE the pairing to understand the warning
    // chip when a dispatch departs from it, but reassigning custody is not their
    // call. The API mirrors this — POST/DELETE exclude dispatcher.
    driver_assignments: { read: true },
    substitute_driver_schedules: { read: true },
    reservations: {
      create: true, read: true, update: true, delete: false,
      approve: true, assign: true, dispatch: true, cancel: true, reschedule: true,
    },
    dispatch: { create: true, read: true, update: true, delete: false },
    drivers: { read: true },
    trips: { create: true, read: true, update: true, delete: false },
    maintenance: { read: true },
    fuel: { read: true },
    routes: { create: true, read: true, update: true, delete: false },
    reports: { create: true, read: true },
    analytics: { read: true },
    ai: { read: true },
    employees: { read: false },
    system: { read: false },
  },
  driver: {
    vehicles: { read: true },
    reservations: { read: false },
    dispatch: { read: true, update: true },
    trips: { read: true, update: true },
    drivers: { read: true },
    maintenance: { create: true, read: true },
    fuel: { create: true, read: true },
    reports: { read: false },
    analytics: { read: false },
    ai: { read: true },
    employees: { read: true },
    system: { read: false },
  },
  management: {
    vehicles: { read: true },
    driver_assignments: { read: true },
    substitute_driver_schedules: { read: true },
    reservations: {
      read: true,
      approve: false, assign: false, dispatch: false, cancel: false, reschedule: false,
    },
    dispatch: { read: true },
    trips: { read: true },
    drivers: { read: true },
    maintenance: { read: true },
    fuel: { read: true },
    routes: { read: true },
    categories: { read: true },
    reports: { create: true, read: true },
    analytics: { read: true },
    ai: { read: true },
    fuelallocations: { read: true },
    scheduled_reports: { read: true },
    employees: { read: false },
    system: { read: false },
  },
};

export function can(employee, resource, action) {
  if (!employee || !employee.roles) return false;
  const userRole = employee.roles.role_name;

  // system_admin can do everything
  if (userRole === ROLES.SYSTEM_ADMIN) return true;

  return MATRIX[userRole]?.[resource]?.[action] === true;
}

export function filterNavItems(navGroups, employee) {
  if (!employee) return [];

  const userRole = employee?.roles?.role_name;

  return navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const allowedRoles = NAV_ROLES[item.href];
      if (!allowedRoles) return true;
      return allowedRoles.includes("*") || (userRole && allowedRoles.includes(userRole));
    }).map((item) => {
      if (item.children) {
        return {
          ...item,
          children: item.children.filter((child) => {
            const childRoles = NAV_ROLES[child.href];
            if (!childRoles) return true;
            return childRoles.includes("*") || (userRole && childRoles.includes(userRole));
          }),
        };
      }
      return item;
    }),
  })).filter((group) => group.items.length > 0);
}

export function getRequiredRolesForPath(pathname) {
  const exactMatch = NAV_ROLES[pathname];
  if (exactMatch) return exactMatch;

  const prefixMatch = Object.entries(NAV_ROLES)
    .filter(([key]) => key !== "/" && (pathname === key || pathname.startsWith(key + "/")))
    .sort(([a], [b]) => b.length - a.length);

  return prefixMatch.length > 0 ? prefixMatch[0][1] : ["*"];
}
