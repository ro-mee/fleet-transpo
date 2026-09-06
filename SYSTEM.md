# FleetOps — Fleet & Logistics Management System

Comprehensive system overview for AI assistants and new developers. Covers architecture, tech stack, directory layout, database schema, API surface, auth/RBAC, the mobile companion app, and the business logic domains.

## 1. System Overview

**FleetOps** is a hotel-affiliated fleet & logistics management platform (guest transport for a hotel, e.g. "CoCo Star Hotel"). It runs the full lifecycle of guest transportation requests — from an external **Booking** subsystem through intake, review, approval, dispatch scheduling, trip execution, GPS tracking, fuel reporting, and maintenance — plus fleet/driver/vehicle management, analytics, reports, and a driver-facing mobile app.

It is a **single-organization** system (branch/multi-tenant concepts were removed in migration 013). There are two applications in one repo:

> **Last audited:** 2026-09-03 against Git `1a16346`. Repository counts and the checked-in schema are synchronized below; live Vercel environment variables and the production migration ledger remain deployment-specific and must be verified in their respective environments.

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
`/fleet/availability` + `/drivers/availability` boards were merged **2026-08-23**
into the dispatch module as `/dispatch/availability` (one page, Drivers |
Vehicles tabs); management gained Vehicles visibility in the merge. **2026-09-04:**
the page went **pairs-only** — the separate status lists re-proved misleading
(`5 Available vehicles + 5 Available drivers` reading as 5 dispatchable), so
`/dispatch/availability` now answers "which actual vehicle + driver pairs can
dispatch in this window?" Full-day default (`Showing dispatchability for today`),
optional exact-window picker, hard-blocker precedence, collapsed may-be-affected
trip warnings. Read surface: `GET /api/dispatch/availability-pairs` (see §6).

**Latest changes** (the current feature wave — details in §7/§8/§9/§12):

- **Smart Transportation Queue** (migrations 032–033): explicit priority inputs
  `is_vip` / `is_emergency` on `transportation_requests` feed a deterministic
  priority engine (`src/lib/scheduling/priority.js`) that writes a cached
  `derived_priority` (`Overdue → Critical → High → Medium → Normal → Future`);
  thresholds are admin-configurable (`src/lib/dispatch-policy.js`, `/settings/dispatch`).
  AI fleet-pair recommendations are now **immutable snapshots**
  (`recommendation_snapshots`, `src/lib/ai/pair-scoring.js` + `dispatch-advisor.js`)
  with a TTL, a `designated-driver` rule enforced at assign, and regeneration.
- **Incidents module** (migrations 030/035, 081–086): driver-reported incidents (severity +
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
- **CORS lockdown:** `src/proxy.js` (Next 16 middleware) answers preflights only
  for the `NEXT_PUBLIC_APP_URL` origin and 403s every other cross-origin caller —
  fail-closed, no `*` (see §4.6).
- **Authentication and session hardening** (migrations 087–089, 2026-09-02):
  web sessions are server-backed with a 1-hour idle timeout and 12-hour absolute
  expiry; heartbeat activity, cross-tab session events, validated return-to
  redirects, TOTP MFA, and hashed recovery codes are shipped. Production requires
  distinct `MOBILE_JWT_SECRET` and dedicated `MFA_ENCRYPTION_KEY` secrets.
  The password field Caps Lock warning UI matches the reference design with an
  upward speech-notch pointer, a coral "Aa" badge, and an active coral input border,
  also extended to Confirm New Password for live match/mismatch feedback.
  The login session-expired banner matches the reference design with warm peach card
  surface, orange alert circle icon, two-line title/description, and dismiss action.
- **Live map & incident-map UX polish** (2026-09-03): the live map always
  auto-fits to all pins on every GPS poll, vehicle markers carry permanent
  plate + driver labels (no hover/click), marker colors are phase-coded with
  no gray fallback, and the open-incidents layer and floating "Live Route
  Navigation" panel were removed (the Incidents module already plots
  incidents on its own map, whose markers now show permanent type · severity
  + driver labels). Mobile SOS reports a reverse-geocoded place name instead
  of a raw Google Maps URL. Details in §9.3/§12.10.
- Mobile app tab bar is Home / Live Map / **scan FAB** (fuel gauge+receipt
  capture) / Trips / Profile; Vehicle, Alerts (notifications) and History live
  off the bar (header access) — see §8.
- **Newer waves** (2026-08-15 → 2026-09-03, details in §12): driver work
  schedules + leave requests, substitute-driver coverage, fuel **requests**
  (monthly allocations + Gemini gauge scan), **push notifications**
  (`push_outbox` + Expo), AI report narratives, per-trip pre-trip inspection
  gate, idempotent client submissions, and the CORS lockdown (`src/proxy.js`
  replaced `src/middleware.js`).

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
| Document scanning | **Google Gemini** structured extraction (`gemini-3.1-flash-lite`) + LLM provider abstraction | license / OR-CR / insurance / fuel-receipt **+ fuel-gauge** scanning; tesseract.js removed 2026-08-25 |
| Tests | **vitest ^3** | harnesses import real `src/lib` modules against the live DB |
| Scripts | `dev`, `build`, `start`, `lint`/`lint:ci`, `test`/`test:run`, `db:{status,up,check,rebaseline,erd,dump}`, `seed:{status,plan,up,down}` | |

### Mobile (`mobile/package.json`)
- Expo SDK ~54, RN 0.81.5, React 19.1, **expo-router ~6** (file-based), **expo-secure-store** (tokens), **expo-location** (GPS), **expo-notifications** (foreground handler + local scheduling + Expo push token), **expo-camera** + **expo-image-picker** + **expo-image-manipulator** (fuel gauge/receipt capture, incident photos, license scan), **expo-dev-client**; fonts `@expo-google-fonts/plus-jakarta-sans` + `@expo-google-fonts/ibm-plex-mono`; **react-native-web + @expo/metro-runtime** (Expo web target), lottie (completion animation).
- Scripts: `start`, `tunnel` (`@expo/ngrok`), `android`, `ios`, `web`.

### Key environment config
- Local configuration is read from `.env`; deployed configuration is supplied by the hosting provider. Core server keys are `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`; `NEXT_PUBLIC_APP_URL` is the browser CORS origin. `AUTH_SECRET` is retained for compatibility.
- Production auth requires a distinct `MOBILE_JWT_SECRET` and a dedicated 32-byte hex or base64 `MFA_ENCRYPTION_KEY`. The MFA key encrypts TOTP secrets with AES-256-GCM; generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, configure it in Vercel for Production and Preview, and redeploy. Never expose either secret to the client or rotate `MFA_ENCRYPTION_KEY` after enrollment unless all enrolled factors are intentionally reset.
- Mobile EAS configuration is committed in `mobile/app.json` and `mobile/eas.json`. It links project `0c1651d5-7014-48da-8227-5d9f30ea1a23` to Expo owner `josephlopezzzz`; before building, run `eas whoami` and `eas project:info` from `mobile/`. An `Entity not authorized` / `action=READ` error is an Expo-account permission problem, not an app-runtime error; authenticate as the owner or obtain project access before changing the linked project ID.
- Optional integrations use `CRON_SECRET`, `BOOKING_WEBHOOK_SECRET`, `BOOKING_GATEWAY`, `BOOKING_API_URL`, `BOOKING_API_KEY`, AI provider keys, and TomTom (`NEXT_PUBLIC_TOMTOM_API_KEY` client, `TOMTOM_API_KEY` server). Missing integration keys degrade to documented fallbacks or disable the protected integration.
- `next.config.mjs` — `turbopack.root` + security headers (CSP, HSTS, frame/nosniff, referrer policy). **No CORS here.**
- `src/proxy.js` — **Next 16's middleware** (export `proxy()`, matcher `/api/:path*`). CORS **lockdown, fail-closed**: same-origin/no-Origin requests pass; any other `Origin` gets 403; preflight is answered 204 only for the `NEXT_PUBLIC_APP_URL` origin. No auth in the proxy — protected handlers enforce auth per route; public protocol and service-token endpoints use explicit checks. Covered by `src/security-boundaries.test.js`.
- Path alias: `@/* → ./src/*` (`jsconfig.json`).

---

## 3. Directory Layout

