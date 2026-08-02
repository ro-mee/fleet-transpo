# Role-Based Access Control (RBAC) Model

## 1. Executive Summary

This document defines the Role-Based Access Control (RBAC) model for FleetOps, an
AI-driven fleet transportation management system operating within a single-organization
hotel and restaurant ecosystem. The model covers 9 distinct user roles.

**Enforcement is application-layer, not database-layer.** Every API route authorizes
requests in Node via `requireAuth(req, [roles])` (`src/lib/api/utils.js`), and the client
gates navigation, routes, and feature buttons via the helpers in
`src/lib/auth/role-guard.js`. Row-Level Security (RLS) policies still exist in the SQL
migrations but are **inert at runtime** — see Section 5.

- Section 2 describes the enforcement architecture.
- Section 3 defines each role.
- Section 4 provides the resource access matrix (the source of truth for per-route roles).
- Section 5 explains why RLS is not the boundary.
- Section 6 documents the four client-side and server-side enforcement layers.

> **Single-org note:** FleetOps was multi-branch in an earlier design. Branches were
> removed entirely in `supabase/migrations/013_drop_branches.sql` (branch_id columns and
> the branches table are gone). This document reflects the single-organization model — there
> is no branch scoping anywhere.

## 2. Enforcement Architecture

### 2.1 System Context

FleetOps is a multi-role fleet transportation management system serving a single
organization's hotel, restaurant, and transportation operations. It supports 9 distinct
user roles across 35+ database tables, 12+ backend service modules, and a Next.js dashboard
with a mobile driver experience.

### 2.2 Why Enforcement Is Application-Layer

Both data-access paths in the app hold elevated database privileges:

- The raw `pg` Pool (`DATABASE_URL`, `src/lib/db.js` → `query()`) connects as the database
  owner.
- The Supabase client is created with the **service role** key (`getAdminClient()`), which
  bypasses RLS by design.

Because every query runs with privileges that ignore RLS, **RLS can never be the security
boundary**. Authorization must be — and is — enforced in the application:

| Layer | Where | Mechanism |
|---|---|---|
| API route authz | `src/lib/api/utils.js` | `requireAuth(req, [allowedRoles])` throws 401/403 |
| Login throttling | `src/lib/auth.js` | per-IP in-memory rate limit (5/min) |
| Nav gating | `src/lib/auth/role-guard.js` → `NAV_ROLES`, `filterNavItems()` | hides sidebar items |
| Route guard | `useRequireRole()` | redirects unauthorized users |
| Feature gating | `can(employee, resource, action)` matrix | conditionally renders actions |

The `can()` matrix in `src/lib/auth/role-guard.js` is the **single source of truth** for
which role may perform which action; the per-route `requireAuth` role lists are derived from
it.

### 2.3 Roles

Nine roles are seeded and present in `src/lib/constants.js` (`ROLES`, `ROLE_IDS`):

`system_admin`, `admin`, `fleet_manager`, `dispatcher`, `driver`, `reception_staff`,
`restaurant_staff`, `concierge`, `management`.

## 3. Role Definitions

### 3.1 system_admin

- **Description:** Full system access, configuration management, automation rules, audit logs, and RBAC management.
- **Scope:** Organization-wide. No restrictions.
- **Persona:** IT administrator / system owner.
- **Access Pattern:** Full CRUD on all resources. `can()` returns `true` for system_admin unconditionally.

### 3.2 admin

- **Description:** Day-to-day operational administrator. Manages fleet, drivers, reservations, dispatch, fuel, maintenance — all operational domains. Creates employee accounts.
- **Scope:** Organization-wide.
- **Access Pattern:** Full CRUD on all operational resources. Read-only on system config. Creates accounts via the admin-only `POST /api/auth/register`.

### 3.3 fleet_manager

- **Description:** Focused on fleet operations — vehicles, drivers, maintenance, inspections, assignments.
- **Scope:** Organization-wide (no branch restriction), read across all fleet data for coordination.
- **Access Pattern:** Create/update on fleet, vehicles, drivers, maintenance, inspections, fuel (no delete — deletes are admin/system_admin only). Read on reservations, dispatch, trips. Cannot manage users, roles, or system config.

