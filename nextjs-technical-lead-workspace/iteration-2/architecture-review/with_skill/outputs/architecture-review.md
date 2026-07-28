# FleetOps — Full Architecture Review

**Date:** 2026-07-28
**Reviewer:** AI Senior Technical Lead (Next.js)
**Status:** Complete

---

## 1. Project Discovery Summary

**Business Domain:** Fleet Transportation Management System — designed for hotel/restaurant operations to manage vehicle fleets, driver assignments, reservations, dispatching, trip tracking, fuel, maintenance, and integration with parent booking (PMS/POS) systems.

**Framework:** Next.js 16.2.11 (App Router) + React 19.2.4
**Database:** PostgreSQL via Supabase
**Auth:** Supabase Auth (email/password + Google OAuth)
**Styling:** Tailwind CSS v4
**UI Library:** Radix primitives (via shadcn/ui patterns)
**State:** TanStack Query (server state) + Zustand (client state, present in deps)
**Maps:** Leaflet + React-Leaflet
**Charts:** Recharts

---

## 2. What's Good

### Database
- Comprehensive domain model: 22+ tables covering all fleet operations
- Proper foreign keys, indexes, soft-delete patterns (deleted_at), and audit fields (created_by, updated_by)
- RLS enabled on all tables with role-based policies (admin, fleet_manager, dispatcher, driver)
- Database triggers for automated notifications (reservation approved, dispatch assigned, maintenance due, trip completed)
- Integration sub-system (migration 004) for parent booking system connectivity
- CHECK constraints on critical enums (driverattendance status, check_in_method, integration_log direction/status)
- Partition-friendly design for gpstracking (time-series ready)
- Clean migration history — 6 migrations with clear purpose
- Migration 005 shows deliberate schema cleanup (40→22 tables)

### Service Layer
- Thin, focused service modules per domain (vehicle, driver, trip, dispatch, fuel, etc.)
- Consistent pattern: `getX`, `getX(id)`, `createX`, `updateX`, `deleteX`
- Client-side query filtering via filter objects
- Soft-delete awareness across all queries

### Frontend
- Feature-based route groups under `(dashboard)/` and `(auth)/`
- Reusable `DataTable` component built on TanStack Table with sorting, pagination, search
- Reusable `FleetTable` on top of DataTable
- Error boundary component at layout level
- Dark/light theme with localStorage persistence
- Clean CSS architecture with CSS variables and Tailwind v4 `@theme inline`
- Sidebar with collapsible nav groups, breadcrumb top nav
- Consistent use of shadcn/ui components (Card, Badge, Button, Input, Avatar)

### Constants
- Well-organized constants file with all status enums, service types, booking channels, integration sources
- Single source of truth for domain values

### Tooling
- ESLint configured
- `.env.local.example` documents all required env vars
- `jsconfig.json` path alias (`@/` → `./src/*`)

---

## 3. Critical Issues

### 🔴 3.1 No TypeScript — Entire Codebase is JavaScript
Every file is `.js`/`.jsx`. No type safety. This is the single biggest risk. With 22+ database tables and complex domain relationships, the absence of types will cause runtime errors, make refactoring dangerous, and eliminate the benefits of IDE autocompletion.

**Fix:** Rename to `.ts`/`.tsx`, install `@types/react`, `@types/node`, generate Supabase types.

### 🔴 3.2 No Input Validation Anywhere
Zod is in `package.json` but **never imported**. Every service function accepts raw data from the client and passes it directly to Supabase. No schema validation, no type coercion, no sanitization.

**Fix:** Add Zod schemas to every `create` and `update` service function, plus API routes.

### 🔴 3.3 No API Routes — All Mutations Are Client-Side
Only 3 API routes exist (auth callback, logout, manifest). Every other CRUD operation calls Supabase directly from browser client code. This means:
- Business logic lives in client components
- No server-side validation
- No webhook endpoints for integration
- Cannot be consumed by external systems
- Service role key usage is uncontrolled

**Fix:** Create Route Handlers (or Server Actions) for all mutations. Move service layer to use server-side Supabase client.

