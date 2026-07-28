# Role-Based Access Control (RBAC) Model

## 1. Executive Summary

This document defines the Role-Based Access Control (RBAC) model for FleetOps, an AI-driven fleet transportation management system operating within a hotel and restaurant ecosystem. The model covers 9 distinct user roles across 36 database tables with row-level security, frontend navigation gating, route guards, and API middleware enforcement. The goal is to ensure every user can only access the data and actions their role requires — no more, no less. Sections 2 describes the current state and gaps; Section 3 defines each role; Section 4 provides the full resource access matrix; Section 5 specifies per-table RLS policies; Section 6 outlines frontend enforcement layers; and Section 7 is the implementation roadmap.

## 2. Current State & Gaps

### 2.1 System Context

FleetOps is a multi-role fleet transportation management system serving hotels, restaurants, and transportation operations. It supports 9 distinct user roles across 36 database tables, 12+ backend service modules, and a Next.js dashboard with mobile driver app.

### 2.2 Roles Currently Defined

The seed data defines these roles, but enforcement is inconsistent:

| Role | Seed Data | constants.js | RLS Policies |
|---|---|---|---|
| system_admin | ✅ | ✅ | ✅ Partial |
| admin | ✅ | ✅ | ✅ Partial |
| fleet_manager | ✅ | ✅ | ✅ Partial |
| dispatcher | ✅ | ✅ | ✅ Partial |
| driver | ✅ | ✅ | ✅ Partial |
| reception_staff | ✅ | ✅ | ❌ Not referenced |
| restaurant_staff | ✅ | ✅ | ❌ Not referenced |
| concierge | ✅ | ❌ Missing | ❌ Not referenced |
| management | ✅ | ✅ | ❌ Overly permissive |

**Gap — concierge role missing from constants:** The `concierge` role is seeded in the database but absent from the `ROLES` constant in `src/lib/constants.js`. The app and RLS policies cannot reference or enforce it.

### 2.3 RLS Policy Gaps

Row-Level Security is enabled on all 36 tables, but **16 tables have zero policies defined** — all access is denied by default:

`roles`, `permissions`, `role_permissions`, `routes`, `vehicleinspection`, `vehicledocuments`, `vehicleassignment`, `fuelstations`, `fuelconsumption`, `fuelrequests`, `fuelallocations`, `driverincidents`, `ai_insights`, `automation_rules`, `automation_logs`, `scheduled_tasks`, `scheduled_reports`, `mobiledevices`, `offlinesync`

This means backbone operational tables (routes, inspections, documents, fuel, AI insights, automation) are inaccessible through RLS — the application must bypass RLS or use the service role to function, undermining the security model.

### 2.4 Overly Permissive Role: management

The `management` role is intended for reports and analytics read-only access. However, existing RLS grants `management` SELECT on all `employees` records — far too broad. Combined with the lack of frontend guards, this role can access more than intended.

### 2.5 No Frontend Enforcement

The sidebar renders all navigation items to every authenticated user regardless of role. There are no route-level guards — any logged-in user can navigate to `/settings`, `/dispatch`, `/ai`, or `/system-config`. There is no component-level feature gating — buttons, actions, and data are visible to all roles equally.

### 2.6 Security Risks

Without database-level or application-level enforcement, a driver or reception_staff user can navigate to admin-only pages and, if they know the API structure, access or manipulate restricted data. The RBAC model exists structurally (roles table, role_permissions table) but is not enforced at either layer.

## 3. Role Definitions

### 3.1 system_admin

- **Description:** Full system access, configuration management, automation rules, audit logs, and RBAC management.
- **Scope:** Company-wide. No branch restrictions.
- **Persona:** IT administrator / system owner.
- **Responsibilities:** Manage system config, audit logs, automation rules, scheduled tasks, role/permission assignments. All operations read/write.
- **Access Pattern:** Full CRUD on all resources. No row-level restrictions. Can manage the system itself.

### 3.2 admin