### 3.4 dispatcher

- **Description:** Creates and manages dispatches, reservations, and trips. Monitors GPS tracking and coordinates real-time operations.
- **Scope:** Organization-wide read across relevant fleet data.
- **Access Pattern:** Create/update on reservations, dispatch, trips, routes. Read on vehicles, drivers, GPS, fuel. Cannot delete, manage fleet inventory, maintenance, or system settings.

### 3.5 driver

- **Description:** Mobile user. Executes assigned trips, reports GPS location, logs fuel receipts, checks in/out for attendance.
- **Scope:** Own data only — assigned trips, own attendance, own performance.
- **Access Pattern:** Insert own GPS, attendance, fuel records. Read own trips, dispatch, performance, notifications. Update own trip/dispatch status (via the trip start/complete/status and dispatch status routes, which include `driver`). Cannot view other drivers' data, fleet management, or admin pages.

### 3.6 reception_staff

- **Description:** Hotel front desk staff who create guest transportation reservations.
- **Scope:** Organization-wide reservation visibility per RBAC (no branch scoping). Create + read reservations. No access to fleet ops, dispatch mutation, or maintenance.
- **Access Pattern:** Create + read on reservations. Read on vehicle categories. No dispatch/fleet/driver/fuel/system write access.

### 3.7 concierge

- **Description:** Hotel concierge arranging guest transportation, tours, and excursions.
- **Scope:** Create + read reservations; read routes to recommend tours.
- **Access Pattern:** Create + read on reservations. Read on routes and categories. Same as reception_staff plus route read access.

### 3.8 restaurant_staff

- **Description:** Restaurant staff who request food delivery and supply logistics.
- **Scope:** Create delivery requests, track delivery status.
- **Access Pattern:** Create + read on reservations (delivery type). Read on dispatch status. No fleet/driver/maintenance access.

### 3.9 management

- **Description:** Read-only access to reports, analytics dashboards, AI insights, and operational summaries.
- **Scope:** Organization-wide read of aggregated/analytical data. No writes on operational data.
- **Access Pattern:** Read on reports, analytics, AI insights, trip/fuel analytics. `create`/`read` on reports. No INSERT/UPDATE/DELETE on operational data, no user management, no system config, no employee list.

## 4. Resource Access Matrix

This matrix is the source of truth for the `requireAuth(req, [roles])` lists on each route
and for the `can()` matrix. `—` means denied. There is no branch scoping.

### 4.1 Fleet & Vehicles

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| **Vehicles** SELECT | ✅ | ✅ | ✅ | ✅ | ✅ Assigned | ✅ | ✅ | ✅ | ✅ |
| Vehicles INSERT/UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Vehicles DELETE | ✅ | ✅ | — | — | — | — | — | — | — |
| **Categories** SELECT | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Categories INSERT/UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Categories DELETE | ✅ | ✅ | — | — | — | — | — | — | — |
| **Maintenance** INSERT | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| Maintenance UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Maintenance DELETE | ✅ | ✅ | — | — | — | — | — | — | — |
| **Documents** INSERT/UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Documents DELETE | ✅ | ✅ | — | — | — | — | — | — | — |

### 4.2 Reservations

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| INSERT | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | — |
| UPDATE / cancel | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |

### 4.3 Dispatch

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ Own | ✅ | ✅ | ✅ | ✅ |
| INSERT | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| UPDATE (record) | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| UPDATE (status) | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |

### 4.4 Drivers

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ Own | — | — | — | ✅ |
| INSERT/UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |

### 4.5 Routes

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT/UPDATE | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |

### 4.6 Trips

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ Own | — | — | — | ✅ |
| INSERT | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| UPDATE (record) | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| UPDATE/start/complete/status | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |

### 4.7 GPS Tracking

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ Own | — | — | — | ✅ |
| INSERT | — | — | — | — | ✅ Own vehicle | — | — | — | — |

### 4.8 Fuel

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ Own | — | — | — | ✅ |
| INSERT | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |

### 4.9 AI & Providers

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| AI insights / recommendations (read) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI providers CRUD + document scan | ✅ | ✅ | fleet_manager: scan only | — | — | — | — | — | — |

> AI provider config (create/update/delete/test, model fetch) is admin/system_admin only.
> Document scanning (`POST /api/ai/scan-document`) allows system_admin/admin/fleet_manager
> since it feeds vehicle onboarding.

### 4.10 Reports & Analytics

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| Generate / view | ✅ | ✅ | ✅ | ✅ Limited | — | — | — | — | ✅ |

### 4.11 Notifications

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT / mark read (own) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |

### 4.12 System

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| Roles / Permissions | ✅ CRUD | ✅ Read | — | — | — | — | — | — | — |
| Audit Logs | ✅ Read | ✅ Read | — | — | — | — | — | — | — |
| System Config | ✅ CRUD | ✅ Read | — | — | — | — | — | — | — |
| Employees (create) | ✅ | ✅ | — | — | — | — | — | — | — |
| Integration events | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| Status sync | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Profile (self) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 5. Data-Level Security (RLS) — Not the Enforcement Boundary

RLS policies exist in `supabase/migrations/002_rls_policies.sql` and `011_rls_fix.sql`, and
RLS is `ENABLE`d on the tables. **However, these policies do not enforce anything at
runtime**, because:

1. The app queries Postgres through the raw `pg` Pool as the database owner, and
2. The Supabase client uses the **service role** key, which bypasses RLS.

Neither path establishes an end-user Postgres identity, so the RLS helper functions
(`get_current_employee_id()`, `has_role()`, etc.) have no session to read. The policies are
effectively dead code kept for reference only.

**Do not rely on RLS.** All authorization is enforced in the application (Section 2.2). If
true database-level enforcement is ever desired, it would require routing user queries
through PostgREST/Supabase with per-user JWTs (a significant architectural change) — that is
explicitly out of scope for the current single-instance design.

## 6. Enforcement Layers (Implemented)

### 6.1 Layer 1 — Navigation Gating

`src/lib/auth/role-guard.js` defines `NAV_ROLES` and `filterNavItems()`. The sidebar renders
only items whose allowed-roles list includes the user's role (or `"*"`).

### 6.2 Layer 2 — Route Guards

`useRequireRole(requiredRoles)` redirects unauthorized users to `/dashboard`.

> **Known limitation:** the redirect runs in a `useEffect` after first render, so restricted
> pages can briefly flash before redirecting. This is a defense-in-depth convenience layer,
> not the real boundary — the API layer (6.4) is authoritative.

### 6.3 Layer 3 — Feature Gating

`can(employee, resource, action)` returns a boolean used to conditionally render action
buttons (create/approve/delete, etc.). This is the source of truth the API role lists mirror.

### 6.4 Layer 4 — API Route Authorization (authoritative)

Every mutation route calls `await requireAuth(req, [allowedRoles])` at the top of its
handler; it throws `AuthError(401)` if unauthenticated and `AuthError(403)` if the role is
not permitted. GET/read routes and self-scoped read-state toggles (mark-notification-read,
dismiss-insight) use the default authenticated check. Account creation
(`POST /api/auth/register`) is restricted to `system_admin`/`admin`; there is no public
self-signup.

A `withRole([...])` HOF also exists in `src/lib/auth/api-auth.js` as an alternative wrapper
form; the codebase standardizes on the inline `requireAuth(req, [...])` call.

## 7. Status

The RBAC model described here is **implemented**:

- ✅ All 9 roles present in `constants.js` and seed data.
- ✅ Per-route `requireAuth(req, [roles])` on every create/update/delete route (Section 4).
- ✅ Nav / route / feature client guards in `role-guard.js`.
- ✅ No public self-signup; admin-only account creation.
- ✅ Login rate limiting (5/min per IP).
- ✅ Single-org — no branch scoping anywhere.

Remaining hardening (tracked separately): audit-log writing, scheduled compliance sync,
server-side state-machine validation on status transitions, and removal of the inert RLS
migrations if they are judged to add more confusion than reference value.