### 🔴 3.4 Service Layer Uses Browser Client Exclusively
All services import from `@/lib/supabase/client` (browser `createBrowserClient`). This makes them unusable in Server Components, Route Handlers, or Server Actions. The server.js client exists but is never used by any service.

### 🔴 3.5 Missing `driver_stats` Table/View
Multiple services (`driver.service.js`, `ai.service.js`, `report.service.js`) query a `driver_stats` table/view that does not exist in any migration. This would cause runtime errors in production. The derived fields (`performance_score`, `total_trips`, `total_distance`, `total_hours`, `rating`) were stripped from the `drivers` table in migration 005 but no replacement was created.

### 🔴 3.6 No Auth Middleware
No `middleware.js` at the root. Route protection is handled client-side only via the `useAuth` hook. This means:
- Protected pages are exposed until JS loads
- API routes have no auth enforcement
- Anyone with the URL can see the HTML source

---

## 4. High Priority Issues

### 🟠 4.1 No Tests
Zero test files. No `jest`, `vitest`, `@testing-library/react`, or Playwright configuration. Critical business logic (status transitions, conflict detection, cost calculations) is untested.

### 🟠 4.2 Dashboard Uses Hardcoded Data
All KPI values on `/dashboard` are hardcoded strings ("24", "8", "12", etc.). Charts are placeholder divs. The dashboard has no data-fetching logic at all.

### 🟠 4.3 Static Sidebar User
The sidebar footer shows "System Admin" / "admin@fleetops.com" statically. Does not use the authenticated user context.

### 🟠 4.4 Hardcoded Notification Badge
The notification bell shows "3" as a hardcoded count.

### 🟠 4.5 No Pagination Metadata from Services
While the `DataTable` supports pagination and services accept `page`/`pageSize`, no service returns a total count. Clients can't know how many pages exist.

### 🟠 4.6 `getDispatchesByStatus` Fetches Everything Client-Side
Fetches ALL dispatches, then filters into status groups in JavaScript. Will not scale past a few hundred records.

### 🟠 4.7 No Loading/Error Boundaries on Most Pages
Only the dashboard layout has an `ErrorBoundary`. Individual pages lack `loading.js`, `error.js`, or Suspense boundaries.

### 🟠 4.8 GPS Real-time Hook Has Stale Closure
`useTrackingRealtime` depends on `vehicleIds?.join(",")` which creates a new string every render, potentially causing subscription churn.

---

## 5. Medium Priority Issues

### 🟡 5.1 Export Button Not Wired
The "Export" button on the fleet vehicles page has no onClick handler.

### 🟡 5.2 Analytics Route Exists but No Implementation
`/analytics` page file exists but content wasn't reviewed — likely empty or placeholder.

### 🟡 5.3 No Environment Variable Validation at Build/Start
Missing runtime validation for required env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, etc.).

### 🟡 5.4 `dangerouslySetInnerHTML` in Layout
Theme injection script uses `dangerouslySetInnerHTML`. While justified for flash-of-wrong-theme prevention, it should be isolated and reviewed.

### 🟡 5.5 No `metadata` Export on Sub-Pages
Only the root layout exports `metadata`. Sub-pages don't have page-specific SEO metadata.

### 🟡 5.6 Redundant Fuel Tables Dropped but Constants Remain
Fuel-related constants for `fuelrequests`, `fuelallocations`, `fuelconsumption` and `fuelstations` still exist in `constants.js` even though those tables were dropped.

### 🟡 5.7 No Rate Limiting
No rate limiting on auth endpoints or any public-facing endpoints.

### 🟡 5.8 No Audit Logging on Mutations
The `audit_logs` table exists in the schema but service functions don't write to it.

---

## 6. Low Priority / Nice-to-Have

### 🟢 6.1 Add Supabase Type Generation
Set up `supabase gen types` and generate a typed client.

### 🟢 6.2 Move to Server Components by Default
Most pages can be Server Components with small client islands.