- **Description:** Day-to-day operational administrator. Manages fleet, drivers, reservations, dispatch, fuel, maintenance — all operational domains.
- **Scope:** Company-wide. Can operate across all branches.
- **Persona:** Fleet operations manager.
- **Responsibilities:** Full fleet management, driver management, reservation oversight, dispatch management, fuel management, maintenance scheduling, report generation.
- **Access Pattern:** Full CRUD on all operational resources. Read-only on system config. No user/role management (system_admin only).

### 3.3 fleet_manager

- **Description:** Focused on fleet operations — vehicles, drivers, maintenance, inspections, assignments.
- **Scope:** Branch-level (assigned branch), plus read access fleet-wide for coordination.
- **Persona:** Fleet Supervisor Juan Dela Cruz.
- **Responsibilities:** Manage vehicle registration, schedule maintenance, track inspections, assign drivers, monitor fleet utilization, review fuel consumption, generate operational reports.
- **Access Pattern:** Full CRUD on fleet, vehicles, drivers, maintenance, inspections, fuel. Read on reservations, dispatch, trips. Cannot manage users, roles, or system config.

### 3.4 dispatcher

- **Description:** Creates and manages dispatches, reservations, and trips. Monitors GPS tracking and coordinates real-time operations.
- **Scope:** Branch-level (assigned branch), plus read access across relevant fleet data.
- **Persona:** Senior Dispatcher Maria Santos, Dispatcher Pedro Gonzales.
- **Responsibilities:** Approve reservations, assign vehicles and drivers to dispatches, create dispatch schedules, monitor live trip progress, coordinate with drivers, update trip status.
- **Access Pattern:** Full CRUD on reservations, dispatch, trips. Read on vehicles, drivers, routes, GPS, fuel. Cannot manage fleet, maintenance, or system settings.

### 3.5 driver

- **Description:** Mobile app user. Executes assigned trips, reports GPS location, logs fuel receipts, checks in/out for attendance.
- **Scope:** Own data only — can see assigned trips, own attendance, own performance.
- **Persona:** John Doe, Jane Smith (seed drivers).
- **Responsibilities:** View dispatch assignments, accept/reject trips, update trip status (start, complete), send GPS pings, upload fuel receipts, report incidents, check in/out for attendance.
- **Access Pattern:** INSERT own GPS, attendance, fuel records. SELECT own trips, dispatch, performance, notifications. UPDATE own trip status. Cannot view other drivers' data, fleet management, or admin pages.

### 3.6 reception_staff

- **Description:** Hotel front desk staff who create guest transportation reservations.
- **Scope:** Branch-level. Can create and view reservations for their branch. No access to fleet ops, dispatch, or maintenance.
- **Persona:** Front Desk Reception Anna Davis.
- **Responsibilities:** Create guest reservations for airport transfers, tours, point-to-point transport. View reservation status. Communicate guest requirements.
- **Access Pattern:** INSERT + SELECT on reservations for own branch. Read on vehicle categories (to select appropriate vehicle type). No access to dispatch, fleet management, drivers, fuel, or system settings.

### 3.7 concierge

- **Description:** Hotel concierge arranging guest transportation, tours, and excursions. Similar to reception_staff but with additional scope for arranging complex itineraries.
- **Scope:** Branch-level. Can create and view reservations, coordinate multi-stop trips.
- **Persona:** Hotel concierge (not in seed data).
- **Responsibilities:** Create guest reservations for tours, excursions, airport transfers, multiple-stop itineraries. View reservation and dispatch status to inform guests.
- **Access Pattern:** INSERT + SELECT on reservations for own branch. SELECT on routes (to recommend tours). Same scope as reception_staff with additional route read access. No fleet, dispatch, or maintenance access.

### 3.8 restaurant_staff

- **Description:** Restaurant staff who request food delivery and supply logistics.
- **Scope:** Branch-level. Can create delivery requests and track delivery status.
- **Persona:** Restaurant Supervisor Carlos Lopez.
- **Responsibilities:** Request food delivery or supply runs, view delivery/reservation status, coordinate with dispatch for logistics.
- **Access Pattern:** INSERT + SELECT on reservations (delivery type only). Read on dispatch status. No access to fleet, drivers, maintenance, or passenger transport reservations.

