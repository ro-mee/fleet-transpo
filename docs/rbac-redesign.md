# RBAC Redesign — Audit, Matrix, Dashboards, and Implementation Plan

Deliverables for the role-based access + dashboard redesign of the FleetOps system.
Companion to `docs/rbac-model.md` (the authoritative RBAC model) and `SYSTEM.md`
(system overview). This document contains the concrete audit findings and the
designs that the implementation phases follow.

Ground rules honored throughout:

- No database schema changes (RLS stays inert; enforcement is application-layer).
- No module removal, no breaking API changes, no breaking business logic.
- Next.js + React + Supabase stack preserved; existing components reused.
- `docs/rbac-model.md` section 4.1 permission matrix and `src/lib/auth/permissions.js`
  MATRIX are the source of truth for *what a role may do*.

---

> **Status (latest):** FleetOps now focuses on **fleet & transportation**. The
> three hospitality roles (`reception_staff`, `restaurant_staff`, `concierge`)
> were **removed** in migration `022_remove_front_desk_roles.sql` (role rows 5/6/8
> deleted; the 3 employees who held them disabled). Six roles remain. The
> front-desk/hospitality material in §1–§5 below is **historical** — kept as the
> original audit/design record, superseded by §8–§9. See §9 for the current end
> state.

## 1. RBAC Audit & Permission Matrix

### 1.1 Roles (current)

| Role | ID | Registerable | Home |
|---|---|---|---|
| `system_admin` | 1 | yes | `/dashboard` |
| `fleet_manager` | 2 | yes | `/dashboard` |
| `dispatcher` | 3 | yes | `/dashboard` |
| `driver` | 4 | yes | `/driver` |
| `management` | 7 | yes | `/dashboard` |
| `admin` | 9 | yes | `/dashboard` |

> Removed (migration 022): `reception_staff` (5), `restaurant_staff` (6),
> `concierge` (8).

`system_admin` short-circuits every check to **allowed** (`can()` returns true and
`requireAuth` never refuses it), so its "matrix" row is implicit.

### 1.2 Desired read/create access (from the matrix, current roles)

| Resource | admin | fleet_mgr | dispatcher | driver | mgmt |
|---|---|---|---|---|---|
| vehicles | CRUD | CRUD(d) | R | R | R |
| reservations | full | full(-d) | full(-d) | — | R |
| dispatch | CRUD | CRU | CRU | RU | R |
| routes | CRUD | CRU | CRU | — | R |
| trips | CRUD | CRU | CRU | RU | R |
| drivers | CRUD | CRU | R | R | R |
| maintenance | CRUD | CRU | R | CR | R |
| fuel | CRUD | CRU | R | CR | R |
| categories | CRUD | CRU | — | — | R |
| ai / insights | R | R | R | R | R |
| reports | CRUD(-d) | CRU(-d) | CR | — | CR |
| analytics | R | R | R | — | R |

### 1.3 Audit findings — API boundary does not match the matrix

> **Historical.** These guard gaps were fixed during implementation (§5.1) and
> the front-desk roles they concerned have since been removed (migration 022).
> Retained as the audit record.

`requireAuth(req)` with no role list defaults to `DEFAULT_ROLES =
[system_admin, admin, fleet_manager, dispatcher, management]`. Several read
endpoints rely on that default and therefore **refuse roles the matrix grants
read access to**. This breaks the intended per-role dashboards (front-desk roles
cannot load the data their dashboard needs) and is the single biggest concrete
gap.

