# Frontend Layer — Role Guards & Navigation

This reference file provides patterns for implementing frontend role enforcement as described in `docs/rbac-model.md` Section 6.

## Prerequisites

- Read `docs/rbac-model.md` Section 6 (Frontend Enforcement) and Section 4 (Access Matrix)
- Read `src/components/layout/app-shell.jsx` to understand the nav structure
- Read `src/hooks/use-auth.js` to understand how the current employee/role is exposed
- Read `src/lib/constants.js` for the existing `ROLES` constant

## File 1: Role Guard Utility

Create `src/lib/auth/role-guard.js`:

```javascript
import { ROLES } from '@/lib/constants';

/**
 * Navigation role map — each route to allowed roles.
 * '*' means all authenticated users.
 */
export const NAV_ROLES = {
  '/dashboard': ['*'],
  '/fleet': ['admin', 'system_admin', ROLES.FLEET_MANAGER],
  '/fleet/vehicles': ['admin', 'system_admin', ROLES.FLEET_MANAGER],
  '/fleet/categories': ['admin', 'system_admin', ROLES.FLEET_MANAGER],
  '/fleet/maintenance': ['admin', 'system_admin', ROLES.FLEET_MANAGER],
  '/reservations': ['*'],
  '/dispatch': ['admin', 'system_admin', ROLES.FLEET_MANAGER, ROLES.DISPATCHER],
  '/drivers': ['admin', 'system_admin', ROLES.FLEET_MANAGER],
  '/routes': ['*'],
  '/trips': ['admin', 'system_admin', ROLES.FLEET_MANAGER, ROLES.DISPATCHER],
  '/fuel': ['admin', 'system_admin', ROLES.FLEET_MANAGER, ROLES.DRIVER],
  '/tracking': ['admin', 'system_admin', ROLES.FLEET_MANAGER, ROLES.DISPATCHER],
  '/tracking/live-map': ['admin', 'system_admin', ROLES.FLEET_MANAGER, ROLES.DISPATCHER],
  '/ai': ['admin', 'system_admin', ROLES.FLEET_MANAGER, ROLES.MANAGEMENT],
  '/reports': ['admin', 'system_admin', ROLES.FLEET_MANAGER, ROLES.MANAGEMENT],
  '/analytics': ['admin', 'system_admin', ROLES.FLEET_MANAGER, ROLES.MANAGEMENT],
  '/notifications': ['*'],
  '/settings': ['admin', 'system_admin'],
};

/**
 * Check if a user role can access a given route.
 */
export function canAccessRoute(role, pathname) {
  // Normalize: match parent routes (e.g., /fleet/vehicles matches /fleet entry)
  const allowedRoles = Object.entries(NAV_ROLES).find(([route]) =>
    pathname === route || pathname.startsWith(route + '/')
  )?.[1];

  if (!allowedRoles) return false;
  if (allowedRoles.includes('*')) return true;
  return allowedRoles.includes(role);
}

/**
 * Check if a user role has a specific permission on a resource.
 * This is for component-level gating. Extend as needed.
 */
export function can(role, resource, action) {
  // For now, this delegates to RLS — the frontend uses route guards
  // and the database enforces row-level security. Component-level guards
  // are a UX convenience, not a security boundary.
  return true;
}

/**
 * Filter navigation groups based on user role.
 */
export function filterNavByRole(navGroups, role) {
  return navGroups.map(group => ({
    ...group,
    items: group.items
      .map(item => {
        if (item.children) {
          return {
            ...item,
            children: item.children.filter(child =>
              canAccessRoute(role, child.href)
            ),
          };
        }
        return item;
      })
      .filter(item => {
        if (item.children) return item.children.length > 0;
        return canAccessRoute(role, item.href);
      }),
  })).filter(group => group.items.length > 0);
}

/**
 * Higher-order function for route-level protection.
 * Returns a component that renders children only if the user has the required role.
 */
export function requireRole(allowedRoles) {
  return function guardComponent(Component) {
    return function GuardedPage(props) {
      // This is used as a hook-equivalent in pages.
      // The actual check happens in the useRequireRole hook.
      return <Component {...props} />;
    };
  };
}
```

