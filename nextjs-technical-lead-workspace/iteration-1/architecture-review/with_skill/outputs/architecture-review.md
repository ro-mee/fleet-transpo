# FleetOps — Full Architecture Review

**Date:** 2026-07-28  
**Project:** FleetOps — AI-Driven Fleet Transportation Management System  
**Stack:** Next.js 16.2 (App Router) · React 19.2 · Supabase · Prisma (none — raw Supabase SDK) · TanStack Query · Zustand · Tailwind v4 · shadcn/ui (Radix primitives) · Zod v4  
**Target Domain:** Hotel & Restaurant fleet management (sub-system integration with PMS/POS)

---

## 1. Project Discovery Summary

### Business Domain
FleetOps is a fleet transportation management system designed as a **sub-system** within a larger hotel/restaurant ecosystem. It manages vehicles, drivers, routes, reservations, dispatch, trips, fuel, maintenance, and provides AI-driven recommendations and insights. It integrates with parent systems (PMS, POS, Booking Engine) via an integration layer.

### Architecture Overview
```
                          ┌─────────────────────────────────────┐
                          │         Next.js App Router           │
                          │  src/app/(auth)/ · (dashboard)/     │
                          │  Route Groups · Server Components    │
                          └──────────┬──────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
    │   src/services/  │   │  src/hooks/     │   │ src/components/ │
    │ 12 service files │   │ use-auth · use- │   │ tables · ui ·   │
    │ (all .js, no TS) │   │ realtime · use- │   │ layout · forms  │
    │                  │   │ theme           │   │ (empty) · cards  │
    └────────┬─────────┘   └─────────────────┘   │ (empty) · charts│
             │                                    │ (empty)        │
             ▼                                    └─────────────────┘
    ┌──────────────────┐
    │    Supabase       │
    │  PostgreSQL DB    │
    │  RLS Policies     │
    │  Edge Functions   │
    │  Realtime Subs    │
    └──────────────────┘
```

### File Count (Source Only)
- **12 service files** (`.js`) in `src/services/`
- **8 pages** in `(auth)/` route group
- **~40+ pages** in `(dashboard)/` covering all modules
- **3 hooks** in `src/hooks/`
- **3 Supabase client files** in `src/lib/supabase/`
- **2 API routes** in `src/app/api/` (auth callback, logout, manifest)
- **0 Zod validation schemas** (empty `src/lib/validations/` directory)
- **0 TypeScript files** in `src/` (100% JavaScript)
- **1 Edge Function** in `supabase/functions/`

---

## 2. Database Analysis

### Schema Health: GOOD OVERALL (with concerns)

**Tables (post-migration 006):** ~24 tables

**Core Domains:**
| Domain | Tables | Status |
|--------|--------|--------|
| Auth/RBAC | employees, roles, branches, (permissions removed) | ✅ Acceptable |
| Fleet | vehicles, vehiclecategories | ✅ Good |
| Drivers | drivers, driverattendance | ✅ Good |
| Operations | vehiclereservations, dispatchschedules, routes, trips | ✅ Good |
| Tracking | gpstracking | ✅ Good |
| Maintenance | vehiclemaintenance | ✅ Good |
| Fuel | fuelrecords | ✅ Good (simplified post-005) |
| Intelligence | ai_recommendations, ai_insights | ✅ Good |
| Notifications | notifications | ✅ Good |
| Integration | service_types, booking_channels, integration_log | ✅ Good |
| Analytics | tripcostanalysis, tripperformance, driver_stats (view/?) | ⚠️ See below |
| Audit | audit_logs | ✅ Good |

### What's Good
1. **Soft deletes** (`deleted_at`) on most tables — excellent for data integrity
2. **Migration 005** was well-executed — reduced from 40 to ~24 tables, dropped redundant tables
3. **Migration 004** (sub-system integration) is well-architected — `integration_log`, `service_types`, `booking_channels`
4. **Indexes** on foreign keys and frequently filtered columns are present
5. **RLS policies** are comprehensive per table
6. **Triggers** for `updated_at` and notifications are functional
7. **Unique constraint** on `driverattendance(driver_id, date)` prevents duplicates

### What's Missing / Needs Improvement

