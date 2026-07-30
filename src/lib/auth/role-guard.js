"use client";

import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROLES } from "@/lib/constants";

export const NAV_ROLES = {
  "/dashboard": ["*"],
  "/fleet": ["admin", "system_admin", "fleet_manager"],
  "/fleet/vehicles": ["admin", "system_admin", "fleet_manager"],
  "/fleet/categories": ["admin", "system_admin", "fleet_manager"],
  "/reservations": ["*"],
  "/dispatch": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/drivers": ["admin", "system_admin", "fleet_manager"],
  "/trips": ["admin", "system_admin", "fleet_manager", "dispatcher"],
  "/tracking": ["admin", "system_admin", "fleet_manager", "dispatcher"],
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
  "/analytics": ["admin", "system_admin", "fleet_manager", "management"],
  "/notifications": ["*"],
  "/notifications/templates": ["admin", "system_admin"],
  "/notifications/preferences": ["*"],
  "/settings/general": ["admin", "system_admin"],
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

export function can(employee, resource, action) {
  if (!employee || !employee.roles) return false;
  const userRole = employee.roles.role_name;

  // system_admin can do everything
  if (userRole === ROLES.SYSTEM_ADMIN) return true;

  const matrix = {
    admin: {
      vehicles: { create: true, read: true, update: true, delete: true },
      reservations: { create: true, read: true, update: true, delete: true },
      dispatch: { create: true, read: true, update: true, delete: true },
      drivers: { create: true, read: true, update: true, delete: true },
      trips: { create: true, read: true, update: true, delete: true },
      maintenance: { create: true, read: true, update: true, delete: true },
      fuel: { create: true, read: true, update: true, delete: true },
      routes: { create: true, read: true, update: true, delete: true },
      categories: { create: true, read: true, update: true, delete: true },
      branches: { create: true, read: true, update: true, delete: false },
      reports: { create: true, read: true, update: true, delete: false },
      analytics: { read: true },
      ai: { read: true },
      employees: { create: true, read: true, update: true, delete: false },
      system: { read: true },
    },
    fleet_manager: {
      vehicles: { create: true, read: true, update: true, delete: false },
      reservations: { create: true, read: true, update: true, delete: false },
      dispatch: { create: true, read: true, update: true, delete: false },
      drivers: { create: true, read: true, update: true, delete: false },
      trips: { create: true, read: true, update: true, delete: false },
      maintenance: { create: true, read: true, update: true, delete: false },
      fuel: { create: true, read: true, update: true, delete: false },
      routes: { create: true, read: true, update: true, delete: false },
      categories: { create: true, read: true, update: true, delete: false },
      branches: { read: true },
      reports: { create: true, read: true, update: true, delete: false },
      analytics: { read: true },
      ai: { read: true },
      employees: { read: true },
      system: { read: false },
    },
    dispatcher: {
      vehicles: { read: true },
      reservations: { create: true, read: true, update: true, delete: false },
      dispatch: { create: true, read: true, update: true, delete: false },
      drivers: { read: true },
      trips: { create: true, read: true, update: true, delete: false },
      maintenance: { read: true },
      fuel: { read: true },
      routes: { create: true, read: true, update: true, delete: false },
      branches: { read: true },
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
      maintenance: { create: true, read: true },
      fuel: { create: true, read: true },
      branches: { read: true },
      reports: { read: false },
      analytics: { read: false },
      ai: { read: true },
      employees: { read: true },
      system: { read: false },
    },
    reception_staff: {
      vehicles: { read: true },
      reservations: { create: true, read: true, update: false, delete: false },
      dispatch: { read: true },
      branches: { read: true },
      categories: { read: true },
      reports: { read: false },
      analytics: { read: false },
      ai: { read: true },
      employees: { read: true },
      system: { read: false },
    },
    restaurant_staff: {
      vehicles: { read: true },
      reservations: { create: true, read: true, update: false, delete: false },
      dispatch: { read: true },
      branches: { read: true },
      categories: { read: true },
      reports: { read: false },
      analytics: { read: false },
      ai: { read: true },
      employees: { read: true },
      system: { read: false },
    },
    concierge: {
      vehicles: { read: true },
      reservations: { create: true, read: true, update: false, delete: false },
      dispatch: { read: true },
      routes: { read: true },
      branches: { read: true },
      categories: { read: true },
      reports: { read: false },
      analytics: { read: false },
      ai: { read: true },
      employees: { read: true },
      system: { read: false },
    },
    management: {
      vehicles: { read: true },
      reservations: { read: true },
      dispatch: { read: true },
      trips: { read: true },
      drivers: { read: true },
      maintenance: { read: true },
      fuel: { read: true },
      routes: { read: true },
      categories: { read: true },
      branches: { read: true },
      reports: { create: true, read: true },
      analytics: { read: true },
      ai: { read: true },
      fuelallocations: { read: true },
      scheduled_reports: { read: true },
      employees: { read: false },
      system: { read: false },
    },
  };

  return matrix[userRole]?.[resource]?.[action] === true;
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
    .filter(([key]) => key !== "/" && pathname.startsWith(key))
    .sort(([a], [b]) => b.length - a.length);

  return prefixMatch.length > 0 ? prefixMatch[0][1] : ["*"];
}

export function useRequireRole(requiredRoles) {
  const { employee, loading } = useAuth();
  const router = useRouter();
  const role = employee?.roles?.role_name;

  const isAuthorized = !loading && (requiredRoles.includes('*') || (role && requiredRoles.includes(role)));

  useEffect(() => {
    if (loading) return;
    if (!isAuthorized) {
      router.replace('/dashboard');
    }
  }, [loading, isAuthorized, router]);

  return { authorized: isAuthorized, role };
}