| Endpoint (GET) | Current guard | Matrix says should read | Status |
|---|---|---|---|
| `/api/vehicles` | default roles | all 9 roles | **GAP** — driver, reception_staff, restaurant_staff, concierge refused |
| `/api/drivers` | explicit `[sys,admin,fleet_mgr,dispatcher,mgmt]` | + driver | **GAP** — driver refused (driver portal uses `/api/driver/*`, but a driver's "My vehicle" read on this list is allowed by matrix) |
| `/api/trips` | default roles | + driver | **GAP** — driver refused |
| `/api/routes` | default roles | + concierge | **GAP** — concierge refused |
| `/api/dispatch` | default roles | all 9 roles | **GAP** — driver, reception_staff, restaurant_staff, concierge refused |
| `/api/vehicle-categories` | default roles | reception, restaurant, concierge, management | **GAP** — front-desk + management refused |
| `/api/fuel` | explicit `[sys,admin,fleet_mgr,dispatcher,mgmt,driver]` | same | matches |
| `/api/reservations` | default roles | reception/restaurant/concierge/mgmt read | matches (default includes all) |
| `/api/notifications` | default + self-scope | all | matches |

**Fix:** add the missing roles to each GET guard, exactly the set the matrix
grants (see §5).

### 1.4 Audit findings — scope and residual issues

1. **`PUT /api/notifications/read-all` updates every notification in the table
   (`WHERE is_read = false` with no user filter).** The companion GET already
   self-scopes to `employee_id` / `user_id`. Any authenticated user can silently
   clear the unread flags of every other user. **Fix:** self-scope like the GET.
   (Severity: low–medium — it only toggles a read flag, but it is cross-user
   mutation and contradicts the model.)
2. **`/dashboard` is `["*"]` for every role**, so a `driver` landing on
   `/dashboard` sees the staff operations dashboard and its queries fire against
   endpoints that will 403 for driver. **Fix:** redirect driver to `/driver` and
   render role-specific dashboards (§3).
3. **Sidebar nav is filtered by `NAV_ROLES`, but the sidebar has no entry for
   `/driver`.** Drivers see an empty Operations/Monitoring set; the logo links to
   `/dashboard` which redirects them away from their portal. **Fix:** add a
   Driver Portal nav entry and make the logo link to the role home (§2).
4. **`dispatcher` cannot read `/api/drivers` for the assignment view** — matrix
   grants dispatcher read on `drivers`, and the dispatch UI links to driver
   records. Current explicit guard excludes dispatcher. **Fix:** add dispatcher.
5. **`reports` CRUD** — `reports.create` is granted to management in the matrix
   but `POST /api/reports` uses default roles (management included) — consistent.
   No change.
6. **`GET /api/notifications`** supports `?employee_id=` for admins to view
   another user's notifications (guarded). `PUT read-all` is the only scope
   leak. See item 1.

### 1.5 Verified-consistent (no change needed)

- Reservation lifecycle (review/approve/reject/assign/cancel/reschedule) routes
  refuse exactly the roles `can()` denies; `scripts/verify-rbac.mjs` pins this.
- Fuel read/write split (driver may log fuel + read own; dispatcher read-only).
- Driver portal (`/driver`, `/api/driver/*`) is driver-only end to end.
- Notification *write* is restricted to `[system_admin, admin, fleet_manager,
  dispatcher]`.

---

## 2. Role-Specific Sidebar Navigation

Rendered by `src/components/layout/app-shell.jsx`; filtering already happens via
`filterNavItems(navGroups, employee)` + `NAV_ROLES` in
`src/lib/auth/permissions.js`. Changes required:

### 2.1 NAV_ROLES additions / corrections

- Add `/driver` already present (`["driver"]`) — but ensure it also appears as a
  sidebar item (§2.2).
- `/fleet/vehicles` and `/fleet/categories` stay fleet-staff only.
- Add missing entries used by child links already in the sidebar so the route
  guard admits them:
  - `/reservations/queue` → `["admin","system_admin","fleet_manager","dispatcher","reception_staff","restaurant_staff","concierge"]` (front desk authors + approves nothing, reads queue).
  - `/tracking` stays ops-only; `/tracking/history` adds management (already).
  - `/settings/ai`, `/settings/ai/logs` → `["admin","system_admin","fleet_manager"]` (sidebar children under AI; currently they fall back to `["*"]` default, a soft bypass).

### 2.2 Nav group content per role

**system_admin** — every module: Overview, Operations (Fleet, Reservations,
Queue, Dispatch, Routes, Drivers, Trips), Monitoring (Fuel, Maintenance,
Tracking), Intelligence (AI, Reports, Analytics), System (Notifications,
Settings incl. Add User + API Access). Plus a **System Admin** group:
`/system` status placeholders (documented in §7 as future work).

**admin / fleet_manager** — same as system_admin minus Add User/API settings for
fleet_manager? No: fleet_manager keeps full ops nav, loses System admin tools
(Add User, API Access) — those are `["admin","system_admin"]` in NAV_ROLES and
already filtered. Dashboard becomes the only difference.

**dispatcher** — Overview (Dashboard), Operations (Queue, Dispatch, Routes,
Trips), Monitoring (Fuel read, Tracking, Maintenance read). No Fleet, no
Drivers, no System admin tools. AI Dashboard + Insights yes; Reports/Analytics
yes (matrix: dispatcher reports CR, analytics R).

**driver** — single **Driver Portal** group: Dashboard (`/driver`). No staff
nav. (Mobile app covers field use; desktop portal is the consent + assignments
view.)

**reception_staff / restaurant_staff / concierge** — Overview (Dashboard),
Operations (Reservations, Request Queue), Monitoring (GPS Tracking read? — matrix
grants dispatch read and vehicles read; tracking map uses `/api/live-locations`
which is ops-only. Keep Tracking **hidden**; the dashboard shows availability
instead). System (Notifications). No Fleet/Drivers/Trips/Fuel/Maintenance/AI
config/Reports/Analytics.

**management** — Overview (Dashboard), Operations (Queue read, Trips read),
Monitoring (Fuel read, Maintenance read, Tracking history), Intelligence
(Reports, Analytics, AI Insights). No Fleet, no Dispatch, no Drivers.

### 2.3 Logo home

Logo currently hard-links `/dashboard`. Make it role-aware: driver → `/driver`,
everyone else → `/dashboard`.

---

## 3. Role-Based Dashboards

Implemented as a **config-driven role dashboard** so "no two dashboards are
identical" is enforced structurally: one component reads a per-role config and
renders only that config's widgets. Widgets reuse `StatCard`/`StatGrid`,
`Card`, `StatusBadge`, `EmptyState` and the recharts primitives already used in
`src/app/(dashboard)/dashboard/page.js`.

Each role config declares:

- **kpis**: StatCard list (icon, label, tone, trend, click-through).
- **quickActions**: buttons into the role's highest-frequency screens.
- **charts**: derived-series charts (reservation trend, fleet status, trip
  counts).
- **lists**: recent/attention lists (pending requests, active trips, alerts).
- **queries**: only the service calls the role's API grants (respects §1.3
  fixes; otherwise the widget is omitted).

