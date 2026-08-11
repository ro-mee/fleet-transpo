# Role-Based Access Control (RBAC) Model

FleetOps has **six roles** and a single organization. Authorization is enforced in
the application layer, per API route. This document describes the roles, the
permission matrix, and why the database is not the boundary.

Source of truth: **`src/lib/auth/permissions.js`** — `MATRIX[role][resource][action]`
plus `NAV_ROLES[path]`. `role-guard.js` re-exports it and adds the React hook;
the matrix data itself lives in `permissions.js`.

> **History.** FleetOps was multi-branch and had nine roles. Branches were removed
> in migration `013_drop_branches.sql`. The three hospitality roles
> (`reception_staff`, `restaurant_staff`, `concierge`) were removed in migration
> `022_remove_front_desk_roles.sql`, and the three employees holding them were
> disabled. There is no branch scoping and there are no front-desk roles anywhere
> in the current system.

## 1. Roles

Six roles, from `src/lib/constants.js` (`ROLES`, `ROLE_IDS`). The IDs are
non-contiguous because rows 5/6/8 were the removed hospitality roles.

| Role | `role_id` | Workspace | Authority |
|---|---|---|---|
| `system_admin` | 1 | System Console | Everything. `can()` short-circuits to `true` before the matrix is consulted. |
| `fleet_manager` | 2 | Fleet Operations | Full write on fleet, drivers, maintenance, fuel, and the reservation lifecycle. No deletes, no system config. |
| `dispatcher` | 3 | Transportation Operations | Runs the queue: creates dispatches and trips, drives the reservation lifecycle. Read-only on vehicles, drivers and custodial pairings. |
| `driver` | 4 | Driver Workspace | Own data only. Executes assigned trips, reports GPS, files fuel and incidents. |
| `management` | 7 | Executive Center | Read-only. Reports, analytics, AI insights. No lifecycle verbs. |
| `admin` | 9 | Operations Center | Full CRUD on operational domains, creates employee accounts, read-only on system config. |

## 2. Why enforcement is application-layer

Both database paths hold elevated privileges:

- the raw `pg` pool (`DATABASE_URL`, `src/lib/db.js`) connects as the database owner;
- the Supabase client uses the **service-role** key, which bypasses RLS by design.

Neither establishes an end-user Postgres identity, so RLS policies have no session
to read and **cannot** be the security boundary. RLS is enabled in the SQL and the
policies exist, but they are inert at runtime — kept for reference, not relied on.
`has_role()` in the migrations even calls a function that was later dropped
(`get_current_employee_role`), which would error if it ever ran; that it has never
errored is evidence it never runs.

Authorization therefore lives in the application, in four layers:

| Layer | Where | What it does |
|---|---|---|
| **API route authz** (authoritative) | `requireAuth(req, [roles])` in `src/lib/api/utils.js` | Throws 401 unauthenticated, 403 wrong role. This is the real boundary. |
| Ownership scoping | `src/lib/api/ownership.js` | `assertTripOwnership` / `assertDispatchOwnership` return 404 for another driver's row; `resolveDriverScope` 403s a driver asking for someone else's data. |
| Nav gating | `NAV_ROLES` + `filterNavItems()` | Hides sidebar items the role cannot use. |
| Feature gating | `can(employee, resource, action)` | Conditionally renders action buttons. |

The last two decide what the UI *offers*. They are convenience, not protection:
`useRequireRole()` redirects from a `useEffect`, so a restricted page can flash
before the redirect. The API check is what actually stops a request.

`scripts/verify-rbac.mjs` asserts the UI matrix and the per-route role lists agree,
so a verb cannot be merely hidden while its endpoint stays open.

Auth resolution itself (`resolveIdentity`) accepts either a NextAuth cookie session
or an `Authorization: Bearer` mobile JWT, with bearer winning when both are
present. `DEFAULT_ROLES` for `requireAuth` is the five staff roles — **driver is
excluded by default** and must be named explicitly.

## 3. Permission matrix

Transcribed from `MATRIX` in `src/lib/auth/permissions.js`. `system_admin` is
omitted: it never reaches the matrix. Blank means denied.

Verbs are `create` / `read` / `update` / `delete`, plus five lifecycle verbs on
`reservations` — `approve`, `assign`, `dispatch`, `cancel`, `reschedule`. Lifecycle
is separate from `update` on purpose: moving a request through its states is a
different authority than editing its fields.

