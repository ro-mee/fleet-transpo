---
type: feature
status: partial
tags: [feature, maintenance]
source:
  - src/lib/ai/predictive-maintenance.js
  - src/app/(dashboard)/fleet/maintenance
  - src/app/(dashboard)/maintenance/page.js
  - src/app/api/vehicle-maintenance/[id]/route.js
  - supabase/migrations/113_maintenance_repairer_identity.sql
last_verified: 2026-09-16
---

# Feature: Maintenance

## What it does

Tracks vehicle servicing, handles emergency repairs from incidents, provides an operational dashboard for the Fleet Manager, and flags vehicles approaching a service threshold.

## What's real — CONFIRMED

| Piece | State |
|---|---|
| `src/lib/ai/predictive-maintenance.js` | ✅ Pure scoring module, feeds [[AI Advisory]] |
| `trigger_notify_maintenance_due` | ✅ DB trigger writes a [[Notifications]] row |
| `src/app/(dashboard)/fleet/maintenance/` | ✅ **Fully operational dashboard** (history, active repairs, predictive schedule) |
| `vehiclemaintenance` State Machine | ✅ `Completed` is a terminal state. Strict completion audit trail (`completed_by`, `completed_at`) enforced server-side. Separation of duties keyed to `repair_completed_by` (migration 113). |
| ~~Manager inspection gate~~ | ❌ **REMOVED 2026-09-16** — required `inspection_completed_at`, which nothing in the app could ever write. See the bug record below. |

## The Fleet Maintenance Dashboard

The Fleet Maintenance dashboard allows the Fleet Manager to view active repairs, historical records, and the upcoming predictive maintenance schedule. The system strictly governs the state of a maintenance record:

### State Machine & Completion Audit
A maintenance record transitions from `Scheduled` → `In Progress` → `Completed`.
The intermediate state `Pending Inspection` is available and reachable from the
maintenance page, but is **optional** — a record may go straight from
`In Progress` to `Completed`.
* **Immutability:** Once a record reaches `Completed`, its status becomes terminal and cannot be reverted to an earlier state by any user.
* **Audit Trail:** When a record is completed (via `PUT /api/vehicle-maintenance/[id]`), the system securely injects the authenticated user's ID (`completed_by`) and the precise database timestamp (`completed_at`). The `POST` creation endpoint forces all new records to `Scheduled` to prevent audit bypass.

### Separation of duties — CONFIRMED 2026-09-16

Two guards run on the `Completed` transition, in this order:

1. **Role gate.** `hasRole(session.user, ["system_admin", "admin", "fleet_manager"])` — everything else (including `driver`) gets `403`.
2. **Four-eyes gate.** The person who declared the repair finished cannot also approve it: `repair_completed_by === session.user.employeeId` → `403 "The person who completed this repair cannot approve its completion."`

`repair_completed_by` is stamped by the server on the transition **into**
`Pending Inspection` (migration 113), together with `repair_completed_at`. That
is the only point in the lifecycle where "who did the work" is knowable, so it is
the only honest key the guard can use.

**`created_by` is deliberately not a fallback.** It records the work order's
provenance, and on an incident-sourced ticket (`src/lib/incidents/maintenance.js`
passes `session.user.employeeId`) it names **whoever resolved the incident**, not
the mechanic — that mis-keying is exactly what the pre-2026-09-16 guard denied on.
A row whose `repair_completed_by` is `NULL` — every record predating migration
113, and any record that skipped `Pending Inspection` — is **not blocked**: there
is no evidence of who did the work, so the guard stays silent rather than guess.
No backfill was performed, for the same reason.

### The inspection gate — ADDED 2026-09-04, REMOVED 2026-09-16

Migration 097 added `inspection_required BOOLEAN DEFAULT TRUE` and the route
required `inspection_completed_at` to be set before `Completed`. Nothing could
ever set it — see the bug record below — so the gate denied every user on every
record. It, and the now-dead `inspection_required` / `inspection_completed_at` /
`inspection_notes` allowlist entries, are gone. The DB columns remain (dropping
them is a separate decision, and `inspection_required` now defaults `FALSE`).