#### CRITICAL
1. **`driver_stats` is queried as a table but not created anywhere** — `driver.service.js` and `ai.service.js` reference `supabase.from("driver_stats")` but there's no migration creating this table or view. It's referenced in the seed data as direct fields on `drivers`. This is a **schema/view mismatch** that will fail at runtime.

2. **No `driver_stats` view or materialized view created** — The service layer filters, maps, and computes derived driver stats (performance_score, total_trips, total_distance, total_hours, rating) in-memory from `drivers` table. These fields exist as columns on `drivers` in 001_schema but should be derived/computed, not stored denormalized.

#### HIGH
3. **No full-text search indexes** — All search uses `ilike.%` patterns which are table-scan operations. Add GIN/trigram indexes.
4. **`gpstracking` is a massive time-series table with no partitioning** — The comment in 001_schema mentions TimescaleDB but it's not implemented. This will become a performance bottleneck.
5. **Missing cascading deletes on some FKs** — `trips` references `dispatchschedules(dispatch_id)` with no `ON DELETE` rule.
6. **No check constraints on status fields** — `vehicle_status`, `trip_status`, `driver_status` etc. are `VARCHAR(50)` with no CHECK constraints to enforce valid values.

#### MEDIUM
7. **`integration_log` has no TTL/retention policy** — Will grow unbounded. Add partitioning or cleanup job.
8. **`audit_logs` has the same unbounded growth issue**
9. **`ai_insights` and `ai_recommendations` have no cleanup strategy**
10. **`branches.created_by` and `branches.updated_by` are missing** — Other tables have these, branches doesn't.

---

## 3. API Review

### Current State: VERY THIN

Only **2 real API route handlers** exist:
- `api/auth/callback/route.js` — OAuth callback handler
- `api/auth/logout/route.js` — Session sign-out

Plus `api/manifest/route.js` for PWA manifest.

### What's Missing

#### CRITICAL
1. **No API routes for any CRUD operations** — All data access goes directly through the browser-side Supabase client (`createClient()`). This means:
   - No server-side validation
   - No server-side authorization beyond RLS
   - No audit logging for mutations
   - No rate limiting
   - All queries expose the anon key to the client (acceptable but limits control)

2. **No integration API endpoints exist** — The `docs/architecture/sub-system-integration.md` defines endpoints like `/api/integration/inbound`, `/api/integration/status`, `/api/integration/logs`, `/api/integration/retry/:logId` — **none are implemented**.

#### HIGH
3. **No input validation anywhere** — `src/lib/validations/` is completely empty. No Zod schemas exist.
4. **No consistent error response format** — Services throw raw errors, no standardized API error shape.
5. **No pagination metadata** — When pagination is used, count/next/total are not returned.

---

## 4. Frontend Review

### What's Good
1. **Clean component structure** — logical separation into `ui/`, `tables/`, `layout/`, `cards/`, `forms/`, `charts/`, `dialogs/`, `shared/`, `maps/`, `kanban/`
2. **TanStack Query** is used correctly with query keys, mutations, cache invalidation
3. **DataTable component** is well-built (sorting, pagination, global filter, TanStack Table)
4. **Dark mode support** via CSS custom properties and ThemeProvider
5. **Responsive grid layouts** using Tailwind
6. **Dashboard layout** with collapsible sidebar and breadcrumb top nav
7. **Loading states** exist (`loading.js` with skeleton animation)
8. **ErrorBoundary** component is wired in layout

### What's Missing / Needs Improvement

#### CRITICAL
1. **EVERY page is `"use client"`** — Zero Server Components. The dashboard layout, app-shell, and all pages are client-rendered. No `generateMetadata`, no `metadata` exports on dashboard pages. This kills SEO and increases bundle size.

2. **Dashboard page uses hardcoded mock data** — KPI values, recent activities, and AI insights in `dashboard/page.js` are all static. They should be fetched from the database via TanStack Query.

3. **No error states on any page** — Pages display loading skeletons but never handle query errors. If a query fails, the user sees nothing or an uncaught error.