### 3.1 Per-role widget sets

| Role | KPIs | Charts | Lists / actions |
|---|---|---|---|
| **system_admin** | fleet total, drivers on duty, active trips, pending requests, unread notifications, AI status | reservation trend, fleet status pie | notifications, AI request log, quick actions → Settings/Users/AI logs |
| **admin** | total vehicles, available, in maintenance, drivers on duty, active trips, trips today | reservation trend, fleet status pie, live map | pending requests, recent trips, AI insights |
| **fleet_manager** | vehicles by status, maintenance queue count, fuel spend (read), driver count, utilization | fleet status pie, reservation trend, fuel trend | maintenance due, pending requests, insights |
| **dispatcher** | active trips, pending requests, available vehicles, drivers on duty, routes count | request status pie, trips today | queue, active trips, live map |
| **driver** | my assigned trip (if any), my today trips, vehicle assigned, fuel logged | — | my trips, my vehicle, request consent/assignment actions |
| **reception_staff** | pending requests, today's requests, available vehicles | today's requests by status | request queue, new request action |
| **restaurant_staff** | pending requests, today's requests | today's requests by status | request queue, new request action |
| **concierge** | pending requests, available vehicles, routes | today's requests | request queue, new request action |
| **management** | revenue snapshot (from trips/reservations), trips today, utilization, maintenance | reservation trend, trip volume | reports, analytics, insights |

### 3.2 Data sources per dashboard (respecting API guards)

- system_admin/admin/fleet_manager/dispatcher: `getVehicles`, `getDriverStats`,
  `getTrips`, `getActiveTrips`, `getLatestLocations`, `getReservations`,
  `getAiInsights` — all permitted for these roles.
- management: `getTrips` (after §1.3 fix), `getActiveTrips`, `getReservations`,
  `getAiInsights`. No live map (tracking is ops-only) — show trip volume chart.
- reception/restaurant/concierge: `getReservations`, `getVehicles` (after §1.3
  fix), `getAiInsights`. No trips/drivers/fuel. Core widget: **request queue
  attention list** + fleet availability.
