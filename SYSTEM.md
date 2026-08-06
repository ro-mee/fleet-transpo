# FleetOps — Fleet & Logistics Management System

Comprehensive system overview for AI assistants and new developers. Covers architecture, tech stack, directory layout, database schema, API surface, auth/RBAC, the mobile companion app, and the business logic domains.

## 1. System Overview

**FleetOps** is a hotel-affiliated fleet & logistics management platform (guest transport for a hotel, e.g. "CoCo Star Hotel"). It runs the full lifecycle of guest transportation requests — from an external **Booking** subsystem through intake, review, approval, dispatch scheduling, trip execution, GPS tracking, fuel reporting, and maintenance — plus fleet/driver/vehicle management, analytics, reports, and a driver-facing mobile app.

It is a **single-organization** system (branch/multi-tenant concepts were removed in migration 013). There are two applications in one repo:

| App | Location | Tech | Audience |
|---|---|---|---|
| Web dashboard | `src/` | Next.js 16 (App Router) + React 19 | Admin, fleet managers, dispatchers, drivers, management |
| Mobile app | `mobile/` | Expo SDK 54 / React Native 0.81 (Expo Router) | Drivers |

**Latest changes:** FleetOps is scoped strictly to **fleet & transportation**. The
three hospitality roles (`reception_staff`, `restaurant_staff`, `concierge`)
were **removed** (migration `022_remove_front_desk_roles.sql`: role rows 5/6/8
deleted; the 3 employees who held them disabled). Six roles remain. Each role is
a distinct **workspace** (identity, tagline, accent, home, role-specific nav)
driven by `src/lib/workspaces.js` (`WORKS[role]`, `getWorkspace(role)`); role
dashboards render through `src/components/dashboard/role-dashboard.jsx` +
`dashboard-configs.js`. New **read-only operational/executive boards** reuse
existing data (see §8): `/fleet/availability`, `/drivers/availability`,
`/fleet/documents` (Vehicle/Driver tabs incl. driver licenses + vehicle
registration), `/drivers/performance`, `/reports/cost`, `/executive`. New
endpoints `GET /api/documents/expiring` and `GET /api/reports/fleet-cost`; the
`admin` role (`role_id 9`, "FleetOps Admin") was added earlier via migration
`019_admin_role.sql`.

---

## 2. Tech Stack

### Web (`package.json`)
| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.2.11** (App Router) | Repo `AGENTS.md` warns this Next version has breaking changes vs. earlier training data; guides in `node_modules/next/dist/docs/` |
| React | **19.2.4** | Server + client components |
| Auth | **next-auth ^4.24** (Credentials, JWT cookie sessions) | bcryptjs for password hashes; jose for mobile tokens |
| Database | **Supabase** (`@supabase/supabase-js` admin/service-role client) **+ raw `pg` Pool** on `DATABASE_URL` | Dual pattern; see §4.1 |
| Data fetching | **@tanstack/react-query ^5** | 30s staleTime, retry 1, no refetch-on-focus |
| Tables | @tanstack/react-table ^8 | generic `DataTable` |
| Forms | **react-hook-form + zod ^4** | `@/lib/validation/schemas.js` |
| UI | **shadcn-style** — ~17 `@radix-ui/react-*`, class-variance-authority, clsx, tailwind-merge, **lucide-react**, Tailwind **v4** (CSS-first, no config file) | components in `src/components/ui/` |
| Charts / maps | **recharts ^3**, **leaflet ^1.9 + react-leaflet ^5**, framer-motion, date-fns | live GPS map |
| OCR / AI docs | **tesseract.js ^7** + LLM provider abstraction | license / OR-CR / insurance scanning |
| Tests | **vitest ^3** | harnesses import real `src/lib` modules against the live DB |
| Scripts | `dev`, `build`, `start`, `lint` (eslint flat config), `test`/`test:run` | |

### Mobile (`mobile/package.json`)
- Expo SDK ~54, RN 0.81.5, React 19.1, **expo-router ~6** (file-based), **expo-secure-store** (tokens), **expo-location** (GPS), Google-font packages (Archivo / IBM Plex).
- Scripts: `start`, `tunnel` (`@expo/ngrok`), `android`, `ios`, `web`.

### Key environment config
- `.env` — Supabase URL/key, service-role key, `DATABASE_URL` (pg), `NEXTAUTH_SECRET`, `CRON_SECRET`, `BOOKING_WEBHOOK_SECRET`, `BOOKING_GATEWAY`, AI provider keys.
- `next.config.mjs` — minimal (`turbopack.root` only). **No middleware**.
- Path alias: `@/* → ./src/*` (`jsconfig.json`).

---

## 3. Directory Layout