### 3.9 management

- **Description:** Read-only access to reports, analytics dashboards, AI insights, and operational summaries.
- **Scope:** Company-wide read access to aggregated and analytical data. No write operations on any operational data.
- **Persona:** Hotel/restaurant executive or owner.
- **Responsibilities:** Review fleet utilization, fuel costs, driver performance, trip analytics, AI recommendations. Generate and export reports.
- **Access Pattern:** SELECT on analytical tables only: reports, ai_insights, ai_recommendations, tripcostanalysis, tripperformance, fuelconsumption. SELECT on operational tables restricted to summary/view level. No INSERT, UPDATE, or DELETE on any operational data. No access to user management, system config, or audit logs.

## 4. Resource Access Matrix

### 4.1 Dashboard

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| View KPIs | ✅ All | ✅ All | ✅ All | ✅ Ops | ✅ Own trips | ✅ Branch | ✅ Branch | ✅ Branch | ✅ Summary |

### 4.2 Fleet & Vehicles

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| **Vehicles** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Assigned | ✅ | ✅ | ✅ | ✅ |
| INSERT | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |
| **Categories** |
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT/UPDATE/DELETE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| **Maintenance** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own vehicle | — | — | — | ✅ |
| INSERT | ✅ | ✅ | ✅ | — | ✅ (inspection) | — | — | — | — |
| UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |
| **Documents** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own vehicle | — | — | — | ✅ |
| INSERT/UPDATE/DELETE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| **Assignments** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own | — | — | — | ✅ |
| CRUD | ✅ | ✅ | ✅ | — | — | — | — | — | — |

### 4.3 Reservations

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| **Reservations** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | — | ✅ Own+branch | ✅ Own+branch | ✅ Own+branch | ✅ |
| INSERT | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ (delivery) | ✅ | — |
| UPDATE | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |

### 4.4 Dispatch

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| **Dispatch Schedules** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own | ✅ Branch | ✅ Branch | ✅ Branch | ✅ |
| INSERT | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| UPDATE | ✅ | ✅ | ✅ | ✅ | ✅ (status) | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |

### 4.5 Drivers

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| **Driver Profiles** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own | — | — | — | ✅ |
| INSERT/UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |
| **Attendance** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own | — | — | — | ✅ |
| INSERT | ✅ | ✅ | ✅ | — | ✅ Own | — | — | — | — |
| UPDATE | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |
| **Incidents** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own | — | — | — | ✅ |
| INSERT | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| UPDATE | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |

### 4.6 Routes

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ Assigned | ✅ | ✅ | ✅ | ✅ |
| INSERT/UPDATE | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |

### 4.7 Trips

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| **Trips** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own | — | — | — | ✅ |
| INSERT | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — |
| UPDATE | ✅ | ✅ | ✅ | ✅ | ✅ (status) | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |
| **Trip Performance** |
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ Own | — | — | — | ✅ |
| INSERT/UPDATE | System | System | System | System | — | — | — | — | — |
| **Trip Cost Analysis** |
| SELECT | ✅ | ✅ | ✅ | ✅ | — | — | — | — | ✅ |
| INSERT/UPDATE | System | System | System | System | — | — | — | — | — |

### 4.8 GPS Tracking

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT (live) | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own | — | — | — | ✅ Summary |
| INSERT | — | — | — | — | ✅ Own vehicle | — | — | — | — |
| History | ✅ | ✅ | ✅ | ✅ | ✅ Own | — | — | — | ✅ |

### 4.9 Fuel

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| **Fuel Records** |
| SELECT | ✅ All | ✅ All | ✅ All | ✅ All | ✅ Own | — | — | — | ✅ |
| INSERT | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| UPDATE | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| DELETE | ✅ | ✅ | — | — | — | — | — | — | — |
| **Fuel Requests** |
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ Own | — | — | — | ✅ |
| INSERT | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| UPDATE (approve) | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| **Fuel Allocations** |
| SELECT/CRUD | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ Summary |
| **Fuel Stations** |
| SELECT | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ |
| CRUD | ✅ | ✅ | ✅ | — | — | — | — | — | — |