### 🟢 6.3 Add WebSocket Presence for Live Tracking
The `gpstracking` table supports real-time but no presence/awareness is implemented.

### 🟢 6.4 Add Reservation Conflict Detection at DB Level
Currently done client-side in `reservation.service.js`. Should be a database constraint or RPC.

### 🟢 6.5 Add Image Optimization
Vehicle images and face captures aren't served through `next/image`.

### 🟢 6.6 Add Accessibility Audit
Skip keyboard navigation, ARIA labels, focus management review.

---

## 7. Database Schema Analysis

### Present Tables (after migration 005):
| Table | Purpose | Status |
|---|---|---|
| branches | Company branches/locations | ✅ |
| roles | User roles (admin, dispatcher, driver, etc.) | ✅ |
| employees | Employee profiles linked to auth.users | ✅ |
| vehiclecategories | Vehicle type categories | ✅ |
| vehicles | Vehicle fleet inventory | ✅ |
| drivers | Driver profiles linked to employees | ✅ |
| routes | Predefined route definitions | ✅ |
| vehiclereservations | Reservation/booking records | ✅ |
| dispatchschedules | Dispatch assignments | ✅ |
| trips | Trip records | ✅ |
| gpstracking | GPS location pings | ✅ |
| vehiclemaintenance | Service records | ✅ |
| fuelrecords | Fuel purchase records | ✅ |
| notifications | In-app notification queue | ✅ |
| audit_logs | Change tracking | ✅ |
| ai_recommendations | AI suggestions | ✅ |
| ai_insights | AI-generated insights | ✅ |
| service_types | Fleet service categorization | ✅ |
| booking_channels | Booking origin tracking | ✅ |
| integration_log | Parent system sync audit | ✅ |
| tripcostanalysis | Per-trip cost breakdown | ✅ |
| tripperformance | Per-trip performance metrics | ✅ |
| driverattendance | Attendance with face recognition | ✅ (restored in 006) |

### Missing:
- `driver_stats` — referenced but not created (view or materialized view needed)
- `dispatch_number_seq` — exists but should be documented in migration 001

### State Machine Gaps (Business Logic Review):
- Dispatch/vehicle/trip/reservation statuses accept any string — no CHECK constraints on most status fields
- No trigger guards preventing invalid status transitions (e.g., Completed → Pending)
- Conflict detection for overlapping reservations is client-side only

---

## 8. API Review

| Endpoint | Method | Auth | Validation | Status |
|---|---|---|---|---|
| `/api/auth/callback` | GET | None | None | ⚠️ Needs CSRF |
| `/api/auth/logout` | POST | Session | None | ✅ Basic |
| `/api/manifest` | GET | None | None | ✅ Static |

All CRUD operations (vehicles, drivers, trips, dispatch, fuel, etc.) are **missing as API routes**. The frontend calls Supabase directly.

---

## 9. Security Review

| Concern | Status | Notes |
|---|---|---|
| Authentication | ⚠️ | Client-side only, no middleware |
| Authorization (RLS) | ✅ | Good role-based policies |
| JWT handling | ✅ | Supabase handles this |
| Input validation | 🔴 | None whatsoever |
| SQL injection | ⚠️ | Supabase JS SDK is parameterized, but raw SQL in triggers is safe |
| XSS | ✅ | React handles escaping |
| CSRF | ⚠️ | No token validation on mutation endpoints |
| Environment secrets | ⚠️ | `SUPABASE_SERVICE_ROLE_KEY` in client-side admin.js is risky |
| Rate limiting | 🔴 | Not implemented |
| Audit logging | ⚠️ | Table exists, not populated |

---

## 10. Priority-Ordered Development Roadmap

### Phase 1 — Foundation (Critical)
1. **Add TypeScript** — rename all files `.ts`/`.tsx`, configure `tsconfig.json`, generate Supabase types
2. **Create `driver_stats` view** — migration to restore derived driver performance fields
3. **Add auth middleware** — `middleware.ts` at root to protect routes
4. **Add Zod validation** — schemas for every entity on create/update operations
5. **Create API routes** — Route Handlers for all CRUD operations (vehicles, drivers, trips, dispatch, fuel, maintenance, reservations)