```
capstone/
├── src/                        # Next.js web app
│   ├── app/
│   │   ├── layout.js           # ONLY root layout; wraps all pages in DashboardLayout
│   │   ├── page.js             # "/" → redirect /dashboard or /login
│   │   ├── globals.css
│   │   ├── (auth)/             # login, register(→redirect /login), forgot-password, reset-password
│   │   ├── (dashboard)/        # all app modules (no group layout; chrome from DashboardLayout)
│   │   │   ├── dashboard/      # home KPIs, charts, live map, AI insights
│   │   │   ├── driver/         # ★ driver portal (new) — profile + consent gate
│   │   │   ├── fleet/          # vehicles (+ new/[id]/edit), categories, availability, documents
│   │   │   ├── drivers/        # list, new, [id] (detail+account), [id]/edit, availability, performance
│   │   │   ├── trips/          # register, active (live cards), [id]
│   │   │   ├── reservations/   # register, queue (dispatcher workspace), new (dev mock), [id]
│   │   │   ├── dispatch/       # kanban board, calendar, [id]
│   │   │   ├── fuel/           # records (approval workflow), analytics
│   │   │   ├── maintenance/    # records, predictive (AI)
│   │   │   ├── tracking/       # live-map, history
│   │   │   ├── routes/
│   │   │   ├── ai/             # insights, predictive-maintenance, provider settings, logs
│   │   │   ├── reports/        # 5 report types + cost dashboard
│   │   │   ├── analytics/
│   │   │   ├── executive/      # ★ Executive KPI Center (management/admin, read-only)
│   │   │   ├── notifications/  # feed, preferences, templates
│   │   │   ├── system/         # ★ System Console (admin) — audit log (system_admin only)
│   │   │   └── settings/       # general, profile, security, users/new, api, ai/logs
│   │   └── api/                # ~99 route handler files (see §6)
│   ├── components/
│   │   ├── layout/             # app-shell, dashboard-layout (+RouteGuard)
│   │   ├── dashboard/          # ★ role-dashboard renderer + dashboard-configs.js
│   │   ├── ui/                 # shadcn primitives (card, button, dialog, toast, ...)
│   │   ├── tables/             # data-table, fleet-table
│   │   ├── maps/               # live-locations-map
│   │   ├── drivers/            # assigned-vehicle-card
│   │   ├── dispatch/  reservations/
│   │   ├── providers.jsx       # SessionProvider + QueryClientProvider
│   │   └── error-boundary.jsx
│   ├── lib/
│   │   ├── db.js               # getAdminClient(), getPool()/query()/withTransaction()
│   │   ├── auth.js             # NextAuth options (Credentials, JWT, rate-limited)
│   │   ├── constants.js        # ROLES, ROLE_IDS, status lifecycles, etc.
│   │   ├── workspaces.js       # ★ WORKS[role] per-role workspace (identity, accent, home, nav) + getWorkspace()
│   │   ├── auth/               # api-auth, permissions.js (RBAC matrix), role-guard, mobile-token
│   │   ├── api/                # utils (requireAuth/ok/err), client (apiFetch), service-auth, ownership, trips-query
│   │   ├── consent/            # policies.js, driver-visibility.js (NEW)
│   │   ├── scheduling/         # calendar, conflicts, dispatch/trip/reservation state machines
│   │   ├── integration/        # booking-gateway, contracts, category-resolver, status-map
│   │   ├── ai/                 # llm-adapter, rule-engine, dispatch-advisor, predictive-maintenance
│   │   ├── validation/         # schemas (zod), useFormValidation, helpers
│   │   └── geo/, vehicles/
│   ├── services/               # 24 thin apiFetch wrappers + server business-logic services
│   └── hooks/                  # use-auth, use-realtime, use-role-access, use-theme, ...
├── mobile/                     # Expo driver app (see §8)
├── supabase/
│   ├── migrations/             # 27 SQL migrations (see §5)
│   ├── config.toml
│   └── functions/ai-recommend-vehicle/   # edge function
├── docs/                       # design-system.md, rbac-model.md, mobile-mvp.md
├── scripts/                    # ~20 verification harnesses (run against live DB)
├── resources/ai/instructions.md
├── proxy.js                    # dev proxy for Booking gateway mock
└── SYSTEM.md                   # this file
```

---

## 4. Architecture Patterns

### 4.1 Dual database access
- **`getAdminClient()`** — Supabase service-role client (bypasses RLS) used for most row operations.
- **`getPool()` / `query()` / `withTransaction()`** — raw `pg` Pool on `DATABASE_URL` for raw SQL, joined reads, and atomic multi-statement transactions (e.g. driver↔vehicle assignment swaps).
- **Important:** RLS policies in the SQL are **inert by design** — both DB connections bypass RLS. **Authorization is enforced in the application layer** (`requireAuth`) only. See `docs/rbac-model.md` and §7.