### 4.10 AI & Automation

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| **AI Insights** | ✅ Read | ✅ Read | ✅ Read | ✅ Read | ✅ Read | ✅ Read | ✅ Read | ✅ Read | ✅ Read |
| **AI Recommendations** | ✅ Read | ✅ Read | ✅ Read | ✅ Read | ✅ Own | ✅ Read | ✅ Read | ✅ Read | ✅ Read |
| **Automation Rules** | ✅ CRUD | ✅ Read | ✅ Read | — | — | — | — | — | — |
| **Automation Logs** | ✅ Read | ✅ Read | ✅ Read | ✅ Read | — | — | — | — | — |
| **Scheduled Tasks** | ✅ CRUD | ✅ Read | ✅ Read | — | — | — | — | — | — |
| **Scheduled Reports** | ✅ CRUD | ✅ CRUD | ✅ CRUD | — | — | — | — | — | ✅ Receive |

### 4.11 Reports

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| Generate Reports | ✅ | ✅ | ✅ | ✅ Limited | — | — | — | — | ✅ |
| Export (PDF/Excel) | ✅ | ✅ | ✅ | ✅ Limited | — | — | — | — | ✅ |
| View Analytics | ✅ | ✅ | ✅ | ✅ | — | — | — | — | ✅ |

### 4.12 Notifications

| Operation | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| SELECT | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own |
| UPDATE (read) | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own |
| Create (system) | System | System | System | System | System | System | System | System | System |

### 4.13 System

| Resource | system_admin | admin | fleet_manager | dispatcher | driver | reception | resto | concierge | mgmt |
|---|---|---|---|---|---|---|---|---|---|
| **Roles/Permissions** | ✅ CRUD | ✅ Read | — | — | — | — | — | — | — |
| **Audit Logs** | ✅ Read | ✅ Read | — | — | — | — | — | — | — |
| **System Config** | ✅ CRUD | ✅ Read | — | — | — | — | — | — | — |
| **Branches** | ✅ CRUD | ✅ CRUD | ✅ Read | ✅ Read | ✅ Read | ✅ Read | ✅ Read | ✅ Read | ✅ Read |
| **Employees** | ✅ CRUD | ✅ CRUD | ✅ Read | ✅ Read | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Read |
| **Mobile Devices** | ✅ CRUD | ✅ CRUD | ✅ Read | ✅ Read | ✅ Own | — | — | — | — |
| **Offline Sync** | ✅ Read | ✅ Read | ✅ Read | — | ✅ Own | — | — | — | — |
| **Profile (self)** | ✅ Edit | ✅ Edit | ✅ Edit | ✅ Edit | ✅ Edit | ✅ Edit | ✅ Edit | ✅ Edit | ✅ Edit |

## 5. Data-Level Security (RLS)

### 5.1 Helper Functions

Reusable RLS helpers used across all policies:

- `get_current_employee_role()` → VARCHAR — Returns the current user's role name
- `has_role(required_roles TEXT[])` → BOOLEAN — Checks if current user has one of the required roles
- `get_current_employee_branch()` → INT — Returns the current user's branch_id
- `get_current_employee_id()` → INT — Returns the current user's employee_id
- `get_current_driver_id()` → INT — Returns the current user's driver_id (NULL if not a driver)

### 5.2 Branches

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | All authenticated | Any branch |
| INSERT | admin, system_admin | — |
| UPDATE | admin, system_admin | — |
| DELETE | system_admin only | Soft-delete (set `deleted_at`) |

*No change from current.*

### 5.3 Roles & Permissions (`roles`, `permissions`, `role_permissions`)

*Currently have RLS enabled but NO policies.*

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, system_admin | All rows |
| INSERT/UPDATE/DELETE | system_admin only | — |

### 5.4 Employees

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT (own) | All authenticated | `user_id = auth.uid()` |
| SELECT (all) | admin, system_admin, fleet_manager | All active employees |
| INSERT | admin, system_admin | — |
| UPDATE | admin, system_admin | — |
| DELETE | system_admin only | Soft-delete |

*Fix: remove `management` from SELECT-all policy (currently granted). management gets only reports-level view.*

