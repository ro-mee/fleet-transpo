# Role-Based Access Control (RBAC) Model

## 1. Executive Summary

[To be written]

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

[To be written]

## 4. Resource Access Matrix

[To be written]

## 5. Data-Level Security (RLS)

[To be written]

## 6. Frontend Enforcement

[To be written]

## 7. Implementation Roadmap

[To be written]