#### HIGH
4. **Empty component directories** — `cards/`, `forms/`, `charts/`, `shared/` are all empty. These are placeholders.
5. **No `/settings/*` pages exist** despite being in the sidebar — only a few routes are missing entirely.
   - Missing: `/settings/*` (all settings pages), `/fleet/vehicles/[id]/edit` exists but no detail page content verified
6. **`fleet-table.jsx` uses `confirm()` for delete** — Should use a proper dialog/modal component.
7. **Notifications page** exists in sidebar but implementation unknown (likely empty/mock).
8. **No mobile navigation** — The sidebar is fixed on all screen sizes. On mobile, the 60px left margin will consume the screen.

#### MEDIUM
9. **Dispatch board is a read-only Kanban with a "move forward" button** — No real drag-and-drop. The column title says "Drag and drop" but it's not implemented.
10. **Avatar fallback shows hardcoded "SA"** in collapsed sidebar — Should use actual user data from `useAuth`.
11. **Notification badge shows hardcoded "3"** — Not wired to real notification count.
12. **No `generateMetadata`** in any dashboard page — Title/breadcrumb is derived from pathname on the client side via `usePathname()`.

---

## 5. Services Layer Review

### What's Good
1. **Consistent pattern** — All services follow the same structure: `async function getX(filters)`, `createX`, `updateX`, `deleteX`
2. **Filter-based queries** with conditional chaining
3. **Pagination support** in vehicle, driver, fuel services
4. **AI service** has reasonable scoring logic for vehicle/driver recommendations

### What's Missing / Needs Improvement

#### CRITICAL
1. **No TypeScript** — All services are `.js` files. No type safety, no `typeof`, no `interface`. This will cause runtime errors as the app grows.
2. **No Zod validation** — Service functions accept raw objects and pass them directly to Supabase `insert()`/`update()`. No schema validation anywhere.
3. **`driver_stats` table doesn't exist** — The service queries `supabase.from("driver_stats")` but there is no migration that creates it. This will fail in production.
4. **Auth service creates `employees` record from client** — `signUp()` in `auth.service.js` does `supabase.from("employees").insert(...)` directly from the client. This bypasses RLS and is a security concern. Should be done via a server action or edge function.

#### HIGH
5. **`createClient()` is called inside every function** — Creates a new Supabase client instance per function call. Should be instantiated once per service file or passed as dependency.
6. **No error handling beyond `throw error`** — Errors from Supabase are raw and unformatted. No consistent error shape, no user-friendly messages.
7. **`getNotifications()` doesn't filter by current user** — Returns all notifications without filtering by `employee_id` or `user_id`.
8. **`markAllAsRead()` updates ALL notifications** — Doesn't scope to current user. Will mark everyone's notifications as read.

#### MEDIUM
9. **`notification.service.js` `getNotificationIcon()` returns string keys, not React components** — Dead code or misleading.
10. **`fuel.service.js` `getFuelAnalytics()` does client-side aggregation** — Should use database aggregation for large datasets.
11. **`report.service.js` does all aggregation client-side** — Will be slow with real data volume.
12. **`ai.service.js` `getPredictiveMaintenance()` calculates everything in JavaScript** — Should use database functions or a cron job that pre-computes.

---

## 6. Security Review

### What's Good
1. **RLS enabled on all tables** — Comprehensive row-level security
2. **Role-based RLS helper functions** (`get_current_employee_role()`, `has_role()`)
3. **Admin client uses `SUPABASE_SERVICE_ROLE_KEY`** — Properly segregated from client
4. **Environment variables for secrets** — No hardcoded keys in code
5. **Supabase SSR for cookie-based auth** — Proper session management
6. **Storage bucket for face captures is private** — `face-captures` bucket is not public

### What's Missing / Needs Improvement

#### CRITICAL
1. **No HTTPS enforcement** — Should be configured in `next.config.mjs`
2. **No rate limiting** — Auth endpoints (login, signup, password reset) are exposed without rate limiting
3. **`integration.service.js` `processInboundBooking()` is callable from the client** — This function creates reservations from external booking data. It's a JS function importable by any client component. This should be an API route or edge function.
4. **`signUp()` creates employee profiles from the client** — The `supabase.from("employees").insert()` runs with the client anon key and should be gated behind a server action with admin privileges.

