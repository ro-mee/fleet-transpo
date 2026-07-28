# FleetOps — Full Architecture Review

**Project:** Fleet Transportation Management System  
**Stack:** Next.js 16 + Supabase + Tailwind 4 + React 19  
**Date:** 2026-07-28  

---

## 1. What's Good

### 1.1 Domain Model & Schema
- **Comprehensive domain coverage.** 22 tables (post-cleanup) cover the full lifecycle: employees, vehicles, drivers, routes, reservations, dispatch, trips, fuel, maintenance, GPS tracking, notifications, AI insights, audit logs, and integration.
- **Soft deletes** (`deleted_at`) on every primary entity — safe data retention.
- **RLS is enabled on every table** with role-aware policies across 8 roles. The helper functions `get_current_employee_role()` and `has_role()` are clean patterns.
- **Migration 005 (schema cleanup)** was a brave, necessary refactor cutting 40 tables to 22:
  - Merged `permissions` + `role_permissions` into `roles.permissions` (JSONB)
  - Merged `vehicleinspection` into `vehiclemaintenance`
  - Inlined `vehicledocuments` into `vehicles.documents` (JSONB)
  - Dropped `vehicleassignment` (redundant with dispatch)
  - Simplified fuel sub-system (dropped `fuelstations`, `fuelrequests`, `fuelallocations`, `fuelconsumption`)
  - Dropped `offlinesync`, `mobiledevices`, `automation_*`, `scheduled_*`, `system_config`
- **Migration 004 (integration sub-system)** adds a hotel/PMS integration layer with `service_types`, `booking_channels`, `integration_log` — a clean bounded context.
- **`driverattendance`** with face recognition support and storage bucket in migration 006 is well-designed.
- **Database triggers** for auto-generated dispatch numbers, `updated_at` maintenance, and automatic notification creation are solid.

### 1.2 Service Layer
- All 12 services (`vehicle`, `driver`, `trip`, `dispatch`, `fuel`, `auth`, `reservation`, `notification`, `route`, `ai`, `report`, `integration`) follow a consistent pattern: import `createClient()`, build queries with filter chaining, return data.
- **`driver.service.js`** has a nice pattern: `stripDerivedFields()` to prevent writing aggregated fields back, and queries `driver_stats` view for real data.
- **`reservation.service.js`** includes conflict detection logic (`getReservationConflicts`) — good domain logic at the service level.
- **`trip.service.js`** has a fallback in `getLatestLocations` that tries the RPC first then falls back to raw GPS tracking query.
- **`ai.service.js`** implements simple scoring algorithms for vehicle and driver recommendations — good as a starting point.
- **`report.service.js`** aggregates fleet utilization, fuel consumption, maintenance, driver performance, and financial summary.
- **`integration.service.js`** has a well-defined inbound/outbound event logging pattern with processed/failed/skipped states.

### 1.3 Frontend Architecture
- **`providers.jsx`** composes `QueryClientProvider` + `ThemeProvider` + `AuthProvider` cleanly. React Query configured with sensible defaults (30s stale time, 1 retry, no refetch on focus).
- **`use-auth.js`** is a proper context-based auth hook with listener cleanup.
- **`use-realtime.js`** uses Supabase Realtime for GPS tracking updates — good architectural decision.
- **`dashboard-layout.jsx`** conditionally renders full layout vs. bare auth routes. Collapsible sidebar is a nice UX touch.
- **`app-shell.jsx`** has a well-structured sidebar nav with groups, expandable sub-items, active state detection, dark mode toggle, and user avatar.
- **`data-table.jsx`** is a reusable generic table using `@tanstack/react-table` with sorting, filtering, pagination.
- **`globals.css`** uses Tailwind 4 with CSS variables for theming.
- **Dashboard page** displays 12 KPI cards, chart placeholders, live tracking placeholder, recent activity, and AI insights.