```
fleet-transpo/
├── src/                        # Next.js web app
│   ├── proxy.js                # Next-16 middleware: CORS lockdown on /api/* (fail-closed, no auth)
│   ├── security-boundaries.test.js  # vitest guard for the boundaries above
│   ├── app/
│   │   ├── layout.js           # ONLY root layout; wraps all pages in DashboardLayout + beforeInteractive theme-init script
│   │   ├── page.js             # "/" → server redirect: no session → /login, driver → /driver, else /dashboard
│   │   ├── globals.css
│   │   ├── (auth)/             # login, register(→redirect /login), forgot-password, reset-password
│   │   ├── (dashboard)/        # all app modules (no group layout; chrome from DashboardLayout)
│   │   │   ├── dashboard/      # home KPIs, charts, live map, AI insights
│   │   │   ├── driver/         # ★ driver portal — home, trips, profile (licenses+scan), incidents, vehicle, fuel
│   │   │   ├── fleet/          # vehicles (+ new/[id]/edit), categories, documents
│   │   │   ├── drivers/        # list, new, [id] (detail+account), [id]/edit, performance
│   │   │   ├── trips/          # register, active (live cards), [id]
│   │   │   ├── reservations/   # register, queue (dispatcher workspace), new (dev mock), [id]
│   │   │   ├── dispatch/       # kanban board, calendar, pair-first availability (today/exact-window), [id]
│   │   │   ├── fuel/           # ops console (registry/budget/permits/review), analytics
│   │   │   ├── maintenance/    # records, predictive (AI)
│   │   │   ├── incidents/      # ★ Fleet Incidents Registry (staff read-only + resolve, live map)
│   │   │   ├── tracking/       # live-map, history
│   │   │   ├── routes/
│   │   │   ├── ai/             # insights, predictive-maintenance, provider settings, logs
│   │   │   ├── reports/        # 6 report types + cost dashboard (+ AI narrative cards)
│   │   │   ├── analytics/
│   │   │   ├── executive/      # ★ Executive KPI Center (management/admin, read-only)
│   │   │   ├── notifications/  # feed, preferences, templates
│   │   │   ├── system/         # ★ System Console (admin) — audit log (system_admin only)
│   │   │   └── settings/       # general, profile, security, users/new, api, ai/logs, number-coding (UVVRP), dispatch (smart queue)
│   │   └── api/                # 183 route handler files (see §6)
│   ├── components/
│   │   ├── layout/             # app-shell, dashboard-layout (+RouteGuard)
│   │   ├── dashboard/          # ★ role-dashboard renderer + dashboard-configs.js
│   │   ├── ui/                 # shadcn primitives (card, button, dialog, toast, query-feedback, phase-rail, ...)
│   │   ├── tables/             # data-table, fleet-table
│   │   ├── maps/               # live-locations-map
│   │   ├── drivers/            # assigned-vehicle-card, substitute-driver-card
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
│   │   ├── audit.js            # writeAudit() — the only audit_logs writer since 014b dropped the DB triggers
│   │   ├── auth/               # api-auth, permissions.js (RBAC matrix), role-guard, mobile-token
│   │   ├── api/                # utils (requireAuth/ok/err), client (apiFetch), service-auth, ownership, trips-query
│   │   ├── consent/            # policies.js, driver-visibility.js
│   │   ├── driver/             # grounding.js — breakdown regex + vehicle-grounding rule (unit-tested)
│   │   ├── fuel/               # request-policy.js, gemini-gauge.js (gauge scan, fail-closed)
│   │   ├── notifications/      # presentation.js (category/severity chips), target.js (per-role nav)
│   │   ├── scheduling/         # calendar, conflicts, priority, queue-grouping, trip-progress, travel-buffer,
│   │   │                       #   driver-schedule (shift/leave blocking), state machines
│   │   ├── integration/        # booking-gateway, contracts, ingest (shared writer), category-resolver, status-map
│   │   ├── ai/                 # llm-adapter, rule-engine, dispatch-advisor, pair-scoring, predictive-maintenance,
│   │   │                       #   gemini-document, report-narrative, license-scan-policy
│   │   ├── uvvrp/              # policy.js (Number Coding), uvvrp.service.js
│   │   ├── supabase/, geo/, vehicles/, validation/
│   ├── services/               # 35 modules: client apiFetch wrappers + server business-logic services
│   └── hooks/                  # use-auth, use-realtime, use-role-access, use-theme, ...
├── mobile/                     # Expo driver app — see §8
├── supabase/
│   ├── migrations/             # 93 SQL migrations (through 089; see §5)
│   ├── config.toml
│   └── functions/ai-recommend-vehicle/   # edge function
├── docs/                       # rbac-model.md, design-system.md, mobile-*.md, architecture/
├── scripts/                    # 57 files: migrate.mjs, dump-schema.mjs, generate-erd.mjs, seed-demo.mjs, verification harnesses
├── schema.sql                  # GENERATED by npm run db:dump — never edit by hand
├── resources/ai/instructions.md
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
   (external ingest)                   6-state      5-state      16-state
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
  a **strict linear chain** `Pending → Scheduled → Assigned → In Progress →
  Completed`; `Cancelled` from any non-terminal. Terminal states are locked.
  The old review cluster (`Under Review` / `Approved` / `Rejected`) was removed by
  migration `037_remove_review_statuses.sql` — existing rows were backfilled
  (`Under Review→Pending`, `Approved→Scheduled`, `Rejected→Cancelled`) and the CHECK
  now carries exactly six values; the `review|approve|reject` routes remain as thin
  aliases that walk this chain (`approve` = `Pending→Scheduled`).
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
  (migration `047_drop_vehiclereservations.sql`). It held 0 rows and duplicated
  `transportation_requests`.

### 4.5 AI layer (optional LLM + rule engine)
- **Rule engine** (`lib/ai/rule-engine.js`) is the deterministic baseline (recommendations, insights, predictive maintenance).
- **LLM** (`lib/ai/llm-adapter.js`) adds natural-language summaries/narrations — failure-tolerant, time-budgeted (25 s), falls back to rule output.
- `aiproviders` config table (API keys masked); `ailogs` usage log; `POST /api/ai/scan-document` (Gemini structured extraction via `src/lib/ai/gemini-document.js`, 12 s timeout, null-for-unreadable) powers license / OR-CR / insurance scanning with LTO renewal scheduling.
- **Error-log ownership (2026-09-06):** `app_errors` (migration 103) owns *unexpected* application/platform failures only. AI provider/timeout/parse/quota/fallback events stay exclusively in `ailogs`; the gate is proof-of-persistence (`subsystemOwned` set only after the specialized write succeeds — a bare subsystem code never suppresses), so a failed specialized write still lands in `app_errors` as fallback. Scan routes (`scan-document`, driver `license-scan`) now persist their contained Gemini failures to `ailogs`. Writer: `src/lib/app-errors.js` (sanitize + fingerprint + 90-day prune helper); `handleError(error, { req, employeeId })` stays backward-compatible (224 single-arg + 11 string-label callsites untouched). **Pass 1b APIs (same day):** `POST /api/errors` (explicit 6-role array incl. driver, per-account+IP throttles, rejects `source=server` + oversized/non-path payloads, always 200 with `{ received }` so reporters never retry-loop) and `GET /api/errors` (`audit`-read gate; events without stack + `GROUP BY fingerprint` occurrence groups + single-`error_id` detail with stack);   client `src/services/errors.service.js` (`getAppErrors`, `getAppError`,
  fire-and-forget `reportAppError`). **Pass 2 UI + reporters (same day):**
  `/system/errors` page (system_admin-only via `NAV_ROLES` + workspace nav +
  path-derived guard; grouped-by-fingerprint default with expandable events,
  stack detail dialog, source/date filters, CSV export) under Administration
  next to Audit Logs; web `ErrorBoundary.componentDidCatch` and mobile
  `ErrorBoundary` report once per mount (mobile stack display is `__DEV__`-only
  in production); 90-day `pruneAppErrors` runs inside the CRON_SECRET
  `/api/cron/sync` flow in an isolated step with an `errors_pruned` count —
  **deploy check:** an external scheduler must actually hit that route or
  neither the status sync nor pruning runs.

### 4.6 CORS — `src/proxy.js` lockdown (fail-closed)
Next 16 renamed middleware to **proxy**: `src/proxy.js` exports `proxy(request)`
with `config.matcher = "/api/:path*"`. Policy (Roadmap Phase 5): the web client
is same-origin, the mobile app is native (no browser origin checks), and Booking
is server-to-server — so there is **no legitimate cross-origin browser caller**.
Requests with no `Origin` header pass untouched; any `Origin` other than
`NEXT_PUBLIC_APP_URL` gets **403**; `OPTIONS` preflights are answered 204 only
for that allowed origin. There is no auth in the proxy — the real boundary stays
per-route `requireAuth()`/`requireDriver()` (§4.2). `src/security-boundaries.test.js`
locks this behavior in. (The older `Access-Control-Allow-Origin: *` design is
gone — do not reintroduce it.)

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
- **Recommendation snapshots** (`recommendation_snapshots`, migration 033) are
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
6. **Working per weekly schedule** — `driver_work_schedules` must have a row for
   the pickup weekday, the pickup→return window must fit inside the shift, and a
   half-open break overlap blocks (`lib/scheduling/driver-schedule.js`).
   No schedule row = blocked (fail-closed when context was loaded).
7. **Not on leave** — approved leave covering the pickup date blocks; *pending*
   leave surfaces as a non-blocking warning.
8. **No blocker** — no active incident / restriction, etc.

A **vehicle** is dispatchable when **all** hold:

1. **Operationally dispatchable** — status not `Under Maintenance` or
   `Decommissioned`. `In Use` is **not** a blocker
   for a *future* request (see 4.8.2); `Reserved` (a whole-day label) never
   hides a genuinely free window. (`Registration Expired` was removed from the
   live status CHECK — see §5.3.)
2. **Not grounded** — not grounded by an incident / not under an open maintenance
   window on the pickup date.
3. **Documents valid** — registration and insurance valid on the pickup date.
4. **Free in the window** — no overlapping dispatch / reservation.
5. **Right size** — seating capacity ≥ passenger count.
6. **Covered custodian** — if the designated driver is unavailable
   (e.g. suspended), a `substitute_vehicle_schedules` row covering the date must
   exist; consumers resolve the "effective driver for a date" through it
   (`recommendation.service.js`, `pair-scoring.js`, `conflicts.js`,
   `uvvrp.service.js`).

These predicates are enforced at: `GET /api/drivers` (picker filters blocked
drivers with a reason), `GET /api/vehicles/available`, `validatePairing`
(`recommendation.service.js`) + `pair-scoring.js`, conflict checks
(`conflicts.js`), and the trip-start guard (`PUT /api/trips/[id]/start`).
`GET /api/dispatch/availability-pairs` reports (not enforces) the same rules
for the availability board — classification only, assignment authority stays
with the gates above.

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

### 4.9 Canonical route resolution and lifecycle

`src/services/route-resolver.service.js` is the shared server-side path for
turning a request leg into a reusable route estimate. It normalizes endpoint
names, resolves both ends to active `locations` rows, reuses the active
directional route when one exists, and only creates a route after both endpoint
identities are valid. Unknown/free-text destinations remain ad-hoc request legs
and never pollute the route registry.

Routes are directional (`origin → destination`) and the database allows only one
active, non-deleted route per location pair while preserving inactive history.
`estimate_source` (`TomTom`, `Manual`, or `Legacy / Unknown`) and
`estimate_updated_at` preserve provenance; manual values are not overwritten by
TomTom refreshes, which is an explicit action from the Routes registry.
Endpoint identity changes are blocked after any dispatch/trip usage; operators
create a replacement route and deactivate the old one instead. Hotel renames
preserve the location identity, while a physical move creates a new active
location and retires the old location/routes so historical trips keep their
original geography.

Booking ingestion, dispatch auto-create, rescheduling, and AI recommendations
use this resolver. Live GPS and mobile navigation consume the selected trip's
route/destination data only; missing endpoint coordinates omit the route line
and ETA rather than guessing another route or a default hotel position.

---

## 5. Database Schema (PostgreSQL on Supabase)

The checked-in `schema.sql` currently declares **50 tables, 1 view (`driver_stats`),
103 foreign keys, 108 standalone indexes plus 15 unique indexes, 14 functions, and
19 triggers**. It is the authoritative structure dump; §5.2 below is a reading aid,
not the source. Dispatch numbers are random strings, while serial-backed tables
still use PostgreSQL sequences in the live database.

There are **105 migration files** in `supabase/migrations/`, numbered through 102 (090 unused).
Exactly four numeric versions are duplicated historically — **036, 037, 059, and
060** each have two files, applied in filename order. The checked-in schema includes
the server-backed session/MFA tables and the `idle_timeout_seconds` column from
migrations 087–089. Live ledger state is environment-specific; verify it with
`npm run db:status` before applying anything. Migrations are applied via a direct
`pg` connection, NOT the Supabase CLI or the SQL editor (see `AGENTS.md` — the CLI
is broken here and the web editor was found to silently target the wrong project).
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
| 001 | `schema.sql` | Baseline: 36 tables — roles, employees, vehicles, drivers, trips, dispatchschedules, gpstracking, fuelrecords, **fuelrequests** (born here), audit/notifications/AI tables; `update_updated_at()` + `generate_dispatch_number()` |
| 002 | `rls_policies.sql` | RLS on all tables + `has_role()` helper (documented **inert** at runtime) |
| 003 | `notification_triggers.sql` | SECURITY DEFINER notification triggers |
| 004 | `integration_sub_system.sql` | `service_types`, `booking_channels`, `integration_log`; guest columns on `vehiclereservations` |
| 005 | `schema_cleanup.sql` | Trim 40→22 tables (drop permissions/fuel sub-tables/attendance/incidents/etc.; merge inspection→maintenance) |
| 006 | `driver_attendance_face.sql` | `drivers.face_image_url`; recreate `driverattendance` w/ face fields; `face-captures` bucket |
| 007 | `normalization.sql` | `locations` table; restore `vehicledocuments`; merge trip cost+performance into `trips`; create `driver_stats` VIEW |
| 008 | `auth_migration.sql` | `employees.password_hash` (bcrypt); seed admin |
| 009 | `registration_policy.sql` | anon INSERT/SELECT on employees (revoked again in 060b) |
| 010 | `compliance_notifications.sql` | registration-overdue + license-expired triggers |
| 011 | `rls_fix.sql` | missing policies; grant `driver_stats` |
| 012 | `status_constraints.sql` | CHECK constraints on vehicle/driver/reservation/dispatch/trip/fuel status |
| 013 | `drop_branches.sql` | remove single-tenant branches |
| 014 | `registration_expired_status.sql` | add `Registration Expired` vehicle status (the live `chk_vehicle_status` has since been rebuilt without it — five values remain, see §5.3) |
| 015 | `cleanup_dead_objects.sql` | drop broken triggers/functions (auth trigger, dashboard stats, audit fns) |
| 016 | `mobile_tokens.sql` | `mobile_refresh_tokens` (hashed, revocable) |
| 017 | `transportation_requests.sql` | **Fleet Reservation Queue** (`external_booking_id` UNIQUE idempotency) |
| 018 | `reservation_module.sql` | reservation lifecycle, `reservation_number`, AI recommendation cols, `reservation_events` timeline |
| 019 | `driver_consents.sql` | ★ privacy consent audit table (append-only) |
| 020 | `driver_vehicle_assignments.sql` | permanent driver↔vehicle pairing history w/ 2 partial UNIQUE active indexes |
| 021 | `cleanup_dead_columns.sql` | drop 6 never-read/written columns |
| 022 | `predictive_maintenance.sql` | `vehicles.service_interval_km/days` |
| 023 | `admin_role.sql` | ★ insert **`admin`** role (`role_id 9`); backfill role-less drivers to `driver` |
| 024 | `cleanup_ai_and_gpstracking.sql` | drop `vehiclereservations.ai_*` + `gpstracking.driver_id` (both dead) |
| 025 | `service_interval_guards.sql` | positive-interval CHECKs + partial `idx_trips_end_time` |
| 026 | `fuel_hardening.sql` | fuel review workflow (`rejection_reason`, `approved_by/at`, status CHECK) |
| 027 | `driver_personal_details.sql` | `drivers.address/sex/birthdate/nationality` (license scan auto-fill) |
| 028 | `remove_front_desk_roles.sql` | ★ drop hospitality roles (role rows 5/6/8); disable the 3 employees who held them |
| 029 | `dispatch_overlap_guard.sql` | ★ DB-level double-booking guard trigger + advisory locks on `dispatchschedules` |
| 030 | `driverincidents.sql` | ★ recreate `driverincidents` (dropped in 005) — driver incident reporting + breakdown automation |
| 031 | `uvvrp.sql` | ★ Number Coding: `uvvrp_exemptions` + `uvvrp_violations` |
| 032 | `smart_dispatch.sql` | ★ smart-queue inputs `is_vip`/`is_emergency` + cached `derived_priority` (CHECK) + indexes |
| 033 | `recommendation_snapshots.sql` | ★ immutable AI fleet-pair snapshots (UNIQUE active-per-request, TTL, consumed flag) |
| 034 | `recreate_vehicleinspection.sql` | ★ restore `vehicleinspection` for driver inspection reporting |
| 035 | `incident_coordinates.sql` | ★ `driverincidents.latitude/longitude` for the incident live map |
| 036a | `dispatch_cancel_reason.sql` | `dispatchschedules.cancel_reason` (auditable stand-downs) |
| 036b | `trip_lifecycle_status.sql` | rebuild `chk_trip_status` with the pickup-lifecycle statuses; declare `Pending Reassignment` in `chk_dispatch_status` |
| 037a | `notification_preferences.sql` | ★ per-employee (event×channel) toggles table + self-access RLS |
| 037b | `remove_review_statuses.sql` | ★ `fleet_status` → six values: backfill `Under Review→Pending`, `Approved→Scheduled`, `Rejected→Cancelled`; re-add CHECK without the review cluster |
| 038 | `perf_ai_provider_and_board_index.sql` | migrate `aiproviders` out of hot-path DDL; partial `scheduled_departure` index for the board |
| 039 | `fuel_receipts_bucket.sql` | private `fuel-receipts` storage bucket (server uploads, signed URLs out) |
| 040 | `substitute_driver_schedules.sql` | ★ `substitute_vehicle_schedules` — substitute custodian coverage per vehicle/date window |
| 041 | `dispatch_number_trigger.sql` | BEFORE INSERT trigger `trg_dispatch_number` fills `dispatch_number` when NULL |
| 042 | `dispatch_pending_reassignment.sql` | reconciliation no-op re-declaring the five dispatch status values |
| 043 | `backfill_undeclared_tables.sql` | reconciliation: declares `ailogs`, `ai_report_narratives`, `system_settings`, `substitute_vehicle_schedules` that existed live but had no migration |
| 044 | `dispatch_number_random.sql` | redefine `generate_dispatch_number()` → random `DSP-XXXX` suffix (50 collision re-rolls); sequence numbering gone |
| 045 | `ai_report_narratives.sql` | AI report narrative cache/budget table (+RLS); guarded create, no-op after 043 |
| 046 | `driverincidents_assistance_needed.sql` | declare `assistance_needed text[]` (existed live only) |
| 047 | `drop_vehiclereservations.sql` | ★ **drop `vehiclereservations`** (0 rows), both `reservation_id` columns and their FKs/indexes, two orphaned trigger functions |
| 048 | `trip_pretrip_gate.sql` | `vehicleinspection.trip_id` FK + index — inspections become per-trip |
| 049 | `driver_work_schedule_and_leave.sql` | ★ `driver_work_schedules` (weekly shift rows) + `driver_leave_requests` |
| 050 | `vehicle_images_bucket.sql` | public `vehicle-images` storage bucket |
| 051 | `fix_driver_work_schedules_constraint.sql` | rest-day rows exempt from `shift_end > shift_start` |
| 052 | `server_side_pagination_indexes.sql` | seven list/pagination indexes (trips by vehicle/driver/status, dispatch by request, routes endpoints) |
| 053 | `driver_leave_improvements.sql` | leave start/end times; `driver_leave_balances`; `notify_leave_requested/reviewed()` triggers |
| 054 | `notify_dispatcher_leave.sql` | briefly adds dispatcher to leave-request notifications |
| 055 | `remove_dispatcher_leave_notification.sql` | deliberate revert of 054 (fleet_manager/admin only) |
| 056 | `names_proper_case.sql` | data normalization: initcap names across employees/drivers/guest_name |
| 057 | `vehicle_names_proper_case.sql` | acronym-aware title-casing of `vehicles.vehicle_name`/manufacturer via temp function |
| 058 | `device_tokens.sql` | ★ Expo push tokens (`token` UNIQUE, platform, active flag) |
| 059a | `dispatch_push_outbox.sql` | ★ `push_outbox` queue + `notifications.pushed_at` + trigger enqueueing a driver push on dispatch INSERT |
| 059b | `fuel_submission_idempotency.sql` | `fuelrecords.client_submission_id` + UNIQUE partial index (offline replay safety) |
| 060a | `inspection_submission_idempotency.sql` | same idempotency pattern on `vehicleinspection` |
| 060b | `remove_anon_employee_access.sql` | ★ security hardening: drops anon policies on `employees`, REVOKEs anon privileges |
| 061 | `invalidate_seeded_admin_hash.sql` | nulls the publicly-known seeded admin password hash if ever still present (normally a no-op) |
| 062 | `driverincidents_resolution_integrity.sql` | incidents get `client_submission_id`; stray statuses normalized; `chk_driverincidents_status` → `Open\|Resolved` |
| 063 | `vehiclemaintenance_source_incident.sql` | `vehiclemaintenance.source_incident_id` FK + backfill from "generated from Incident #N" descriptions |
| 064 | `driver_suspension_reason.sql` | `drivers.suspension_reason` + backfill `license_expired` |
| 065 | `incident_photos.sql` | ★ `driverincidents.photo_urls text[]` + private `incident-evidence` bucket |
| 066 | `vehicle_monthly_fuel_allocations.sql` | ★ vehicles get `tank_capacity_l`/`fuel_efficiency_kmpl`; monthly `fuelallocations` table; `fuelrequests` snapshot columns (`current_fuel_level_percent`, `recommended_liters`, `allocation_month`, …); open-request uniqueness moves trip→vehicle scope |
| 067 | `fuelrecord_receipt_fuel_type.sql` | `fuelrecords.receipt_fuel_type` |
| 068 | `fuelrequest_gauge_photo.sql` | `fuelrequests.gauge_photo_url` |
| 069 | `fuel_requests.sql` | declares `fuelrequests` indexes/idempotency (table born in 001) and links receipts: `fuelrecords.fuel_request_id` 1:1 UNIQUE FK |
| 070 | `driver_licenses_bucket.sql` | private `driver-licenses` storage bucket for sensitive driver documents |
| 071 | `fuel_receipt_integrity.sql` | preserves receipt scan data, anomaly flags, transaction IDs, and corrects fuel status defaults |
| 072 | `cleanup_fuel_test_data.sql` | soft-deletes fuel test artifacts and adds fuel/trip analytics indexes |
| 073 | `fuel_review_remarks.sql` | adds review remarks to fuel records |
| 074 | `vehiclemaintenance_completion_audit.sql` | records the employee who completed maintenance |
| 075 | `vehiclemaintenance_completed_at.sql` | records maintenance completion time |
| 076 | `routes_integrity.sql` | canonical location links, estimate provenance, active directional uniqueness, and route integrity checks |
| 077 | `routes_direction_labels.sql` | normalizes legacy bidirectional labels to explicit direction arrows |
| 078 | `validate_routes_integrity.sql` | validates route status, endpoint, estimate, and provenance constraints |
| 079 | `normalize_route_arrows.sql` | normalizes remaining legacy `->` route labels to `→` |
| 080 | `backfill_hotel_location_identity.sql` | persists the canonical active hotel `location_id` in `system_settings` |
| 081 | `incident_triage_integrity.sql` | adds incident acknowledgement/resolution ownership, grounding state, retry indexes, and severity checks |
| 082 | `incident_grounding_no_vehicle.sql` | prevents incidents without a vehicle from triggering grounding automation |
| 083 | `incident_maintenance_unique.sql` | enforces one maintenance work order per source incident |
| 084 | `incident_maintenance_state.sql` | links incident maintenance state, backfills work orders, and grounds affected vehicles |
| 085 | `incident_maintenance_grounding.sql` | keeps unresolved vehicle incidents in the grounding queue |
| 086 | `incident_maintenance_grounding_backfill.sql` | completes legacy incident grounding backfills after maintenance linkage |
| 087 | `auth_security_lifecycle.sql` | adds auth-version invalidation, shared rate limits, mobile token families, and password reset tokens |
| 088 | `auth_sessions_mfa.sql` | adds server-backed web sessions, encrypted employee MFA, recovery codes, and supporting indexes |
| 089 | `session_idle_timeout.sql` | adds the configurable `web_sessions.idle_timeout_seconds` defaulting to 3600 seconds |
| 091 | `company_cards_and_assignments.sql` | `company_cards` + `company_card_assignments` (fleet fuel payment cards) |
| 092 | `expense_records.sql` | `expense_records` (driver expenses, idempotent `client_submission_id`) |
| 093 | `fuelrecords_payment_method.sql` | `fuelrecords.payment_method` + `company_card_id` + consistency CHECK |
| 094 | `expense_receipt_scans.sql` | `expense_receipt_scans` (receipt storage key + sha + OCR snapshot) |
| 095 | `expense_receipts_rls_fix.sql` | locks down `expense-receipts` storage to backend-signed URLs only |
| 096 | `company_card_unique_assignment.sql` | one active assignment per company card (partial UNIQUE) |
| 097 | `incident_production_remediation.sql` | incident remediation fields (confidentiality, injury, police/insurance refs, SLA dates) |
| 098 | `incident_overdue.sql` | `update_incident_sla_breaches()` helper for SLA-breach marking |
| 099 | `pg_cron_sla.sql` | pg_cron schedule running the SLA-breach check every minute |
| 100 | `enable_rls_all.sql` | enables RLS across tables (still inert at runtime — §4.1) |
| 101 | `incident_response_tracking.sql` | physical-rescue columns on incidents (response status/type/ETA, history via `incident_comments`) |
| 102 | `incident_responder_tracking.sql` | links incidents to a GPS-tracked fleet responder driver (auto-advance Dispatched→En Route→Arrived) |

> 042–046 are **reconciliation** migrations: the live database had drifted ahead of
> the files, so replaying the history onto an empty database produced a schema the
> app could not run against. They declare what already existed rather than
> changing live — which is why every one is a no-op there.

### 5.2 Tables (final state)
| Table | Domain | Notes |
|---|---|---|
| `roles` | auth | `role_id`, `role_name` UNIQUE |
| `employees` | auth/users | 1:1 with `auth.users`, `role_id`, `password_hash`, `auth_version`, soft-delete |
| `auth_rate_limits` | auth | shared IP/account throttle buckets used by web/mobile auth |
| `password_reset_tokens` | auth | hashed, one-time, expiring administrator-issued reset links |
| `web_sessions` | web auth | server-backed session records with revocation, device metadata, 12-hour expiry, and configurable idle timeout |
| `employee_mfa` | web/mobile auth | encrypted TOTP secret, enrollment expiry, enabled state, and replay marker |
| `mfa_recovery_codes` | web/mobile auth | hashed, single-use recovery codes |
| `vehiclecategories` | fleet | base/per-km/per-hour rates, seating |
| `vehicles` | fleet | plate UNIQUE, status CHECK, service intervals, expiry dates |
| `drivers` | drivers | license fields, status CHECK, GPS last-known, face image, personal details (021) |
| `routes` | operations | canonical directional location FKs, active-pair uniqueness, estimate provenance, lifecycle/status checks (076–079) |
| `dispatchschedules` | operations | `dispatch_number` UNIQUE, status CHECK, `request_id` FK, `cancel_reason` (036) |
| `trips` | operations | 16-state CHECK, cost+performance cols (007) |
| `gpstracking` | tracking | BIGSERIAL time-series GPS (no `driver_id`, 024) |
| `vehiclemaintenance` | maintenance | inspection merged (005), inspection cols dropped (018b) |
| `vehicledocuments` | fleet | restored real table (007) |
| `fuelrecords` | fuel | review workflow (026) |
| `driverattendance` | attendance | face rec, UNIQUE (driver_id, date) |
| `notifications` | notifications | fed by triggers |
| `ai_recommendations`, `ai_insights` | AI | rule-engine output |
| `audit_logs` | audit | the DB trigger functions were dropped (015); writes now come from the application — `writeAudit()` (`src/lib/audit.js`) is called across route/service modules |
| `service_types`, `booking_channels`, `integration_log` | integration | |
| `locations` | reference | named places with active/retired identity metadata (076, 080) |
| `mobile_refresh_tokens` | mobile auth | hashed, revocable, family-grouped, device metadata, no RLS |
| `transportation_requests` | queue | 6-state `fleet_status` (review states removed, 037), `external_booking_id` UNIQUE, AI rec cols, `is_vip`/`is_emergency`/`derived_priority` (032) |
| `reservation_events` | timeline | append-only |
| **`driver_consents`** | ★ privacy | `driver_id`, `policy_version`, `accepted_at/via`, `ip_address`; append-only; index `(driver_id, accepted_at DESC)` |
| `driver_vehicle_assignments` | drivers | interval history + 2 partial UNIQUE active-pairing indexes |
| `driverincidents` | ★ incidents | driver-reported incidents (030), coordinates (035), photos (065), triage/grounding/maintenance state (081–086) |
| `uvvrp_exemptions`, `uvvrp_violations` | ★ Number Coding | vehicle exemptions + violation history (031) |
| `recommendation_snapshots` | ★ AI | immutable fleet-pair advice per request; TTL + UNIQUE active-per-request (033) |
| `vehicleinspection` | ★ fleet | restored driver-facing inspection table for `/api/driver/vehicle-inspection` (034) |
| `notification_preferences` | ★ notifications | per-employee (event × channel) toggles; absent rows = server defaults (037) |
| `aiproviders` | AI | LLM provider config (migrated to proper table in 038; used to be hot-path DDL) |
| `system_settings` | settings | created ad-hoc then declared by 043; stores `dispatch_policy`, `uvvrp_policy` |
| `schema_migrations` | tooling | migration ledger keyed by full filename + checksum |
| **`driver_work_schedules`** | ★ scheduling | weekly shift rows per driver (shift/break/rest-day CHECKs; UNIQUE driver+weekday) (049/051) |
| **`driver_leave_requests`** / **`driver_leave_balances`** | ★ leave | Pending→approve/decline workflow w/ balance deduction; approval auto-`Pending Reassignment`s overlapping dispatches (049/053–055) |
| **`substitute_vehicle_schedules`** | ★ coverage | substitute custodian per vehicle for a date window (`effective_until NULL` = open-ended; one open-ended per vehicle) (040) |
| **`fuelrequests`** | ★ fuel | driver fuel requests w/ gauge photo, snapshot columns, one-open-per-vehicle, 1:1 to the fulfilled receipt (066/068/069) |
| **`fuelallocations`** | ★ fuel | monthly liters budget per vehicle (UNIQUE vehicle+month) (066) |
| **`device_tokens`** | ★ push | Expo push tokens per install (token UNIQUE, platform, active) (058) |
| **`push_outbox`** | ★ push | pending/sent/error push queue drained by `flushOutbox()`; fed by DB trigger on dispatch INSERT (059a) |
| **`ai_report_narratives`** | ★ AI | cached LLM report narratives (24 h sticky, ≤3 forced regenerations/day, unique COALESCE range key) (043/045) |

**Views:** `driver_stats` (computed from completed trips). **Storage buckets:**
`face-captures`, `fuel-receipts`, `incident-evidence` (private), `driver-licenses`
(private), `vehicle-images` (public). Dispatch numbers are random `DSP-XXXX`
strings from `generate_dispatch_number()` (trigger `trg_dispatch_number`); the
old dispatch-number sequence is gone, although other serial-backed tables still
use PostgreSQL sequences.

### 5.3 DB-enforced integrity (highlights)
- Status CHECKs, counted from `schema.sql`: vehicle (5 — `Available`, `Reserved`,
  `In Use`, `Under Maintenance`, `Decommissioned`; `Registration Expired` is no
  longer in the constraint), driver (5 — `Available`, `On Trip`, `Off Duty`,
  `On Leave`, `Suspended`), dispatch (5 — incl. `Pending Reassignment`), trip
  (16, the full pickup-lifecycle vocabulary), transport `fleet_status`
  (**6** since 037b: `Pending → Scheduled → Assigned → In Progress → Completed`,
  plus `Cancelled`; no review states), fuel record (4), transport `priority`
  (4 — `Urgent/High/Medium/Low`), transport `derived_priority` (6),
  incident status (`Open|Resolved`). There is **no** reservation status CHECK —
  it went with the table in 047.
- Partial UNIQUE: `uq_dva_active_driver`, `uq_dva_active_vehicle` (one active pairing per driver/vehicle); client-submission idempotency indexes on `fuelrecords`, `vehicleinspection`, `driverincidents`, `fuelrequests`; one-open-fuel-request-per-vehicle.
- Partial UNIQUE: `uq_routes_active_direction` permits only one active, non-deleted route for each `(origin_location_id, destination_location_id)` pair while preserving inactive history. `routes` also enforce valid status/source values, positive estimates, and complete non-self endpoint pairs.
- Route estimates carry `estimate_source` (`TomTom`, `Manual`, `Legacy / Unknown`) and `estimate_updated_at`; `locations.is_active`/`retired_at` preserve location identity across hotel renames and physical moves.
- UNIQUE (driver_id, date) on attendance; positive service-interval / tank-capacity / efficiency guards; `idx_trips_end_time` partial index for the 90-day maintenance window.

---

## 6. API Surface (`src/app/api/` — 162 route files)

Protected handlers call `requireAuth(req, [...roles])` / `requireDriver(req)`; public protocol endpoints and service-token endpoints use explicit alternatives. Reads default to the 5 ops roles; writes are narrowed to admin/fleet_manager (+ dispatcher for dispatch/trip/integration; + driver for self-owned actions).

### Auth & account
- `auth/[...nextauth]` (GET/POST) — NextAuth Credentials.
- `auth/register` (POST) — **admin-only** employee account creation; 409 on duplicate email; no silent credential overwrite.
- `auth/profile` (PATCH), `auth/change-password` (POST) — self-service.
- `auth/login-status` (GET) — read-only lockout status; `auth/heartbeat` (GET/POST) — session expiry state and human-activity heartbeat.
- `auth/sessions` (GET/DELETE) — owner-scoped web/mobile session listing and revocation.
- `auth/mfa` (GET), `auth/mfa/setup`, `auth/mfa/confirm`, `auth/mfa/disable`, `auth/mfa/recovery-codes` — password-gated TOTP enrollment, confirmation, disablement, and recovery-code management.
- `auth/forgot-password`, `auth/reset-password`, `auth/reset-token` — rate-limited recovery/reset flows; reset tokens are administrator-issued, hashed, one-time, and expiring.

### Drivers & driver self-service
- `drivers/` (GET/POST) — list (filters; `includeUnlinked=1` surfaces driver-role employees without a `drivers` row flagged `requires_completion`); create (employee+driver, optional password, rollback on failure).
- `drivers/[id]` (GET/PUT/DELETE) — detail w/ `driver_stats` + last 20 trips + `account` block; update; soft-delete archive.
- `drivers/[id]/account` (PUT) ★ — **enable/reset driver login**: force driver role, set/reset bcrypt password, revoke all `mobile_refresh_tokens`.
- `drivers/link` (POST) ★ — finalize a driver profile for an existing driver-role employee missing a `drivers` row.
- `drivers/stats` (GET) — counts by status.
- `driver/me` (GET/PATCH) ★ — **driver's own profile**: license, performance, trips, attendance, consent status, editable fields, visible sections; PATCH only `DRIVER_SELF_EDITABLE_FIELDS` (`phone`, `face_image_url`, `license_image_url`, `license_back_image_url`). License scan columns are self-writable anytime (30-day window removed 2026-08-25); the quality gate lives in `driver/license-scan`. License number/class/expiry remain staff-only.
- `driver/license-scan` (POST) ★ — **single-call self-service renewal**: Gemini verifies the photo is a genuine LTO card (`document_is_license_card`, fail-closed), reads key fields, and on pass **persists the scan** + applies a future-dated `license_expiry` (front side), then notifies ops staff (`system_admin`/`admin`/`fleet_manager`) best-effort. Failures write nothing — an unreadable or non-card photo is never saved. Policy: `src/lib/ai/license-scan-policy.js`.
- `driver/me/consent` (POST) ★ — record policy acceptance; 409 on stale `policy_version`.
- `driver/incidents` (GET/POST) ★ — driver-reported incidents (self-scoped to own trips).
- `driver/vehicle-inspection` (GET/POST) ★ — driver vehicle inspection reporting (reads `vehicleinspection`, migration 034).
- `driver/trips` (GET) ★ — **web driver-portal** trip list; always `WHERE driver_id = auth` (unlike the unscoped `trips/`).
- `driver/balances`, `driver/leave`, `driver/incidents/upload` — driver-scoped leave balance/self-service and incident-photo upload support.

### Trips
- `trips/` (GET/POST), `trips/[id]` (GET/PUT) — shared `TRIPS_SELECT/TRIPS_JOINS` (`src/lib/api/trips-query.js`).
- `trips/[id]/status` (PUT) — state-machine transition (`canTransitionTrip`); `transition.service.js` centralizes trip/dispatch status writes with derived-resource reconciliation + audit.
- `trips/[id]/start` (PUT) — **pre-trip inspection gate**: requires the latest per-trip `vehicleinspection` for this driver+vehicle to be `Passed`, else 400 (migration 048); also runs the work-schedule/leave window guard.
- `trips/[id]/complete` (PUT) — odometer validation + cascade sync.
- `trips/[id]/locations` (GET/POST) — GPS breadcrumbs (trip-isolated route history).
- `trips/active` (GET) — active fleet; **driver sees only own trips**.
- `trips/latest-locations` (GET) — latest status-aware GPS telemetry per active vehicle/trip (`src/lib/gps.js`); filters by active states (`In Progress`, `Dispatched`, `Assigned`), marks staleness with a 3-minute disconnect threshold (`GPS_STALE_THRESHOLD_MS`), and isolates breadcrumbs to active trips.
- `trips/[id]/accept|at-pickup|cancel|complete|dropoff|enroute|onboard|start` — explicit lifecycle action endpoints; the centralized transition service remains the status-write authority.

### Vehicles, maintenance, fuel
- `vehicles/` (GET/POST), `vehicles/[id]` (GET/PUT/DELETE, archive admin-only), `vehicles/available`, `vehicles/[id]/documents`, `vehicles/[id]/image`, `vehicle-documents/[id]`, `vehicle-categories`, `vehicle-categories/[id]`.
- `vehicle-maintenance/` (GET/POST), `vehicle-maintenance/[id]` (PUT) — drivers can file reports **without** moving the service schedule (ops roles only); maintenance rows created from incidents carry `source_incident_id` (063).
- **Fuel requests & allocations** ★ — `fuel/requests` (GET staff+driver-scoped; POST = driver-only: requires an owned gauge photo + idempotent `client_submission_id`, derives vehicle from trip/assignment, computes `calculateFuelRecommendation` vs tank/efficiency/monthly allocation, then **auto-authorizes within policy** or files `Pending`; PUT = staff approval with override reasons, bounded by tank space and current month). `fuel/allocations` (GET/PUT, staff) — monthly liters per vehicle with consumed/committed CTEs. Fulfillment: `POST /api/mobile/fuel` creates the receipt against an **Approved** request and flips it to `Fulfilled`. Gauge scanning: `POST /api/mobile/fuel/gauge-scan` → Gemini (`lib/fuel/gemini-gauge.js`, fail-closed); uploads via `POST /api/mobile/fuel/upload` (`kind=receipt|gauge`). Policy helpers: `src/lib/fuel/request-policy.js`.
- `fuel/[id]` (GET/PUT/DELETE) — record review workflow (reason required; Completed locked), `fuel/analytics` (Approved only).
- `admin/analytics/fuel` and `admin/analytics/fuel/resolve` — staff fuel analytics and anomaly resolution.

### Reservations & integration (Booking)
There is **no `reservations/` route tree.** It was deleted with migration 036
(§5.1): the legacy endpoints that used to answer 410, plus `conflicts`,
`service-types` and `booking-channels`, are all gone. `transportation_requests`
is the only reservation concept, and `integration/` is its only door.

- `integration/transport-requests` (GET/POST — POST = inbound ingest), `[id]` (GET), `[id]/review|approve|assign|reschedule|cancel|reject` (PUT), `[id]/timeline` (GET), `[id]/recommendation` (GET/POST), `[id]/flags` (PATCH).
  > `review|approve|reject` are thin aliases over the linear lifecycle now: approve walks `Pending→Scheduled`; there is no `Under Review`/`Rejected` status anymore (037b).
- `[id]/flags` (PATCH) ★ — set `is_vip` / `is_emergency`; recomputes `derived_priority` immediately + writes timeline/audit (system_admin, admin, fleet_manager).
- `[id]/recommendation` (GET/POST) ★ — active recommendation snapshot (regenerate/narrate); POST persists a snapshot + back-writes legacy AI columns.
- `integration/inbound`, `outbound`, `pull`, `logs`.

### Dispatch & assignments
- `dispatch/` (GET/POST), `dispatch/[id]` (GET/PUT), `dispatch/[id]/status` (PUT), `dispatch/calendar` (GET), `dispatch/by-status` (GET). Dispatch numbers are random `DSP-XXXX` assigned by the DB trigger (`trg_dispatch_number`), with a JS fallback in the autocreate service.
- `dispatch/availability-pairs` (GET) ★ — pair-first read surface for
  `/dispatch/availability`: hard eligibility per vehicle (capacity, operational
  status, travel docs/coding, custodial pairing via the shared
  `resolveVehiclePairing` rule) plus every overlapping dispatch as `clashes[]`
  data. Classification is board-side (today overview vs exact-window check);
  no new eligibility, read-only.
- `driver-assignments/` (GET/POST), `driver-assignments/[id]` (DELETE) — transactional pairings.
- `substitute-driver-schedules/` (GET; POST; `[id]` PATCH/DELETE) ★ — substitute custodian coverage per vehicle/date window; overlap-guarded 409s, audited.

### Work schedules & leave ★
- `driver-work-schedules/` (GET — driver self-scoped; PUT — system_admin/fleet_manager only, admin deliberately read-only) — replaces the whole week.
- `driver-leave-requests/` (GET staff feed), `[id]` (PATCH approve/decline — system_admin/fleet_manager); driver self-service via `driver/leave` (GET/POST/DELETE, withdraw own Pending only). Approval deducts `driver_leave_balances`, notifies fleet_manager/admin, and flips overlapping dispatches to `Pending Reassignment`.

### Push notifications & device tokens ★
- `device-tokens/` (POST upsert / DELETE deactivate — any role incl. driver) — registers this install's Expo push token against the session employee.
- Server side: `push.service.js` tiers every notification (`deliveryFor`: Alert/Emergency + Critical/Major/incident → loud push; Warning/Moderate → heads-up; else silent in-app only), sends via Expo Push to active tokens, deactivates `DeviceNotRegistered` tokens, and drains `push_outbox` (`flushOutbox()` after dispatch create + autocreate sync).

### Reports, AI, notifications, system, mobile
- `reports/{maintenance,fuel-consumption,fleet-utilization,financial,driver-performance,fleet-cost}` (GET) + `reports/{analytics,driver-performance,financial,fleet-cost,fleet-utilization,fuel-consumption,incidents,maintenance,trip-performance}/excel` (GET) ★ — multi-tab native Excel workbooks with embedded OpenXML charts (bar, line, doughnut) powered by `src/lib/reports/{native-charts,operational-reports,fuel-workbook,remaining-workbooks}.js` and `exceljs`.
- `documents/expiring` (GET) ★ — Document Expiration Center: aggregates `vehicles.*_expiry` + `vehicledocuments.expiry_date` + `drivers.license_expiry` with days-left/expired flags (admin, system_admin, fleet_manager).
- `ai/recommendations`, `ai/predictive-maintenance`, `ai/insights[/[id]/dismiss]`, `ai/driver-insights`, `ai/providers[/[id]]`, `ai/providers/fetch-models`, `ai/scan-document`, `ai/logs`, `ai/instructions`.
- `ai/report-narrative` (POST) ★ — LLM report narration over a client-computed payload: 24 h sticky cache, ≤3 forced regenerations per tab/day, deterministic rules fallback (`lib/ai/report-narrative.js`, `ai_report_narratives` table).
- `notifications/` (GET/POST) — **self-scoped** GET (ops roles may pass `?employee_id=`); POST admin-directed. `notifications/[id]/read`, `notifications/read-all` (self-scoped), `notifications/[id]` (DELETE, self- or ops-scoped), `notifications/preferences` (GET/PUT) ★ — per-user event × channel toggle matrix (migration 037).
- `search` (GET) ★ — global command-palette search across reservations, dispatches, drivers, vehicles (min 2 chars, LIMIT 5 per entity; any role).
- `tomtom/route` (GET) ★ — server-keyed routing proxy (`origin`/`destination` as `lng,lat`): decoded polyline, turn-by-turn instructions, distanceKm, travelTimeMin; all roles incl. driver.
- `audit/` (GET) ★ — system audit log (system_admin only).
- `system/activity` (GET) ★ — system console activity feed.
- `routes/`, `routes/[id]`, `routes/seed-naia`, `locations/`, `settings/hotel`, `settings/users`, `settings/connectors`, `manifest`, `status/sync`, `cron/sync`, `cron/reconcile` (service-token protected). The Routes registry stores canonical directional location pairs: reads include management/dispatcher, writes are limited to system_admin/admin/fleet_manager, endpoint edits lock after dispatch/trip use, and unused routes may be archived while historical routes are deactivated. `locations` hides retired identities by default; hotel rename preserves its location ID while a physical move versions and retires the old identity.
- The active NAIA registry currently contains six canonical curbside endpoints: Terminal 1 arrivals/departures, Terminal 2 arrivals/departures, and Terminal 3 Bay 9 arrivals/departures. Terminal 4 is not an active endpoint; its legacy row/routes remain only as inactive history. Canonical endpoint coordinates are maintained in `src/lib/naia-locations.js` and seeded without fabricated distance/time estimates.
- `incidents/` (GET) + `incidents/[id]` (PATCH) ★ — **staff incident registry**: all driver-reported incidents (severity/status/coords filters, join plate + driver), resolve with `actions_taken`. Acknowledge, resolve, grounding, and maintenance actions have dedicated guarded endpoints; creation is driver-side. Vehicle-related reports automatically create one linked maintenance work order; `incidents/[id]/maintenance` (POST) is an idempotent recovery endpoint for a failed automatic attempt.
- `settings/dispatch` (GET/PUT) ★ — smart-queue policy (`criticalMinutes`/`highMinutes`/`mediumMinutes`, `enableVipFlag`/`enableEmergencyFlag`); audit-writes `dispatch_policy` (system_admin/admin; fleet_manager read).
- `settings/uvvrp` (GET/PUT) ★ — configurable Number Coding (UVVRP) policy (`system_settings.uvvrp_policy`; enable, location preset, per-weekday ending digits, block|warn|approve response, exemption categories).
- `uvvrp` (GET) ★ — read-only board (restricted today, exemptions, upcoming restrictions, violation history, dispatches affected).
- `uvvrp/exemptions` (GET/POST), `uvvrp/exemptions/[id]` (PUT) ★ — per-vehicle coding exemptions (category, approver, optional expiry).
- `uvvrp/violations` (GET), `uvvrp/violations/[id]/decide` (POST) ★ — coding violation history + approve/deny pending approvals (defer-then-retry: an approved violation exempts that vehicle+date).
- `mobile/auth/login|refresh|logout`, `mobile/driver/me`, `mobile/driver/ref` (GET) ★ — driver-only trip/status reference (status buckets, `getNextStatus` chain, tones; the server owns the state machine), `mobile/driver/trips` (+ `pre_trip_status` per trip), `mobile/driver/trips/[id]/accept|gps` (trip-scoped GPS ping ingestion — only records live movement during `In Progress` trips), `mobile/driver/inspections` (POST — per-trip pre-trip inspection, notifies staff on fail), `mobile/driver/submissions` (GET — activity-log/dead-letter feed), `mobile/driver/gps` and `mobile/driver/trips/[id]/gps` (driver GPS ingestion), `mobile/fuel/scan|upload|gauge-scan|[id]`, `mobile/fuel` (POST receipt → fulfills the Approved request).

### Client service layer (`src/services/`)
Thin `apiFetch` wrappers per domain plus server-only business-logic services. Current modules: `ai.service, audit.service, auth.service, dispatch.service, dispatch-autocreate.service, dispatch-settings.service, driver.service, driver-assignment.service, driver-schedule.service, fuel.service, integration.service, location.service, maintenance.service, maintenance-schedule.service, notification.service, outbound.service, priority.service, push.service, recommendation.service, report.service, reservation-events.service, reservation-lifecycle.service, route.service, route-resolver.service, search.service, settings.service, status.service, substitute-driver.service, system.service, transition.service, transport.service, trip-lifecycle.service, trip.service, uvvrp.service, vehicle.service`. Notable server-only ones: `reservation-lifecycle`, `trip-lifecycle`, `transition` (centralized trip/dispatch status writes), `status`, `outbound`, `push`, `uvvrp`, `dispatch-autocreate`, `route-resolver`.

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
- **Enforcement layers:** per-route `requireAuth(req, [...])` on the server (the real boundary); `useRequireRole()` / `RouteGuard` + `useRoleAccess()` on the client (convenience). `/` redirects server-side (no flash). For deep protected routes the client guard distinguishes no-session (`!employee` → `saveReturnTo()` + `/login`, shell withheld until a session exists so no dashboard chrome flashes) from session-without-role (renders the role-not-configured card, never `/login`, to avoid a login loop); wrong-role sessions fall back to the role home with an access-restricted panel.
- **Routes permissions:** dispatcher and management are read-only; create/update is limited to `system_admin`, `admin`, and `fleet_manager`; route DELETE/archive is limited to `system_admin` and `admin`. `scripts/verify-rbac.mjs` covers the UI/API agreement.
- `scripts/verify-rbac.mjs` asserts the UI matrix and API role lists agree.
- Role **assignment** is itself guarded: only `system_admin` can grant `system_admin` (`canAssignRole`; asserted in `src/security-boundaries.test.js`).
- `src/lib/constants.js` — `ROLES`, `ROLE_IDS` = `{ system_admin: 1, fleet_manager: 2, dispatcher: 3, driver: 4, management: 7, admin: 9 }`, `REGISTRATION_ROLES` (6, incl. "FleetOps Admin").

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
`actions_taken`; vehicle-related maintenance is automatic). Automation on a
driver POST (`src/lib/driver/grounding.js` + `src/lib/incidents/maintenance.js`):
1. Acknowledges the reporter (Info notification).
2. If `shouldGroundVehicle` → sets the vehicle **Under Maintenance**, alerts
   dispatcher/staff, and if the vehicle has an active dispatch inside a 48 h
   (Major/Critical) or 2 h window, cancels its trips, unassigns the pair, resets
   the dispatch to **Pending Reassignment**, and sends URGENT interruption alerts.
3. If `requiresVehicleMaintenance` → creates one linked `Emergency Repair`
   for breakdown/mechanical/vehicle-damage reports, or `Vehicle Inspection` for
   qualifying accidents; alerts fleet/maintenance staff. Passenger, route,
   traffic-delay, medical, and other non-vehicle reports do not create a work
   order.
4. Otherwise notifies overseers of the report.

Incident resolution and maintenance completion are separate state changes:
resolving a maintenance-required incident never releases its vehicle. The
maintenance PUT state machine calls `syncVehicleStatus` after `Completed`; only
then can the vehicle become `Available` (subject to other active work/trip and
registration checks).

`shouldGroundVehicle` (`src/lib/driver/grounding.js`) grounds when the severity is
Major/Critical **or** the incident type matches the breakdown regex (breakdown,
mechanical, engine, flat tire, battery, electrical, overheat), and never when
there is no `vehicleId`. It was previously a stub that grounded on any incident
with a vehicle attached; the rule is now real and unit-tested
(`src/lib/driver/grounding.test.js`).

### Web sessions (NextAuth)
- Credentials provider; bcrypt vs `employees.password_hash`; **IP/account rate limit 5/min**; JWT transport (`NEXTAUTH_SECRET`) identifies a server-backed `web_sessions` record. Role/employeeId/name remain in the token for UI landing, while every API request revalidates the live employee and session row.
- Sessions expire after 12 hours absolutely or 1 hour idle (`idle_timeout_seconds`); `GET/POST /api/auth/heartbeat` updates the idle deadline only for verified activity. The session manager warns five minutes before either deadline, synchronizes tabs through `BroadcastChannel`, and preserves only validated internal return-to routes through re-authentication.
- Registration is **admin-only**; public signup redirects to login. TOTP MFA is checked before a web session is created, and enabling/disabling MFA revokes existing sessions.

### Mobile tokens (separate system)
- Access = 15-min HS256 JWT (aud `fleetops-mobile-access`), refresh = 30-day JWT (aud `fleetops-mobile-refresh`), signed with production-only `MOBILE_JWT_SECRET` (development can fall back to `NEXTAUTH_SECRET` with a warning). Refresh tokens are stored SHA-256 hashed in `mobile_refresh_tokens`; **single-use rotation**, family grouping, and device metadata are enforced; role/driver re-read from DB every refresh; `logout?allDevices` revokes all.

---

## 8. Mobile App (`mobile/`)

Driver-only Expo app (guest experience not implemented). Tab bar: **Home · Live
Map · scan FAB · Trips · Profile** over a guard stack; no native map SDK (TomTom
static images). Push is **wired**: foreground handler + local scheduling +
Expo token registration at sign-in/out (terminated-app remote fan-out is honest,
documented future work — see below).

### Route tree
```
app/_layout.js            fonts (Plus Jakarta Sans / IBM Plex Mono) + AuthProvider +
                          ThemeProvider + SettingsProvider + initPush() + ErrorBoundary