### Phase 2 — Data Integrity (High)
6. **Add CHECK constraints** — on status fields for valid state values
7. **Move business logic to service layer** — create server-side services using `@/lib/supabase/server`
8. **Add reservation conflict detection at DB level** — exclusion constraint or RPC
9. **Wire audit logging** — populate `audit_logs` on mutations
10. **Implement pagination metadata** — return counts from all list services

### Phase 3 — Frontend Hardening (High)
11. **Wire dashboard to live data** — replace hardcoded KPIs with TanStack Query data
12. **Add loading.tsx + error.tsx** — to all route segments
13. **Fix sidebar user** — use actual auth context
14. **Wire notification badge** — use real unread count
15. **Fix `useTrackingRealtime`** — proper deps and cleanup

### Phase 4 — Testing & Quality (High)
16. **Set up test framework** — Vitest + Testing Library
17. **Write unit tests** — for service functions and business logic
18. **Write integration tests** — for API routes
19. **Add env validation** — runtime check at build/start

### Phase 5 — Performance & Scale (Medium)
20. **Add server-side pagination** — for all list endpoints
21. **Implement cursor-based pagination** for gpstracking
22. **Add rate limiting** — on auth and public endpoints
23. **Optimize `getDispatchesByStatus`** — use DB grouping instead of client-side filter

### Phase 6 — Integration & Features (Medium)
24. **Implement inbound webhook** — for parent system integration
25. **Wire export functionality** — CSV/Excel/PDF generation
26. **Add SEO metadata** — to all sub-pages
27. **Implement face recognition** — wire the existing face_capture_url pipeline

### Phase 7 — Polish (Low)
28. **Accessibility audit** — keyboard nav, ARIA, focus management
29. **Image optimization** — next/image for vehicle photos
30. **Remove stale constants** — for dropped fuel tables
31. **Add Supabase realtime presence** — for live driver tracking

---

## 11. Architecture Diagram (Text)

```
Browser Client
│
├─ Auth Routes (login, register, forgot-password, reset-password)
│   └─ useAuth hook → Supabase Auth
│
├─ Dashboard Routes (group: (dashboard))
│   ├─ Dashboard, Fleet, Reservations, Dispatch, Routes
│   ├─ Drivers, Trips, Fuel, Maintenance, Tracking
│   ├─ AI, Analytics, Reports
│   ├─ Notifications, Settings
│   │
│   ├─ Pages (all "use client")
│   │   ├─ TanStack Query → Service Functions → Supabase (browser client)
│   │   └─ Recharts, React-Leaflet for charts/maps
│   │
│   └─ Layout
│       ├─ Sidebar (app-shell.jsx)
│       ├─ TopNav (app-shell.jsx)
│       └─ ErrorBoundary
│
├─ API Routes (minimal — 3 total)
│   ├─ /api/auth/callback → Supabase OAuth
│   ├─ /api/auth/logout → Session end
│   └─ /api/manifest → Static JSON
│
└─ Service Layer (all client-side)
    ├─ auth.service.js, vehicle.service.js, driver.service.js
    ├─ reservation.service.js, dispatch.service.js, trip.service.js
    ├─ route.service.js, fuel.service.js, notification.service.js
    ├─ report.service.js, integration.service.js, ai.service.js
    └─ All use @/lib/supabase/client (browser)
```

**Current Gap:** Missing server-side API layer. The current architecture has no backend enforcement — all business logic runs in the browser.

---

## 12. Summary

**Strengths:** Excellent domain modeling, comprehensive schema, good RLS policies, modern stack choices, reusable UI components, well-organized constants.

**Critical Weakness:** The entire application is client-side. No API routes, no Server Actions, no TypeScript, no validation, no tests, no middleware. This is a functional prototype that needs architectural hardening before production.

**Estimated effort to production-ready:** ~4-6 weeks for a single developer following the roadmap above, with Phase 1-2 taking priority.