### 5.5 Vehicles & Categories

**vehicles:**

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | All authenticated | `deleted_at IS NULL` |
| INSERT | admin, fleet_manager, system_admin | — |
| UPDATE | admin, fleet_manager, system_admin | — |
| DELETE | admin, system_admin | Soft-delete |

*No change from current.*

**vehiclecategories:** Same pattern as vehicles.

### 5.6 Drivers

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT (own) | driver | `employee_id = get_current_employee_id()` |
| SELECT (all) | admin, fleet_manager, system_admin, dispatcher, management | `deleted_at IS NULL` |
| INSERT | admin, fleet_manager, system_admin | — |
| UPDATE | admin, fleet_manager, system_admin | — |
| DELETE | admin, system_admin | Soft-delete |

*Fix: add dispatcher to SELECT (currently missing). Add management for read-only.*

### 5.7 Routes

*Currently has RLS enabled but NO policies.*

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | All authenticated | `deleted_at IS NULL` |
| INSERT | admin, fleet_manager, dispatcher, system_admin | — |
| UPDATE | admin, fleet_manager, dispatcher, system_admin | — |
| DELETE | admin, system_admin | Soft-delete |

### 5.8 Reservations

*Fix current policy gaps: add fleet_manager to UPDATE, add concierge to SELECT for branch-scoped, add DELETE policy.*

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT (own+branch) | reception_staff, concierge, restaurant_staff | `branch_id = get_current_employee_branch() OR created_by = get_current_employee_id()` |
| SELECT (all) | admin, system_admin, fleet_manager, dispatcher, management | All non-deleted |
| INSERT | All authenticated | — |
| UPDATE | admin, system_admin, fleet_manager, dispatcher | — |
| DELETE | admin, system_admin | Soft-delete |

### 5.9 Dispatch Schedules

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT (own) | driver | `driver_id = get_current_driver_id()` |
| SELECT (branch) | reception_staff, concierge, restaurant_staff | Related to their branch reservations |
| SELECT (all) | admin, system_admin, fleet_manager, dispatcher, management | All non-deleted |
| INSERT | admin, system_admin, fleet_manager, dispatcher | — |
| UPDATE | admin, system_admin, fleet_manager, dispatcher | — |
| DELETE | admin, system_admin | Soft-delete |

### 5.10 Trips

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT (own) | driver | `driver_id = get_current_driver_id()` |
| SELECT (all) | admin, system_admin, fleet_manager, dispatcher, management | All non-deleted |
| INSERT | admin, system_admin, fleet_manager, dispatcher | — |
| UPDATE | admin, system_admin, fleet_manager, dispatcher | — |
| DELETE | admin, system_admin | Soft-delete |

**tripcostanalysis, tripperformance:** SELECT - same as trips. INSERT/UPDATE - system only (generated by trip completion).

### 5.11 GPS Tracking

| Operation | Role(s) | Policy |
|---|---|---|
| INSERT | driver | `driver_id = get_current_driver_id()` |
| SELECT (live) | admin, system_admin, fleet_manager, dispatcher | Recent pings |
| SELECT (history) | admin, system_admin, fleet_manager, dispatcher, management | All |
| SELECT (own) | driver | `driver_id = get_current_driver_id()` |

### 5.12 Maintenance & Inspection

**vehiclemaintenance:**

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | All authenticated | `deleted_at IS NULL` |
| INSERT | admin, fleet_manager, system_admin | — |
| UPDATE | admin, fleet_manager, system_admin | — |
| DELETE | admin, system_admin | Soft-delete |

**vehicleinspection** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | All authenticated | All |
| INSERT | admin, fleet_manager, system_admin, driver | driver: limited to own vehicle |
| UPDATE | admin, fleet_manager, system_admin | — |
| DELETE | admin, system_admin | — |

### 5.13 Vehicle Documents & Assignments

**vehicledocuments** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, fleet_manager, system_admin, dispatcher | `deleted_at IS NULL` |
| INSERT/UPDATE | admin, fleet_manager, system_admin | — |
| DELETE | admin, system_admin | Soft-delete |