### 4.2 Request flow & auth resolution (`src/lib/api/utils.js`)
- `resolveIdentity(req)` — if `Authorization: Bearer <token>` present → verify mobile JWT (`jose`, `NEXTAUTH_SECRET`) → `{ user, via: "bearer" }`; else fall back to NextAuth cookie session (`auth()`), backfilling `driverId` for driver roles. Bearer wins when both present.
- `requireAuth(req, allowedRoles)` — resolves identity, throws `AuthError(401)` unauth / `AuthError(403)` wrong role. **`DEFAULT_ROLES = ["system_admin","admin","fleet_manager","dispatcher","management"]`** (driver excluded by default).
- `requireDriver(req)` — `requireAuth(req, ["driver"])` + guarantees a linked `driverId` exists (403 otherwise).
- Shared: `parseBody`, `ok`, `err`, `errValidation`, `validateBody`, `handleError`.
- M2M endpoints use `verifyServiceToken` (`src/lib/api/service-auth.js`, constant-time compare, Bearer or `?token=`, fail-closed when secret unset) — used by `/api/cron/sync` and the integration POST.
- Ownership scoping: `src/lib/api/ownership.js` — `assertTripOwnership`, `assertDispatchOwnership` (404 for other drivers' rows), `resolveDriverScope` (403 if a driver requests another driver's data).

### 4.3 State machines
Centralized lifecycle logic lives in `src/lib/scheduling/` and server services:
- **Reservation lifecycle** (`reservation-lifecycle.service.js` + `lib/scheduling/reservation-state.js`): strict 9-state chain `Pending → Under Review → Approved|Rejected → Scheduled → Assigned → In Progress → Completed`; `Cancelled` from any non-terminal. `advanceReservation()` is the *only* place `fleet_status` changes; it validates the hop, persists, appends a timeline event, and notifies Booking.
- **Dispatch** (`dispatch-state.js`): `Scheduled → In Progress → Completed | Cancelled`.
- **Trip** (`trip-state.js`): 13-state `chk_trip_status`; `canTransitionTrip` gates; Completed/Cancelled delegate to `completeTrip`/`cancelTrip` which cascade to vehicle/driver/dispatch/request.
- `trip-lifecycle.service.js` — `completeTrip`, `cancelTrip`, `syncBusyTrip` (odometer validation, single UPDATE, cascades, audit).

### 4.4 Booking integration (anti-corruption layer)
The external **Booking** subsystem owns guest data + approval. Fleet:
- Ingests via `POST /api/integration/transport-requests` (idempotent on `external_booking_id`; `BOOKING_WEBHOOK_SECRET` or dispatcher session) and `POST /api/integration/pull`.
- Caches in `transportation_requests` (the **Fleet Reservation Queue**), back-links via `vehiclereservations.request_id` / `dispatchschedules.request_id`.
- Notifies Booking outbound via `outbound.service.js` (`emitTransportStatus`), logs everything in `integration_log`.
- Legacy `vehiclereservations` **write endpoints return 410 Gone** — replaced by this integration flow; reads remain for compatibility.

### 4.5 AI layer (optional LLM + rule engine)
- **Rule engine** (`lib/ai/rule-engine.js`) is the deterministic baseline (recommendations, insights, predictive maintenance).
- **LLM** (`lib/ai/llm-adapter.js`) adds natural-language summaries/narrations — failure-tolerant, time-budgeted (25 s), falls back to rule output.
- `ai_providers` config table (API keys masked); `ailogs` usage log; `POST /api/ai/scan-document` (tesseract OCR → regex → optional LLM) powers license / OR-CR / insurance scanning with LTO renewal scheduling.

---

## 5. Database Schema (PostgreSQL on Supabase)

28 migrations in `supabase/migrations/` (numbers are non-linear: no 008; pairs share 011, 013, 014, 017, 018, 019 — applied in filename order). **Migrations are applied via a direct `pg` connection (small Node script in repo dir), NOT the Supabase CLI or SQL editor** (see `AGENTS.md`).