- driver: uses the existing `/driver` portal (kept; already driver-only).

---

## 4. Optimized Operational Workflows

### 4.1 Front-desk request lifecycle (reception/restaurant/concierge)

Current: front-desk author a request → fleet ops approve/dispatch → driver
completes. Optimizations (all within existing state machine and routes):

1. **New Request** stays on the front-desk dashboard as a first-class quick
   action (one click from the queue list, pre-filled category select).
2. **Queue list** on the front-desk dashboard surfaces only *their* authored
   pending requests with the live status badge, so the desk never re-checks
   "all" for status.
3. **Management oversight**: management dashboard lists pending approvals as a
   read-only board — the model already denies management any action verb, so
   this is a pure visibility win.

### 4.2 Dispatcher dispatch workflow

- Dashboard quick actions: "Dispatch next pending request", "Open live map",
  "Assign driver".
- Active-trips list with per-row status badge keeps the dispatcher on one
  screen (already exists on `/trips/active`; surfaced on the dispatcher
  dashboard).

### 4.3 Driver portal

- Consent gate + profile + today's trips stay as-is.
- Dashboard adds: assigned vehicle, pending assignment, fuel-log shortcut
  (driver may create fuel + read; matrix-consistent).

### 4.4 Fleet health loop (fleet_manager/admin)

- Dashboard "Maintenance due" list links straight to the maintenance record;
  the maintenance queue KPI carries the trend text ("X due this week").
- Predictive maintenance alerts surface via the AI insights block (already
  wired).

---

## 5. API & Route Protection

### 5.1 Guard changes (exact diffs)

| File | Change |
|---|---|
| `src/app/api/vehicles/route.js` (GET) | `requireAuth(req, ["system_admin","admin","fleet_manager","dispatcher","management","driver","reception_staff","restaurant_staff","concierge"])` |
| `src/app/api/drivers/route.js` (GET) | add `"dispatcher"` and `"driver"` to the existing explicit list |
| `src/app/api/trips/route.js` (GET) | add `"driver"` |
| `src/app/api/routes/route.js` (GET) | add `"concierge"` |
| `src/app/api/dispatch/route.js` (GET) | add `"driver","reception_staff","restaurant_staff","concierge"` |
| `src/app/api/vehicle-categories/route.js` (GET) | add `"reception_staff","restaurant_staff","concierge","management"` |
| `src/app/api/notifications/read-all/route.js` | self-scope the UPDATE by `employee_id` / `user_id` like the GET |

Writes are **unchanged** — no role gains a verb the matrix denies.

### 5.2 Route guards / redirects

- `dashboard/page.js`: if role is `driver`, `router.replace("/driver")`.
- `driver/page.js`: if role is not `driver`, `router.replace("/dashboard")`.
- Logo link → role home (§2.3).
- `NAV_ROLES` additions from §2.1 (`/reservations/queue`, `/settings/ai`,
  `/settings/ai/logs`) tighten the route guard from `["*"]` default to the
  intended role sets.

### 5.3 Regression net

`scripts/verify-rbac.mjs` pins the reservation lifecycle. The GET-guard changes
above do not touch lifecycle routes, so the harness stays green. Re-run it plus
eslint/build after the changes.

---

## 6. UI/UX & Design System

- Keep the existing tokens (surface/border/hover/foreground-*) and components
  (`StatCard`, `Card`, `StatusBadge`, `EmptyState`, `PageHeader`, skeletons).
- Dashboard configs are data, not JSX per role → consistent spacing, one set of
  widget primitives, per-role emphasis only.
- Empty states stay descriptive ("No reservations yet…") per existing pattern.
- `TopNav` breadcrumb/theme/bell stay shared; the bell badge remains static (see
  §7 note) — leaving its wiring untouched.

---

## 7. Implementation Plan (phase order)