**vehicleassignment** (currently no policies): Same as vehicledocuments.

### 5.14 Fuel Tables

**fuelrecords:**

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | All authenticated | `deleted_at IS NULL` |
| INSERT | All authenticated (driver submits) | — |
| UPDATE | admin, fleet_manager, system_admin | — |
| DELETE | admin, system_admin | Soft-delete |

**fuelrequests** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | All authenticated | All |
| INSERT | driver, admin, fleet_manager, system_admin | — |
| UPDATE (approve) | admin, fleet_manager, system_admin | — |
| DELETE | admin, system_admin | — |

**fuelallocations** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, fleet_manager, system_admin, management | All |
| INSERT/UPDATE/DELETE | admin, fleet_manager, system_admin | — |

**fuelstations** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | All authenticated | `deleted_at IS NULL` |
| INSERT/UPDATE/DELETE | admin, system_admin | — |

**fuelconsumption** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, fleet_manager, system_admin, dispatcher, management | All |
| INSERT/UPDATE/DELETE | System only | Generated by analytics |

### 5.15 Driver Incidents (currently no policies)

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, fleet_manager, system_admin, dispatcher | All |
| SELECT (own) | driver | `driver_id = get_current_driver_id()` |
| INSERT | driver, admin, fleet_manager, system_admin | — |
| UPDATE | admin, fleet_manager, system_admin | — |
| DELETE | admin, system_admin | — |

### 5.16 AI & Automation Tables

**ai_recommendations** — already has policies, no change.

**ai_insights** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | All authenticated | All |
| INSERT/UPDATE/DELETE | System only | — |

**automation_rules** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, system_admin | All |
| INSERT/UPDATE/DELETE | system_admin | — |

**automation_logs** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, system_admin, fleet_manager | All |
| INSERT | System only | — |

### 5.17 Scheduled Tasks & Reports

**scheduled_tasks** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, system_admin | All |
| CRUD | system_admin | — |

**scheduled_reports** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, system_admin, fleet_manager, management | All |
| INSERT/UPDATE/DELETE | admin, system_admin, fleet_manager | — |

### 5.18 Notifications

*No change from current — already has policies for own-data access.*

### 5.19 Mobile Devices & Offline Sync

**mobiledevices** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, system_admin | All |
| SELECT (own) | driver | `driver_id = get_current_driver_id()` |
| INSERT | driver, admin, system_admin | — |
| UPDATE | driver (own), admin, system_admin | — |

**offlinesync** (currently no policies):

| Operation | Role(s) | Policy |
|---|---|---|
| SELECT | admin, system_admin | All |
| INSERT | System only | — |

### 5.20 Audit Logs

*No change from current — only admin and system_admin can SELECT.*

### 5.21 System Config

*No change from current — only system_admin can manage.*

## 6. Frontend Enforcement

Three layers of enforcement, applied from outermost to innermost.

### 6.1 Layer 1: Navigation Gating

The sidebar in `app-shell.jsx` currently renders all nav items to every user. Fix: filter `navGroups` items based on the current user's role.

**Pattern:**

```javascript
const NAV_ROLES = {
  '/dashboard': ['*'],                         // all authenticated
  '/fleet': ['admin', 'system_admin', 'fleet_manager'],
  '/fleet/vehicles': ['admin', 'system_admin', 'fleet_manager'],
  '/fleet/maintenance': ['admin', 'system_admin', 'fleet_manager'],
  '/reservations': ['*'],                      // all (scope differs by RLS)
  '/dispatch': ['admin', 'system_admin', 'fleet_manager', 'dispatcher'],
  '/drivers': ['admin', 'system_admin', 'fleet_manager'],
  '/trips': ['admin', 'system_admin', 'fleet_manager', 'dispatcher'],
  '/fuel': ['admin', 'system_admin', 'fleet_manager', 'driver'],
  '/tracking': ['admin', 'system_admin', 'fleet_manager', 'dispatcher'],
  '/ai': ['admin', 'system_admin', 'fleet_manager', 'management'],
  '/reports': ['admin', 'system_admin', 'fleet_manager', 'management'],
  '/analytics': ['admin', 'system_admin', 'fleet_manager', 'management'],
  '/notifications': ['*'],
  '/settings': ['admin', 'system_admin'],
};
```