### 5.1 Migration timeline
| Mig | File | Purpose |
|---|---|---|
| 001 | `schema.sql` | Baseline: 36 tables, `roles`, `employees`, `vehicles`, `drivers`, `trips`, `dispatchschedules`, `gpstracking`, audit/notifications/AI tables, `update_updated_at()` + `generate_dispatch_number()` |
| 002 | `rls_policies.sql` | RLS on all tables + `has_role()` helper (documented **inert** at runtime) |
| 003 | `notification_triggers.sql` | 5 SECURITY DEFINER notification triggers |
| 004 | `integration_sub_system.sql` | `service_types`, `booking_channels`, `integration_log`; guest columns on `vehiclereservations` |
| 005 | `schema_cleanup.sql` | Trim 40→22 tables (drop role_permissions/permissions/fuel sub-tables/attendance/incidents/etc.; merge inspection→maintenance) |
| 006 | `driver_attendance_face.sql` | `drivers.face_image_url`; recreate `driverattendance` w/ face fields; `face-captures` bucket |
| 007 | `normalization.sql` | `locations` table; restore `vehicledocuments`; merge trip cost+performance into `trips`; drop duplicate cols; create `driver_stats` VIEW |
| 009 | `auth_migration.sql` | `employees.password_hash` (bcrypt); seed admin |
| 010 | `registration_policy.sql` | anon INSERT/SELECT on employees (email-exists check) |
| 011a | `rls_fix.sql` | missing policies; grant `driver_stats` |
| 011b | `compliance_notifications.sql` | registration-overdue + license-expired triggers (duplicate-guarded) |
| 012 | `status_constraints.sql` | CHECK constraints on vehicle/driver/reservation/dispatch/trip status |
| 013a | `drop_branches.sql` | remove single-tenant branches |
| 013b | `registration_expired_status.sql` | add `Registration Expired` vehicle status |
| 014a | `mobile_tokens.sql` | `mobile_refresh_tokens` (hashed, revocable) |
| 014b | `cleanup_dead_objects.sql` | drop broken triggers/functions (auth trigger, dashboard stats, audit fns) |
| 015 | `transportation_requests.sql` | **Fleet Reservation Queue** (`external_booking_id` UNIQUE idempotency) |
| 016 | `reservation_module.sql` | 9-state lifecycle, `reservation_number`, AI recommendation cols, `reservation_events` timeline |
| 017a | `driver_consents.sql` | ★ **privacy consent audit table** (append-only) |
| 017b | `driver_vehicle_assignments.sql` | permanent driver↔vehicle pairing w/ 2 partial UNIQUE indexes |
| 018a | `predictive_maintenance.sql` | `vehicles.service_interval_km/days` |
| 018b | `cleanup_dead_columns.sql` | drop 6 never-read/written columns |
| 019 | `service_interval_guards.sql` | positive-interval CHECKs + partial `idx_trips_end_time` |
| 019 | `admin_role.sql` | ★ insert **`admin`** role (`role_id 9`); backfill role-less active drivers to `driver` |
| 020 | `fuel_hardening.sql` | fuel review workflow (`rejection_reason`, `approved_by/at`, status CHECK) |
| 021 | `driver_personal_details.sql` | `drivers.address/sex/birthdate/nationality` (license scan auto-fill) |
| 022 | `remove_front_desk_roles.sql` | ★ drop `reception_staff`/`restaurant_staff`/`concierge` (role rows 5/6/8); disable the 3 employees who held them |
| 023 | `dispatch_overlap_guard.sql` | ★ DB-level double-booking guard trigger + advisory locks on `dispatchschedules` |
| 024 | `driverincidents.sql` | ★ recreate `driverincidents` (dropped in 005) — driver incident reporting + breakdown automation |
| 025 | `uvvrp.sql` | ★ Number Coding (UVVRP): `uvvrp_exemptions` + `uvvrp_violations` tables |

### 5.2 Tables (final state)
| Table | Domain | Notes |
|---|---|---|
| `roles` | auth | `role_id`, `role_name` UNIQUE |
| `employees` | auth/users | 1:1 with `auth.users`, `role_id`, `password_hash`, soft-delete |
| `vehiclecategories` | fleet | base/per-km/per-hour rates, seating |
| `vehicles` | fleet | plate UNIQUE, status CHECK, service intervals, expiry dates |
| `drivers` | drivers | license fields, status CHECK, GPS last-known, face image, personal details (021) |
| `routes` | operations | location FKs (007) |
| `vehiclereservations` | reservations | legacy assignment record; guest data deprecated (015) |
| `dispatchschedules` | operations | `dispatch_number` UNIQUE, status CHECK, `request_id` FK |
| `trips` | operations | 13-state CHECK, cost+performance cols (007) |
| `gpstracking` | tracking | BIGSERIAL time-series GPS |
| `vehiclemaintenance` | maintenance | inspection merged (005), inspection cols dropped (018b) |
| `vehicledocuments` | fleet | restored real table (007) |
| `fuelrecords` | fuel | review workflow (020) |
| `driverattendance` | attendance | face rec, UNIQUE (driver_id, date) |
| `notifications` | notifications | fed by triggers |
| `ai_recommendations`, `ai_insights` | AI | rule-engine output |
| `audit_logs` | audit | table survives; functions dropped (014b) — currently unwired |
| `service_types`, `booking_channels`, `integration_log` | integration | |
| `locations` | reference | named places |
| `mobile_refresh_tokens` | mobile auth | hashed, revocable, no RLS |
| `transportation_requests` | queue | 9-state `fleet_status`, `external_booking_id` UNIQUE, AI rec cols |
| `reservation_events` | timeline | append-only |
| **`driver_consents`** | ★ privacy | `driver_id`, `policy_version`, `accepted_at/via`, `ip_address`; append-only; index `(driver_id, accepted_at DESC)` |
| `driver_vehicle_assignments` | drivers | interval history + 2 partial UNIQUE active-pairing indexes |
| `system_settings` | settings | created ad-hoc by `scripts/seed-naia-routes.mjs` (not a migration) |

**Views:** `driver_stats` (computed from completed trips). **Storage:** `face-captures` bucket (private). **Sequences:** `dispatch_number_seq`.

### 5.3 DB-enforced integrity (highlights)
- Status CHECKs: vehicle (6), driver (5), reservation (6), dispatch (4), trip (13), transport fleet_status (9), fuel (4), priority (4).
- Partial UNIQUE: `uq_dva_active_driver`, `uq_dva_active_vehicle` (one active pairing per driver/vehicle).
- UNIQUE (driver_id, date) on attendance; positive service-interval guards; `idx_trips_end_time` partial index for 90-day maintenance window.

---

## 6. API Surface (`src/app/api/` — 99 route files)

