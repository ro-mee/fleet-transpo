# FleetOps — Fleet & Logistics Management System

Comprehensive system overview for AI assistants and new developers. Covers architecture, tech stack, directory layout, database schema, API surface, auth/RBAC, the mobile companion app, and the business logic domains.

## 1. System Overview

**FleetOps** is a hotel-affiliated fleet & logistics management platform (guest transport for a hotel, e.g. "CoCo Star Hotel"). It runs the full lifecycle of guest transportation requests — from an external **Booking** subsystem through intake, review, approval, dispatch scheduling, trip execution, GPS tracking, fuel reporting, and maintenance — plus fleet/driver/vehicle management, analytics, reports, and a driver-facing mobile app.

It is a **single-organization** system (branch/multi-tenant concepts were removed in migration 013). There are two applications in one repo:

| App | Location | Tech | Audience |
|---|---|---|---|
| Web dashboard | `src/` | Next.js 16 (App Router) + React 19 | Admin, fleet managers, dispatchers, drivers, management |
| Mobile app | `mobile/` | Expo SDK 54 / React Native 0.81 (Expo Router) | Drivers |

**Scope:** FleetOps is strictly **fleet & transportation**. The three hospitality
roles (`reception_staff`, `restaurant_staff`, `concierge`) were **removed**
(migration `022_remove_front_desk_roles.sql`). Six roles remain. Each role is a
distinct **workspace** (identity, tagline, accent, home, role-specific nav)
driven by `src/lib/workspaces.js` (`WORKS[role]`, `getWorkspace(role)`); role
dashboards render through `src/components/dashboard/role-dashboard.jsx` +
`dashboard-configs.js`. Earlier additions still apply: **read-only operational/
executive boards** (`/fleet/documents`, `/drivers/performance`, `/reports/cost`,
`/executive`) and
endpoints `GET /api/documents/expiring`, `GET /api/reports/fleet-cost`. The
`/fleet/availability` + `/drivers/availability` boards were **removed 2026-08-15**
(availability is derived from schedule-overlap, not a board page).

**Latest changes** (the current feature wave — details in §7/§8/§9):

- **Smart Transportation Queue** (migrations 026–027): explicit priority inputs
  `is_vip` / `is_emergency` on `transportation_requests` feed a deterministic
  priority engine (`src/lib/scheduling/priority.js`) that writes a cached
  `derived_priority` (`Overdue → Critical → High → Medium → Normal → Future`);
  thresholds are admin-configurable (`src/lib/dispatch-policy.js`, `/settings/dispatch`).
  AI fleet-pair recommendations are now **immutable snapshots**
  (`recommendation_snapshots`, `src/lib/ai/pair-scoring.js` + `dispatch-advisor.js`)
  with a TTL, a `designated-driver` rule enforced at assign, and regeneration.
- **Incidents module** (migrations 024/029): driver-reported incidents (severity +
  GPS coords) surface in a staff **read-only registry** with an active-incident
  map (TomTom tiles), resolve / send-to-maintenance actions, and **vehicle
  grounding + dispatch-interrupt automation** (see §7.3). Web page `/incidents`.
- **Notifications direction & preferences** (migration 030): notifications carry
  `reference_type` / `severity` / `link`; render with shared category/severity
  chips on web, mobile, and the in-app feed; taps route **per-role**
  (`src/lib/notifications/target.js`); per-user `notification_preferences` back
  the `/notifications/preferences` toggle grid.
- **Global search** (`Ctrl/Cmd+K`): `src/components/ui/command-palette.jsx` +
  `GET /api/search` across reservations, dispatches, drivers, vehicles.
- **TomTom routing** (`src/lib/tomtom.js` + `GET /api/tomtom/route` proxy with the
  server key): route / distance / turn-by-turn for trip detail and live tracking;
  the mobile **Live Map** uses TomTom static images (no native map SDK).
- **CORS for the Expo build:** `src/middleware.js` **and** `next.config.mjs` both
  answer `OPTIONS` preflights for `/api/:path*` with `Access-Control-Allow-Origin: *`
  so the mobile web/device build can call the API cross-origin.
- Mobile app is now a 5-tab app (Home / Trips / Vehicle / Alerts / Profile);
  the driver **profile**, **alerts** inbox, **trip history**, and **full-screen
  map** screens all shipped (see §8).

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
- Expo SDK ~54, RN 0.81.5, React 19.1, **expo-router ~6** (file-based), **expo-secure-store** (tokens), **expo-location** (GPS), Google-font packages (Archivo / IBM Plex); **react-native-web + @expo/metro-runtime** (Expo web target).
- Scripts: `start`, `tunnel` (`@expo/ngrok`), `android`, `ios`, `web`.

### Key environment config
- `.env` — Supabase URL/key, service-role key, `DATABASE_URL` (pg), `NEXTAUTH_SECRET`, `CRON_SECRET`, `BOOKING_WEBHOOK_SECRET`, `BOOKING_GATEWAY`, AI provider keys, and TomTom (`NEXT_PUBLIC_TOMTOM_API_KEY` client, `TOMTOM_API_KEY` server).
- `next.config.mjs` — `turbopack.root` + CORS headers for `/api/:path*`.
- `src/middleware.js` — **CORS only** (no auth): answers `OPTIONS` preflights for `/api/:path*` with `Access-Control-Allow-Origin: *`. Duplicates the `next.config.mjs` headers so the Expo web/mobile build can call the API cross-origin.
- Path alias: `@/* → ./src/*` (`jsconfig.json`).

---

## 3. Directory Layout