#### HIGH
5. **No CSRF protection** — Server Actions handle CSRF naturally, but since there are no Server Actions and all mutations go through Supabase directly, there's no CSRF protection.
6. **No input sanitization** — Search terms with `ilike.%${filters.search}%` could be vulnerable to pattern injection.
7. **No request size limiting** — On forms/file upload endpoints
8. **`X-XSS-Protection`, `Content-Security-Policy` headers not configured** — Should be set in `next.config.mjs`

#### MEDIUM
9. **JWT session data might expose sensitive info** — The Supabase anon key is public by design, but ensure no sensitive custom claims are in the JWT
10. **No IP allow-listing for admin endpoints** — `integration_log` is admin-only via RLS, but there's no network-level restriction
11. **No audit trail on most mutations** — `audit_logs` table exists but is never written to (no triggers or middleware)

---

## 7. Performance Review

### What's Good
1. **TanStack Query cache** with 30s stale time reduces redundant fetches
2. **Pagination support** in vehicle, driver, fuel queries
3. **Loading UI** with skeleton screens provides perceived performance
4. **CSS custom properties** for theming (no runtime style recalculation)

### What's Missing / Needs Improvement

#### CRITICAL
1. **No Server Components** — All pages are `"use client"`. Every page requires full client-side JS bundle download before rendering anything meaningful. First Contentful Paint will be slow.
2. **No `next/image` usage** — Any images (vehicle photos, avatars, etc.) lack automatic optimization.
3. **No streaming or Suspense boundaries** — Pages load all-at-once. Partial/streaming rendering not used.

#### HIGH
4. **Client-side aggregation for reports** — `getFuelAnalytics()`, `getMaintenanceReport()`, `getDriverPerformanceReport()` load all records and aggregate in JavaScript. This will fail with real data volume.
5. **`getAllDrivers()` fetches all drivers then filters in memory** for stats — Should use database count with GROUP BY.
6. **`gpstracking` has no partitioning** — Time-series table with high insert volume will degrade.
7. **No pagination on GPS tracking queries** — `getTripLocations()` loads ALL tracking points for a trip.
8. **No infinite scrolling or virtual scrolling on tables** — Tables load all data and paginate client-side. DataTable only shows 10 rows, but all data is fetched.

#### MEDIUM
9. **No image optimization** — `next.config.mjs` has no image configuration
10. **No bundle analysis** — Hard to know what's in the JS bundles
11. **No `dynamic` imports** with `next/dynamic` for heavy components (maps, charts)
12. **Recharts and Leaflet are imported statically** — Both are large libraries that should be lazy-loaded

---

## 8. Configuration & Build Review

### What's Good
1. **Tailwind v4** with CSS-based configuration and `@theme` directive
2. **Clean `.env.local.example`** with all required variables documented
3. **PostCSS** configured for Tailwind
4. **ESLint** configured with Next.js defaults

### What's Missing
1. **`next.config.mjs` is minimal** — Missing: images domains, headers (CSP, HSTS), redirects, rewrites, webpack config
2. **No `tsconfig.json`** — Only `jsconfig.json` exists, confirming the project is JS-only
3. **No Sentry or error monitoring configured**
4. **No Vercel Analytics or similar**
5. **No health check endpoint**

---

## 9. Priority-Ordered Development Roadmap

### Phase 0 — Fix Critical Blockers (Do This First)

| # | Task | Area | Why |
|---|------|------|-----|
| 1 | **Create `driver_stats` view** | Database | Service layer queries a non-existent table — runtime failure |
| 2 | **Add Zod validation schemas** | Validation | Zero input validation across entire app |
| 3 | **Move `signUp` employee creation to server** | Security | Employee profile creation runs from client — RLS bypass risk |
| 4 | **Add all missing API routes** | API | No integration endpoints, no CRUD routes, no validation layer |
| 5 | **Fix `getNotifications` to filter by current user** | Security | Currently returns all notifications to all users |

### Phase 1 — Architecture Foundations