### 1.4 Page Coverage (39 routes)
| Section | Pages |
|---|---|
| Auth | login, register, forgot-password, reset-password |
| Dashboard | dashboard |
| Fleet | dashboard, vehicles (list/detail/new/edit), categories, maintenance |
| Operations | reservations (list/new/detail), dispatch (list/detail), routes, drivers (list/detail), trips (list/detail/active) |
| Monitoring | fuel, fuel/analytics, maintenance, tracking (live-map/history) |
| Intelligence | AI dashboard, predictive-maintenance, insights |
| Reports | reports, analytics |
| System | notifications, notification templates, preferences, settings (general/profile/security/api) |

### 1.5 API Routes
- OAuth callback, logout, and manifest route — minimal but correct proxy-layer API surface.

### 1.6 Edge Function
- `ai-recommend-vehicle` is a Supabase Edge Function (Deno) that scores and recommends vehicles. Good decoupling from the main app.

### 1.7 Env & Config
- Next.js 16 with Turbopack.
- `AGENTS.md` documents conventions.
- `.env.local.example` documents all required env vars.

---

## 2. What's Missing

### 2.1 CRITICAL: No TypeScript
- **Every `.js`/`.jsx` file is JavaScript.** No TypeScript anywhere except the Deno edge function. This is a significant risk for a project of this size (39 pages, 12 services, 20+ components). No type safety for Supabase queries, no autocomplete, no compile-time error catching.

### 2.2 No Zod Validation Schemas
- `src/lib/validations/` and `src/lib/utils/` are empty directories. Despite `zod` and `react-hook-form` being dependencies, there are no validation schemas for forms, API inputs, or service parameters. This means every service function accepts `filters = {}` with no runtime validation.

### 2.3 No API Routes for CRUD
- The API route directory only has `auth/callback`, `auth/logout`, and `manifest`. There are no REST API routes for vehicles, drivers, trips, reservations, etc. The frontend calls the Supabase client **directly from the browser**. This means:
  - **No server-side validation.**
  - **No rate limiting.**
  - **Exposed anon key pattern** — RLS is the only defense.
  - **No transformation layer** between DB and client.
  - **No webhook/event hooks** between frontend and DB.

### 2.4 Empty Component Directories
- `forms/`, `cards/`, `dialogs/`, `charts/`, `maps/`, `shared/`, `kanban/` are all **empty directories**. These were clearly planned but never implemented. Every page currently builds UI inline rather than using reusable form, card, dialog, or chart components.

### 2.5 No Error Handling Strategy
- Every service function throws raw Supabase errors. There are no custom error classes, error codes, or client-side error boundaries beyond the root `ErrorBoundary` in `dashboard-layout.jsx`.
- The dashboard page shows `useAuth()` at the top level without a meaningful error state for auth failures.

### 2.6 No Testing
- No test files exist anywhere. No jest/playwright/cypress config. No test directories.

### 2.7 No Data Table for Most Pages
- Only `fleet-table.jsx` uses the reusable `DataTable`. Reservation, dispatch, driver, trip, and fuel pages presumably render inline tables or placeholder content.

### 2.8 Dashboard Has Hardcoded Data
- The dashboard KPI values are hardcoded (`const kpis = [{ label: "Total Vehicles", value: "24", ... }]`). The `recentActivities` and `aiInsights` arrays are also static. No queries are run to fetch real data.
- Chart placeholders show SVG icons instead of actual `recharts` charts (which is already in `package.json`).

### 2.9 No `not-found.js` or `error.js` Pages
- Only `loading.js` exists in the dashboard route group. No custom 404 or error pages.

### 2.10 No Middleware
- No `src/middleware.js` for route protection. Auth checks happen client-side only.

### 2.11 Limited Reporting
- `report.service.js` calculates data client-side from raw Supabase queries instead of using database views or materialized aggregates. The `byVehicle` arrays in fuel and maintenance reports are empty after aggregation.

### 2.12 No `driver_stats` View Definition
- `driver.service.js` queries `driver_stats` but this view/table is never defined in migrations. This will 404 at runtime.