This is the **second** time inspection columns were tried on `vehiclemaintenance`:
migration 005 merged the whole `vehicleinspection` table in (adding
`inspection_checklist`, `inspection_findings`, `severity`), and `018b` dropped
them again. The lesson is not "inspection is hard" — it is that a gate whose
input has no writer is indistinguishable from a gate that denies everyone.

## Emergency repairs from incidents — CONFIRMED 2026-08-23

`POST /api/incidents/[id]/maintenance` writes an `Emergency Repair` row (In
Progress, High priority, `created_by` = resolving staff) and resolves the
incident in **one transaction** — the old client-side two-call chain could orphan
or duplicate the repair. `syncVehicleStatus` keeps the vehicle grounded while the
record is active; completing it restores availability.

Since migration 063 the row carries **`source_incident_id`** (FK, backfilled from
the description prefix), the register renders an `Incident #N` chip per linked
record, and completing a linked record notifies the reporting driver that the
vehicle is back in service. → [[Incidents]]

## Bug: every PUT 500'd with "could not determine data type of parameter $1" — FIXED 2026-09-15

`PUT /api/vehicle-maintenance/[id]` built the SET `values` array first, then
appended the record `id` and ran the pre-check
`SELECT ... WHERE maintenance_id = $N` with the **whole array** — leaving
`$1..$N-1` unreferenced, which Postgres rejects at parse time. Every edit
(including Edit → Complete) returned `500 Internal server error`.

Fix: the pre-check now runs first with `[id]` only; the `id` is appended last
for the `UPDATE` so every `$n` lines up with `values[n-1]`. No guard behavior
changed (terminal-state 409 and role 403 intact; the inspection 400 that was
also listed here was **removed** on 2026-09-16 — see below).
Regression test: `route.test.js` "Test 9: pre-check SELECT uses only [id]".
Verified: 21/21 maintenance tests pass
(`[id]/route.test.js` 7, `route.test.js` 5, `maintenance-schedule.service.test.js` 9),
ESLint clean on both touched files.

## Bug: completion guard denied every role, including admin — FIXED 2026-09-15

Symptom: Edit → Complete returned `403 "Only a Fleet Manager or Admin can
approve maintenance completion"` even for a real `admin` account.

Cause: `hasRole()` (`src/lib/auth/permissions.js`) only read
`employee.roles.role_name` (the client/NextAuth shape), but
`requirePermission` → `resolveCurrentIdentity` (`src/lib/api/utils.js:161`)
returns a server identity with a **flat `role` string** and no `roles` object —
so the guard returned `false` for everyone. The route's unit tests masked it by
mocking the session with the client shape.

Fix: `hasRole` now accepts the flat `role` string first, then falls back to
`roles.role_name` (string, object, or array form) — backward compatible with
all client callers (`use-role-access.js`, `role-guard.js`). Test mock switched
to the real flat-role shape plus a new "Test 10" asserting a driver session is
rejected with the guard message.
Verified: 40/40 pass (maintenance 22 + auth 18), ESLint clean on all 3 touched
files. Only server caller of `hasRole` is this route, so blast radius is one
endpoint. (`can()` has the same single-shape assumption but no server callers —
left untouched.)

## Bug: no maintenance record could be completed, by anyone, since 2026-09-04 — FIXED 2026-09-16

Two stacked guards on the `Completed` transition, each keyed to the wrong thing.
Both had to be wrong at once for the symptom to look like this, and the symptom
was **role-dependent**, which is what made it read as a permissions bug.

| Account | Error returned |
|---|---|
| `admin` | `403 "Mechanics cannot approve their own repairs. Manager inspection required."` |
| `fleet_manager` | `400 "Inspection must be completed before marking as Completed"` |