app/login.js              interactive sign-in (email/password, show/hide toggle)
app/permissions.js        OS-permission status board (location/camera/media/notifications)
app/consent.js            privacy-policy consent gate (public)
app/(app)/_layout.js      guard: isDriverSession + accepted consent version else → /login or /consent
app/(app)/(tabs)/         bottom tab bar:
  index.js                Home — active vs pending trips, accept/decline, single “advance” button,
                          odometer modal, GPS toggle, tools; SOS button mounted beside the Tabs
  map.js                  Live Map — full-screen trip map + bottom-sheet nav card; START ROUTE time-gate
  fuel_action.js          dummy anchor for the center scan FAB → /fuel-report?scan=1
  trips.js                Trips list (active/history buckets)
  profile.js              ★ driver profile hub — menu into profile/* subpages, settings, Sign out
    …history.js           hidden from bar (header access): completed/cancelled trips
    …notifications.js     hidden from bar: alerts inbox w/ tiered banners (push/heads-up/silent)
    …vehicle.js           hidden from bar: assigned-vehicle detail
app/(app)/fuel-report.js  fuel hub: live-camera gauge/receipt scan (CameraView), library pick, manual
                          entry, fuel-request creation, past requests
app/(app)/incidents.js    report incident (typed categories, assistance chips, camera photos, GPS)
app/(app)/inspection.js   pre-shift 7-point pass/fail checklist tied to a trip (POSTs trip_id)
app/(app)/work-schedule.js weekly schedule editor + leave requests (Vacation/Personal/Medical)
app/(app)/submissions.js  activity logs: fuel/inspection/incident submissions + offline dead-letter retry
app/(app)/settings.js     push/tracking/high-contrast/text-size/theme toggles, permission management
app/(app)/trip/[id].js    trip detail + accept + START ROUTE gate (30 s refresh)
app/(app)/trip/complete.js animated completion summary (Lottie) w/ note & issue modals
app/(app)/profile/*.js    personal (phone edit), license (capture→scan), vehicle, safety, help
```

### lib/
- `api.js` — `BASE_URL = EXPO_PUBLIC_API_URL`; Bearer attach; single-flight refresh on 401; 15 s timeout + one retry; offline-enqueue hooks. **No demo/mock layer** (fully removed).
- `auth.js` — AuthContext (login/signOut/session restore); registers/unregisters the Expo device token at `/api/device-tokens` on auth events.
- `sync.js` — AsyncStorage offline queue replayed on foreground; incident dead-letter store surfaced in Submissions.
- `tracking.js` — `useTripTracking`: foreground GPS every 30 s to `/api/mobile/driver/trips/{id}/gps`; `background-tracking.js` TaskManager task exists but needs a dev build (not yet installed).
- `tripRef.js` — cached `GET /api/mobile/driver/ref`: status buckets, `getNextStatus()`, tones (server owns the machine).
- `notifications/` — `tiers.js` (+test) classifier, `notify.js` emitter, `presentation.js` labels, `navigation.js` deep-link table, `push.js` expo-notifications wrapper (channels `default`/`heads-up`, token minting), `device-token.js` registration.
- `settings-context.js` (persisted prefs), `theme.js`+`theme-context.js` (FleetOps Tactical tokens, light/dark MD3), `scaling.js`, `receipt-crop.js`, `permissions.js` registry, `launch.js`, `consent.js`, `storage.js`, `rbac.js`.
- `components/` — `ui.js` (MD3 primitives), `TomTomMap` (static images, pan/zoom, live overlay, Google Maps deep link), `NotificationHost` (banners/toasts/push taps), `DriverSos`, `plate.js`, `logo.js`, `error-boundary.js`.

### Backend integration / auth
- Talks to the Next API over plain JSON fetch; `EXPO_PUBLIC_API_URL` → LAN IP of the dev server. Referer-free, cookie-less: auth is `Authorization: Bearer` (the same `mobile_refresh_tokens` flow as §7).
- The web API's CORS is now **fail-closed same-origin** (`src/proxy.js`) — irrelevant to the native app (no browser origin checks) but it means the Expo *web* target can no longer call the API cross-origin unless served from `NEXT_PUBLIC_APP_URL`.

### Security rule
Only `EXPO_PUBLIC_*` config is allowed; the **server derives driver/vehicle/role from the token** — the mobile app never sends its own `driver_id`/`vehicle_id`/role. (`EXPO_PUBLIC_ENABLE_DEMO` has zero code references — demo mode fully removed.)

---

## 9. ★ Current Update: Smart Queue & Dispatch, Incidents, Notification Direction, Mobile Tabs

The current feature wave (post-driver-consent) makes dispatch **priority-driven and
pair-scored**, adds **incident management** end-to-end, points **notifications at the
right surface**, and turns the mobile app into a **5-tab driver workspace**.

### 9.1 Smart Transportation Queue (priority engine)
- Explicit inputs `transportation_requests.is_vip` / `is_emergency` (set at intake
  or via `PATCH .../[id]/flags`, migration 032) feed a **deterministic priority
  engine** (`src/lib/scheduling/priority.js`). It writes a cached `derived_priority`
  (`Overdue → Critical → High → Medium → Normal → Future`) that the queue groups and
  orders on (`queue-grouping.js`); never human-set (CHECK in migration 032).
  Thresholds live in `system_settings.dispatch_policy` (`src/lib/dispatch-policy.js`),
  configurable at `/settings/dispatch` (system_admin/admin).

### 9.2 AI fleet-pair snapshots
- `src/lib/ai/pair-scoring.js` + `dispatch-advisor.js` recommend a **vehicle+driver
  pair** (designated-driver match dominates; a provably-unavailable custodian is the
  only legit substitute). Recommendations persist as immutable snapshots
  (`recommendation_snapshots`, migration 033) with a 60-min TTL, an `is_consumed`
  flag (flipped on assign), and a hard **designated-driver rule** at assign
  (`recommendation.service.js`). The saved-recommendation card surfaces stale
  snapshots as expired with regeneration.

### 9.3 Incidents (driver → staff → maintenance)
- Drivers report incidents with severity + GPS (web portal `/driver/incidents`,
  mobile `/incidents`; mobile SOS reverse-geocodes the fix into a place name
  via `expo-location`, falling back to `"lat,lng"` text — never a maps URL).
  Staff see a **read-only registry** (`/incidents`) with an
  active-incident TomTom map (permanent type · severity + driver labels on
  every marker — no hover needed), filters, and only two write controls:
  **Resolve** (`PATCH /api/incidents/[id]` → `Resolved` + `actions_taken`)
  and **Send to Maintenance** (creates an Emergency Repair record). A driver
  POST runs the grounding automation in `src/lib/driver/grounding.js` —
  acknowledge, then ground the vehicle + interrupt active dispatches, or just
  notify overseers (§7.3). The web live map no longer plots open incidents
  (removed 2026-09-03 — this registry's own map owns that view).

### 9.4 Notification direction & preferences
- Rows carry `reference_type` / `reference_id` / `severity` / `link`; all surfaces
  (web feed, driver inbox, admin pages) render shared category/severity chips
  (`src/lib/notifications/presentation.js`). Tap targets resolve **per-role**
  (`src/lib/notifications/target.js`) — staff or driver routes, guarded by
  `getRequiredRolesForPath` so a tap never loops through a redirect.
- Per-user toggles persist in `notification_preferences` (migration 037) and drive
  the `/notifications/preferences` grid (event × channel, in-app non-disableable);
  email/push channels are accepted but delivery ships later.

### 9.5 Mobile tabs + TomTom map
- The mobile app is now `(app)/(tabs)/`: Home · Live Map · scan FAB · Trips ·
  Profile (§8). Sign-out moved to Profile; login is interactive (demo mode removed).
  The map is TomTom **static images** (no RN/Leaflet native module) so it runs in
  Expo Go and on the web target; routing on web/server uses the `/api/tomtom/route`
  proxy.

### 9.6 Routes integrity refactor
- The Routes registry is a canonical operational registry, not a free-text cache.
  `route-resolver.service.js` normalizes request endpoints, resolves active
  location identities, reuses a directional active route, and leaves unknown
  destinations ad-hoc. Booking ingestion, dispatch auto-create, rescheduling,
  and AI recommendations share this resolver.
- The database enforces one active route per directional location pair while
  retaining inactive history. Route estimates expose `TomTom`, `Manual`, or
  `Legacy / Unknown` provenance; manual estimates require an explicit TomTom
  recalculation to change. New or endpoint-changed routes with valid coordinates
  automatically request a TomTom baseline; unavailable values remain blank.
  Stored duration is labelled estimated travel time, not live ETA. Endpoint
  edits lock after dispatch/trip use.
- `/routes` shows Active, Navigation Ready, Needs Setup, and Used Last 30 Days
  operational KPIs. Dispatcher and management are read-only; route writes are
  restricted at both the UI and API boundary. Hotel rename preserves its location
  identity; physical relocation versions the location and retires old routes.

### 9.7 Prior wave (still in effect): driver consent + portal
The consent/portal work (merged from `5794427`) remains live and is condensed here.
Versioned privacy policy (`CURRENT_PRIVACY_POLICY_VERSION = 1` in
`src/lib/consent/policies.js`) gates both web (`/driver`) and mobile (`(app)/_layout.js`)
personal-data screens; acceptance is append-only in `driver_consents` (migration 019,
IP + via captured, no UPDATE/DELETE) via `POST /api/driver/me/consent` (409 on stale
version). The driver self-service portal spans `/driver` + subpages
(profile/license-scan, trips, incidents, vehicle, fuel) — `GET/PATCH /api/driver/me`
(whitelisted fields; license scans self-serve anytime since 2026-08-25),
`POST /api/driver/license-scan` (Gemini verify + persist + expiry auto-apply + staff notification), `GET /api/driver/trips`,
`GET /api/driver/vehicle-inspection` (table restored by migration 034), and admin
controls `PUT /api/drivers/[id]/account` + `POST /api/drivers/link`.

---

## 10. Known Notes / Gotchas

- **RLS is inert** — do not rely on it; the API `requireAuth` is the security boundary. `has_role()` in SQL references a dropped function (`get_current_employee_role`) and would error if ever executed — confirming it never runs.
- **Migration tooling:** the `supabase` CLI is broken in this repo; use the runner — `npm run db:status` / `db:up` / `db:dump` (`scripts/migrate.mjs`, direct `pg` + `DATABASE_URL`, ledger-keyed by filename).
- **CORS is a fail-closed lockdown, not `*`.** `src/proxy.js` (Next 16 middleware) 403s any cross-origin browser caller except `NEXT_PUBLIC_APP_URL`; preflight is answered only for that origin. No auth in the proxy — real protection stays per-route `requireAuth`/`requireDriver`. Mobile auth uses `Authorization: Bearer`.
- **Notification scoping is now self-scoped:** `GET /api/notifications`, `[id]/read`,
  and `read-all` all restrict to the caller (ops roles may pass `?employee_id=` on the
  GET); `notifications/[id]` DELETE allows staff to delete any row, others only their own.
- **`shouldGroundVehicle` is real and unit-tested** (see §7.3): grounds on Major/Critical
  severity or the breakdown regex, never without a `vehicleId`
  (`src/lib/driver/grounding.test.js`). Older notes calling it a stub are obsolete.
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
- **`vehiclereservations` is gone** (migration `047_drop_vehiclereservations.sql`) along with both `reservation_id`
  columns, two trigger functions, and the `/api/reservations/*` route tree. Any
  older note describing a "two tables for one concept" split, or reservation
  endpoints returning 410, is describing a state that no longer exists.
- **Mobile demo-driver mode was removed** — login is interactive only; `EXPO_PUBLIC_ENABLE_DEMO` has zero code references.
- Route protection is via root `layout.js` → `DashboardLayout` → `RouteGuard` (client) + per-route API checks.
- A driver hitting `/dashboard` directly would render it (UI-only exposure; data APIs still enforce roles).
- Mobile status-advance uses the **web** route `PUT /api/trips/{id}/status` (not `/mobile/` prefix).
- Scope status (2026-09-02): **push notifications are shipped in-app + local/foreground** (Expo tokens registered at sign-in; server tiers via `push.service.js`; terminated-app remote fan-out documented future work). Offline queueing exists for incident reports (dead-letter surfaced in Submissions). Background location task exists but needs a dev build. Still not implemented: guest mode.
- `070_driver_licenses_bucket.sql` is present and tracked. It owns the private `driver-licenses` bucket; keep its filename and checksum stable because the migration ledger keys entries by full filename.

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
  `GET/PUT /api/settings/users` (disable = soft-delete;
  that is what blocks sign-in; status='Inactive' is the readable flag).
- Availability is pair-first (2026-09-04): `/dispatch/availability` shows
  vehicle + driver pairs for a window, not separate Drivers/Vehicles status
  lists (removed — they re-proved misleading). Do not reintroduce standalone
  status lists as dispatch truth.
- Mobile: SwipeButton exposes accessibility actions; offline-queued incident
  reports say "saved offline", never claim dispatch receipt.

---

## 12. ★ Current wave (2026-08-15 → 2026-09-04) — schedules, leave, fuel requests, push, auth, map UX, availability, fuel console

The newest feature set after §9/§11. Everything here is shipped and enforced in code; the auth/session items were added 2026-09-02.

### 12.1 Driver work schedules + leave (migrations 049–055)
Weekly per-driver shift rows (`driver_work_schedules`, UNIQUE driver+weekday,
rest days stored 00:00–00:00) and a leave workflow (`driver_leave_requests` →
approve/decline by system_admin/fleet_manager; balances in
`driver_leave_balances`). `lib/scheduling/driver-schedule.js::driverBlockReason`
blocks dispatch when approved leave covers pickup, the weekday has no schedule,
it is a rest day, the window doesn't fit the shift, or a break overlaps;
pending leave warns. Leave approval auto-flips overlapping dispatches to
`Pending Reassignment`. Routes: `driver-work-schedules`, `driver-leave-requests[/id]`,
`driver-leave-balances`, driver self-service `driver/leave`; mobile screens
`work-schedule.js`. DB triggers notify fleet_manager/admin on request/review
(054 added dispatchers; 055 reverted that).

### 12.2 Substitute drivers (migration 040)
When a vehicle's designated custodian can't drive it (e.g. suspended), the
vehicle stays out of recommendations/dispatch unless
`substitute_vehicle_schedules` covers the date (`effective_until NULL` =
open-ended; one open-ended row per vehicle). Consumers resolve "effective driver
for a date": `recommendation.service.js`, `pair-scoring.js`, `conflicts.js`,
`uvvrp.service.js`. Routes `substitute-driver-schedules[/id]`; UI cards on fleet/
dispatch pages.

### 12.3 Fuel requests + monthly allocations + gauge AI (migrations 066–069)
Drivers file a **fuel request** with a gauge photo (Gemini scan via
`lib/fuel/gemini-gauge.js`, fail-closed) instead of directly writing receipts.
The server computes recommendation from `vehicles.tank_capacity_l` /
`fuel_efficiency_kmpl`, last report variance, and remaining monthly budget
(`fuelallocations`, UNIQUE vehicle+month), then **auto-authorizes within policy**
or files Pending for staff review. Fulfillment: the receipt (`POST /api/mobile/fuel`)
must reference an Approved request and flips it to `Fulfilled`
(`fuelrecords.fuel_request_id` 1:1). Policy helpers: `src/lib/fuel/request-policy.js`.

### 12.4 Push notifications (migrations 058/059a)
`device_tokens` stores Expo push tokens per install (registered at sign-in/out).
Every dispatch INSERT enqueues a driver push via DB trigger into `push_outbox`;
`push.service.js` tiers notifications (loud / heads-up / silent), sends via Expo
Push in batches, deactivates dead tokens, and drains the outbox after dispatch
create/autocreate sync. Mobile renders tiered banners (`notifications/tiers.js`)
— honest scope: local/foreground scheduling only; terminated-app remote fan-out
is documented future work.

### 12.5 AI report narratives (migrations 043/045)
`POST /api/ai/report-narrative` narrates an already-computed report payload:
24 h sticky cache per report+range, ≤3 forced regenerations/day, deterministic
fallback grounded in the same numbers. Engine: `lib/ai/report-narrative.js`;
UI card on analytics/reports pages.

### 12.6 Per-trip pre-trip inspection gate (migration 048)
Inspections are tied to trips (`vehicleinspection.trip_id`). `PUT /api/trips/[id]/start`
requires a `Passed` inspection for this trip's driver+vehicle before starting;
mobile posts inspections via `/api/mobile/driver/inspections` and reads
`pre_trip_status` from the trips feed.

### 12.7 Idempotent client submissions (059b/060a/062)
Fuel records, inspections, incidents, and fuel requests all carry
`client_submission_id` UNIQUE partial indexes so mobile retries/offline replays
never duplicate rows.

### 12.8 Hardening & hygiene
CORS lockdown via `src/proxy.js` (§4.6); anon access to `employees` revoked
(060b); seeded admin hash invalidated if ever still present (061);
`source_incident_id` links maintenance to incidents (063);
`drivers.suspension_reason` (064); incident photos + evidence bucket (065);
random `DSP-XXXX` dispatch numbers (044); seven pagination indexes (052);
incident triage/grounding/maintenance integrity (081–086); auth-version
invalidation and shared auth rate limits (087); server-backed web sessions and
TOTP MFA (088); configurable web-session idle timeout (089).

### 12.9 Auth lifecycle and session UX (migrations 087–089)
Web authentication now records a server-backed session with a 12-hour absolute
lifetime and 1-hour idle timeout. Live identity resolution checks session expiry,
revocation, employee status, role, and `auth_version` before authorizing each API
request. Human activity and the Stay signed in action use `/api/auth/heartbeat`;
background polling does not extend the idle deadline. The browser session manager
warns before idle or absolute expiry, coordinates failures/extensions/logout across
tabs, and returns users only to validated internal routes after re-authentication.
TOTP enrollment and login MFA use encrypted per-employee secrets, a v9-compatible
`otpauth` implementation, hashed single-use recovery codes, replay protection, and
separate IP/account throttles. Production deployments must set both
`MOBILE_JWT_SECRET` and `MFA_ENCRYPTION_KEY` as distinct server-side secrets.

The `/settings/security` UI uses a compact two-column password/MFA layout with a
full-width session manager recreated with pixel-level parity to the reference design.
It renders live password validation with a segmented strength meter, a 2-column requirements checklist,
all real MFA states, recovery codes, and owner-scoped session rows through the existing auth
endpoints; the redesign did not change authentication, revocation, or
authorization behavior. The vendor-neutral RFC 6238 helper is paired with local
brand marks for Google Authenticator, Microsoft Authenticator, Authy, and 1Password;
session rows render official browser marks (e.g. Google Chrome) and accurate metadata.
Responsive composition and dark mode inherit the shared FleetOps semantic tokens.
The enrollment QR is rendered through the Next image boundary without changing
the data URI flow, and session rows expose only implemented actions.


### 12.10 Live map & SOS UX polish (2026-09-03)
`src/components/maps/live-locations-map.jsx` (used by `/tracking/live-map`, role
dashboards, and `/trips/[id]`):
- **Always auto-fit** — the viewport re-fits to all pins (or the selected trip's
  route) on every GPS poll; user pans are re-fitted on the next refresh.
- **Permanent labels** — latest-locations markers (nested `vehicles`/`drivers`
  data) show a status-color dot + plate + driver name without hovering; the
  click popup (telemetry, Street View) is unchanged. Raw GPS-history rows
  (`/trips/[id]`) have no identity and keep the hover tooltip.
- **No gray markers** — every `LIVE_TRIP_STATUSES` phase maps to a phase color
  (pre-trip blue, to-pickup amber, passenger-onboard/arrived green); the
  fallback default is blue, not gray.
- **Removed** — the open-incidents layer (the `/incidents` module's own map
  owns that view) and the floating "Live Route Navigation" panel (turn-by-turn
  instructions, distance/ETA). The route polyline, origin/destination labels,
  and sidebar trip metrics remain; the `incidents`, `instructions`,
  `routeDistanceKm`, `routeTravelMin`, and `showNavigationPanel` props are gone.

### 12.11 Pair-first availability, fuel console, dashboard wave (2026-09-04)
- **Availability is pairs, not lists.** `/dispatch/availability` dropped the
  Drivers | Vehicles tabs: default is the full day (`Showing dispatchability
  for today`), with an optional exact-window picker behind `Set exact window`.
  Today-mode classifies Clear Schedule Today / Has Trips Today (upcoming-first)
  / Blocked; exact-window mode stays strict (Ready / Blocked, overlap blocks).
  Hard blockers always outrank schedule activity; blocked cards with trips get
  a collapsed `N scheduled trips today — may be affected` warning (never
  "requires reassignment"). Backend `GET /api/dispatch/availability-pairs`
  reports hard eligibility + `clashes[]` using the shared `resolveVehiclePairing`
  rule — read-only, no new eligibility. Request prefill via query params.
  Today-mode (`mode=today`) evaluates day-scoped schedule eligibility only
  (leave / schedule-exists / rest day via `driverDayEligibility`, shift span
  shown as duty window); `driver-schedule.js` untouched, exact mode keeps load
  + containment strictness.
- **Fuel is one ops console.** `/fuel` holds registry/budget/permits/review
  (Needs-review pins atop Registry when flagged; smart Pending/All default;
  full-set CSV export); `fleet/fuel` is a redirect stub; driver web Log Fuel
  (direct-record bypass) is replaced with mobile-request guidance; driver role
  removed from `/fuel` nav.


### 12.10 Live map & SOS UX polish (2026-09-03)
`src/components/maps/live-locations-map.jsx` (used by `/tracking/live-map`, role
dashboards, and `/trips/[id]`):
- **Always auto-fit** — the viewport re-fits to all pins (or the selected trip's
  route) on every GPS poll; user pans are re-fitted on the next refresh.
- **Permanent labels** — latest-locations markers (nested `vehicles`/`drivers`
  data) show a status-color dot + plate + driver name without hovering; the
  click popup (telemetry, Street View) is unchanged. Raw GPS-history rows
  (`/trips/[id]`) have no identity and keep the hover tooltip.
- **No gray markers** — every `LIVE_TRIP_STATUSES` phase maps to a phase color
  (pre-trip blue, to-pickup amber, passenger-onboard/arrived green); the
  fallback default is blue, not gray.
- **Removed** — the open-incidents layer (the `/incidents` module's own map
  owns that view) and the floating "Live Route Navigation" panel (turn-by-turn
  instructions, distance/ETA). The route polyline, origin/destination labels,
  and sidebar trip metrics remain; the `incidents`, `instructions`,
  `routeDistanceKm`, `routeTravelMin`, and `showNavigationPanel` props are gone.
- **Dashboards answer their primary question first.** Dispatcher opens with
  Needs-attention + Next-departures (live countdowns); fleet manager has
  readiness + utilization/workload strips; admin swaps status meters for request
  pipeline + document-compliance donuts; linked StatCards navigate; executive
  gains MoM trend chips; reservation queue lands on the first non-empty work tab.
- **Merged incident responder work (origin/main):** GPS-tracked fleet responders
  on incidents (101–102, auto-advance Dispatched→En Route→Arrived), SLA-breach
  marking + pg_cron schedule (098–099), incident remediation fields (097),
  company cards + expense records/receipts (091–096); dispatcher live map plots
  active rescuers alongside GPS.

### 12.12 Operations Dashboard 2x2 Grid Modernization (2026-09-06)
- Rebuilt the central 2x2 dashboard card section on `/dashboard` (`AdminDashboard` in `src/components/dashboard/role-dashboard.jsx`) to achieve visual and functional fidelity with the reference operations console:
  - **Request pipeline (`RequestPipelineCard`):** Displays overall count, weekly volume change, and completion rate summary header; renders a 6-stage interlocking chevron process ribbon (`Pending`, `Scheduled`, `Assigned`, `In Progress`, `Completed`, `Cancelled`) with precise 2px gap geometry and status dot legend.
  - **Document compliance (`DocumentComplianceCard`):** Side-by-side view with a primary valid-documents percentage stat box, full-width multi-segment progress bar (Expired, Due ≤30d, Due 31–90d, Valid), 4 breakdown columns, and an Expiring soon unit chips row with `+N more` link.
  - **Maintenance and incident pressure (`MaintenancePressureCard`):** Clean event list displaying active work orders with colored left status strips, vehicle plates, service types, schedules, status pills, relative timestamps, and hover navigation to `/maintenance`.
  - **Incident risk (`IncidentRiskCard`):** 4 metric tiles for Open, Critical/major, Assistance, and Maintenance pending, paired with a dynamic calm-state card (soft-green shield when 0 active risks; rose alert with action link when risks exist).
- Component architecture encapsulated in `src/components/dashboard/operations-cards.jsx` with unit testing in `src/components/dashboard/operations-cards.test.js`. Verified clean with `npm run lint:ci` (0 errors, 0 warnings) and Vitest (`539/539 tests passing`).

### 12.13 Fleet Utilization Dashboard & Reports Suite Exact Mockup Recreation (2026-09-06)
- Rebuilt the Fleet Utilization dashboard and elevated the reports suite (`src/app/(dashboard)/reports/page.js`) according to the exact visual source of truth (`media_1788656277326.png`):
  - **AI Analyst Card (`AiAnalystCard` in `src/components/ai/ai-analyst-card.jsx`):** Refined header with Sparkles squircle, title (`AI Analyst - Fleet Utilization`), deep navy pill badge (`Intelligence Engine`, `#0b132b`), subtitle (`Number-grounded analysis for the selected window`), and rounded-full border button `Regenerate`. Inset panel empty state features faint landscape wavy contour gradients on left and right edges, 3-vertical-bar squircle icon badge, centered title `"No activity in this period"`, and centered narrative copy.
  - **Fleet Report Header Block & Elevated StatCards:** Standalone page typography with `FLEET REPORT` overline, bold `Fleet utilization` H2 heading, and right-aligned calendar icon with `Capacity and distance by vehicle`. 3 StatCards (`UTILIZATION` at `4%` with `Fleet capacity`, `TRIP RECORDS` at `1` with `Selected window`, `DISTANCE LOGGED` at `0 m` with `Verified km`) upgraded with gentle right-side rising bottom waves, large tabular typography, and tinted circular icon badges (`Gauge`, `FileText`, `Route`).
  - **Fleet Workload Distribution Card (`FleetReport`):** Exact title `Fleet workload distribution`, subtitle `Vehicles ranked by total distance and trip count in the selected window`, and right-side `Top 1`. Features a 3-part summary strip with vertical dividers (`HIGHEST DISTANCE` `0 m`, `MOST DISPATCHED` `ABC-1234` `1 trips`, `AVERAGE TRIP DISTANCE` `0 km` `Across trip records`), integrated horizontal axis scale ruler (`0`, `250`, `500`, `750`, `1,000 km`), navy squircle rank badge (`01`), vehicle plate with `Most dispatched`, track bar with 3 scale divider ticks (25%, 50%, 75%) and royal blue filled indicator (`24px`), column metrics (`1 trips`, `0 m total`), and wide soft-blue Relative Workload pill (`media_1788656506460.png`: `bg-[#eff5ff] max-w-[136px] h-9`, royal blue `3%` in `#2563eb`, and centered `of fleet workload` below).
  - **Verification:** Verified clean with `npm run lint:ci` (0 errors, 0 warnings) and full Vitest suite (`539/539 tests passing across 51 test suites`).

### 12.14 AI Analyst – Fleet Utilization Card Exact Mockup Recreation (2026-09-06)
- Recreated the single premium dashboard card for **AI Analyst – Fleet Utilization** based on the exact visual source of truth (`media_1788657029174.png`) in `src/components/ai/ai-analyst-card.jsx`:
  - **Header Structure:** Squircle badge with `Sparkles`, title `AI Analyst - Fleet Utilization`, dark navy pill badge `Intelligence Engine` (`#0b132b`), subtitle `Number-grounded analysis for the selected window`, and outline `Regenerate` button with rounded-full pill border.
  - **Inner Insight Panel:** Large rounded inset container (`bg-[#f8fafd] border border-slate-200/60 dark:bg-slate-900/40 p-5 sm:p-6`) with atmospheric landscape wave background along the lower half of the panel (gentle translucent gradients and faint dotted landscape contours).
  - **Top Status Pills:**
    - `● Monitoring` in warm amber style with status dot (`bg-amber-500`) and amber pill border.
    - `⚙ DETERMINISTIC` in neutral style with gear icon (`Settings`) and uppercase tracking.
  - **Main Narrative Insight Row:** Leading circular icon badge with soft light-blue tint and 3 rounded vertical bars, paired with bold prominent narrative text (`"Fleet utilization is at 4% across the period, with 1 trips covering 0 km. The busiest unit logged 1 trips."`).
  - **Divider & Recommended Actions:** Thin horizontal divider, uppercase section label `RECOMMENDED ACTIONS` with list icon, and numbered action items inside soft-blue circular markers (`1`, `2`).
  - **Footer Date Row:** Small calendar icon + `Analyzed for 2026-09-01 — 2026-09-05` in muted blue-gray text.
- **Verification:** Verified clean with `npm run lint:ci` (0 errors, 0 warnings) and full Vitest suite (`539/539 tests passing across 51 test suites`).
