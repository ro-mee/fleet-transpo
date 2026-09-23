// Pure permission data and predicates: no React, no next/navigation imports.
//
// Split out of role-guard.js so the authorization matrix can be imported from
// anywhere — server routes, client components, and verification harnesses.
// role-guard.js re-exports all of it, so existing client imports keep working
// unchanged.
//
// Scope: this matrix drives the UI and every cleanly mapped API guard. The
// enforced boundary is requirePermission(req, resource, action) in those
// routes; ownership and protocol-specific handlers remain explicit where a
// role alone cannot express the row or machine scope (docs/rbac-model.md).

import { ROLES } from "@/lib/constants";
import { normalizeRoleName, normalizeRoleList } from "@/lib/auth/role-names";

const KNOWN_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.FLEET_MANAGER,
  ROLES.DISPATCHER,
  ROLES.DRIVER,
  ROLES.MANAGEMENT,
];

export const AUTHENTICATED_ROLES = [...KNOWN_ROLES];

export const NAV_ROLES = {
  "/dashboard": ["super_admin", "admin", "fleet_manager", "dispatcher", "management"],
  "/driver": ["driver"],
  "/driver/trips": ["driver"],
  "/driver/vehicle": ["driver"],
  "/driver/fuel": ["driver"],
  "/driver/incidents": ["driver"],
  "/driver/profile": ["driver"],
  "/driver/schedule": ["driver"],
  "/fleet": ["admin", "super_admin", "fleet_manager"],
  "/fleet/vehicles": ["admin", "super_admin", "fleet_manager"],
  "/fleet/assignments": ["admin", "super_admin", "fleet_manager", "dispatcher", "management"],
  "/fleet/documents": ["admin", "super_admin", "fleet_manager"],
  "/fleet/categories": ["admin", "super_admin", "fleet_manager"],
  "/reservations": ["super_admin", "admin", "fleet_manager", "dispatcher", "management"],
  "/reservations/queue": ["admin", "super_admin", "fleet_manager", "dispatcher"],
  // Prefix gate for the whole /dispatch/* subtree (calendar, availability,
  // [id]). The status-lane board was removed 2026-09-23 — calendar is the
  // default view. Do NOT delete this key: getRequiredRolesForPath prefix-
  // matches, so removing it would turn /dispatch/calendar and /dispatch/[id]
  // into open routes at the page-guard layer.
  "/dispatch": ["admin", "super_admin", "fleet_manager", "dispatcher"],
  "/dispatch/calendar": ["admin", "super_admin", "fleet_manager", "dispatcher"],
  "/dispatch/availability": ["admin", "super_admin", "fleet_manager", "dispatcher", "management"],
  "/incidents": ["admin", "super_admin", "fleet_manager", "dispatcher", "management"],
  "/uvvrp": ["admin", "super_admin", "fleet_manager", "dispatcher", "management"],
  "/drivers": ["admin", "super_admin", "fleet_manager", "dispatcher", "management"],
  "/drivers/leave": ["admin", "super_admin", "fleet_manager"],
  "/drivers/performance": ["admin", "super_admin", "fleet_manager", "management"],
  "/executive": ["admin", "management"],
  "/trips": ["admin", "super_admin", "fleet_manager", "dispatcher"],
  "/tracking": ["admin", "super_admin", "fleet_manager", "dispatcher", "management"],
  "/tracking/live-map": ["admin", "super_admin", "fleet_manager", "dispatcher"],
  "/tracking/history": ["admin", "super_admin", "fleet_manager", "dispatcher", "management"],
  "/routes": ["admin", "super_admin", "fleet_manager", "dispatcher"],
  "/fuel": ["admin", "super_admin", "fleet_manager"],
  "/fuel/analytics": ["admin", "super_admin", "fleet_manager", "management"],
  "/maintenance": ["admin", "super_admin", "fleet_manager"],
  "/maintenance/predictive": ["admin", "super_admin", "fleet_manager"],
  "/ai": ["admin", "super_admin", "fleet_manager", "management"],
  "/ai/insights": ["admin", "super_admin", "fleet_manager", "management"],
  "/ai/predictive-maintenance": ["admin", "super_admin", "fleet_manager"],
  "/reports": ["admin", "super_admin", "fleet_manager", "management"],
  "/reports/cost": ["admin", "super_admin", "fleet_manager", "management"],
  "/analytics": ["admin", "super_admin", "fleet_manager", "management"],
  "/notifications": AUTHENTICATED_ROLES,
  "/notifications/templates": ["admin", "super_admin"],
  "/notifications/preferences": AUTHENTICATED_ROLES,
  "/system/audit": ["super_admin"],
  "/system/errors": ["super_admin"],
  "/system/health": ["super_admin"],
  "/settings/general": ["admin", "super_admin"],
  "/settings/number-coding": ["admin", "super_admin"],
  "/settings/dispatch": ["admin", "super_admin"],
  "/settings/users": ["admin", "super_admin"],
  "/settings/users/new": ["admin", "super_admin"],
  // Platform configuration — Super Admin only. Admin keeps operational
  // policies (dispatch, number-coding) and consumes AI output via /ai/*.
  "/settings/api": ["super_admin"],
  "/settings/ai": ["super_admin"],
  "/settings/ai/logs": ["super_admin"],
  "/settings/users?view=privileged": ["super_admin"],
  "/settings/profile": AUTHENTICATED_ROLES,
  "/settings/security": AUTHENTICATED_ROLES,
  "/settings/security-center": ["super_admin"],
};