All handlers call `requireAuth(req, [...roles])` / `requireDriver(req)`. Reads default to the 5 ops roles; writes are narrowed to admin/fleet_manager (+ dispatcher for dispatch/trip/integration; + driver for self-owned actions).

### Auth & account
- `auth/[...nextauth]` (GET/POST) — NextAuth Credentials.
- `auth/register` (POST) — **admin-only** employee account creation; 409 on duplicate email; no silent credential overwrite.
- `auth/profile` (PATCH), `auth/change-password` (POST) — self-service.

### Drivers & driver self-service
- `drivers/` (GET/POST) — list (filters; `includeUnlinked=1` surfaces driver-role employees without a `drivers` row flagged `requires_completion`); create (employee+driver, optional password, rollback on failure).
- `drivers/[id]` (GET/PUT/DELETE) — detail w/ `driver_stats` + last 20 trips + `account` block; update; soft-delete archive.
- `drivers/[id]/account` (PUT) ★ — **enable/reset driver login**: force driver role, set/reset bcrypt password, revoke all `mobile_refresh_tokens`.
- `drivers/link` (POST) ★ — finalize a driver profile for an existing driver-role employee missing a `drivers` row.
- `drivers/stats` (GET) — counts by status.
- `driver/me` (GET/PATCH) ★ — **driver's own profile**: license, performance, trips, attendance, consent status, editable fields, visible sections; PATCH only `DRIVER_SELF_EDITABLE_FIELDS` (`phone`, `face_image_url`, `license_image_url`, `license_back_image_url`). The license scan columns are writable only while the per-side `canUpdateLicenseScan` gate passes (no scan on file yet, or license within 30 days of expiry); otherwise they 403 as view-only. License number/class/expiry remain staff-only.
- `driver/license-scan` (POST) ★ — OCR + regex check (shared `src/lib/ai/license-ocr.js`) of a driver's own scan; returns `ok`/`unclear`, **no persistence** — an unreadable photo is never saved, so a driver retakes it until it reads clean.
- `driver/me/consent` (POST) ★ — record policy acceptance; 409 on stale `policy_version`.
- `driver/incidents` (GET/POST) ★ — driver-reported incidents (self-scoped to own trips).
- `driver/vehicle-inspection` (GET/POST) ★ — driver vehicle inspection reporting.

### Trips
- `trips/` (GET/POST), `trips/[id]` (GET/PUT) — shared `TRIPS_SELECT/TRIPS_JOINS` (`src/lib/api/trips-query.js`).
- `trips/[id]/status` (PUT) — state-machine transition (`canTransitionTrip`).
- `trips/[id]/start` (PUT), `trips/[id]/complete` (PUT) — odometer validation + cascade sync.
- `trips/[id]/locations` (GET/POST) — GPS breadcrumbs.
- `trips/active` (GET) — active fleet; **driver sees only own trips**.
- `trips/latest-locations` (GET) — latest GPS per vehicle.

### Vehicles, maintenance, fuel
- `vehicles/` (GET/POST), `vehicles/[id]` (GET/PUT/DELETE, archive admin-only), `vehicles/available`, `vehicles/[id]/documents`, `vehicle-documents/[id]`, `vehicle-categories/[id]`.
- `vehicle-maintenance/` (GET/POST), `vehicle-maintenance/[id]` (PUT) — drivers can file reports **without** moving the service schedule (ops roles only).
- `fuel/` (GET/POST), `fuel/[id]` (GET/PUT/DELETE) — Approve/Reject workflow (reason required; Completed locked), `fuel/analytics` (Approved only), `mobile/fuel` (POST) — vehicle/trip derived server-side.

### Reservations & integration (Booking)
- `reservations/` (GET, POST→410), `reservations/[id]` (GET, PUT→410), `reservations/[id]/cancel` (→410), `conflicts`, `service-types`, `booking-channels` — legacy **read-only**.
- `integration/transport-requests` (GET/POST — POST = inbound ingest), `[id]` (GET), `[id]/review|approve|assign|reschedule|cancel|reject` (PUT), `[id]/timeline` (GET), `[id]/recommendation` (GET/POST).
- `integration/inbound`, `outbound`, `pull`, `logs`.

### Dispatch & assignments
- `dispatch/` (GET/POST), `dispatch/[id]` (GET/PUT), `dispatch/[id]/status` (PUT), `dispatch/calendar` (GET), `dispatch/by-status` (GET).
- `driver-assignments/` (GET/POST), `driver-assignments/[id]` (DELETE) — transactional pairings.