| Resource | admin | fleet_manager | dispatcher | driver | management |
|---|---|---|---|---|---|
| `vehicles` | CRUD | CRU | R | R | R |
| `driver_assignments` | CRUD | CRUD¹ | R | — | R |
| `reservations` | CRUD + lifecycle | CRU + lifecycle | CRU + lifecycle | —² | R, lifecycle explicitly denied |
| `dispatch` | CRUD | CRU | CRU | R, U | R |
| `drivers` | CRUD | CRU | R | R | R |
| `trips` | CRUD | CRU | CRU | R, U | R |
| `maintenance` | CRUD | CRU | R | C, R | R |
| `fuel` | CRUD | CRU | R | C, R | R |
| `routes` | CRUD | CRU | CRU | — | R |
| `categories` | CRUD | CRU | — | — | R |
| `reports` | CRU | CRU | CR | — | CR |
| `analytics` | R | R | R | — | R |
| `ai` | R | R | R | R | R |
| `employees` | CRU | R | — | R | — |
| `system` | R | — | — | — | — |
| `fuelallocations` | — | — | — | — | R |
| `scheduled_reports` | — | — | — | — | R |

¹ `delete` on `driver_assignments` is not a row deletion — releasing a custodial
pairing closes its interval (`DELETE /api/driver-assignments/[id]`).

² `driver` has `reservations: { read: false }` written out explicitly rather than
omitted, so the denial is readable at the matrix rather than inferred from a
missing key. Management's five lifecycle verbs are written out `false` for the same
reason: management observes without acting.

A dispatcher reads `driver_assignments` but cannot write them — they need to *see*
the custodial pairing to understand the warning when a dispatch departs from it,
but reassigning custody is a fleet-management decision. The API mirrors this: POST
and DELETE exclude dispatcher.

## 4. Navigation access

`NAV_ROLES[path]` in `permissions.js` gates each route; `"*"` means any
authenticated role. `getRequiredRolesForPath()` falls back to the longest matching
prefix, so a subpath inherits its parent's roles unless it declares its own.

Notable entries:

| Path | Roles |
|---|---|
| `/dashboard` | all except `driver` |
| `/driver`, `/driver/*` | `driver` only |
| `/reservations` | `*` |
| `/reservations/queue` | admin, system_admin, fleet_manager, dispatcher |
| `/executive` | admin, management |
| `/system/audit` | `system_admin` only |
| `/settings/general`, `/settings/api`, `/settings/number-coding`, `/settings/users/new` | admin, system_admin |
| `/settings/profile`, `/settings/security`, `/notifications`, `/notifications/preferences` | `*` |

A driver navigating directly to `/dashboard` would render it — a UI-only exposure,
since every data endpoint behind it still enforces roles.

## 5. Accounts and sessions

- **No public signup.** `POST /api/auth/register` is admin-only and 409s on a
  duplicate email; it never silently overwrites a credential. The public register
  page redirects to login.
- **Web sessions:** NextAuth Credentials, bcrypt against `employees.password_hash`,
  JWT session strategy, per-IP login rate limit of 5/min. Drivers land on `/driver`,
  everyone else on `/dashboard`.
- **Mobile tokens** are a separate system: a 15-minute access JWT and a 30-day
  refresh JWT, both signed with `NEXTAUTH_SECRET`. Refresh tokens are stored
  SHA-256 hashed in `mobile_refresh_tokens` with single-use rotation, and the role
  and driver link are re-read from the database on every refresh — so disabling an
  account takes effect at the next refresh rather than at token expiry.
- **Machine-to-machine:** `verifyServiceToken` (`src/lib/api/service-auth.js`)
  does a constant-time compare and fails closed when the secret is unset. Used by
  `/api/cron/sync` and the Booking ingest endpoint.
- **Driver license scans** are self-service but narrowly gated: a driver may
  upload a scan of their own license only while that side has no scan on file or
  the license is within 30 days of expiry. The scan passes through
  `POST /api/driver/license-scan` (Tesseract OCR + regex, no persistence) first, so
  an unreadable photo is never stored. License number, class and expiry stay
  staff-only.

## 6. Status and known gaps

Implemented: all six roles, per-route `requireAuth` on every mutating route,
ownership scoping for driver-facing reads, the client guards, admin-only account
creation, login rate limiting, and no branch scoping anywhere.

Known gaps, tracked rather than fixed:

- The inert RLS migrations are still in the tree. Removing them is a judgement
  call between reference value and the confusion of shipping policies that do
  nothing.
- `useRequireRole()`'s post-render redirect flash (§2).
- A driver can render `/dashboard` (§4).