**Guard 1 — the repairer was identified as `created_by`.** The guard compared
`beforeRow.created_by` against the session. But on an incident-sourced work order
`created_by` is the **incident resolver** (`src/lib/incidents/maintenance.js:71`),
not the mechanic. The live rows that prompted the report (`maintenance_id`
39/40/44/45) all carry `created_by = 48` — the `admin` account. That admin was
therefore permanently locked out of work orders it had opened itself, while a
`fleet_manager` who had never touched them sailed past the guard and hit the
second one.

**Guard 2 — the inspection gate was unsatisfiable.** Migration 097 made
`inspection_required` default `TRUE` on every row, and the route required
`inspection_completed_at` before `Completed`. A repo-wide grep found that column
written **nowhere** outside the route, its test, `schema.sql`, and the migration
itself — no UI, service, or endpoint could supply it. Every record was gated on a
field the application had no writer for.

**Why it went unnoticed for 12 days.** Migration 097 applied 2026-09-04, and live
data confirms nothing had completed since: 0 rows with `manager_approved_by`, 0
with `inspection_completed_at`, `max(completed_at)` still `NULL`, 8 records
stuck `In Progress`. The unit tests stayed green because `mockRecord` carried
neither `created_by` nor `inspection_required`, so both guards resolved to
`undefined` and never armed — and Test 9 sent `inspection_required: false`, a
field the real UI never sends. The suite was asserting against a session and a
payload that production never produces.

**Fix.**
- Migration **113** adds `vehiclemaintenance.repair_completed_by` (FK →
  `employees`) and flips `inspection_required` to `DEFAULT FALSE`.
- The route stamps `repair_completed_by` / `repair_completed_at` on the
  transition into `Pending Inspection`, and the four-eyes guard now compares
  **that** column. `NULL` never blocks (no backfill — see above).
- The inspection gate is deleted, along with its three now-dead allowlist and
  validator entries, so a client can no longer send those fields and leave a row
  looking inspected.
- `Pending Inspection` was added to both status dropdowns (maintenance page and
  `MaintenanceFormDialog`) and to the `maintenance` tone map in
  `status-badge.jsx` — it was a state the route understood but no UI could reach.
- The in-progress counter in `GET /api/vehicle-maintenance` now counts
  `IN ('In Progress', 'Pending Inspection')`, so a record waiting on approval is
  not reported as finished work that does not exist.

**Verified.** New tests 11–14 in `[id]/route.test.js` pin the guard's three
cases (repairer blocked; uninvolved manager allowed; the incident resolver
allowed) plus the `NULL` case and the `Pending Inspection` stamp. The tests were
proven to have teeth by reverting the route to its pre-fix revision and
re-running: all four fail with the correct messages (`expected 200 to be 403`,
`expected 403 to be 200`, missing `repair_completed_by = $`, and
`inspection_required` still present in the SET list). Full suite **141 files /
1338 tests pass**, ESLint clean on the 7 touched files, `npm run db:dump` a
clean 3-insertion/1-deletion `schema.sql` diff, migration 113 confirmed applied
via `information_schema` + `pg_constraint`. The three queries the app actually
runs were replayed against live and return correct shapes.

## Predictive maintenance

`predictive-maintenance.js` is one of the pure modules in `src/lib/ai/`. It scores vehicles by proximity to a service threshold (odometer-driven) and surfaces them in the advisory ranking.

**Schedule Clamp:** `recomputeVehicleSchedule()` updates a vehicle's next service date and mileage when a maintenance record is `Completed`. To prevent illegal tampering, this function uses a PostgreSQL `GREATEST()` clamp. If a user modifies an older completed maintenance record with a lower odometer reading, the clamp discards the edit and preserves the furthest advanced predictive schedule, keeping the risk scores strictly safe and forward-moving.

## Database tables used

`vehiclemaintenance` · `vehicles` (odometer) · `notifications`

## Related

[[Fleet And Vehicles]] · [[AI Advisory]] · [[Notifications]] · [[Feature Index]]