### 2.13 Incomplete `service_types` Columns in Seed
- The seed inserts `icon` and `color` values but the schema doesn't define these as color/icon columns — only `icon` and `color` of type `VARCHAR`. Works but is worth noting.

### 2.14 No `update_updated_at` Trigger on Tables Missing It
- `vehiclecategory`, `fuelrecords`, `route`, `vehiclereservation`, `dispatchschedules`, `driver`, `driverattendance` — some have the trigger, others don't. Inconsistent.

---

## 3. What Needs Improvement

### 3.1 Services Create New Client on Every Call
- Every service function calls `createClient()` fresh, creating a new Supabase browser client instance. This should be a singleton or passed as a dependency.

### 3.2 No Pagination Metadata
- Services accept `page`/`pageSize` for range queries but never return `count` or `totalPages`. The frontend cannot properly paginate.

### 3.3 RPC for `get_latest_vehicle_locations` Not Defined
- `trip.service.js` calls `supabase.rpc("get_latest_vehicle_locations", ...)` with a fallback to raw query. The RPC is never defined in migrations.

### 3.4 Auth Service Uses `window.location.origin`
- `resetPassword()` in `auth.service.js` references `window.location.origin`, which will fail during SSR if this runs on the server. The function is likely client-only, but the risk exists.

### 3.5 `deleteNotification` Uses Hard Delete
- `notification.service.js:deleteNotification` calls `.delete()` instead of soft-delete. Inconsistent with the rest of the codebase patterns.

### 3.6 Empty `env.local` Files
- `.env.local` exists but presumably has no values configured. Without a working Supabase connection, the app will crash on any DB call.

### 3.7 No `driver_stats` PostgreSQL View
- All driver stats-related queries reference a `driver_stats` table/view that doesn't exist in any migration. The service layer will crash at runtime.

### 3.8 `integration.service.js` Hardcodes `source_system: "PMS"`
- The `processInboundBooking()` function defaults `sourceSystem` to `"PMS"` rather than reading from the booking payload.

### 3.9 Fleet Stats Duplication
- The fleet dashboard page (`fleet/page.js`) and fleet vehicles page (`fleet/vehicles/page.js`) both compute the same stats (total, available, inUse, maintenance) from the same query. This should be extracted.

### 3.10 No Linting Config for Project
- `eslint.config.mjs` exists but hasn't been reviewed. The project may lack consistent code style enforcement.

### 3.11 CSS Variable Names Inconsistent
- Some classes use `text-foreground`, `text-foreground-secondary`, `text-foreground-muted`, `bg-hover`, `bg-surface`, `bg-muted` — these suggest custom Tailwind theme variables. But without seeing `globals.css`, it's unclear if all are defined consistently.

### 3.12 Hardcoded "System Online" Badge
- Dashboard shows a hardcoded "System Online" badge. This should be driven by a real health check.

### 3.13 No Persistent Layout
- `DashboardLayout` wraps every route but calling `usePathname()` and `useState` in layout means the entire layout re-renders on every navigation.

### 3.14 Edge Function Missing Deno Types
- The `ai-recommend-vehicle` function uses `Deno.serve` without importing Deno types. No `import_map.json` or `deno.json` config for the functions directory.

---

## 4. Priority Development Roadmap

### Phase 1 — Foundation (Do First)
| # | Task | Effort | Impact |
|---|---|---|---|
| 1 | **Create `driver_stats` SQL view** in a new migration so the services don't crash | 1h | Critical |
| 2 | **Create `get_latest_vehicle_locations` RPC** in a migration | 1h | Critical |
| 3 | **Add `env.local`** with working Supabase credentials so the app can connect | 0.5h | Critical |
| 4 | **Wire dashboard KPI values to real queries** instead of hardcoded data | 4h | High |
| 5 | **Add `error.js` and `not-found.js`** to the dashboard route group | 1h | High |