### Reports, AI, notifications, system, mobile
- `reports/{maintenance,fuel-consumption,fleet-utilization,financial,driver-performance,fleet-cost}` (GET).
- `documents/expiring` (GET) ★ — Document Expiration Center: aggregates `vehicles.*_expiry` + `vehicledocuments.expiry_date` + `drivers.license_expiry` with days-left/expired flags (admin, system_admin, fleet_manager).
- `ai/recommendations`, `ai/predictive-maintenance`, `ai/insights[/[id]/dismiss]`, `ai/driver-insights`, `ai/providers[/[id]]`, `ai/providers/fetch-models`, `ai/scan-document`, `ai/logs`, `ai/instructions`.
- `notifications/` (GET/POST), `notifications/[id]/read`, `notifications/read-all`.
- `audit/` (GET) ★ — system audit log (system_admin only).
- `system/activity` (GET) ★ — system console activity feed.
- `routes/`, `routes/[id]`, `routes/seed-naia`, `locations/`, `settings/hotel`, `manifest`, `status/sync`, `cron/sync` (CRON_SECRET).
- `settings/uvvrp` (GET/PUT) ★ — configurable Number Coding (UVVRP) policy (`system_settings.uvvrp_policy`; enable, location preset, per-weekday ending digits, block|warn|approve response, exemption categories).
- `uvvrp` (GET) ★ — read-only board (restricted today, exemptions, upcoming restrictions, violation history, dispatches affected).
- `uvvrp/exemptions` (GET/POST), `uvvrp/exemptions/[id]` (PUT) ★ — per-vehicle coding exemptions (category, approver, optional expiry).
- `uvvrp/violations` (GET), `uvvrp/violations/[id]/decide` (POST) ★ — coding violation history + approve/deny pending approvals (defer-then-retry: an approved violation exempts that vehicle+date).
- `mobile/auth/login|refresh|logout`, `mobile/driver/me`, `mobile/driver/trips`, `mobile/driver/trips/[id]/accept|gps`, `mobile/fuel`.

### Client service layer (`src/services/`)
Thin `apiFetch` wrappers per domain: `auth, driver, vehicle, trip, reservation, reservation-lifecycle, reservation-events, dispatch, driver-assignment, fuel, transport, report, notification, route, location, settings, status, integration, outbound, maintenance-schedule, ai`. Server-only business-logic services (e.g. `reservation-lifecycle`, `trip-lifecycle`, `status`, `outbound`) are imported by route handlers.

---

## 7. Roles & RBAC

### Roles (6)
`system_admin`, `admin`, `fleet_manager`, `dispatcher`, `driver`, `management`.

> The hospitality roles `reception_staff`, `restaurant_staff`, `concierge` were
> removed in migration 022 (FleetOps is fleet & transport only). Their 3
> employees were disabled.

### Model
- Single source of truth: **`src/lib/auth/permissions.js`** — `MATRIX[role][resource][action]` with resources `vehicles, driver_assignments, reservations, dispatch, drivers, trips, maintenance, fuel, routes, categories, reports, analytics, ai, employees, system`. Verbs `create/read/update/delete` + reservation lifecycle verbs (`approve/assign/dispatch/cancel/reschedule`). `system_admin` short-circuits to always-true.
- **Denials are explicit** (e.g. management gets no lifecycle verbs — read-only by design).
- `NAV_ROLES[path]` drives the sidebar + route guard; `hasRole()`, `can()`, `filterNavItems()`, `getRequiredRolesForPath()`.
- **Per-role workspaces:** `src/lib/workspaces.js` maps each role to a workspace (name, tagline, accent, home route, role-specific `nav` groups). `getWorkspace(role)` falls back to `WORKS.admin` for unknown roles. The sidebar/top-nav render the active role's workspace; `filterNavItems` further gates each item by `NAV_ROLES[item.href]`.
- **Role dashboards:** `src/components/dashboard/role-dashboard.jsx` renders role-specific KPIs/widgets defined in `src/components/dashboard/dashboard-configs.js`.
- **Enforcement layers:** per-route `requireAuth(req, [...])` on the server (the real boundary); `useRequireRole()` / `RouteGuard` + `useRoleAccess()` on the client (convenience; brief render flash before redirect is documented).
- `scripts/verify-rbac.mjs` asserts the UI matrix and API role lists agree.
- `src/lib/constants.js` — `ROLES`, `ROLE_IDS` (6, incl. `admin: 9`), `REGISTRATION_ROLES` (6, incl. "FleetOps Admin").

**Workspace names:** `system_admin`→System Console · `admin`→Operations Center · `fleet_manager`→Fleet Operations · `dispatcher`→Transportation Operations · `driver`→Driver Workspace · `management`→Executive Center.

### 7.1 Read-only operational & executive boards (Phase B)

New read-only boards built on existing data, wired into `NAV_ROLES` + the relevant
workspaces. Management-facing boards are strictly read-only (no write controls).

| Route | Purpose | Roles |
|---|---|---|
| `/fleet/availability` | Vehicles grouped by status | admin, system_admin, fleet_manager, dispatcher |
| `/drivers/availability` | Drivers grouped by duty status | admin, system_admin, fleet_manager, dispatcher, management |
| `/fleet/documents` | Document Expiration Center — Vehicle / Driver tabs; driver licenses + vehicle registration/OR-CR/insurance | admin, system_admin, fleet_manager |
| `/drivers/performance` | Driver Performance Center — on-time, trips, score, cost/km | admin, system_admin, fleet_manager, management |
| `/reports/cost` | Fleet Cost Dashboard — per-vehicle fuel/maintenance cost | admin, system_admin, fleet_manager, management |
| `/executive` | Executive KPI Center — fleet/driver/financial KPIs + AI insights | admin, management |