```
fleet-transpo/
├── src/                        # Next.js web app
│   ├── middleware.js           # CORS preflight for /api/* (Expo cross-origin, no auth)
│   ├── app/
│   │   ├── layout.js           # ONLY root layout; wraps all pages in DashboardLayout
│   │   ├── page.js             # "/" → redirect /dashboard or /login
│   │   ├── globals.css
│   │   ├── (auth)/             # login, register(→redirect /login), forgot-password, reset-password
│   │   ├── (dashboard)/        # all app modules (no group layout; chrome from DashboardLayout)
│   │   │   ├── dashboard/      # home KPIs, charts, live map, AI insights
│   │   │   ├── driver/         # ★ driver portal — home, trips, profile (licenses+scan), incidents, vehicle, fuel
│   │   │   ├── fleet/          # vehicles (+ new/[id]/edit), categories, availability, documents
│   │   │   ├── drivers/        # list, new, [id] (detail+account), [id]/edit, availability, performance
│   │   │   ├── trips/          # register, active (live cards), [id]
│   │   │   ├── reservations/   # register, queue (dispatcher workspace), new (dev mock), [id]
│   │   │   ├── dispatch/       # kanban board, calendar, [id]
│   │   │   ├── fuel/           # records (approval workflow), analytics
│   │   │   ├── maintenance/    # records, predictive (AI)
│   │   │   ├── incidents/      # ★ Fleet Incidents Registry (staff read-only + resolve, live map)
│   │   │   ├── tracking/       # live-map, history
│   │   │   ├── routes/
│   │   │   ├── ai/             # insights, predictive-maintenance, provider settings, logs
│   │   │   ├── reports/        # 6 report types + cost dashboard
│   │   │   ├── analytics/
│   │   │   ├── executive/      # ★ Executive KPI Center (management/admin, read-only)
│   │   │   ├── notifications/  # feed, preferences, templates
│   │   │   ├── system/         # ★ System Console (admin) — audit log (system_admin only)
│   │   │   └── settings/       # general, profile, security, users/new, api, ai/logs, number-coding (UVVRP), dispatch (smart queue)
│   │   └── api/                # 113 route handler files (see §6)
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
│   │   ├── constants.js        # ROLES, ROLE_IDS, status lifecycles, NOTIFICATION_EVENTS/CHANNELS, derived-priority, etc.
│   │   ├── workspaces.js       # ★ WORKS[role] per-role workspace (identity, accent, home, nav) + getWorkspace()
│   │   ├── dispatch-policy.js  # ★ smart-queue thresholds (critical/high/medium minutes, vip/emergency flags)
│   │   ├── tomtom.js           # ★ TomTom URLs + server-keyed route builder (two-key split)
│   │   ├── auth/               # api-auth, permissions.js (RBAC matrix), role-guard, mobile-token
│   │   ├── api/                # utils (requireAuth/ok/err), client (apiFetch), service-auth, ownership, trips-query
│   │   ├── consent/            # policies.js, driver-visibility.js
│   │   ├── driver/             # grounding.js — breakdown regex + vehicle-grounding rule (shipped stub)
│   │   ├── notifications/      # presentation.js (category/severity chips), target.js (per-role nav)
│   │   ├── scheduling/         # calendar, conflicts, priority, queue-grouping, trip-progress, dispatch/trip/reservation state machines
│   │   ├── integration/        # booking-gateway, contracts, ingest (shared writer), category-resolver, status-map
│   │   ├── ai/                 # llm-adapter, rule-engine, dispatch-advisor, pair-scoring, predictive-maintenance, license-ocr
│   │   ├── uvvrp/              # policy.js (Number Coding), uvvrp.service.js
│   │   ├── supabase/, geo/, vehicles/, validation/
│   ├── services/               # 28 modules: client apiFetch wrappers + server business-logic services
│   └── hooks/                  # use-auth, use-realtime, use-role-access, use-theme, ...
├── mobile/                     # Expo driver app — 5-tab UI (see §8)
├── supabase/
│   ├── migrations/             # 43 SQL migrations (see §5)
│   ├── config.toml
│   └── functions/ai-recommend-vehicle/   # edge function
├── docs/                       # rbac-model.md, design-system.md, mobile-*.md, architecture/
├── scripts/                    # 25 scripts: migrate.mjs + dump-schema.mjs + verification harnesses
├── schema.sql                  # GENERATED by npm run db:dump — never edit by hand
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

### 4.3 State machines — one job, three legs, then a loop
The three lifecycle machines are **one continuous chain**, not three separate lists.
The same job moves through them: **Transportation Request → Reservation → Dispatch →
Trip**, and when the trip finishes the resources loop back into the pool. See
§4.8 for the operative sequence; the diagram below shows the hand-offs.

```
TRANSPORTATION REQUEST (Booking) ──► RESERVATION ──► DISPATCH ──► TRIP
   (external ingest)                   9-state      5-state      16-state
                                             │          │            │
                                             ▼          ▼            ▼
                                       Scheduled   Scheduled     Assigned
                                                          │      (live chain)
                                                          ▼            ▼
                                                   In Progress   Driver Accepted
                                                          │            ▼
                                                          ▼        Trip Started
                                                   Completed ◄── En Route ──► Drop-off
                                                          │            │
                                                          ▼            ▼
                               TRIP COMPLETED ◄──────────┴────────── Completed
                                          │
                                          ▼
                     Re-evaluate driver + vehicle (see §4.8/§9)
                     ─► Available / Next Scheduled Assignment /
                        Restricted / Under Maintenance / Incident
                                          │
                                          └──► back to the available pool