The sidebar checks `!requiredRoles.includes('*') && !requiredRoles.includes(userRole)` and hides items the user cannot access.

### 6.2 Layer 2: Route Guards

Each dashboard page checks role access at the top using a `useRequireRole()` hook.

**Pattern:**

```javascript
export default function FleetPage() {
  const { employee } = useAuth();
  useRequireRole(['admin', 'system_admin', 'fleet_manager']);
  // ...page content
}
```

If the user lacks the required role, they see a 403 page or get redirected to the dashboard. This is a safety net — the nav layer should already prevent them from reaching this URL.

### 6.3 Layer 3: Feature-Level Guards

Within a page, actions are conditionally rendered based on role.

**Pattern:**

```javascript
const { can } = useRoleAccess();

return (
  <div>
    {can('vehicles', 'create') && <AddVehicleButton />}
    {can('reservations', 'approve') && <ApproveButton />}
    {can('maintenance', 'delete') && <DeleteButton />}
  </div>
);
```

### 6.4 Layer 4: API Route Middleware

Server-side enforcement. Every mutation API route checks the user's role before processing.

**Pattern:**

```javascript
import { withRole } from '@/lib/auth/role-guard';

export const POST = withRole(['admin', 'fleet_manager', 'system_admin'])(async (req) => {
  const body = await req.json();
  // ... process request
});
```

The middleware extracts the session, fetches the employee role, and returns `401 Unauthorized` if the role is not in the allowed list.

## 7. Implementation Roadmap

### Phase 1: Constants + Database (Migration)

| # | File | Change |
|---|---|---|
| 1 | `src/lib/constants.js` | Add `CONCIERGE: "concierge"` to `ROLES` |
| 2 | `supabase/migrations/008_rbac_policies.sql` | Add RLS policies for all 16+ missing tables |
| 3 | `supabase/migrations/008_rbac_policies.sql` | Fix `employees` SELECT — remove `management` |
| 4 | `supabase/migrations/008_rbac_policies.sql` | Fix `vehiclereservations` UPDATE — add `fleet_manager` |
| 5 | `supabase/migrations/008_rbac_policies.sql` | Add DELETE policies for operational tables |
| 6 | `supabase/migrations/008_rbac_policies.sql` | Add missing helper functions |
| 7 | Run migration | Verify against seed data |

**Verification:** Query `SELECT tablename, policyname FROM pg_policies WHERE tablename NOT IN (...)` — every table should have at least one policy.

### Phase 2: Frontend Guards

| # | File | Change |
|---|---|---|
| 1 | `src/lib/auth/role-guard.js` | Create — `can()`, `hasRole()`, `requireRole()`, nav filter |
| 2 | `src/hooks/use-role-access.js` | Create — wraps `useAuth()` + `role-guard.js` |
| 3 | `src/components/layout/app-shell.jsx` | Update sidebar — filter `navGroups` by user role |
| 4 | `src/components/layout/dashboard-layout.jsx` | Add route-level role check for admin-only pages |
| 5 | Page components | Add `useRequireRole()` to each page as needed |

**Verification:** Log in as each seed user type and confirm: sidebar shows only permitted items; direct URL access to restricted pages returns 403; action buttons only appear for permitted roles.

### Phase 3: API Middleware

| # | File | Change |
|---|---|---|
| 1 | `src/lib/auth/api-auth.js` | Create — `withRole()` middleware HOF |
| 2 | API route files | Wrap handler with `withRole()` as needed |
| 3 | Service files | Add server-side role checks before mutable operations |

**Verification:** Call each API endpoint with different auth headers and confirm 200 vs 403 matches the matrix.

### Phase 4: Validation

| # | Action |
|---|---|
| 1 | Script: query RLS policies — every table has at least one policy |
| 2 | Script: every nav route has a corresponding role entry |
| 3 | Manual: log in as each role type and walk through module access |
| 4 | Regression: ensure existing tests still pass |