Backing endpoints: `GET /api/documents/expiring`, `GET /api/reports/fleet-cost`,
and `GET /api/reports/driver-performance` (extended with `on_time_rate`,
`total_distance`, `cost_per_km`). Driver performance is computed from the merged
`trips`/`drivers` columns (`tripperformance`/`tripcostanalysis`/`driverincidents`
were dropped in migrations 005/007).

### 7.2 Number Coding (UVVRP) validation

Configurable plate-coding policy (`src/lib/uvvrp/`). Enforced at dispatch create
and update (`dispatch/route.js`, `dispatch/[id]/route.js`) and surfaced as a
queue conflict (`conflicts.js`). Response modes:
- **block** → dispatch rejected (409), violation recorded, dispatcher notified.
- **warn** → dispatch proceeds, violation recorded as `warned`.
- **approve** → dispatch deferred; `pending_approval` violation; an authorized
  role approves/denies via `PUT …/uvvrp/violations/[id]/decide`; once approved
  (vehicle+date) the dispatcher retries and it passes.
Per-vehicle exemptions (category + approver + optional expiry) skip the check.
Policy config UI at `/settings/number-coding` (admin/system_admin); read-only
board at `/uvvrp` (ops roles). New endpoints `settings/uvvrp`, `uvvrp`,
`uvvrp/exemptions[/[id]]`, `uvvrp/violations[/[id]/decide]`; tables
`uvvrp_exemptions`, `uvvrp_violations` (migration 025).

### Web sessions (NextAuth)
- Credentials provider; bcrypt vs `employees.password_hash`; **IP rate limit 5/min**; JWT session strategy (`NEXTAUTH_SECRET`); role/employeeId/name embedded in token. Login redirects drivers → `/driver`, others → `/dashboard`.
- Registration is **admin-only**; public signup redirects to login.

### Mobile tokens (separate system)
- Access = 15-min HS256 JWT (aud `fleetops-mobile-access`), refresh = 30-day JWT (aud `fleetops-mobile-refresh`), both `NEXTAUTH_SECRET`-signed. Refresh tokens stored SHA-256 hashed in `mobile_refresh_tokens`; **single-use rotation**; role/driver re-read from DB every refresh; `logout?allDevices` revokes all.

---

## 8. Mobile App (`mobile/`)

Driver-only Expo app (guest experience not implemented).

### Screens
- `app/_layout.js` — fonts + `AuthProvider`.
- `app/login.js` — sign in (real or **demo driver** mode). Demo = fully client-side mock (`mock-driver-access-token` short-circuits `apiFetch` into `handleDriverMock()`).
- `app/(app)/_layout.js` — **guard:** `isDriverSession(user)` else → `/login`; accepted consent version == `CURRENT_PRIVACY_POLICY_VERSION` else → `/consent`.
- `app/(app)/index.js` — driver home: trip list (active vs pending), accept/decline, single "advance" button (Start → En Route → Arrived → Complete via `getNextStatus()`), GPS tracking toggle, fuel entry link, sign out.
- `app/(app)/fuel-report.js` — fuel submission; vehicle/trip **derived server-side** from `profile.activeTrip` (never user-entered).
- `app/(app)/consent.js` ★ — privacy policy gate; loads policy via `/api/driver/me`; on accept posts `/api/driver/me/consent` (`via: "mobile"`) then stores accepted version locally.

### lib/
- `api.js` — `BASE_URL = EXPO_PUBLIC_API_URL`; `apiFetch` attaches Bearer; single-flight refresh on 401; demo mock.
- `auth.js` — AuthContext (login/demo/login/session restore).
- `consent.js` ★ — `CURRENT_PRIVACY_POLICY_VERSION = 1` (kept in lockstep with web), SecureStore gate.
- `rbac.js` — driver actions (`read_trips`, `manage_trip`, `report_location`, `report_fuel`), JWT role decode (client-only; server enforces).
- `tracking.js` — `useTripTracking`: foreground GPS, posts every 30 s to `/api/mobile/driver/trips/{id}/gps`.
- `storage.js` (SecureStore), `theme.js` (design tokens, `tripStatusTone`).
- `components/` — `ui.js`, `logo.js`, `plate.js`.

### Security rule
Only `EXPO_PUBLIC_*` config is allowed; the **server derives driver/vehicle/role from the token** — the mobile app never sends its own `driver_id`/`vehicle_id`/role.

---

## 9. ★ Current Update: Driver Privacy Consent + Driver Portal

This is the most recent feature (merged from the `5794427` feature branch). It makes driver data collection GDPR/DPA-aware and gives drivers a self-service portal.

### 9.1 Consent policy (shared, versioned)
- `src/lib/consent/policies.js` — `CURRENT_PRIVACY_POLICY_VERSION = 1` and the full `PRIVACY_POLICY` text ("Driver Data Privacy & Terms", effective 2026-08-05, 5 sections). Pure data so **web, mobile, and API read identical text** — no drift. Bump the version on any wording change → every driver must re-consent.