## File 2: Role Access Hook

Create `src/hooks/use-role-access.js`:

```javascript
'use client';

import { useAuth } from '@/hooks/use-auth';
import { canAccessRoute, can, filterNavByRole } from '@/lib/auth/role-guard';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function useRoleAccess() {
  const { employee } = useAuth();
  const role = employee?.roles?.role_name;

  return {
    role,
    canAccessRoute: (pathname) => canAccessRoute(role, pathname),
    can: (resource, action) => can(role, resource, action),
    filterNav: (navGroups) => filterNavByRole(navGroups, role),
  };
}

export function useRequireRole(allowedRoles, redirectTo = '/dashboard') {
  const { employee, loading } = useAuth();
  const router = useRouter();
  const role = employee?.roles?.role_name;

  useEffect(() => {
    if (loading) return;
    if (!role || !allowedRoles.includes(role)) {
      router.replace(redirectTo);
    }
  }, [role, loading, allowedRoles, router, redirectTo]);

  return { authorized: !loading && role && allowedRoles.includes(role), role };
}
```

## File 3: Sidebar Update

In `src/components/layout/app-shell.jsx`, update the `Sidebar` component to filter nav groups:

1. Import the hook:
```javascript
import { useRoleAccess } from '@/hooks/use-role-access';
```

2. Inside the `Sidebar` component, add:
```javascript
const { employee } = useAuth();
const role = employee?.roles?.role_name;
const { filterNav } = useRoleAccess();
const visibleGroups = filterNav(navGroups);
```

3. Replace the outer `navGroups.map(...)` loop with `visibleGroups.map(...)`.

If `collapsed` mode shows icons, also check `canAccessRoute` before showing the icon — or keep icons visible as a simpler approach and rely on the expanded view for full gating.

## File 4: Route Protection in Layout

In `src/components/layout/dashboard-layout.jsx`, add route-level protection:

```javascript
import { useRequireRole } from '@/hooks/use-role-access';
import { canAccessRoute } from '@/lib/auth/role-guard';

// Inside the component, after the auth routes check:
const protectedRoutes = {
  '/settings': ['admin', 'system_admin'],
  '/dispatch': ['admin', 'system_admin', 'fleet_manager', 'dispatcher'],
  '/drivers': ['admin', 'system_admin', 'fleet_manager'],
  '/fleet': ['admin', 'system_admin', 'fleet_manager'],
  '/trips': ['admin', 'system_admin', 'fleet_manager', 'dispatcher'],
  '/fuel': ['admin', 'system_admin', 'fleet_manager', 'driver'],
  '/ai': ['admin', 'system_admin', 'fleet_manager', 'management'],
  '/tracking': ['admin', 'system_admin', 'fleet_manager', 'dispatcher'],
  '/reports': ['admin', 'system_admin', 'fleet_manager', 'management'],
};

const entry = Object.entries(protectedRoutes).find(([route]) =>
  pathname === route || pathname.startsWith(route + '/')
);

if (entry) {
  const [, allowedRoles] = entry;
  useRequireRole(allowedRoles);
}
```

This is the safety net — it redirects users who navigate directly to a restricted URL.

## Pattern for Page-Level Guards

For individual pages, use `useRequireRole` at the top:

```javascript
'use client';

import { useRequireRole } from '@/hooks/use-role-access';

export default function FleetPage() {
  const { authorized } = useRequireRole(['admin', 'system_admin', 'fleet_manager']);

  if (!authorized) return null; // redirecting via hook
  return <div>Fleet dashboard content</div>;
}
```

## Pattern for Component-Level Guards

For showing/hiding buttons or sections within a page:

```javascript
const { can } = useRoleAccess();

return (
  <div>
    {can('vehicles', 'create') && <AddVehicleButton />}
  </div>
);
```

The `can()` function currently returns `true` for all — it's designed for future extension when resource-level permissions are tracked. For now, route guards + RLS provide the enforcement.