| Phase | Work | Files |
|---|---|---|
| **1. Analysis** | this document | `docs/rbac-redesign.md` |
| **2. Dashboards** | role-config + `RoleDashboard` renderer; rewrite `/dashboard` to delegate; driver redirect | `src/components/dashboard/dashboard-configs.js`, `src/components/dashboard/role-dashboard.jsx`, `src/app/(dashboard)/dashboard/page.js` |
| **3. Sidebar** | NAV_ROLES additions, `/driver` nav entry, role-home logo | `src/lib/auth/permissions.js`, `src/components/layout/app-shell.jsx` |
| **4. API** | §5.1 guard changes, §5.2 redirects | 7 route files + 2 pages |
| **5. Verify** | eslint + `verify-rbac.mjs` + build; spot-check each role | — |

### Explicitly out of scope (recommended future work)
- **Per-user notification read state** at DB level (schema change — excluded by
  ground rules; the self-scope fix in §5.1 makes the current table safe without
  one).
- **System Admin health/audit dashboard** (`audit_logs` has no read API yet) —
  flagged as a follow-up module.
- **Live bell badge count** — currently static `3`; wiring it to
  `/api/notifications?is_read=false` is a small follow-up, deliberately not
  bundled here to keep this change reviewable.
- **Route-level middleware** for 403 vs redirect at the server boundary — the
  client `RouteGuard` already refuses rendering; a middleware pass is a
  hardening follow-up.

---

## 8. Phase 5 — Multi-Workspace Rebrand (implemented)

Each role is now a distinct workspace with its own identity, navigation, and
dashboard, driven by `src/lib/workspaces.js` (pure config) + the config-driven
dashboard renderer.

### 8.1 Workspaces (current)

| Role | Workspace | Accent |
|---|---|---|
| system_admin | System Console | neutral |
| admin | Operations Center | primary |
| fleet_manager | Fleet Operations | success |
| dispatcher | Transportation Operations | warning |
| driver | Driver Workspace | info |
| management | Executive Center | neutral |

`app-shell.jsx` renders the role's workspace name/logo chip and its
workspace-specific nav (still passed through `filterNavItems` / NAV_ROLES so the
visible UI can never exceed the enforced boundary). `TopNav` shows the workspace
name as the breadcrumb root. Login/guards route each role to `workspace.home`
(`/dashboard` for all staff roles, `/driver` for drivers). Unknown roles
(including the removed front-desk roles) fall back to `WORKS.admin`.

### 8.2 Workspace nav (per role, no disabled items)

- **System Console**: Console (System Dashboard, Notifications), Administration
  (Audit Logs, User Management, API & Integrations, AI Providers, AI & Automation
  Logs, System Settings). Fleet/dispatch/driver modules are not listed.
- **Operations Center** (admin): Overview, Fleet Operations (Vehicle Management,
  Driver Management, Driver Performance & Feedback, Document Expiration),
  Transportation (Reservations, Request Queue, Dispatch, Trips), Operations
  (Fuel, Maintenance, Live GPS), Insights (Reports, Analytics, AI Insights),
  Administration (Settings). The deeper modules (Vehicle Categories, Driver/Fleet
  Availability, Fleet Cost, Active Trips, Routes, Fuel Analytics) were trimmed to
  keep admin as a lean oversight center.
- **Fleet Operations** (fleet_manager): Fleet Operations (Vehicle Management, Add
  Vehicle, Fleet Availability, Document Expiration, Driver Management, Driver
  Availability, Driver Performance), Operations (Maintenance, Predictive
  Maintenance, Fuel Monitoring, Fuel Analytics), Insights (Fleet Reports, Fleet
  Cost, Fleet Analytics, Fleet Insights). No dispatch/queue/settings.
- **Transportation Operations** (dispatcher): Transportation (Reservation Queue,
  Dispatch Board, Dispatch Calendar, Active Trips, Trips), Operations (Fleet
  Availability, Driver Availability, Routes, Live GPS Tracking, Trip Timeline),
  Insights (AI Insights, Reports).
- **Driver Workspace**: single "My Dashboard" (`/driver`).
- **Executive Center** (management): Insights (Executive KPI Center, Reports,
  Fleet Cost, Analytics, Driver Performance, Strategic Insights), Monitoring
  (Operational Review, Fleet Availability, Driver Availability). All read-only —
  no operational write tools.

### 8.3 New read-only data features

- **Audit Log viewer** — `GET /api/audit` (system_admin; reads the existing
  `audit_logs`, filters action/resource/date, paginated). Page
  `src/app/(dashboard)/system/audit/page.js`; `NAV_ROLES["/system/audit"]`.