### 9.2 Durable audit record
- Table `driver_consents` (migration 017a): append-only event log — `driver_id` (FK CASCADE), `policy_version`, `accepted_at`, `accepted_via` (`web`|`mobile`), `ip_address`. Index `(driver_id, accepted_at DESC)` for the latest-acceptance gate. RLS mirrors the driver-self-scoping pattern but is inert (app-layer auth).
- **No UPDATE/DELETE** — a mistaken acceptance is superseded by a new one, never corrected in place.

### 9.3 Server API
- `GET /api/driver/me` (`requireDriver`) — profile + `consent: { acceptedVersion, acceptedAt, acceptedVia, requiredVersion, accepted, policy }` (lookup `.catch()`-guarded so a missing table keeps the gate on). Also returns `editableFields`, `visibleSections` from `src/lib/consent/driver-visibility.js`, and `license.{frontScanImageUrl, backScanImageUrl, canUploadFront, canUploadBack, reuploadWindowDays}` for the scan upload UI.
- `PATCH /api/driver/me` — only `phone`, `face_image_url`, `license_image_url`, `license_back_image_url` (403 otherwise); the scan columns additionally require the per-side `canUpdateLicenseScan` gate (no scan on file yet, or within 30 days of expiry) and are validated as base64 data URLs.
- `POST /api/driver/license-scan` (`requireDriver`) — body `{ side, file_url }`; runs Tesseract OCR + the shared license regex parsers; returns `{ ok, extracted_data, confidence_scores, validation_issues }` and persists nothing. `ok` mirrors the staff route's key-fields check (`license_number || last_name` front; `emergency_contact_name || emergency_contact_phone` back).
- `POST /api/driver/me/consent` (`requireDriver`) — body `{ policy_version, accepted: true, via }`; rejects stale version with **409**; inserts audit row with client IP; responds with updated consent.
- `PUT /api/drivers/[id]/account` — **enable/set driver login**: forces driver role, bcrypt-hashes a new password if supplied, **revokes all mobile refresh tokens** on credential change.
- `POST /api/drivers/link` — finalize a driver profile for an orphaned driver-role employee.

### 9.4 Web driver portal
- `/driver` page (`src/app/(dashboard)/driver/page.js`) — logged-in driver's home: profile, consent gate (`needsConsent` → checkbox → `acceptDriverConsent({ policyVersion, via: "web" })`), assigned vehicle.

### 9.5 Mobile consent gate
- `app/(app)/_layout.js` re-reads the locally accepted version on every focus; mismatch → `<Redirect href="/consent" />` before any personal-data screen renders.
- `consent.js` loads policy from the server (same source as web), posts acceptance (`via: "mobile"`), stores the accepted version locally; demo driver consents locally only.
- Server is authoritative — the local SecureStore copy only avoids re-prompting returning drivers.

### 9.6 Drivers module changes that shipped with it
- Drivers list supports `includeUnlinked=1` (unlinked driver-role employees flagged `requires_completion` for the "finalize" flow) and embeds `account.has_password` for the "Login enabled / No login" badge.
- Driver detail page now has the **Enable Login / Set Password** dialog (`syncDriverAccount`).
- New-driver form keeps the optional login password.
- Settings → Add User excludes the **Driver** role (`ACCOUNT_ROLES`); drivers are created via the Drivers section.
- Shared `TRIPS_SELECT/TRIPS_JOINS` module (`src/lib/api/trips-query.js`) consolidates trip queries.
- Migration 018b dropped 6 dead columns (`roles.permissions`, `routes.waypoints`, `trips.route_data`, `vehiclemaintenance.inspection_*`/`severity`); 021 added driver personal-detail columns for license OCR auto-fill.

### 9.7 Data flow recap (who, where, when)
Driver opens web or mobile → not yet consented → gate blocks personal data → driver accepts current policy version → `POST /api/driver/me/consent` writes `driver_consents` (append-only, IP captured) → subsequent `GET /api/driver/me` reports `accepted: true` → both surfaces unlock. Policy bump → `requiredVersion` increases → gates re-engage.

---

## 10. Known Notes / Gotchas

- **RLS is inert** — do not rely on it; the API `requireAuth` is the security boundary. `has_role()` in SQL references a dropped function (`get_current_employee_role`) and would error if ever executed — confirming it never runs.
- **Migration tooling:** the `supabase` CLI is broken in this repo (`.env` line 8 orphaned token); apply migrations via a small Node script using `pg` + real `DATABASE_URL` wrapped in `BEGIN; … COMMIT;`, then verify via `information_schema`.
- **`notifications/read-all`** marks every notification read globally (no scope guard) — the one endpoint where scoping looks weak.
- **No middleware** — route protection is via root `layout.js` → `DashboardLayout` → `RouteGuard` (client) + per-route API checks.
- A driver hitting `/dashboard` directly would render it (UI-only exposure; data APIs still enforce roles).
- Mobile status-advance uses the **web** route `PUT /api/trips/{id}/status` (not `/mobile/` prefix).
- Not implemented (documented scope limits): background location, push notifications, offline sync, guest mode, receipt OCR, mobile profile screen.