| # | Task | Area | Why |
|---|------|------|-----|
| 6 | **Convert to TypeScript** | Code Quality | `.js` => `.ts` — type safety prevents entire classes of bugs |
| 7 | **Add Server Components** | Frontend | Convert layout and pages to RSC; push client boundaries inward |
| 8 | **Add `generateMetadata` to all pages** | Frontend | SEO, proper page titles, Open Graph |
| 9 | **Create Server Actions for mutations** | Architecture | Replace direct `supabase.insert()` with server-validated mutations |
| 10 | **Move all data aggregation to database** | Performance | Reports, fuel analytics, driver stats — use SQL views or RPCs |

### Phase 2 — Core Features & Missing Pages

| # | Task | Area | Why |
|---|------|------|-----|
| 11 | **Wire dashboard with real data** | Frontend | Dashboard uses hardcoded mock data |
| 12 | **Implement `/settings/*` pages** | Frontend | Referenced in sidebar, missing entirely |
| 13 | **Add error boundaries and error states** | Frontend | No error handling on any data-fetching page |
| 14 | **Implement real drag-and-drop dispatch board** | Frontend | Current "Kanban" is just a list with a button |
| 15 | **Build integration API endpoints** | API | `/api/integration/*` endpoints are specified in docs but not built |

### Phase 3 — Performance & UX

| # | Task | Area | Why |
|---|------|------|-----|
| 16 | **Add streaming and Suspense boundaries** | Performance | Progressive rendering for slower queries |
| 17 | **Implement cursor-based pagination** | Performance | Large list queries (trips, GPS tracking) need efficient pagination |
| 18 | **Add `next/image` optimization** | Performance | Vehicle images, avatars, face captures |
| 19 | **Lazy-load Recharts and Leaflet** | Performance | These are heavy libraries statically imported |
| 20 | **Implement mobile-responsive navigation** | Frontend | Sidebar is unusable on mobile |

### Phase 4 — Security Hardening

| # | Task | Area | Why |
|---|------|------|-----|
| 21 | **Add rate limiting to auth endpoints** | Security | No protection against brute force |
| 22 | **Configure CSP, HSTS, and security headers** | Security | Missing `next.config.mjs` security headers |
| 23 | **Add audit logging middleware** | Security | `audit_logs` table exists but is never written to |
| 24 | **Add partition/retention strategy for large tables** | Database | `gpstracking`, `audit_logs`, `integration_log`, `notifications` |

### Phase 5 — Testing & Polish

| # | Task | Area | Why |
|---|------|------|-----|
| 25 | **Add unit tests for services** | Testing | Critical business logic is untested |
| 26 | **Add integration tests for API routes** | Testing | No test coverage at all |
| 27 | **Add database migration tests** | Testing | Seed data exists, but no migration validation |
| 28 | **Add E2E tests for critical flows** | Testing | Auth, create reservation, dispatch, complete trip |
| 29 | **Set up error monitoring (Sentry)** | DevOps | No error tracking in production |
| 30 | **Add health check endpoint** | DevOps | `/api/health` for monitoring uptime |

---

## 10. Summary of Findings

### Strengths
- Well-organized project structure with clear domain separation
- Excellent database schema with soft deletes, RLS, indexes, triggers
- Good use of TanStack Query for server state management
- Clean, consistent service layer pattern
- Sub-system integration architecture is well-documented and thought out
- Dark mode, responsive grids, loading skeletons show attention to UX
- Comprehensive seed data for development

### Critical Issues (Must Fix Before Production)
1. **`driver_stats` table/view does not exist** — service layer queries a phantom table
2. **Zero input validation** — empty `validations/` directory, no Zod anywhere
3. **All pages are `"use client"`** — no Server Components, no streaming, no metadata
4. **Employee creation from client side** — security hole in auth flow
5. **No API routes for integration sub-system** — documented architecture but not built
6. **No error handling on any data-fetching page** — users see nothing on failure

### Recommendations Summary
1. **Add TypeScript immediately** — the codebase is at high risk of type-related runtime errors
2. **Build the integration API layer** — the sub-system architecture is well-planned but unimplemented
3. **Move to Server Components + Server Actions** — the current client-only approach won't scale
4. **Create database views for aggregations** — stop doing expensive client-side number crunching
5. **Add Zod validation everywhere** — every `insert()` and `update()` needs schema validation
6. **Secure the auth flow** — move employee profile creation to an edge function or server action