- **Platform health feed** — `GET /api/system/activity` (system_admin; recent
  `integration_log` + `automation_logs` + 24h counters). Feeds the System Console
  dashboard widgets.
- **Driver vehicle inspection** — `GET /api/driver/vehicle-inspection`
  (driver-scoped; latest inspection for the driver's assigned vehicle).
- **Driver incident reporting** — `GET` + `POST /api/driver/incidents`
  (driver-scoped create/list). Surfaced on the Driver Portal with a report form.

### 8.4 Read-only operational & executive boards (Phase B)

New read-only boards built on existing data, wired into `NAV_ROLES` + the
relevant workspaces. All management-facing ones are strictly read-only.

| Route | Purpose | Roles |
|---|---|---|
| `/fleet/availability` | Vehicles by status board | admin, system_admin, fleet_manager, dispatcher |
| `/drivers/availability` | Drivers by duty status board | admin, system_admin, fleet_manager, dispatcher, management |
| `/fleet/documents` | Document Expiration Center — driver licenses + vehicle registration/OR-CR/insurance, split into Vehicle / Driver tabs | admin, system_admin, fleet_manager |
| `/drivers/performance` | Driver Performance Center — on-time, trips, score, cost/km | admin, system_admin, fleet_manager, management |
| `/reports/cost` | Fleet Cost Dashboard — per-vehicle fuel/maintenance cost | admin, system_admin, fleet_manager, management |
| `/executive` | Executive KPI Center — fleet/driver/financial KPIs, AI insights | admin, management |

New endpoints: `GET /api/documents/expiring` (aggregates `vehicles.*_expiry`,
`vehicledocuments.expiry_date`, `drivers.license_expiry`), `GET
/api/reports/fleet-cost` (per-vehicle `cost_per_km`). `GET
/api/reports/driver-performance` was extended with `on_time_rate`,
`total_distance`, `cost_per_km`. Note: `tripperformance`, `tripcostanalysis`,
and `driverincidents` were dropped in migrations 005/007 — driver performance is
computed from the merged `trips`/`drivers` columns.

> The front-desk-only pages (`/concierge/airport`, `/transportation/history`)
> were **deleted** along with the roles they served (migration 022).

Requested modules with no backing data (hotel rooms/check-in, restaurant POS,
backup/restore/DB management, revenue/earnings, VIP/guest-satisfaction,
user-list/role-management UIs) are mapped to their closest real equivalent or
omitted entirely - nothing is stubbed as an empty/disabled experience.

---

## 9. Latest — Fleet & Transport Focus (current end state)

FleetOps is now scoped strictly to fleet & transportation. This section is the
authoritative current description; the front-desk/hospitality material above is
historical.

### 9.1 Scope consolidation — front-desk roles removed

- Migration `022_remove_front_desk_roles.sql`: deleted `roles` rows 5/6/8
  (`reception_staff`, `restaurant_staff`, `concierge`) and disabled the 3
  employees who held them (soft-delete + status `Inactive` + `role_id NULL`).
- Six roles remain: `system_admin` (1), `fleet_manager` (2), `dispatcher` (3),
  `driver` (4), `management` (7), `admin` (9).
- Removed from the app: `ROLES`/`ROLE_IDS`/`REGISTRATION_ROLES` in
  `src/lib/constants.js`; `NAV_ROLES` + `MATRIX` in `src/lib/auth/permissions.js`;
  the 3 workspace definitions + `GUEST_TRANSPORT` in `src/lib/workspaces.js`; the
  3 role configs in `src/components/dashboard/dashboard-configs.js`; front-desk
  roles trimmed from 7 API `requireAuth` lists; the `/concierge/airport` and
  `/transportation/history` pages deleted; `scripts/verify-rbac.mjs` +
  `scripts/verify-driver-assignments.mjs` updated.
- Booking-channel values (`BOOKING_CHANNELS.CONCIERGE`, the `POS (Restaurant /
  Concierge)` option) are **not** roles and were retained.

### 9.2 Workspace naming (current)

| Role | Workspace |
|---|---|
| system_admin | System Console |
| admin | Operations Center |
| fleet_manager | Fleet Operations |
| dispatcher | Transportation Operations |
| driver | Driver Workspace |
| management | Executive Center |

### 9.3 Nav regrouping

Admin and fleet_manager navs are grouped into enterprise sections (`Fleet
Operations / Transportation / Operations / Insights / Administration`), replacing
the flat Dashboard/Drivers/Fleet/… ordering. "Add Vehicle" was removed from the
admin nav; "Fleet Availability" was replaced with "Driver Performance &
Feedback" so admin stays a lean oversight center (fleet_manager keeps the deep
operational modules).