### Phase 2 — Type Safety & Validation
| # | Task | Effort | Impact |
|---|---|---|---|
| 6 | **Convert project to TypeScript** (`tsconfig.json`, rename `.js` → `.ts`/`.tsx`, type services and components) | 40h | Highest |
| 7 | **Add Zod schemas in `src/lib/validations/`** for all entities (vehicle, driver, trip, reservation, dispatch, fuel) | 8h | High |
| 8 | **Add Zod resolver integration** with `react-hook-form` for all forms | 4h | High |

### Phase 3 — API Layer
| # | Task | Effort | Impact |
|---|---|---|---|
| 9 | **Build REST API routes** under `src/app/api/` for vehicles, drivers, trips, reservations, dispatch, fuel, maintenance | 24h | High |
| 10 | **Add input validation** to API routes using Zod | 4h | High |
| 11 | **Add rate limiting + CSRF** to API routes | 4h | Medium |
| 12 | **Migrate frontend from direct Supabase calls** to using API routes | 16h | High |

### Phase 4 — Frontend Components
| # | Task | Effort | Impact |
|---|---|---|---|
| 13 | **Build reusable form components** in `src/components/forms/` (VehicleForm, DriverForm, ReservationForm, etc.) | 16h | High |
| 14 | **Build reusable card/chart components** in `src/components/cards/` and `src/components/charts/` with `recharts` | 8h | Medium |
| 15 | **Build dialog/modal components** in `src/components/dialogs/` | 4h | Medium |
| 16 | **Build shared components** in `src/components/shared/` (empty state, loading skeleton variants, status badges) | 4h | Medium |
| 17 | **Implement actual Leaflet maps** in `src/components/maps/` for the tracking pages | 8h | Medium |

### Phase 5 — Performance & Auth
| # | Task | Effort | Impact |
|---|---|---|---|
| 18 | **Add `src/middleware.js`** for server-side route protection based on role | 3h | High |
| 19 | **Persist Supabase client** as singleton instead of `createClient()` per function call | 2h | Medium |
| 20 | **Add pagination metadata** (total count, pages) to all list services | 4h | Medium |
| 21 | **Move report aggregation to database views** instead of client-side JS | 8h | Medium |

### Phase 6 — Testing
| # | Task | Effort | Impact |
|---|---|---|---|
| 22 | **Set up Vitest** for service layer tests | 4h | High |
| 23 | **Write tests for all services** (mock Supabase client) | 16h | High |
| 24 | **Set up Playwright** for E2E tests on critical flows (login, vehicle CRUD, trip lifecycle) | 8h | High |
| 25 | **Write component tests** for `DataTable`, `FleetTable`, and UI primitives | 8h | Medium |

### Phase 7 — Polish
| # | Task | Effort | Impact |
|---|---|---|---|
| 26 | **Fix inconsistent `updated_at` triggers** — ensure every audited table has one | 1h | Low |
| 27 | **Add WebSocket/SSE endpoints** for real-time GPS tracking in addition to Supabase Realtime | 4h | Medium |
| 28 | **Build Kanban dispatch board** in `src/components/kanban/` | 8h | Medium |
| 29 | **Set up edge function CI/CD** with `deno.json` and import maps | 2h | Low |
| 30 | **Add comprehensive seed data** for all tables (maintenance records, GPS tracking history, cost analysis, etc.) | 4h | Medium |

---

## 5. Summary

**Strengths:** Solid domain model, good RLS posture, clean service-level patterns, comprehensive page structure, well-thought-out schema cleanup, and a forward-looking integration sub-system.

**Weaknesses:** No TypeScript, no API layer (direct browser-to-DB calls), empty component directories, hardcoded dashboard data, no middleware, missing DB views/RPCs that services depend on, no tests, no Zod validation.

**The biggest risk** is direct browser-to-Supabase calls with the anon key for all CRUD. While RLS provides per-row security, there's no server-side validation, no request transformation, and no rate limiting. This should be the top architectural priority to fix.