export function hasRole(employee, roleOrRoles) {
  if (!employee) return false;
  // Two shapes cross this predicate. Client employee objects carry
  // `roles: { role_name }` (NextAuth session), while server identities from
  // resolveIdentity/requirePermission carry a flat `role` string. Accept both
  // — the maintenance completion guard passed a server session here and every
  // role, including admin, was denied because `roles` is undefined on it.
  const userRole =
    (typeof employee.role === "string" && employee.role) ||
    (typeof employee.roles === "string" && employee.roles) ||
    employee.roles?.role_name ||
    (Array.isArray(employee.roles)
      ? typeof employee.roles[0] === "string"
        ? employee.roles[0]
        : employee.roles[0]?.role_name
      : null) ||
    null;
  if (!userRole) return false;
  const normalizedUser = normalizeRoleName(userRole);
  const roles = normalizeRoleList(Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles]);
  return roles.includes("*") || roles.includes(normalizedUser);
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
    vehicles: { create: true, read: true, read_all: true, update: true, delete: true },
    incidents: { read: true, acknowledge: true, resolve: true, route_to_maintenance: true },
    driver_assignments: { create: true, read: true, update: true, delete: true },
    // Day-scoped substitute driver coverage (migration 032) follows the same
    // fleet-management authority as the custodial pairing it complements.
    substitute_driver_schedules: { create: true, read: true, update: true, delete: true },
    // Weekly work schedules + leave (migration 049): admin observes, the fleet
    // manager sets them (see fleet_manager). Same split as driver_assignments.
    driver_work_schedules: { read: true },
    driver_leave_requests: { read: true, read_all: true },
    reservations: {
      create: true, read: true, update: true, delete: true,
      approve: true, assign: true, dispatch: true, cancel: true, reschedule: true, recommend: true, manage_flags: true,
    },
    dispatch: { create: true, read: true, read_all: true, update: true, update_all: true, delete: true },
    drivers: { create: true, read: true, read_all: true, update: true, delete: true, manage_account: true },
    trips: { create: true, read: true, read_all: true, update: true, update_all: true, delete: true },
    maintenance: { create: true, read: true, update: true, delete: true },
    fuel: { create: true, read: true, read_all: true, update: true, delete: true },
    fuel_requests: { read: true, review: true },
    fuelallocations: { read: true, update: true },
    routes: { seed: true, create: true, read: true, update: true, delete: true },
    categories: { create: true, read: true, update: true, delete: true },
    reports: { create: true, read: true, update: true, delete: false },
    analytics: { read: true },
    ai: { read: true, update: true, scan_document: true, report_narrative: true },
    // AI provider configuration is platform infrastructure — Super Admin only.
    // Admin keeps consuming AI output through `ai` (insights, recommendations,
    // predictive maintenance, report narratives).
    ai_settings: { read: false, update: false },
    accounts: { create: true, read: true, update: true },
    settings: { read: true, update: true },
    dispatch_settings: { read: true, update: true },
    uvvrp: { read: true, update: true, decide: true, manage_exemptions: true },
    driver_leave_balances: { read_all: true },
    maps: { read: true },
    predictive_maintenance: { read: true },
    integrations: { read: true, execute: true },
    notifications: { create: true, read: true, read_all: true, update: true, delete: true, delete_all: true },
    device_tokens: { create: true, delete: true },
    search: { read: true },
    locations: { read_inactive: true },
    employees: { create: true, read: true, update: true, delete: false },
    // Connector/integration status and other platform configuration are
    // Super Admin only. Operational settings stay shared via `settings`,
    // `dispatch_settings`, and `uvvrp`.
    system: { read: false },
    expenses: { read: true, read_all: true, update: true, review: true },
  },
  fleet_manager: {
    vehicles: { create: true, read: true, read_all: true, update: true, delete: false },
    incidents: { read: true, acknowledge: true, resolve: true, route_to_maintenance: true },
    // Custodial pairing is a fleet-management decision, so fleet_manager writes
    // it. delete:true is not a row deletion — releasing a pairing closes its
    // interval (see /api/driver-assignments/[id]).
    driver_assignments: { create: true, read: true, update: true, delete: true },
    substitute_driver_schedules: { create: true, read: true, update: true, delete: true },
    // Work schedules + leave review (migration 049) live with the fleet manager:
    // they set the weekly schedule and approve/decline leave. delete:true on
    // leave is deliberate (a mistaken request can be withdrawn).
    driver_work_schedules: { create: true, read: true, update: true, delete: true },
    driver_leave_requests: { create: true, read: true, read_all: true, update: true, delete: true },
    reservations: {
      create: true, read: true, update: true, delete: false,
      approve: true, assign: true, dispatch: true, cancel: true, reschedule: true, recommend: true, manage_flags: true,
    },
    dispatch: { create: true, read: true, read_all: true, update: true, update_all: true, delete: false },
    drivers: { create: true, read: true, read_all: true, update: true, delete: false, manage_account: true },
    trips: { create: true, read: true, read_all: true, update: true, update_all: true, delete: false },
    maintenance: { create: true, read: true, update: true, delete: false },
    fuel: { create: true, read: true, read_all: true, update: true, delete: false },
    fuel_requests: { read: true, review: true },
    fuelallocations: { read: true, update: true },
    routes: { seed: false, create: true, read: true, update: true, delete: false },
    categories: { create: true, read: true, update: true, delete: false },
    reports: { create: true, read: true, update: true, delete: false },
    analytics: { read: true },
    ai: { read: true, update: true, scan_document: true, report_narrative: true },
    ai_settings: { read: false, update: false },
    accounts: { create: false, read: false, update: false },
    settings: { read: false, update: false },
    dispatch_settings: { read: true, update: false },
    uvvrp: { read: true, update: false, decide: true, manage_exemptions: true },
    driver_leave_balances: { read_all: true },
    maps: { read: true },
    predictive_maintenance: { read: true },
    integrations: { read: true, execute: true },
    notifications: { create: true, read: true, read_all: true, update: true, delete: true, delete_all: true },
    device_tokens: { create: true, delete: true },
    search: { read: true },
    employees: { read: true },
    system: { read: false },
    expenses: { read: true, read_all: true, update: true, review: true },
  },
  dispatcher: {
    vehicles: { read: true, read_all: true },
    incidents: { read: true, acknowledge: true, resolve: true, route_to_maintenance: false },
    // Read-only: a dispatcher must SEE the pairing to understand the warning
    // chip when a dispatch departs from it, but reassigning custody is not their
    // call. The API mirrors this — POST/DELETE exclude dispatcher.
    driver_assignments: { read: true },
    substitute_driver_schedules: { read: true },
    // Schedules are visible so the dispatch screen can explain why a
    // driver is not offered for a window. Dispatchers can now also review (update) leave requests.
    driver_work_schedules: { read: true },
    driver_leave_requests: { read: true, read_all: true },
    reservations: {
      create: true, read: true, update: true, delete: false,
      approve: true, assign: true, dispatch: true, cancel: true, reschedule: true, recommend: true,
    },
    dispatch: { create: true, read: true, read_all: true, update: true, update_all: true, delete: false },
    drivers: { read: true, read_all: true },
    trips: { create: true, read: true, read_all: true, update: true, update_all: true },
    maintenance: { read: true },
    fuel: { read: true, read_all: true },
    routes: { read: true },
    driver_leave_balances: { read_all: true },
    maps: { read: true },
    categories: { read: true },
    reports: { read: false },
    analytics: { read: true },
    ai: { read: true, scan_document: true, report_narrative: false },
    ai_settings: { read: false, update: false },
    accounts: { create: false, read: false, update: false },
    settings: { read: false, update: false },
    dispatch_settings: { read: true, update: false },
    uvvrp: { read: true, update: false, decide: false, manage_exemptions: false },
    predictive_maintenance: { read: false },
    integrations: { read: true, execute: true },
    notifications: { read: true, update: true, delete: true },
    device_tokens: { create: true, delete: true },
    search: { read: true },
    employees: { read: false },
    system: { read: false },
  },
  driver: {
    vehicles: { read: true },
    reservations: { read: false },
    dispatch: { read: true, update: true },
    trips: { read: true, update: true },
    drivers: { read: true },
    // Self-service (migration 049): a driver reads their own schedule and files
    // their own leave requests. Everything else about schedules is the fleet
    // manager's.
    driver_work_schedules: { read: true },
    driver_leave_requests: { create: true, read: true },
    fuel: { create: true, read: true },
    fuel_requests: { create: true, read: true },
    reports: { read: false },
    analytics: { read: false },
    ai: { read: false },
    ai_settings: { read: false, update: false },
    accounts: { create: false, read: false, update: false },
    settings: { read: false, update: false },
    dispatch_settings: { read: false, update: false },
    uvvrp: { read: false, update: false },
    maps: { read: true },
    device_tokens: { create: true, delete: true },
    notifications: { read: true, update: true, delete: true },
    employees: { read: true },
    system: { read: false },
  },
  management: {
    vehicles: { read: true, read_all: true },
    incidents: { read: true, acknowledge: false, resolve: false, route_to_maintenance: false },
    driver_assignments: { read: true },
    substitute_driver_schedules: { read: true },
    driver_work_schedules: { read: true },
    driver_leave_requests: { read: true, read_all: true },
    reservations: {
      read: true,
      approve: false, assign: false, dispatch: false, cancel: false, reschedule: false,
    },
    dispatch: { read: true, read_all: true },
    trips: { read: true, read_all: true },
    drivers: { read: true, read_all: true },
    maintenance: { read: true },
    fuel: { read: true, read_all: true },
    routes: { read: true },
    driver_leave_balances: { read_all: true },
    maps: { read: true },
    categories: { read: true },
    reports: { create: true, read: true },
    analytics: { read: true },
    ai: { read: true, scan_document: false, report_narrative: true },
    ai_settings: { read: false, update: false },
    accounts: { create: false, read: false, update: false },
    settings: { read: false, update: false },
    dispatch_settings: { read: false, update: false },
    uvvrp: { read: true, update: false },
    notifications: { read: true, update: true, delete: true },
    device_tokens: { create: true, delete: true },
    search: { read: true },
    fuelallocations: { read: true },
    scheduled_reports: { read: true },
    employees: { read: false },
    system: { read: false },
  },
};

export function can(employee, resource, action) {
  if (!employee || !employee.roles) return false;
  const userRole = normalizeRoleName(employee.roles.role_name);

  // super_admin can do everything
  if (userRole === ROLES.SUPER_ADMIN) return true;

  return MATRIX[userRole]?.[resource]?.[action] === true;
}

// API routes can derive the same role list as the UI matrix without copying
// policy into every handler. super_admin remains an explicit bypass, matching
// can() above.
export function rolesFor(resource, action) {
  return KNOWN_ROLES.filter((role) =>
    role === ROLES.SUPER_ADMIN || MATRIX[role]?.[resource]?.[action] === true
  );
}

export function filterNavItems(navGroups, employee) {
  if (!employee) return [];

  const userRole = normalizeRoleName(employee?.roles?.role_name);

  return navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const allowedRoles = normalizeRoleList(NAV_ROLES[item.href]);
      if (!allowedRoles) return true;
      return allowedRoles.includes("*") || (userRole && allowedRoles.includes(userRole));
    }).map((item) => {
      if (item.children) {
        return {
          ...item,
          children: item.children.filter((child) => {
            const childRoles = normalizeRoleList(NAV_ROLES[child.href]);
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