### 9.4 Read-only operational & executive boards

See §8.4. These reuse existing data with no schema changes:
`/fleet/availability`, `/drivers/availability`, `/fleet/documents` (Vehicle /
Driver tabs, incl. driver licenses + vehicle registration),
`/drivers/performance`, `/reports/cost`, `/executive`. New endpoints:
`GET /api/documents/expiring`, `GET /api/reports/fleet-cost`; extended
`GET /api/reports/driver-performance`. Management-facing boards are strictly
read-only.

### 9.5 Verification

- `node --import ./scripts/route-harness-loader.mjs scripts/verify-rbac.mjs` —
  78 passed, 0 failed (assertions for the removed roles dropped).
- `npm run test:run` — 76/76.
- `npm run lint` (changed files) and `npm run build` — clean.
- `getWorkspace(role)` resolves all 6 roles; removed/unknown roles fall back to
  `WORKS.admin`.

---

## 10. Business-rule hardening & Incidents module

FleetOps business rules were audited and gaps closed (documented for the record;
see `docs/rbac-model.md` and the code for the authoritative implementation).

### 10.1 Dispatch rules enforced
- **Double vehicle/driver booking** — hard 409 via `findDispatchConflicts`
  (`src/lib/scheduling/conflicts.js`) on dispatch-create, request-assign, **and**
  now dispatch-update (`PUT /api/dispatch/[id]`). DB-level trigger
  `trg_dispatch_overlap` (migration `023_dispatch_overlap_guard.sql`) makes it
  race-free via `pg_advisory_xact_lock`.
- **Maintenance vs dispatch** — a vehicle with `Under Maintenance /
  Decommissioned / Registration Expired` cannot be dispatched (400) on create or
  update.
- **Driver availability** — `Suspended / On Leave / Off Duty` drivers cannot be
  dispatched (400/409) on create, assign, or update.
- **Expired documents** — expired `registration_expiry`, `insurance_expiry`
  (vehicle) and `license_expiry` (driver) block dispatch. Insurance expiry was
  previously unenforced; now checked at create/update/assign and surfaced as a
  queue conflict.
- **Reservation cancellation cascade** — cancelling a request marks related
  dispatches + trips Cancelled, re-syncs vehicle/driver status, **and** nulls the
  request's `vehicle_id`/`driver_id` for consistency.

### 10.2 Incidents module
- `driverincidents` table (dropped in migration 005) was **recreated** (migration
  `024_driverincidents.sql`) — the driver portal and `/api/driver/incidents`
  referenced a nonexistent table and were broken.
- **Driver self-service** — `GET`/`POST /api/driver/incidents` (driver-scoped).
- **Staff view** — new `GET /api/incidents` (all incidents, joined to
  vehicle/driver; filterable by severity/status/type/date) and a read-only
  `/incidents` page for dispatcher/management/ops.
- **Breakdown automation** — a driver reporting a breakdown
  (`/breakdown|mechanical|engine|flat tire|battery|electrical|overheat/i`) sets
  the vehicle to `Under Maintenance` and notifies system_admin/fleet_manager/
  dispatcher/management/admin, so the vehicle stops receiving assignments.

### 10.3 Driver acceptance (documentation only — not implemented)
Optional enterprise workflow, intentionally **not** built yet:

```
Dispatcher → Assign Driver → Driver accepts → Trip confirmed → Trip started
```

The mobile app already lets a driver accept/decline an assigned trip. A full web
"Accepted" hop in the trip state machine (`src/lib/scheduling/trip-state.js`,
currently `Assigned → … → Completed`) would formalize this as a hard gate before
a trip can start. Treat as follow-up; no schema or state-machine change was made
for it in this pass.