```

Centralized lifecycle logic lives in `src/lib/scheduling/` and server services.
The machinery (kept, plus the actual state counts):
- **Reservation** — `reservation-lifecycle.service.js` + `lib/scheduling/reservation-state.js`.
  `advanceReservation()` is the *only* place `fleet_status` changes; it validates the
  hop, persists, appends a timeline event, and notifies Booking. Legal transitions:
  `Pending → Under Review → Approved|Rejected → Scheduled → Assigned → In Progress →
  Completed`; `Cancelled` from any non-terminal. Terminal states are locked.
- **Dispatch** — `dispatch-state.js` (`chk_dispatch_status` CHECK + explicit
  `Pending Reassignment`). Edges: `Scheduled ⇄ Pending Reassignment → Cancelled`;
  `Scheduled → In Progress`; `In Progress → Completed / Pending Reassignment /
  Cancelled`; `Completed / Cancelled` terminal. `Pending Reassignment` is a first-class
  state: a committed-then-released resource (incident, stand-down, driver/vehicle swap)
  sits there until reassigned (→ `Scheduled`) or cancelled. Dispatch is created for a
  request automatically (`dispatch-autocreate.service.js`) once a vehicle **and** a
  driver are both committed.
- **Trip** — `trip-state.js` (16-state graph, mirrors `chk_trip_status`).
  `canTransitionTrip` gates single forward hops; two vocabularies coexist — a loose
  legacy ingest cluster and the strict live driver chain (`Assigned → Driver Accepted →
  Trip Started → At Pickup → Passenger Onboard → En Route → Drop-off → Completed`).
  Cancellation is allowed from any non-terminal; `Completed` / `Cancelled` are locked.
  `trip-lifecycle.service.js` (`completeTrip`, `cancelTrip`, `syncBusyTrip`) validates
  the odometer, cascades status to vehicle/driver/dispatch/request, and writes the audit.

> Ownership rule: the **transportation request** carries the booking intent, the
> **dispatch** is the committed schedule on the board, and the **trip** is the executed
> drive. Requests do not advance to `Assigned` until both halves (vehicle + driver) are
> committed; dispatch is the entity that owns the operational timeline; trip completion
> closes the loop and releases the resources.

### 4.4 Booking integration (anti-corruption layer)
The external **Booking** subsystem owns guest data + approval. Fleet:
- Depends only on `src/lib/integration/booking-gateway.js`, never on Booking's
  database. `BOOKING_GATEWAY=mock` (default) serves canned requests shaped exactly
  like the future API; `http` is a loud stub until Booking is connected.
- Validates every inbound payload against `contracts.js`
  (`parseTransportationRequest`, which also translates Booking's `"Normal"`
  priority to Fleet's `"Medium"`).
- **Ingests through one shared writer**, `src/lib/integration/ingest.js`
  (`ingestRequest`), idempotent on `external_booking_id`. Two doors call it:
  - `POST /api/integration/transport-requests` — push. `BOOKING_WEBHOOK_SECRET`
    service token or a staff session. A contract violation is a 400 naming the
    failing issue; a replay returns the existing row with `idempotent: true`.
  - `POST /api/integration/pull` — pull. Staff session; polls the gateway. A
    malformed item is skipped and counted rather than failing the batch, so one
    bad record cannot block the good ones behind it.
  - The routes differ only in auth, that error handling, the
    `integration_log.event_type` (`transport_request_received` vs
    `transport_request_pulled`, kept distinct so reconciliation can tell push from
    pull), and the audit row — pull writes one aggregate per operator click.
  - Before this was unified, pull inserted 13 columns against push's 19: a pulled
    request arrived with no resolved category, no travel estimate, no reservation
    number and no timeline event.
- Caches in `transportation_requests` (the **Fleet Reservation Queue**);
  `dispatchschedules.request_id` is the back-link.
- Notifies Booking outbound via `outbound.service.js` (`emitTransportStatus`), logs everything in `integration_log`.
- The legacy `vehiclereservations` table, its `reservation_id` columns on both
  parents, and the whole `/api/reservations/*` route tree were **dropped**
  (migration 036). It held 0 rows and duplicated `transportation_requests`.

### 4.5 AI layer (optional LLM + rule engine)
- **Rule engine** (`lib/ai/rule-engine.js`) is the deterministic baseline (recommendations, insights, predictive maintenance).
- **LLM** (`lib/ai/llm-adapter.js`) adds natural-language summaries/narrations — failure-tolerant, time-budgeted (25 s), falls back to rule output.
- `aiproviders` config table (API keys masked); `ailogs` usage log; `POST /api/ai/scan-document` (tesseract OCR → regex → optional LLM) powers license / OR-CR / insurance scanning with LTO renewal scheduling.

### 4.6 Cross-origin (mobile web) — middleware + config CORS
The Expo web/device build runs on a different origin than the Next server, so
every `/api/*` call is cross-origin. Both `src/middleware.js` (matcher `/api/:path*`)
and `next.config.mjs` `headers()` answer `OPTIONS` preflights with
`Access-Control-Allow-Origin: *` and allow `Content-Type, Authorization`.
The **middleware is CORS-only — no auth**. Because `*` forbids cookies, the mobile
app authenticates via `Authorization: Bearer`, which `resolveIdentity()` prefers
over the NextAuth cookie (see 4.2).

### 4.7 Smart dispatch & AI pair recommendation
- **Priority engine** (`lib/scheduling/priority.js`) — pure, deterministic. Inputs:
  pickup time, status, `is_vip`, `is_emergency`, thresholds. Terminal states → `null`;
  missed pickup → `Overdue`; then by time-to-pickup `Critical/High/Medium`, same-day
  `Normal`, else `Future`. VIP boosts one band (max High); emergency forces Critical.
  The queue groups/sorts by this (`lib/scheduling/queue-grouping.js`); `priority.service.js`
  batched-UPSERTs it into `transportation_requests.derived_priority` (never human-set).
  Thresholds come from `dispatch-policy` in `system_settings` (`lib/dispatch-policy.js`).
- **Fleet-pair scoring** (`lib/ai/pair-scoring.js`) scores vehicle+driver **as one
  unit** (designated-driver match +45); only a *provably unavailable* custodian
  legitimizes a substitute. `dispatch-advisor.js` enriches candidates with fuel-burn
  estimates and `detected_risks`; `recommendation.service.js` enforces the
  **designated-driver rule** at assign and flips snapshots to `is_consumed`.
- **Recommendation snapshots** (`recommendation_snapshots`, migration 027) are
  immutable pair records (`pair_json`, score, reasons, validity window). The
  saved-recommendation card reads the active snapshot; unconsumed/past-`valid_until`
  is surfaced as expired with `?regenerate=1`.

### 4.8 Dispatch eligibility, future availability & travel buffer

These are the **formal eligibility rules**. SYSTEM.md is the spec of record; the
two rules that were previously documented-only (future availability and the
travel/safety-buffer gate) are now **enforced** in code — see the inline notes
in 4.8.2 / 4.8.3 and §10.

#### 4.8.1 The dispatchable predicate

A **driver** is dispatchable for a requested trip when **all** hold:

1. **Active availability** — not `Suspended`, `On Leave`, or `Off Duty`. Being
   mid-trip is **not** itself "unavailable" for a *future* request (see 4.8.2),
   so `On Trip` is excluded from the disqualifying set.
2. **Qualified** — driver's license is valid on the pickup date (not expired).
3. **Compatible with the vehicle** — appropriate class / seating fit for the
   passenger count.
4. **No overlapping assignment** — no active reservation or dispatch already
   committed to this driver inside the requested window.
5. **Enough travel + safety buffer** — the previous scheduled commitment clears
   the requested pickup with the ETA + buffer rule of 4.8.3.
6. **No blocker** — not on leave, no active incident / restriction, etc.

A **vehicle** is dispatchable when **all** hold:

1. **Operationally dispatchable** — status not `Under Maintenance`,
   `Decommissioned`, or `Registration Expired`. `In Use` is **not** a blocker
   for a *future* request (see 4.8.2); `Reserved` (a whole-day label) never
   hides a genuinely free window.
2. **Not grounded** — not grounded by an incident / not under an open maintenance
   window on the pickup date.
3. **Documents valid** — registration and insurance valid on the pickup date.
4. **Free in the window** — no overlapping dispatch / reservation.
5. **Right size** — seating capacity ≥ passenger count.

#### 4.8.2 Future availability (current status ≠ future availability)

Eligibility is evaluated against the **requested trip's time window**, not solely
against the driver's or vehicle's **current** status label. A resource currently
marked `On Trip` / `In Use` may still be eligible for a future booking if its
current and scheduled assignments end early enough to satisfy the required travel
time and safety buffer.

- Example: *Juan is `On Trip` printing 2:00–5:00 PM today. A new booking starts
  tomorrow 8:00 AM. His current trip ends long before that window, so he is
  eligible.*
- The time-aware authority is **window overlap** (`lib/scheduling/conflicts.js`),
  which already implements the half-open rule for dispatches/reservations; the
  status label must not short-circuit it for future windows.
- **Enforced:** `lib/ai/pair-scoring.js` no longer disqualifies `On Trip` / `In Use`
  unconditionally (removed from `UNAVAILABLE_STATUSES` /
  `NON_DISPATCHABLE_VEHICLE_STATUSES`); a currently-busy-but-future-free resource
  is offered unless an overlapping `_schedule_load` marks it genuinely busy.

#### 4.8.3 Dynamic travel + safety buffer (spec)

```
earliest_next_available =
    previous_scheduled_end
  + travel_time_to_next_pickup      (TomTom travelTimeMin, /api/tomtom/route)
  + safety_buffer
```

Decision rule:

- requested `pickup_datetime >= earliest_next_available` → **eligible** ✅
- requested `pickup_datetime <  earliest_next_available` → **ineligible** ❌

- The safety buffer is **derived, not a fixed 30 minutes**: it scales with the
  trip via a configurable offset on top of TomTom `travelTimeMin`, with a
  configurable floor for very short hops and no blanket minimum forced on every
  trip. **Enforced** — config `safetyBufferMinutes` / `bufferFloorMinutes` /
  `travelBufferEnabled` (defaults in `src/lib/dispatch-policy.js`, editable at
  `/settings/dispatch`); the rule lives in `src/lib/scheduling/travel-buffer.js`
  (`earliest_next_available`) and is a **hard BLOCKING** gate at assign time via
  `detectRequestConflicts` when the ETA + previous-commitment signals are present
  (the assign route accepts a per-resource ETA, computed from TomTom coordinates
  when supplied, else failing open). The queue-chip (batch) path stays advisory —
  matching how chips never block while the assign gate is the authoritative 409.
- The buffer reserves slack so one late finish cannot cascade into the next
  pickup.

#### 4.8.4 The operative sequence (booking → assignment → execution → re-evaluate)

1. Booking / trip request enters (external ingest, §4.4).
2. **Pending dispatch** — find eligible drivers (**4.8.1**) and eligible vehicles
   (**4.8.1**) for the requested window.
3. Check **driver ↔ vehicle compatibility**.
4. Check **schedule conflicts** (`conflicts.js`).
5. Check **travel time + safety buffer** (**4.8.3**).
6. **Show valid assignments** (assign dialog / pair recommendations).
7. Dispatcher **selects driver + vehicle**.
8. **Final backend validation** — re-run the conflict gate; blocking findings 409
   unless the dispatcher overrides with `force` (see `assign` route).
9. **`Assigned`** — the transportation request advances.
10. **Driver accepts**.
11. **`Dispatched`** → **pre-trip verification** → **en route to pickup** →
    **arrived at pickup** → **pickup started/completed** → **en route to
    destination** → **arrived** → **drop-off completed** → **Trip completed**.
12. **Re-evaluate driver + vehicle status** → `Available` / `Next Scheduled
    Assignment` / `Restricted` / `Under Maintenance` (incident/grounding §7.3),
    then return to the available pool for the next request (loop to step 1).

---

## 5. Database Schema (PostgreSQL on Supabase)

Live, per the last `npm run db:dump`: **38 tables, 1 view, 77 foreign keys, 84
standalone indexes, 11 functions, 16 triggers.** `schema.sql` carries that dump
and is the authoritative picture — §5.2 below is a reading aid, not the source.

43 migration files in `supabase/migrations/` (numbers are non-linear: no 008; some
numbers have multiple files — 011, 013, 014, 017, 018, 019, 030 — applied in
filename order; 019 appears three times). **Migrations are applied via a direct
`pg` connection, NOT the Supabase CLI or the SQL editor** (see `AGENTS.md` — the
CLI is broken here and the web editor was found to silently target the wrong
project).

Use the runner rather than a one-off script: `npm run db:status` (applied /
pending / changed-since-applied), `npm run db:up` (apply pending, each in its own
transaction), `npm run db:dump` (regenerate `schema.sql` from live).
`scripts/migrate.mjs` records every apply in a `schema_migrations` ledger keyed by
**full filename** — because version numbers are duplicated — and refuses to run if
an already-applied file's checksum changed. New migrations must be idempotent
(`IF NOT EXISTS`, `DROP ... IF EXISTS`): the live DB is ahead of the files in
places, so a migration has to be a safe no-op there.

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
| 019a | `service_interval_guards.sql` | positive-interval CHECKs + partial `idx_trips_end_time` |
| 019b | `admin_role.sql` | ★ insert **`admin`** role (`role_id 9`); backfill role-less active drivers to `driver` |
| 019c | `cleanup_ai_and_gpstracking.sql` | drop `vehiclereservations.ai_*` + `gpstracking.driver_id` (both dead) |
| 020 | `fuel_hardening.sql` | fuel review workflow (`rejection_reason`, `approved_by/at`, status CHECK) |
| 021 | `driver_personal_details.sql` | `drivers.address/sex/birthdate/nationality` (license scan auto-fill) |
| 022 | `remove_front_desk_roles.sql` | ★ drop `reception_staff`/`restaurant_staff`/`concierge` (role rows 5/6/8); disable the 3 employees who held them |
| 023 | `dispatch_overlap_guard.sql` | ★ DB-level double-booking guard trigger + advisory locks on `dispatchschedules` |
| 024 | `driverincidents.sql` | ★ recreate `driverincidents` (dropped in 005) — driver incident reporting + breakdown automation |
| 025 | `uvvrp.sql` | ★ Number Coding (UVVRP): `uvvrp_exemptions` + `uvvrp_violations` tables |
| 026 | `smart_dispatch.sql` | ★ smart-queue inputs `is_vip`/`is_emergency` + cached `derived_priority` (CHECK) + indexes; VIP backfill |
| 027 | `recommendation_snapshots.sql` | ★ immutable AI fleet-pair snapshots table (UNIQUE active-per-request, TTL, consumed flag) |
| 028 | `recreate_vehicleinspection.sql` | ★ restore `vehicleinspection` (dropped in 005) for `GET /api/driver/vehicle-inspection` |
| 029 | `incident_coordinates.sql` | ★ `driverincidents.latitude/longitude` for the incident live map |
| 030a | `dispatch_cancel_reason.sql` | `dispatchschedules.cancel_reason` (auditable stand-downs) |
| 030b | `notification_preferences.sql` | ★ per-employee (event×channel) notification toggles table + self-access RLS |
| 031 | `perf_ai_provider_and_board_index.sql` | ★ migrate `aiproviders` out of hot-path DDL; partial `scheduled_departure` index for the dispatch board |
| 032 | `fuel_receipts_bucket.sql` | private `fuel-receipts` storage bucket (server uploads with the service-role key, signed URLs out) |
| 033 | `dispatch_pending_reassignment.sql` | declare `Pending Reassignment` in `chk_dispatch_status` — live already allowed five values, migration 012 declared four |
| 034 | `backfill_undeclared_tables.sql` | declare four tables that existed on live but no migration ever created, so a replay onto an empty DB produced a schema the app could not run against |
| 035 | `driverincidents_assistance_needed.sql` | declare `driverincidents.assistance_needed text[]` — present and populated on live, originally added by a since-deleted root script |
| 036 | `drop_vehiclereservations.sql` | ★ **drop `vehiclereservations`** (0 rows), both `reservation_id` columns and their FKs/indexes, and two orphaned trigger functions |

> 033–035 are **reconciliation** migrations: the live database had drifted ahead of
> the files, so replaying the history onto an empty database produced a schema the
> app could not run against. They declare what already existed rather than
> changing live — which is why every one is a no-op there.

### 5.2 Tables (final state)
| Table | Domain | Notes |
|---|---|---|
| `roles` | auth | `role_id`, `role_name` UNIQUE |
| `employees` | auth/users | 1:1 with `auth.users`, `role_id`, `password_hash`, soft-delete |
| `vehiclecategories` | fleet | base/per-km/per-hour rates, seating |
| `vehicles` | fleet | plate UNIQUE, status CHECK, service intervals, expiry dates |
| `drivers` | drivers | license fields, status CHECK, GPS last-known, face image, personal details (021) |
| `routes` | operations | location FKs (007) |
| `dispatchschedules` | operations | `dispatch_number` UNIQUE, status CHECK, `request_id` FK, `cancel_reason` (030a) |
| `trips` | operations | 13-state CHECK, cost+performance cols (007) |
| `gpstracking` | tracking | BIGSERIAL time-series GPS (no `driver_id`, 019c) |
| `vehiclemaintenance` | maintenance | inspection merged (005), inspection cols dropped (018b) |
| `vehicledocuments` | fleet | restored real table (007) |
| `fuelrecords` | fuel | review workflow (020) |
| `driverattendance` | attendance | face rec, UNIQUE (driver_id, date) |
| `notifications` | notifications | fed by triggers |
| `ai_recommendations`, `ai_insights` | AI | rule-engine output |
| `audit_logs` | audit | the DB trigger functions were dropped (014b); writes now come from the application — `writeAudit()` (`src/lib/audit.js`) is called across 30 route/service modules |
| `service_types`, `booking_channels`, `integration_log` | integration | |
| `locations` | reference | named places |
| `mobile_refresh_tokens` | mobile auth | hashed, revocable, no RLS |
| `transportation_requests` | queue | 9-state `fleet_status`, `external_booking_id` UNIQUE, AI rec cols, `is_vip`/`is_emergency`/`derived_priority` (026) |
| `reservation_events` | timeline | append-only |
| **`driver_consents`** | ★ privacy | `driver_id`, `policy_version`, `accepted_at/via`, `ip_address`; append-only; index `(driver_id, accepted_at DESC)` |
| `driver_vehicle_assignments` | drivers | interval history + 2 partial UNIQUE active-pairing indexes |
| `driverincidents` | ★ incidents | driver-reported incidents (024) with `latitude/longitude` (029); `severity`, `actions_taken`, status |
| `uvvrp_exemptions`, `uvvrp_violations` | ★ Number Coding | vehicle exemptions + violation history (025) |
| `recommendation_snapshots` | ★ AI | immutable fleet-pair advice per request; TTL + UNIQUE active-per-request (027) |
| `vehicleinspection` | ★ fleet | restored driver-facing inspection table for `/api/driver/vehicle-inspection` (028) |
| `notification_preferences` | ★ notifications | per-employee (event × channel) toggles; absent rows = server defaults (030b) |
| `aiproviders` | AI | LLM provider config (migrated to proper table in 031; used to be hot-path DDL) |
| `system_settings` | settings | created ad-hoc by `scripts/seed-naia-routes.mjs` (not a migration); stores `dispatch_policy`, `uvvrp_policy` |

**Views:** `driver_stats` (computed from completed trips). **Storage:** `face-captures` bucket (private). **Sequences:** `dispatch_number_seq`.

### 5.3 DB-enforced integrity (highlights)
- Status CHECKs, counted from `schema.sql`: vehicle (5), driver (5), dispatch (5 —
  `Pending Reassignment` joined the other four in 033), trip (13), transport
  `fleet_status` (9), fuel (4), transport `priority` (4), transport
  `derived_priority` (6). There is **no** reservation status CHECK — it went with
  the table in 036.
- Partial UNIQUE: `uq_dva_active_driver`, `uq_dva_active_vehicle` (one active pairing per driver/vehicle).
- UNIQUE (driver_id, date) on attendance; positive service-interval guards; `idx_trips_end_time` partial index for 90-day maintenance window.

---

## 6. API Surface (`src/app/api/` — 113 route files)

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
- `driver/vehicle-inspection` (GET/POST) ★ — driver vehicle inspection reporting (reads `vehicleinspection`, migration 028).
- `driver/trips` (GET) ★ — **web driver-portal** trip list; always `WHERE driver_id = auth` (unlike the unscoped `trips/`).

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
There is **no `reservations/` route tree.** It was deleted with migration 036
(§5.1): the legacy endpoints that used to answer 410, plus `conflicts`,
`service-types` and `booking-channels`, are all gone. `transportation_requests`
is the only reservation concept, and `integration/` is its only door.

- `integration/transport-requests` (GET/POST — POST = inbound ingest), `[id]` (GET), `[id]/review|approve|assign|reschedule|cancel|reject` (PUT), `[id]/timeline` (GET), `[id]/recommendation` (GET/POST), `[id]/flags` (PATCH).
- `[id]/flags` (PATCH) ★ — set `is_vip` / `is_emergency`; recomputes `derived_priority` immediately + writes timeline/audit (system_admin, admin, fleet_manager).
- `[id]/recommendation` (GET/POST) ★ — active recommendation snapshot (regenerate/narrate); POST persists a snapshot + back-writes legacy AI columns.
- `integration/inbound`, `outbound`, `pull`, `logs`.

### Dispatch & assignments
- `dispatch/` (GET/POST), `dispatch/[id]` (GET/PUT), `dispatch/[id]/status` (PUT), `dispatch/calendar` (GET), `dispatch/by-status` (GET).
- `driver-assignments/` (GET/POST), `driver-assignments/[id]` (DELETE) — transactional pairings.

### Reports, AI, notifications, system, mobile
- `reports/{maintenance,fuel-consumption,fleet-utilization,financial,driver-performance,fleet-cost}` (GET).
- `documents/expiring` (GET) ★ — Document Expiration Center: aggregates `vehicles.*_expiry` + `vehicledocuments.expiry_date` + `drivers.license_expiry` with days-left/expired flags (admin, system_admin, fleet_manager).
- `ai/recommendations`, `ai/predictive-maintenance`, `ai/insights[/[id]/dismiss]`, `ai/driver-insights`, `ai/providers[/[id]]`, `ai/providers/fetch-models`, `ai/scan-document`, `ai/logs`, `ai/instructions`.
- `notifications/` (GET/POST) — **self-scoped** GET (ops roles may pass `?employee_id=`); POST admin-directed. `notifications/[id]/read`, `notifications/read-all` (self-scoped), `notifications/[id]` (DELETE, self- or ops-scoped), `notifications/preferences` (GET/PUT) ★ — per-user event × channel toggle matrix (migration 030b).
- `search` (GET) ★ — global command-palette search across reservations, dispatches, drivers, vehicles (min 2 chars, LIMIT 5 per entity; any role).
- `tomtom/route` (GET) ★ — server-keyed routing proxy (`origin`/`destination` as `lng,lat`): decoded polyline, turn-by-turn instructions, distanceKm, travelTimeMin; all roles incl. driver.
- `audit/` (GET) ★ — system audit log (system_admin only).
- `system/activity` (GET) ★ — system console activity feed.
- `routes/`, `routes/[id]`, `routes/seed-naia`, `locations/`, `settings/hotel`, `manifest`, `status/sync`, `cron/sync` (CRON_SECRET).
- `incidents/` (GET) + `incidents/[id]` (PATCH) ★ — **staff incident registry**: all driver-reported incidents (severity/status/coords filters, join plate + driver), resolve with `actions_taken`. Read-only + resolve only; creation is driver-side.
- `settings/dispatch` (GET/PUT) ★ — smart-queue policy (`criticalMinutes`/`highMinutes`/`mediumMinutes`, `enableVipFlag`/`enableEmergencyFlag`); audit-writes `dispatch_policy` (system_admin/admin; fleet_manager read).
- `settings/uvvrp` (GET/PUT) ★ — configurable Number Coding (UVVRP) policy (`system_settings.uvvrp_policy`; enable, location preset, per-weekday ending digits, block|warn|approve response, exemption categories).
- `uvvrp` (GET) ★ — read-only board (restricted today, exemptions, upcoming restrictions, violation history, dispatches affected).
- `uvvrp/exemptions` (GET/POST), `uvvrp/exemptions/[id]` (PUT) ★ — per-vehicle coding exemptions (category, approver, optional expiry).
- `uvvrp/violations` (GET), `uvvrp/violations/[id]/decide` (POST) ★ — coding violation history + approve/deny pending approvals (defer-then-retry: an approved violation exempts that vehicle+date).
- `mobile/auth/login|refresh|logout`, `mobile/driver/me`, `mobile/driver/ref` (GET) ★ — driver-only trip/status reference (status buckets, `getNextStatus` chain, tones; the server owns the state machine), `mobile/driver/trips`, `mobile/driver/trips/[id]/accept|gps`, `mobile/fuel`.

### Client service layer (`src/services/`)
Thin `apiFetch` wrappers per domain: `auth, driver, vehicle, trip, reservation, reservation-lifecycle, reservation-events, dispatch, dispatch-settings, driver-assignment, fuel, transport, report, notification, route, location, settings, status, integration, outbound, maintenance-schedule, search, priority, recommendation, uvvrp, audit, system, ai`. Server-only business-logic services (e.g. `reservation-lifecycle`, `trip-lifecycle`, `status`, `outbound`, `uvvrp`) are imported by route handlers.

---

## 7. Roles & RBAC

### Roles (6)
`system_admin`, `admin`, `fleet_manager`, `dispatcher`, `driver`, `management`.

> The hospitality roles `reception_staff`, `restaurant_staff`, `concierge` were
> removed in migration 022 (FleetOps is fleet & transport only). Their 3
> employees were disabled.

### Model
- Single source of truth: **`src/lib/auth/permissions.js`** — `MATRIX[role][resource][action]` with resources `vehicles, driver_assignments, reservations, dispatch, drivers, trips, maintenance, fuel, routes, categories, reports, analytics, ai, employees, system` (+ management-only `fuelallocations`, `scheduled_reports`). Verbs `create/read/update/delete` + reservation lifecycle verbs (`approve/assign/dispatch/cancel/reschedule`). `system_admin` short-circuits to always-true.
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

### 7.3 Incident reporting & vehicle grounding

Drivers report incidents (type, severity `Minor/Moderate/Major/Critical`, GPS
coords, assistance, expense) via `/api/driver/incidents` (web portal + mobile).
The staff registry `/incidents` is **read + resolve only** (PATCH status/
`actions_taken`; "Send to Maintenance" creates an Emergency Repair record).
Automation on a driver POST (`src/lib/driver/grounding.js`):
1. Acknowledges the reporter (Info notification).
2. If `shouldGroundVehicle` → sets the vehicle **Under Maintenance**, alerts
   dispatcher/staff, and if the vehicle has an active dispatch inside a 48 h
   (Major/Critical) or 2 h window, cancels its trips, unassigns the pair, resets
   the dispatch to **Pending Reassignment**, and sends URGENT interruption alerts.
3. Otherwise notifies overseers of the report.

`shouldGroundVehicle` (`src/lib/driver/grounding.js`) grounds when the severity is
Major/Critical **or** the incident type matches the breakdown regex (breakdown,
mechanical, engine, flat tire, battery, electrical, overheat), and never when
there is no `vehicleId`. It was previously a stub that grounded on any incident
with a vehicle attached; the rule is now real and unit-tested
(`src/lib/driver/grounding.test.js`).

### Web sessions (NextAuth)
- Credentials provider; bcrypt vs `employees.password_hash`; **IP rate limit 5/min**; JWT session strategy (`NEXTAUTH_SECRET`); role/employeeId/name embedded in token. Login redirects drivers → `/driver`, others → `/dashboard`.
- Registration is **admin-only**; public signup redirects to login.

### Mobile tokens (separate system)
- Access = 15-min HS256 JWT (aud `fleetops-mobile-access`), refresh = 30-day JWT (aud `fleetops-mobile-refresh`), both `NEXTAUTH_SECRET`-signed. Refresh tokens stored SHA-256 hashed in `mobile_refresh_tokens`; **single-use rotation**; role/driver re-read from DB every refresh; `logout?allDevices` revokes all.

---

## 8. Mobile App (`mobile/`)

Driver-only Expo app (guest experience not implemented). **5-tab MD3 UI** over a
guard stack; no native map SDK (TomTom static images), no push (in-app inbox).

### Route tree
```
app/_layout.js            fonts + AuthProvider + ThemeProvider + ErrorBoundary (Stack, headerShown:false)
app/login.js              interactive sign-in (email/password, show/hide toggle)
app/consent.js            privacy-policy consent gate (public)
app/(app)/_layout.js      guard: isDriverSession + accepted consent version else → /login or /consent
app/(app)/(tabs)/         bottom tab bar:
  index.js                Home — active vs pending trips, accept/decline, single “advance” button
                          (Start → En Route → Arrived → Complete), odometer modal, GPS toggle, tools
  map.js                  Live Map — full-screen trip map + bottom-sheet nav card, Google Maps deep link
  history.js              Completed/Cancelled trip list (status-pill tinted)
  notifications.js        Alerts inbox (in-app only) — mark read / read-all; tap deep-links per role map
  profile.js              ★ driver profile — identity, assigned vehicle, performance, license, consent
                          status, phone edit, **Sign out** (moved here from Home)
app/(app)/fuel-report.js  fuel entry; vehicle/trip derived server-side from profile.activeTrip
app/(app)/incidents.js    report incident (type/severity/desc/assistance/expense; GPS auto-capture via
                          expo-location + reverse geocode, forward-fail if no permission) + own list
app/(app)/inspection.js   read-only latest vehicle inspection (GET /api/driver/vehicle-inspection)
```

### lib/
- `api.js` — `BASE_URL = EXPO_PUBLIC_API_URL`; Bearer attach; single-flight refresh on 401; 15 s timeout + one retry. **No demo/mock layer** (removed).
- `auth.js` — AuthContext (login/signOut/session restore); `signOut` posts `/api/mobile/auth/logout`, clears SecureStore.
- `rbac.js` — `ACTIONS` (`manage_trip`, `report_location`, `report_fuel`), JWT role decode (client-only; server enforces).
- `tracking.js` — `useTripTracking`: foreground GPS, posts every 30 s to `/api/mobile/driver/trips/{id}/gps`.
- `tripRef.js` — cached `GET /api/mobile/driver/ref`: status buckets, `getNextStatus()`, tones (server owns the machine).
- `consent.js` — `CURRENT_PRIVACY_POLICY_VERSION = 1` in lockstep with web; SecureStore/localStorage gate.
- `storage.js` (SecureStore, localStorage on web), `theme.js` + `theme-context.js` (MD3 tokens, light/dark), `notifications/{presentation,navigation}.js`.
- `components/` — `ui.js` (MD3 primitives), `map.js` (**TomTom static-image** map inside an RN `Image`; PanResponder pan/zoom, live-position overlay, Google Maps "directions" deep link), `plate.js`, `logo.js`, `error-boundary.js`.

### Backend integration / CORS
- Talks to the Next API over plain JSON fetch; `EXPO_PUBLIC_API_URL` → LAN IP of the dev server. Referer-free, cookie-less: auth is `Authorization: Bearer` (the same `mobile_refresh_tokens` flow as §7).
- Cross-origin is enabled by `src/middleware.js` + `next.config.mjs` CORS headers (`Access-Control-Allow-Origin: *`, no credentials), so the Expo **web** build (different origin) and device/Expo Go builds work against the same API.

### Security rule
Only `EXPO_PUBLIC_*` config is allowed; the **server derives driver/vehicle/role from the token** — the mobile app never sends its own `driver_id`/`vehicle_id`/role.

---

## 9. ★ Current Update: Smart Queue & Dispatch, Incidents, Notification Direction, Mobile Tabs

The current feature wave (post-driver-consent) makes dispatch **priority-driven and
pair-scored**, adds **incident management** end-to-end, points **notifications at the
right surface**, and turns the mobile app into a **5-tab driver workspace**.

### 9.1 Smart Transportation Queue (priority engine)
- Explicit inputs `transportation_requests.is_vip` / `is_emergency` (set at intake
  or via `PATCH .../[id]/flags`, migration 026) feed a **deterministic priority
  engine** (`src/lib/scheduling/priority.js`). It writes a cached `derived_priority`
  (`Overdue → Critical → High → Medium → Normal → Future`) that the queue groups and
  orders on (`queue-grouping.js`); never human-set (CHECK in migration 026).
  Thresholds live in `system_settings.dispatch_policy` (`src/lib/dispatch-policy.js`),
  configurable at `/settings/dispatch` (system_admin/admin).

### 9.2 AI fleet-pair snapshots
- `src/lib/ai/pair-scoring.js` + `dispatch-advisor.js` recommend a **vehicle+driver
  pair** (designated-driver match dominates; a provably-unavailable custodian is the
  only legit substitute). Recommendations persist as immutable snapshots
  (`recommendation_snapshots`, migration 027) with a 60-min TTL, an `is_consumed`
  flag (flipped on assign), and a hard **designated-driver rule** at assign
  (`recommendation.service.js`). The saved-recommendation card surfaces stale
  snapshots as expired with regeneration.

### 9.3 Incidents (driver → staff → maintenance)
- Drivers report incidents with severity + GPS (web portal `/driver/incidents`,
  mobile `/incidents`). Staff see a **read-only registry** (`/incidents`) with an
  active-incident TomTom map, filters, and only two write controls: **Resolve**
  (`PATCH /api/incidents/[id]` → `Resolved` + `actions_taken`) and **Send to
  Maintenance** (creates an Emergency Repair record). A driver POST runs the grounding
  automation in `src/lib/driver/grounding.js` — acknowledge, then ground the vehicle +
  interrupt active dispatches, or just notify overseers (§7.3).

### 9.4 Notification direction & preferences
- Rows carry `reference_type` / `reference_id` / `severity` / `link`; all surfaces
  (web feed, driver inbox, admin pages) render shared category/severity chips
  (`src/lib/notifications/presentation.js`). Tap targets resolve **per-role**
  (`src/lib/notifications/target.js`) — staff or driver routes, guarded by
  `getRequiredRolesForPath` so a tap never loops through a redirect.
- Per-user toggles persist in `notification_preferences` (migration 030b) and drive
  the `/notifications/preferences` grid (event × channel, in-app non-disableable);
  email/push channels are accepted but delivery ships later.

### 9.5 Mobile tabs + TomTom map
- The mobile app is now `(app)/(tabs)/`: Home · Live Map · History · Alerts ·
  Profile (§8). Sign-out moved to Profile; login is interactive (demo mode removed).
  The map is TomTom **static images** (no RN/Leaflet native module) so it runs in
  Expo Go and on the web target; routing on web/server uses the `/api/tomtom/route`
  proxy.

### 9.6 Prior wave (still in effect): driver consent + portal
The consent/portal work (merged from `5794427`) remains live and is condensed here.
Versioned privacy policy (`CURRENT_PRIVACY_POLICY_VERSION = 1` in
`src/lib/consent/policies.js`) gates both web (`/driver`) and mobile (`(app)/_layout.js`)
personal-data screens; acceptance is append-only in `driver_consents` (migration 017a,
IP + via captured, no UPDATE/DELETE) via `POST /api/driver/me/consent` (409 on stale
version). The driver self-service portal spans `/driver` + subpages
(profile/license-scan, trips, incidents, vehicle, fuel) — `GET/PATCH /api/driver/me`
(whitelisted fields + per-side `canUpdateLicenseScan` 30-day gate),
`POST /api/driver/license-scan` (OCR, no persistence), `GET /api/driver/trips`,
`GET /api/driver/vehicle-inspection` (table restored by migration 028), and admin
controls `PUT /api/drivers/[id]/account` + `POST /api/drivers/link`.

---

## 10. Known Notes / Gotchas

- **RLS is inert** — do not rely on it; the API `requireAuth` is the security boundary. `has_role()` in SQL references a dropped function (`get_current_employee_role`) and would error if ever executed — confirming it never runs.
- **Migration tooling:** the `supabase` CLI is broken in this repo (`.env` line 8 orphaned token); apply migrations via a small Node script using `pg` + real `DATABASE_URL` wrapped in `BEGIN; … COMMIT;`, then verify via `information_schema`.
- **Middleware is CORS-only, no auth.** `src/middleware.js` + `next.config.mjs` answer `OPTIONS` for `/api/*`; real protection stays per-route `requireAuth`/`requireDriver`. Because the CORS header is `*` (no cookies allowed), mobile auth must use `Authorization: Bearer`.
- **Notification scoping is now self-scoped:** `GET /api/notifications`, `[id]/read`,
  and `read-all` all restrict to the caller (ops roles may pass `?employee_id=` on the
  GET); `notifications/[id]` DELETE allows staff to delete any row, others only their own.
- **`shouldGroundVehicle` is a stub** (see §7.3): always grounds when a `vehicleId` is
  present, ignoring the breakdown-regex/severity gating the comments describe.
- **Future-availability is enforced** (§4.8.2): a driver on `On Trip` or a vehicle
  on `In Use` is no longer excluded by status alone; `pair-scoring.js` now treats
  window overlap (`_schedule_load`) as the authority, so a busy-now-but-free-tomorrow
  resource is correctly offered. Removed `On Trip` from `UNAVAILABLE_STATUSES` and
  `In Use` from `NON_DISPATCHABLE_VEHICLE_STATUSES`; tests updated.
- **Travel + safety-buffer is enforced** (§4.8.3): `earliest_next_available` lives
  in `src/lib/scheduling/travel-buffer.js` and is a hard `TRAVEL_BUFFER` BLOCKING
  conflict at assign time when the ETA + previous-commitment signals are present
  (TomTom coordinates when supplied, else fails open). Buffer config in
  `dispatch-policy.js`. The `distance/25*60` value in `dispatch-advisor.js` remains
  a scoring heuristic only.
- **`vehiclereservations` is gone** (migration 036) along with both `reservation_id`
  columns, two trigger functions, and the `/api/reservations/*` route tree. Any
  older note describing a "two tables for one concept" split, or reservation
  endpoints returning 410, is describing a state that no longer exists.
- **Mobile demo-driver mode was removed** — login is interactive only; `EXPO_PUBLIC_ENABLE_DEMO` is orphaned config in `mobile/.env`.
- Route protection is via root `layout.js` → `DashboardLayout` → `RouteGuard` (client) + per-route API checks.
- A driver hitting `/dashboard` directly would render it (UI-only exposure; data APIs still enforce roles).
- Mobile status-advance uses the **web** route `PUT /api/trips/{id}/status` (not `/mobile/` prefix).
- Not implemented (documented scope limits): background location, **push** notifications (email/push channels are stored in `notification_preferences` but delivery does not ship yet), offline sync, guest mode, receipt OCR.

---

## 11. ★ UI remediation wave (2026-08-23) — shared primitives & behavior contracts

A full UX audit ran across web + mobile; the remediation landed in phases
0–6. The complete record lives in
`Capstone/01 - System/UI UX Audit - Web.md` (and the mobile twin). What a
future developer/AI must know:

**New/changed shared primitives (`src/components/ui/`)**
- `query-feedback.jsx` — `QueryBoundary` (loading skeleton / error+Retry /
  empty / children-as-function) and `QueryErrorBanner`. Every data surface is
  expected to handle query failure explicitly; failures must never render as
  "empty".
- `phase-rail.jsx` — `PhaseRail`, the ONE stepper grammar for ordered
  lifecycles (request/reservation/dispatch/trip chains). Tolerant of unknown
  statuses via fallback note.
- `confirm-dialog.jsx` — canonical props `{title, message, confirmLabel,
  variant, requireReason, loading, onConfirm(reason)}` with legacy aliases
  (`description`, `confirmText`, `isLoading`, `variant:"danger"` accepted).
  Variants: destructive/danger/warning/archive/logout/info. Destructive or
  externally-visible actions require confirmation; reason capture where audit
  matters.
- `stat-card.jsx` — renders `trend` as a context caption under the value;
  dashboard configs rely on it.
- `status-badge.jsx` — central grammar now covers ALL dispatch/trip states
  (incl. `Pending Reassignment` = danger), plus `incident` and `leave`
  entities. Do not add local status maps in pages; extend the central maps.
- `command-palette.jsx` — full role-filtered page coverage + entity search
  (deferred, non-blocking); Pages remain visible during search.

**Design tokens**
- Semantic colors exist as raw CSS vars AND Tailwind theme colors
  (`globals.css`). Charts take hex mirrors from `src/lib/chart-tokens.js` —
  never declare private palettes. Chart heights use `chart-h-sm/md/lg`
  utilities. `docs/design-system.md` is canonical for the shipped visual
  language (Inter-everywhere, ink primary).

**Behavior contracts**
- Cancel of a transportation request ALWAYS goes through ConfirmDialog +
  required reason, gated by `can("reservations","cancel")`.
- Login throttling surfaces honestly: `GET /api/auth/login-status`
  (read-only peek) backs the login page's lockout messaging.
- Staff account management: `/settings/users` index +
  `GET/PUT /api/settings/users` (disable = soft-delete per migration 028 —
  that is what blocks sign-in; status='Inactive' is the readable flag).
- Availability boards tab vocabulary mirrors canonical DB CHECK values exactly.
- Mobile: SwipeButton exposes accessibility actions; offline-queued incident
  reports say "saved offline", never claim dispatch receipt.
