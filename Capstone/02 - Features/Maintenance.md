---
type: feature
status: partial
tags: [feature, maintenance]
source:
  - src/lib/ai/predictive-maintenance.js
  - src/app/(dashboard)/fleet/maintenance
  - src/app/(dashboard)/maintenance/page.js
  - src/app/api/vehicle-maintenance/[id]/route.js
  - supabase/migrations/114_maintenance_repairer_identity.sql
last_verified: 2026-10-26
---

# Feature: Maintenance

## Predictive view zero-state follow-up — 2026-10-02

Read-only live SQL found 37 non-deleted work orders and 22 non-deleted, non-decommissioned vehicles. These are different populations: the predictive endpoint returns one computed assessment per eligible vehicle, while the maintenance register counts work orders. The prediction page previously rendered five zero KPI cards before its query resolved. It now shows a loading skeleton, then the real counters; a successful empty eligible fleet gets an explicit explanation that work orders are counted separately. The existing request-error retry panel remains. The scoring engine and database are unchanged. Component tests, ESLint and production build passed; the deployed default view still needs an authenticated replay.

## What it does

Tracks vehicle servicing, handles emergency repairs from incidents, provides an operational dashboard for the Fleet Manager, and flags vehicles approaching a service threshold.

## What's real — CONFIRMED

| Piece | State |
|---|---|
| `src/lib/ai/predictive-maintenance.js` | ✅ Pure scoring module, feeds [[AI Advisory]] |
| `trigger_notify_maintenance_due` | ✅ DB trigger writes a [[Notifications]] row |
| `src/app/(dashboard)/fleet/maintenance/` | ✅ **Fully operational dashboard** (history, active repairs, predictive schedule) |
| `vehiclemaintenance` State Machine | ✅ `Completed` is a terminal state. Strict completion audit trail (`completed_by`, `completed_at`) enforced server-side. Separation of duties keyed to `repair_completed_by` (migration 114). |
| ~~Manager inspection gate~~ | ❌ **REMOVED 2026-09-16** — required `inspection_completed_at`, which nothing in the app could ever write. See the bug record below. |

## The Fleet Maintenance Dashboard

The Fleet Maintenance dashboard allows the Fleet Manager to view active repairs, historical records, and the upcoming predictive maintenance schedule. The system strictly governs the state of a maintenance record:

### State Machine & Completion Audit
A maintenance record transitions from `Scheduled` → `In Progress` → `Completed`.
The intermediate state `Pending Inspection` is available and reachable from the
maintenance page, but is **optional** — a record may go straight from
`In Progress` to `Completed`.
* **Immutability:** Once a record reaches `Completed` (or `Cancelled`), the full row is frozen — any PUT without `deleted_at` returns 409; only a staff archive passes.
* **Audit Trail:** When a record is completed (via `PUT /api/vehicle-maintenance/[id]`), the system securely injects the authenticated user's ID (`completed_by`) and the precise database timestamp (`completed_at`). The `POST` creation endpoint forces all new records to `Scheduled` to prevent audit bypass.

### Mechanic work-order lifecycle — ADDED 2026-10-06 (PUT hardening, Task 3)

The `mechanic` role (id 10, migration 143) works its own queue under five PUT
guards in `src/app/api/vehicle-maintenance/[id]/route.js`, verified by Tests
15–22 in `route.test.js` (amended Test 6 pins the freeze):

1. **Ownership.** A mechanic session may touch only rows where
   `assigned_mechanic_id` equals their own employee id (403 otherwise;
   unassigned `NULL` rows match nobody).
2. **Field whitelist.** Mechanic bodies are stripped to `MECHANIC_WRITABLE`
   (`status`, notes/diagnosis/evidence fields); `cost`, `vehicle_id`,
   `priority`, `deleted_at`, assignment and stamp columns never reach the SET
   list. Archive-by-mechanic therefore dies as 400 "No writable fields".
3. **Per-role transitions.** Mechanic: `Scheduled → In Progress → Pending
   Inspection` only (no direct completion, no skips). Staff keep the direct
   `Scheduled → Completed` edge for externally-completed work, plus
   `Cancelled`; illegal edges 409 naming both states. The completion role
   guard still runs first, so a mechanic attempting `Completed` gets its 403.
4. **Terminal freeze.** `Completed` and `Cancelled` rows reject every PUT
   without `deleted_at` (409 "… maintenance records are read-only."). Only a
   staff archive passes a frozen row.
5. **Server stamps.** `Scheduled → In Progress` sets `repair_started_at` once
   (never overwritten); staff assigning `assigned_mechanic_id` get
   `assigned_at = NOW()` (any client value stripped); an explicit staff
   unassign (`assigned_mechanic_id: null`) clears `assigned_at = NULL` so no
   stale assignment moment survives; returning
   `Pending Inspection → In Progress` is a rejection and requires a non-empty
   `rejection_reason` (400 otherwise).

Task 5 (notifications) builds its fan-out on these transitions; the route
preserves the `beforeStatus` return and `isTransitioningTo*` flags for it.

### Separation of duties — CONFIRMED 2026-09-16

Two guards run on the `Completed` transition, in this order:

1. **Role gate.** `hasRole(session.user, ["system_admin", "admin", "fleet_manager"])` — everything else (including `driver`) gets `403`.
2. **Four-eyes gate.** The person who declared the repair finished cannot also approve it: `repair_completed_by === session.user.employeeId` → `403 "The person who completed this repair cannot approve its completion."`

`repair_completed_by` is stamped by the server on the transition **into**
`Pending Inspection` (migration 114), together with `repair_completed_at`. That
is the only point in the lifecycle where "who did the work" is knowable, so it is
the only honest key the guard can use.

**`created_by` is deliberately not a fallback.** It records the work order's
provenance, and on an incident-sourced ticket (`src/lib/incidents/maintenance.js`
passes `session.user.employeeId`) it names **whoever resolved the incident**, not
the mechanic — that mis-keying is exactly what the pre-2026-09-16 guard denied on.
A row whose `repair_completed_by` is `NULL` — every record predating migration
114, and any record that skipped `Pending Inspection` — is **not blocked**: there
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

## End Duty driver reports — second auto-generated source, 2026-09-23

The **only other** path that writes a work order without a human in the office
authoring it. When a driver ends duty with a description of something wrong
(`POST /api/mobile/driver/duty {active:false, report:{findings}}`), the inserted
`Post-Shift` inspection raises a `Repair` order through
`ensureInspectionMaintenance` (`src/lib/inspections/maintenance.js`), mirroring
`src/lib/incidents/maintenance.js` deliberately — same `withTransaction` + row
lock, same `ON CONFLICT DO NOTHING` + recovery re-read when the insert loses a
race.

Provenance is **`vehiclemaintenance.source_inspection_id`** (migration `121`),
the reverse of `source_incident_id` and carrying its own partial unique index
(`WHERE source_inspection_id IS NOT NULL`), which is what makes creation
idempotent under a retried mobile submit. There is deliberately **no
`vehicleinspection.maintenance_id` back-link**: the FK already answers the
question in reverse, and the register renders provenance that way.

**Grounding is keyword-decided, and the keyword only sets urgency.** A finding
matching `shouldGroundReportedDefect` (`src/lib/driver/grounding.js` — English
breakdown/damage terms plus the Filipino words drivers actually type: `preno`,
`gulong`, `manibela`, `makina`, `baterya`, `usok`, `tagas`, `basag`) writes
`status='In Progress'` + `priority='High'`; anything else writes
`Scheduled` + `Normal`. `status` is the operational lever —
`GET /api/vehicles/available` excludes `In Progress` and `Pending Inspection`, so
`In Progress` is what actually removes the vehicle from dispatch. **A report the
keywords do not match still files a `Scheduled` order for a human to read**; the
test decides urgency, never whether the report is recorded. Saying "nothing
unusual" files nothing.

**The order is raised after the clock-out transaction commits, and never
throws.** A maintenance failure must not strand a driver at the end of their
shift — the failure is logged via `writeAppError` (work-order and notification
failures logged separately) rather than surfaced. The driver's shift ends either
way; a missing order shows up as an inspection row with no linked record, which
is exactly the state the register's provenance chip makes visible.

Notifications go to **`notificationRolesFor("incidents","route_to_maintenance")`**
— reused rather than adding an `inspections` resource to the `can()` matrix,
since the function's own contract is "the roles that own the maintenance queue"
and it is source-agnostic. The notifier carries its **own title** so it cannot
collide with the incident notifier's title+reference dedup key, and it inherits
that module's documented `::varchar` cast requirement (see the 42P08 bug in the
notifier below) — without the casts the statement fails to parse and the
notification is lost silently.

## Vehicle problem queue — `/maintenance/problems`, 2026-09-26

A single office worklist of vehicle problems **nobody is following up**, at
`/maintenance/problems`, backed by `GET /api/vehicle-inspections/problems`
(`src/lib/inspections/problem-queue.js`) and a partial index from migration `131`
(renumbered up from the plan's `127`/`128` at execution time — those numbers were
spent by other workstreams) so the scan does not walk the whole inspection table.
In the nav under Maintenance → Problem Queue for the admin and fleet_manager
workspaces (`src/lib/workspaces.js`) — added 2026-09-28, the page shipped without
a nav entry so only the direct URL reached it.

**Three buckets, in the order the page renders them:**

| Bucket | What it means | Counted on the dashboard? |
| --- | --- | --- |
| `reported_untracked` | A driver reported a fault (Post-Shift `status='Reported'`) and the automatic raise produced **no** work order — the failure was logged and swallowed. Unanswered by any person. | **Yes** — admin's attention strip and fleet_manager's maintenance card both show `counts.reportedUntracked`. |
| `failed_untracked` | A checklist inspection the driver failed (`status='Failed'`). Closable by hand, already notified when it happened. | No — the office was told the moment it failed; a usually-positive count is one the strip gets ignored for. |
| `tracked` | The problem **does** have a work order. | n/a |

**Resolution is provenance, not a flag.** There is no `is_tracked` column and no
status on the inspection. "Has a work order" is the existence of a
`vehiclemaintenance.source_inspection_id` row pointing at the inspection — the
same link the End Duty path writes, and the reason creation stays idempotent under
a retried submit. A problem leaves the queue the moment that link exists.

**Who raises what.** Only an **End Duty** report raises a work order
automatically. The office can now raise one by hand for **any** flagged inspection
from the queue page — one button, `POST /api/vehicle-inspections/[id]/work-order`,
idempotent, so a double-click resolves to the existing ticket. A hand-raised order
for a failed **checklist** files as `Scheduled` and is dated **tomorrow**
(`buildChecklistMaintenancePayload` → `nextCalendarDay()`), which is what keeps it
out of `GET /api/vehicles/available` — that predicate drops a vehicle when
`status IN ('In Progress','Pending Inspection')` **or**
`(status='Scheduled' AND maintenance_date <= CURRENT_DATE)`, so `Scheduled` with a
future date is still dispatchable. That non-grounding promise holds for checklist
rows **only**. A hand-raised order for a **reported** Post-Shift defect takes the
End Duty branch instead (`buildInspectionMaintenancePayload`): a severe-keyword
match files `In Progress` (grounded at once), and even a routine filing is dated
today, which the same predicate reads as out of service. The page states the
matching version next to each button — fixed 2026-09-26, when one shared sentence
wrongly promised both — because the natural assumption is the opposite.

**Authorization: `maintenance:read` for the queue, `maintenance:create` for the
raise.** The existing `maintenance` resource is reused rather than adding an
`inspections` resource to the `can()` matrix. That is *not* in conflict with
`notifyMaintenanceTeam`, which uses `notificationRolesFor("incidents",
"route_to_maintenance")`: the two answer different questions. The notifier asks
"who owns the maintenance queue" — a **routing** question that is source-agnostic
and has no session attached to it. The queue asks "may this session read the
maintenance register" — a **permission** question about an existing resource. One
is who gets told; the other is who may look and act.

**The residual, now narrower but still standing:** a failed Pre-Shift / Pre-Trip
still raises **nothing** on its own and still escalates to nobody automatically.
`src/lib/inspections/maintenance.js:53-55` returns `notRequired` for anything that
is not Post-Shift, on purpose. What changed is that the row is now visible in one
place and closable by a person. Whether the automatic path should widen is the
separate conversation that code defers, and it stays deferred.

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
- Migration **114** adds `vehiclemaintenance.repair_completed_by` (FK →
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
clean 3-insertion/1-deletion `schema.sql` diff, migration 114 confirmed applied
via `information_schema` + `pg_constraint`. The three queries the app actually
runs were replayed against live and return correct shapes.

## Predictive maintenance

`predictive-maintenance.js` is one of the pure modules in `src/lib/ai/`. It scores vehicles by proximity to a service threshold (odometer-driven) and surfaces them in the advisory ranking.

**Schedule Clamp:** `recomputeVehicleSchedule()` advances a vehicle's legacy routine date and mileage only on completed `Routine` work. Its PostgreSQL `GREATEST()` clamp keeps earlier service records from moving existing values backward. The clamp does not prove a vehicle is safe or correct a mistaken future baseline; an authorized vehicle edit remains the correction path. Terminal maintenance records are frozen except for staff archive.

## Inspections do not ground a vehicle — 2026-09-23

Inspection failures (Quick Pre-Trip / Pre-Shift) create severity-classified findings + dispatch notifications **only** — `vehicle_status` is never flipped by an inspection. Grounding stays with the incident/maintenance flow (`src/lib/incidents/grounding.js`), so a driver reporting a FAIL cannot take a vehicle out of service on their own, and a reader looking at an inspection `severity = 'High'` row should not conclude the vehicle was pulled. Repeated findings are recorded in `vehicleinspection.checklist` for a future condition-signal wiring (not yet wired — see [[Trips]]).

**One exception, and it is narrower than it looks (2026-09-23):** an **End Duty** report *can* ground a vehicle, but never by flipping `vehicle_status`. It writes a `vehiclemaintenance` row in `In Progress`, and `GET /api/vehicles/available` excludes that status — so the vehicle leaves dispatch through the maintenance register, the same lever a human-authored order uses, and only when the driver's own words match a breakdown/damage keyword. A checklist FAIL still grounds nothing. → see the End Duty section above and [[Trips]]

Note for anyone rendering inspection severity: `vehicleinspection.severity` carries **three vocabularies at once** and has no CHECK to settle them — the mobile route writes `None|Medium|High`, the demo seed writes `Minor|Moderate`, and the column default is `Minor`. Render it through the shared severity grammar (`status-badge.jsx`, `entity="severity"`) rather than a local ladder; the driver-portal card had a hand-written `Critical|Major` mapping that matched none of them and sent every real row to a grey "info" chip.

## Manual follow-up: “0 health records” not reproduced — 2026-10-01

`GET /api/ai/predictive-maintenance` was replayed read-only against live and returned **21 predictions**: 21 low-risk rows, 19 with no schedule/basis and 2 genuinely scheduled/healthy. The default page computes Healthy as `low - unscheduled`, therefore 2; with All/default selected the list should be 21, not 0. A selected empty risk filter legitimately changes the heading count to 0 because the heading uses `filteredPredictions.length`.

“Vehicle Telemetry Health Records” is misleading terminology: these rows are computed predictions, not persisted health records. They are generated even with no maintenance history. The vehicle grounded by incident #110 is present, but has risk `low`, score 50, no basis and a recommendation to add service date/mileage. That is not a contradiction: incident grounding is current operational state and an active repair; predictive risk is derived from next-service schedule/usage. The screens need clearer scope wording.

**Fixed the same day.** The heading now reads **“Vehicle Health Predictions (N)”**, and a filtered view reads `(N of total)` so an empty filter cannot be mistaken for an empty fleet. Engine, KPI band and scoring are untouched, and the reported default-view zero was never reproduced (the endpoint returns 21 predictions: 19 unscheduled, 2 scheduled/healthy). Full evidence: [[Manual Functional Testing Follow-up Audit]].

## Mechanic workshop — shipped 2026-10-06 (Tasks 1–7)

The seventh role (`mechanic`, id 10) works an assignee-scoped web-only queue.
Registry detail lives in [[RBAC]]; PUT-guard detail under "State Machine &
Completion Audit" above; the seven notification titles in [[Notifications]].

- **Role row + assignment columns (Task 1, migration 143).**
  `roles (10, 'mechanic')` plus 7 columns on `vehiclemaintenance`:
  `assigned_mechanic_id INT REFERENCES employees(employee_id)`,
  `assigned_at`, `repair_started_at`, `diagnosis TEXT`,
  `parts_replaced JSONB DEFAULT '[]'`, `labor_hours NUMERIC(8,2)`,
  `rejection_reason TEXT`, with partial index `idx_vm_assigned_mechanic`
  (`WHERE deleted_at IS NULL`). No new table, so no RLS/grant change
  (`db:contract` clean for `vehiclemaintenance`).
- **Registry (Task 2).** `ROLE_IDS.mechanic = 10`, `WORKS.mechanic`
  ("Mechanic Workshop", home `/mechanic`), `MATRIX.mechanic` (explicit grants
  only — vehicles/read, maintenance read+update, incidents read-only,
  notifications read/update/delete, device_tokens, search, employees/read,
  system deny), four `/mechanic/*` NAV keys, `/dashboard` → `/mechanic`
  redirect, `MAINTENANCE_STATUS.PENDING_INSPECTION`, seven `work_*`
  notification events. super_admin and admin assign mechanic; fleet_manager
  assigns nothing; driver accounts stay in the Drivers Directory.
  Unknown-role fallback is least-privilege "No Access", not the old admin
  workspace.
- **Session + redirect gaps closed 2026-10-08.** The heartbeat admitted staff
  roles only, so mechanic/driver web sessions 403'd on every heartbeat
  (`last_seen_at` never slid → idle-logout while active); both roles are now
  admitted (`route.roles.test.js` pins the list — the endpoint only
  reads/slides the caller's own session row). Post-login and denied-route
  redirects also knew only the driver home, so a mechanic landed on
  staff-only `/dashboard` (restricted panel + bounce to the same page);
  `role-guard.js` and `return-to.js` now route mechanics to `/mechanic`,
  mirroring the driver precedent (pinned in `return-to.test.js`).
- **Per-role transition maps (Task 3 + human rulings C1–C3).** Mechanic:
  `Scheduled → In Progress → Pending Inspection` only (no completion, no
  skips). Staff: `Scheduled → In Progress/Cancelled/Completed`,
  `In Progress → Pending Inspection/Completed`,
  `Pending Inspection → Completed/In Progress`; `Completed`/`Cancelled` carry
  empty edge lists. Rulings: staff keep the direct `Scheduled → Completed`
  edge for externally-completed work (Test 7 pins it); `Completed` and
  `Cancelled` rows are full-row frozen — any PUT without `deleted_at` 409s
  and only a staff archive passes (amended Test 6 + Test 23 pin it, including
  the `""` bypass); `Cancelled` is terminal like `Completed`.
- **Return-for-rework loop.** `Pending Inspection → In Progress` is a
  rejection and requires a non-empty `rejection_reason` (400 otherwise); the
  assignee is paged ("Maintenance Returned for Rework").
- **Stamps.** Staff assigning `assigned_mechanic_id` get `assigned_at = NOW()`
  (client values stripped); `Scheduled → In Progress` sets `repair_started_at`
  once (never overwritten); entering `Pending Inspection` stamps
  `repair_completed_by/at` — the four-eyes key (the completer cannot approve
  their own work: 403).
- **Scoped reads (Task 4, corrected 2026-10-07).** Mechanic list/counts carry
  `AND vm.assigned_mechanic_id = $n` (paginated and non-paginated, lean
  projection + own id; staff SQL byte-identical); the problem queue gains an
  `EXISTS` on the linked live WO (a problem with no live linked order is
  invisible to a mechanic); `/api/incidents` gains the same linked-WO EXISTS
  for mechanic; `/api/ai/predictive-maintenance` filters to assigned vehicles
  for mechanic; `GET /api/mechanic/summary` serves counts +
  ordered queue (`upNext` = `queue[0]`, actionable Scheduled/In Progress only)
  + latest 8 notifications + `upcoming: []`. `assigned` counts actionable
  (Scheduled/In Progress/Pending Inspection) only so the Today's Line
  EmptyState gate stays honest; `overdue` includes Pending Inspection past
  `maintenance_date`. Non-mechanic → 403.
- **Single-record GET (Task 4b).** `GET /api/vehicle-maintenance/[id]`
  (mechanic 403 unless assignee; staff read-only superset; lean columns incl.
  cost + `source_inspection_id`; vehicle = plate + name only). List and
  summary projections carry the same evidence keys, so queue, up-next and
  detail agree.
- **Workshop UI (Task 6, web-only, corrected 2026-10-07).** `/mechanic` (Today's Line),
  `/mechanic/work-orders`, `/mechanic/work-orders/[id]`,
  `/mechanic/problems` (read-only, no raise button — `maintenance:create` is
  FM-only), `/mechanic/history` (Completed/Cancelled, cost display-only,
  parts rendered from `parts_replaced`, "Not recorded" only when absent).
  Hero shows Start / Mark Ready only — Approve/Complete have no
  representation; mutating actions disable below 1024px with the desktop
  reason. Detail timeline prefers `repair_completed_at` with `completed_date`
  fallback for staff-direct completions; `Cancelled` maps to milestone 0.
  Notification explicit `link` values are role-validated (`target.js`) so a
  cross-role link resolves to null instead of a guard redirect. Task 7 polish: queue rows drop `shadow-xs`, problem chips reuse
  `StatusBadge` tones, the parts dot never falls back to `labor_hours`.
- **Demo seed (Task 7).** `scripts/seed-mechanic-demo.mjs`
  (`seed:mechanic:plan/up/down`, ledger `seed:mechanic-demo` — the same
  ledger-in-`system_settings` mechanism as `seed-demo.mjs`, under a separate
  key because the phase4 ledger is already planted live): employee 134
  (`mechanic.demo@fleetops.test`, role 10) + WOs 80 (Scheduled), 81
  (In Progress, started, diagnosed), 82 (Pending Inspection,
  `repair_completed_by` = 134 with parts + labor — the four-eyes demo path),
  on vehicles 130/131/132 (DMM-4201/2/3).

**Verified.** Mechanic suites: `[id]` PUT 21/21, scoped reads 37/37,
single-record GET 41/41, copy/target 187/187, workshop UI 16/16.
`verify:auth` 296/296 (294 pre-branch: + scoped summary GET, + record GET).
Full suite: only the 7 pre-existing baseline failures (proven via `git stash`
on the clean tree each time — rate-limit LEAST regex, secrets timeout,
no-legacy-role allowlist, upload-storage regex, standby ×2,
driver-assignments 500).

## Database tables used

`vehiclemaintenance` · `vehicles` (odometer) · `notifications` · `employees` (assignee link, recipients) · `system_settings` (seed ledgers only)

## Related

[[Fleet And Vehicles]] · [[AI Advisory]] · [[Notifications]] · [[Feature Index]]

## Fleet Manager live-use remediation - 2026-10-03

Maintenance rows now derive `is_overdue` when their stored status is `Scheduled` and `maintenance_date` is before the current Asia/Manila date. The register shows an additional Overdue badge while preserving the stored Scheduled status; the API also returns a global overdue count, and the dashboards surface that count. In-progress and completed work are excluded. No maintenance record or lifecycle state is changed by the clock.

Predictive maintenance is presented as a **Vehicle Service Outlook**. Its description states that scores use service-date urgency and corrective-maintenance history and do not measure physical condition. Rows retain their calendar-only warning and now identify when a 90-day trip sample supports mileage estimates. Focused route and UI regressions pass; the reported QA-0001 row was not checked against live data.

## Passenger/cargo merge verification — 2026-10-08

The merge preserves main's mechanic workshop, assignee-scoped work orders, role and transition guards, and completion review rules. The work-order list, work-order detail and mechanic history pages now call the exported `getMaintenanceRecords` service. They no longer depend on a missing service export. `src/components/mechanic/sub-pages.test.js` renders the actual pages, captures their actual query callbacks and invokes those callbacks, so a page cannot pass merely because its query never runs.

This is automated source/component and caller verification. It does not claim an authenticated browser workshop walkthrough or a new mechanic demo seed apply. The coordinated checks and remaining release limits are recorded in [[FleetOps Passenger Cargo Review Closeout 2026-10-08]].
## Creating a mechanic account — corrected 2026-10-08

Admin and Super Admin can select **Mechanic** in Settings → Users → Add User. The picker now uses the same `canAssignRole` rule as the account API; the old page-only Admin list had omitted Mechanic. The role card explains assigned repair jobs and submission for review, with a Workshop badge. Provisioning keeps the existing temporary-password invitation workflow and mechanic's assigned-work-order permissions. See [[RBAC]] for the page/API regression evidence and live role check.

## Archive and cancellation reconsideration - 2026-10-09

Maintenance archive confirmations and both existing-record edit flows that save status `Cancelled` now use the shared five-second pre-request reconsideration. Cancellation captures the validated form snapshot; Undo returns to the current editor without writing, while expiry sends the existing update once. The warning keeps the terminal/history consequence visible. New-record creation and other maintenance status transitions are unchanged. Changed-file ESLint passed; a production build could not start because another Next build held the shared lock, and these maintenance flows were not exercised in the browser.
## Mechanic integration (P0/P1/P2) — built 2026-10-08, branch `feat/mechanic-integration`

Incident → Maintenance stays automatic (untouched). The mechanic is now the execution layer after the work order exists:

- **P0 — FM assign UI (was the only missing P0 piece).** The maintenance register + fleet maintenance dialog had no mechanic control, so auto-created WOs stayed unassigned/invisible to mechanic queries. Added staff-only Assign Mechanic select backed by new `GET /api/mechanics` (active mechanics, `maintenance:create` gate — FM lacks `accounts:read` so the users endpoint was unusable), `assigned_mechanic_id` threaded through the client service + POST allowlist with active-mechanic validation, `assigned_at` stamped server-side. Register renders both `Incident #N` and `Inspection #N` chips. Mechanic cannot assign (UI never renders, server strips). Assigned creation now uses the same notification fan-out as PUT; High/Emergency creation also alerts the assignee and maintenance staff.
- **P1 — Upcoming + labels + history.** `GET /api/mechanic/summary` now carries `source_incident_id` (was inspection-only); mechanic queue/detail/hero render display-only source chips. Upcoming is a client-side reuse of the existing predictive endpoint (already mechanic-scoped server-side to assigned vehicles), filtered to `effectiveDays <= 14` excluding unscheduled rows, rendered in the existing SideRail whisper strip (no CTAs). New `GET /api/mechanic/vehicle-history?vehicle_id=N` (fail-closed: ≥1 assigned WO on that vehicle; lean projections, no cost, LIMIT 5) feeds read-only Previous maintenance / Recent incidents / Recent inspections / Last PMS sections in the work-order detail.
- **P2 — Fuel diagnostic WO (manual, never automatic).** Reports efficiency rows with `Below baseline` + non-null estimate show an FM/admin-only `Create diagnostic work order` button → `POST /api/vehicle-maintenance` (`Inspection`, `Normal`, cost 0, dated tomorrow in Manila) with fuel reference in remarks + honesty line. This diagnostic does not ground the vehicle today; ordinary due-maintenance rules apply tomorrow, and independent grounding rules still apply. Notifies the maintenance queue via `Fuel Efficiency Diagnostic Filed`. No cron, no auto-filing, no formula change, no migration. Also fixed along the way: client service double-JSON-encoding of write bodies, and `created_by` now stamped server-side on POST.

**Verified.** 68/68 API/service tests (vehicle-maintenance POST + [id] + summary + vehicle-history + mechanics directory + fuel diagnostic builder/notifier/service) and 27/27 mechanic component + fuel-diagnostic POST tests pass on the merged tree; ESLint clean on all touched files.

### Review fixes and improvements — 2026-10-08

Both staff assignment surfaces now use a shared, correctly wired Radix picker. Loading and failed directory requests disable selection; failure offers retry, an empty directory explains that there are no active mechanics, and an unavailable current assignee remains visible rather than being cleared. An unchanged edit omits the assignment field; choosing Unassigned sends null. The fleet dialog's vehicle/type/status controls also use working native selects. Runtime role checks use the current permission matrix without the retired role alias.

Reports checks `GET /api/vehicle-maintenance/fuel-diagnostics?vehicle_ids=…` for up to ten visible vehicles under `maintenance:create`. Its lean projection returns the latest active marked Inspection per vehicle (Scheduled, In Progress or Pending Inspection), excluding deleted/closed/unmarked rows. An existing work-order number is displayed; another requires explicit confirmation. Failed checks block filing and offer retry; rapid duplicate clicks are suppressed. This is an operator safeguard, not a database uniqueness guarantee: concurrent users can deliberately file separate diagnostics.

Upcoming maintenance distinguishes loading, unavailable data and successful empty results, including when the mechanic has no actionable jobs. The existing assigned-vehicle scope, effectiveDays <= 14 threshold, exclusion of unscheduled rows and display-only strip remain intact. Staff maintenance and fuel-diagnostic alerts open `/maintenance`; mechanic alerts retain their assigned work-order destination. Notification failures are logged without undoing a successfully created work order.

Diagnostic date generation, maintenance status synchronization and availability SQL use the Manila calendar. Regression tests freeze independent literal dates at midnight/month/year boundaries. The full suite passed 4,482 tests (17 intentionally skipped), lint passed, the route-auth audit passed 318 methods and the offline migration check validated 155 files. An opt-in run passed 14 date/status/availability tests, including actual availability SQL against rollback-only PostgreSQL temporary tables copied from live column types; its clock and unrelated auth/coding gates are isolated. It does not exercise production triggers, RLS or complete dispatch. Browser checks verified selection, clearing, loading and retry in the real shared picker using synthetic data; the signed-in application walkthrough was still unverified at that review stage because the browser session had expired. The later local walkthrough and its limits are recorded below. See [[Mechanic Integration Review Fixes Plan]] for final build evidence and limitations.

### Authenticated local smoke test — 2026-10-08

The later local walkthrough verified staff assignment and its mechanic notification, mechanic access to the assigned work order, Vehicle History, Scheduled → In Progress → Pending Inspection, and the absence of mechanic completion/assignment controls. It also verified the assigned-work-order Not Found response for an order assigned to someone else, Incident #117 display, the Upcoming empty state, and the two staff assignment pickers. It did not test a second mechanic account, direct `/api/mechanics` denial (the browser blocked that URL), or simulated request failures.

The fuel report's quarter range exposed eligible Below-baseline rows. Manual filing created diagnostic #84 for DMM-4201, scheduled for 2026-10-09; after reload the open diagnostic appeared, and choosing **Keep existing** from the repeat-filing prompt created no duplicate. Work order #83 for DMM-4211 remains Pending Inspection with clearly labeled test-only diagnosis text; #84 remains Scheduled. These are test records in the connected local app and should be cancelled or otherwise cleaned up before operational use.

That walkthrough found a date-edit regression: the API serialized PostgreSQL DATE values as UTC timestamps, so Manila midnight for October 9 arrived as October 8 at 16:00Z and the edit input showed October 8. `GET /api/vehicle-maintenance` now converts the date columns back to date-only calendar strings before JSON serialization. The new regression first failed with the one-day-shifted value and now passes; the maintenance route suite passes 16/16. The full suite has not been rerun after this final correction.

### Maintenance record form cleanup — 2026-10-08

The admin maintenance record picker now uses string IDs for both its selected value and its options, so Radix can display the chosen vehicle label. Selecting a vehicle fills **Mileage at Service (km)** from that vehicle's saved `vehicles.mileage`; staff can adjust it if the odometer reading at service differs. The Fleet Maintenance dialog uses the same selection and mileage behavior, and shows the mileage field before a work order is completed.

Removed Service Provider and Service Center from the admin form and detail view, and Service Provider from the Fleet dialog and register. The feature regression tests passed (7/7), the maintenance component suite passed (14/14), and ESLint passed on all touched UI, helper, and test files. A local browser check confirmed the selected vehicle remained visible and its saved mileage appeared; the form was not submitted, so no maintenance record was created or changed.

### Provider columns dropped — 2026-10-13

Follow-up: the columns are now fully deleted, not just hidden. Migration `163_drop_maintenance_provider_columns` drops `vehiclemaintenance.service_provider` and `service_center`; the POST/PUT allowlists and validation schemas reject those keys, the lean/single-record projections and sortable map no longer select them, register search matches plate/type/description instead, the mechanic `MECHANIC_WRITABLE` set and client body builder dropped the four provider aliases, the reports workbook lost the Provider/Service-center columns (SELECT updated in `operational-reports.js`), and all three seed writers stopped inserting them. The register's "no provider text" regression test (legacy "Old garage" row stays invisible) still passes. Migration file validated by `db:check` (162 files); **not yet applied** — `db:up` also has pending cargo migrations 158–161, so apply + `db:dump` together when ready.

### Maintenance records show the repair performer — 2026-10-08

The admin maintenance registry and Fleet Maintenance register now show a **Mechanic** column from the employee name joined to `vehiclemaintenance.repair_completed_by`. The detail view labels this **Performed By**, separately from **Assigned Mechanic**. `repair_completed_by` is stamped when work enters Pending Inspection, so it records who did the work; assignment, `created_by`, and old provider text are not used as substitutes. Rows with no performer stamp show **Not recorded**. No existing records were backfilled, and no schema change was made; the read projection adds only the display name.

The maintenance route and register regression tests pass (23/23), and ESLint passes on all touched code. The full run reported 4,486 passed and 17 skipped; its sole failure was a Git-history security test blocked by the host's Git text-conversion helper, and that test file passed 44/44 with the system Git config disabled for the test process. Production build verification remains blocked by Windows filesystem errors in generated `.next` output: Turbopack cannot create a junction, and the Webpack fallback gets `EPERM` creating a route directory.

### Mechanic workspace UI redesign — 2026-10-09

My Line now uses one filterable assigned-work-order queue with a selected vehicle snapshot. The snapshot shows `vehicles.image_url` when available and a labeled fallback when it is missing or fails; on phones it follows the queue, while wider screens show it beside the queue. My Work Orders shares the responsive queue, and the Problem Queue and History pages use compact layouts that avoid wide-table scrolling.

Work-order details load one mechanic-assigned record, prefill saved diagnosis, parts, labor, and handover notes, and show which core repair evidence is recorded. Mechanics can update evidence and use the existing status actions on phones, tablets, and desktop. Vehicle history omits the open work order. The existing mechanic field whitelist, assignment checks, status transitions, and database schema are unchanged. The repair evidence API serializes the validated parts array as JSON text for PostgreSQL JSONB.

Focused ESLint passed for the nine changed mechanic source files, and `git diff --check` passed. Automated tests were not run. An authenticated visual review could not be completed: the isolated local preview redirects `/mechanic` to `/login`, and no account credentials were used. See `docs/superpowers/specs/2026-10-09-mechanic-role-module-ui-redesign.md` and `docs/superpowers/plans/2026-10-09-mechanic-role-module-ui-redesign.md`.

The work-order summary now shows Job type, Scheduled, Odometer at service, and Priority as four equal 2×2 tiles. On desktop, two independent columns place work details above vehicle history and repair timeline above findings/evidence, so a tall history panel does not leave a large gap above the evidence form. Phone and tablet views stack the panels. A missing odometer remains visible as a dash. Focused ESLint and `git diff --check` passed; no workflow or permission behavior changed.

The work-order loading state now uses the same Card components, two-column stacks, 2×2 work-detail tiles, timeline and evidence-form structure as the loaded page. Its vehicle-history placeholder follows the same section and row structure as the real history card, avoiding a generic layout that shifts when the work order loads. Focused ESLint and `git diff --check` passed; automated tests were not run. Authenticated visual review remains unavailable because the local preview redirects to login.

Queue rows on both My Line and My Work Orders no longer show issue/description text, keeping the list focused on the vehicle, job type, status, timing, and action. The issue remains available in the vehicle snapshot and work-order details. Focused ESLint and `git diff --check` passed.

The mechanic workspace sidebar now contains only My Line and workshop tasks; the separate Account group and Profile link were removed to keep the navigation focused on repair work. Other roles and the account menu are unchanged. Focused ESLint and `git diff --check` passed.

## Predictive maintenance implementation started - 2026-10-24

The owner approved the practical capstone direction and per-task commits in the isolated codex/predictive-maintenance worktree. See [[Predictive Maintenance Implementation Progress 2026-10-23]] and docs/superpowers/plans/2026-10-23-predictive-maintenance.md. The focused baseline passed 82 tests; implementation is pending and no behavior change is claimed.

## Predictive due-status correction - 2026-10-24

The service outlook now distinguishes an observed threshold from a forecast. A recorded odometer above the configured service mileage is overdue even with zero recent trips or a future calendar date; reaching the threshold is due. A one-kilometre overrun cannot round to zero days. When the usage rate is unavailable, the result retains the observed overdue kilometres and leaves the day estimate empty. A missing odometer stays null, and a configured mileage threshold with no reading or usable trip rate is marked needs data rather than healthy or unscheduled. The response retains the existing risk bands and adds serviceStatus, dataIssues, mileageOverdue, and a needsData fleet count. No schedule means both date and mileage thresholds are absent.

The predictive and AI overview badges show the observed kilometres or missing reading without a fabricated day or zero-kilometre value. The mechanic upcoming strip includes observed mileage overdue without inventing a day count. This is a service-due assessment, not a roadworthiness judgment or a claim that a scheduled work order is completed. Focused prediction, rule-engine, predictive-page and mechanic tests passed (94 tests across four files), including new red-to-green regressions. No database, migration, or work-order data changed.


## Atomic work-order completion and routine schedules - 2026-10-24

Approving a work order now commits the completion row, required audit, vehicle status and qualifying routine schedule together. A failed status, schedule or audit write rolls the request back. Notifications remain best-effort after commit. POST still forces new work to `Scheduled`, removes completion dates and identity stamps, and synchronizes its vehicle before creation commits.

Only completed `Routine` work advances the legacy routine schedule. Corrective, Inspection, emergency and fuel diagnostic work does not reset it. On approval, a supplied actual completion day is validated; if omitted or blank, the server stamps today's Manila calendar day. The planned maintenance date is never used as evidence of completed service. Missing mileage at service stays unknown, even if the vehicle's current mileage is known; existing non-null schedule values remain subject to the forward-only clamp.

PUT locks both old and new vehicle rows in increasing ID order before changing the work order or reading remaining active work, then synchronizes both on reassignment. The helper uses only the supplied transaction connection. Existing callers without a connection receive an internal transaction. Status precedence remains: decommissioned stays unchanged; an open Major/Critical incident or active/due work grounds the vehicle; a live trip is In Use; registration expired before today grounds it; otherwise it is Available. Registration and due-work comparisons use Manila calendar days. Existing mechanic ownership, state transitions, terminal freeze, role approval and separation-of-duties rules remain covered.

Live preflight found the database status check omitted `Registration Expired` despite migration 014 and existing consumers. After verifying version 167 was unspent, migration `167_restore_registration_expired_status.sql` added that value while retaining every accepted status. It was applied with the migration runner and `schema.sql` was regenerated. The live constraint and five actual status/schedule read-query shapes were verified; existing dispatch, trip-start, status labels and availability rules already recognize that status.

Verification: red-to-green regressions exposed 24 failures before implementation. The focused API/schedule/status run passed 96 tests; rollback-only PostgreSQL route/helper fixtures passed 14 cases using connection-local temporary tables and the actual live status constraint. No operating row or application sequence was changed for tests. The fixture covers completion rollback, actual completion day, Routine versus unrelated work, missing mileage, reassignment, remaining repairs/incidents, due-work dates, registration expiry and POST. Strict touched lint, migration filename checks, encoding and whitespace gates passed. Ledger: 167 applied, zero pending/changed. Database contract: 89 classified relations, zero violations. Anon probe: zero exposed, 41 refused, 48 inconclusive empty results resolved by the live contract; empty results alone are not treated as a pass. These checks do not claim production-trigger/RLS execution in temporary tables or an authenticated browser walkthrough.


Task 2 review follow-up: supplied completion dates and status-aware maintenance-date validation now compare against the Manila calendar too. A UTC-server regression reproduced rejection of Manila today shortly after Manila midnight; matching tests cover the previous day, tomorrow and New Year. The initial helper run failed two cases, then the complete-form maintenance-date check exposed the same boundary once more. After both fixes, the focused validation and PUT suites passed 63 tests across three files; strict touched lint, encoding and whitespace checks passed. The original 110-case task run remains the integration evidence before this validation-only fix. Existing expected 403 denial messages are test stderr, not authorization failures.


## Independent service plans and dated odometer evidence - 2026-10-24

Migration 168 adds private per-vehicle plans for exactly `routine`, `brakes` and `tires`. A plan requires a positive interval or an explicit due threshold; thresholds without an interval are returned as `schedule_mode: manual`. No manufacturer intervals are supplied. Ten usable existing Routine schedules were imported, retaining known dates and thresholds; no brake/tire plans, mileage history, work-order links or odometer observations were backfilled. The live Routine plan/vehicle comparison found zero mismatches.

`GET /api/maintenance/service-plans` requires maintenance read permission; mechanics see only vehicles with a non-deleted work order assigned to them. `PUT` additionally requires maintenance update permission and the explicit admin/super_admin/fleet_manager guard. Use `expected_version: 0` to create a vehicle/service pair and its current version to edit it. Stale versions and plans with an active linked order return 409. Configuration and required audit share a transaction. Deferral records a review day and a required reason without changing the due facts.

Existing vehicle create/edit forms keep their schedule fields, but schedule writes require the same staff configuration permissions and pass through the shared plan service inside the vehicle transaction. Routine legacy fields remain synchronized for current dispatch/advisory readers. Qualifying Routine completions update the authoritative Routine plan, increment its version and mirror legacy columns using the completion transaction; other unlinked work does not reset it. Actual completion day and unknown service mileage remain distinct from planned dates and current odometer. The forward-only due-threshold clamp is retained. Nullable work-order plan/version columns, same-vehicle foreign key, paired linkage/version check and active-order uniqueness prepare the later linked-order task; this task does not add creation of linked work orders.

`POST /api/vehicles/[id]/odometer` requires vehicles update permission. It records reading_km, timezone-bearing observed_at, server recorded_at, recorded_by and a reason, then updates the locked vehicle odometer in the same required-audit transaction. The accepted range is 0..2,000,000 km; future observations and readings below the current odometer are rejected. These are manual observations, not photo verification. No decreasing correction or bulk backfill flow is added.

Verification: observed 22 initial service/catalog behavioral failures and nine route/completion failures before implementation; a live pre-migration assertion confirmed the two tables were absent. After integration, 170 focused tests passed across 14 files, including 22 rollback-only PostgreSQL cases, authorization, completion rollback, independent cycles, stale/active conflicts, constraints and schema classification. Strict touched lint, route-auth audit (342 guarded methods), UTF-8, migration and whitespace gates passed. Migration ledger: 168 applied, zero pending/changed. Live catalog verified constraints, same-vehicle linkage, active partial unique index, zero policies and no anon/authenticated grants on the new tables. Database contract: 91 classified relations, zero violations. Anon probe: zero exposed, 43 explicit refusals, 48 inconclusive empty responses resolved by the catalog; both new tables returned explicit 42501. Temporary fixture writes use connection-local tables inside rollback and do not touch operating rows/sequences. Browser/UI walkthrough and production build were not run for these API/schema changes.


Task 3 review follow-up: Routine kilometre intervals now explicitly require a whole number within the legacy integer range; plan numbers outside numeric(12,2) storage bounds are rejected before SQL. The PostgreSQL fixture now uses the real legacy integer type. That exposed an additional real boundary: pg returns plan numerics as strings such as `5000.00`, so the mirror converts the validated Routine interval to a number before sending it to the integer column. Two new unit cases failed before the fix; the corrected SQL fixture then exposed six decimal-string failures, all resolved by the conversion. Focused service/catalog/schedule plus live PostgreSQL verification passed 50 tests across three files; strict touched lint and whitespace checks passed.


## Measured usage and per-service forecast evidence - 2026-10-24

The predictive endpoint now reads independent service plans and returns `services[]` for Routine, brakes and tires when configured. Every plan uses the same pure threshold engine. The vehicle summary retains its existing fields and takes the most urgent known plan; missing-data plans remain visible and count toward `summary.needsData` even when another plan is overdue. Deferral dates/reasons are reported without moving the underlying due facts. Date-only plans work without an odometer or usage forecast. Due status still does not assess roadworthiness or establish completed work.

Usage includes only positive, finite supported actual distance: the completion writer's `actual_distance_km` with `odometer`, `trip-distance` (validated reported completion distance), or `gps-trail` provenance. Odometer provenance must agree with a valid 0..2,000,000 km start/end pair. A legacy trip with no actual-distance provenance can qualify through that valid pair; its unproven `distance` field alone cannot qualify. Planned/estimated-only, missing, negative, implausible, future, archived, unstarted and reversed-time samples are excluded from qualifying distance. Total completed trips still include evidence gaps, so exclusion cannot quietly improve quality.

The documented sufficiency rule requires at least five qualifying completed trips, complete qualifying-distance coverage of the included completed trips, positive distance, and at least seven observed calendar days within the trailing 90-day window. The period starts at the earliest included trip's known start (or completion for a missing start), clipped to the window, and ends at the single assessment clock; it includes idle days. Trips spanning the window boundary remain a coverage gap instead of assigning their entire distance to the window. Incomplete distance is never imputed. A limited sample leaves `kmPerDay`/mileage point timing unavailable while calendar and observed due/overdue facts remain usable. The compatibility `confidence: high/low` field means evidence sufficiency only, not a calibrated probability.

Vehicle and service evidence reports valid/total sample counts, qualifying kilometres, period start/end/calendar days, usage rate and the sufficiency rule. Current-odometer time is attributable only to matching stored manual observations or trip readings. Committed matching photo captures report their commit time and `trip_odometer_photo`; legacy readings report `trip_odometer`; manual observations report `manual_observation` and are never photo-verified. A missing attributable timestamp/source stays null with `unknown_odometer_time`; `vehicles.updated_at` is never odometer evidence. Invalid current readings remain null. Existing legacy engine callers without plan projections retain their Routine-shaped inputs; callers without measured counts/period now conservatively receive no usage forecast.

Verification: eight initial pure-engine failures and six endpoint SQL failures were observed before the corresponding implementation. Self-review added two failing regressions for large valid plan thresholds and matching sample/calendar periods, then corrected both. Focused pure-engine, API, advisory, predictive page, mechanic and dispatch tests passed; rollback-only PostgreSQL fixtures exercise the actual query plus staff/mechanic read-only calls against the live schema. Strict touched lint, UTF-8 and whitespace checks passed. No migration, operating-data mutation, UI change, work-order linkage or snapshot was added. Browser walkthrough and production build were not run for this read-only API/engine task.

## Reviewed service plans and work-order links - 2026-10-24

Staff can file a reviewed plan order through the existing maintenance POST using vehicle_id, service_plan_id and the plan's current expected_version. The server locks the vehicle, plan and existing order in that order, checks the current version and computes the service evidence again through the transaction connection. Browser forecast claims and service_plan_version are never used as authority. A repeated active-cycle request returns its existing order (200 rather than a new 201), with no new audit or notification. Separate tasks may have separate orders; cancelled, completed or archived orders release the active slot. Migration 168 already provides the same-vehicle link, paired plan/version and active unique index, so no migration was added.

Every service outlook now carries active_work_order (or null); the vehicle summary identifies primary_service_plan_id. A mechanic receives active-order links only for orders assigned to them. Scheduling retains the factual due/overdue status, including a deferred plan; defer_reason is exposed as deferral_reason without moving thresholds. The existing Fleet scheduling button seeds the summarized task and current version into its current review dialog, labels that service, and locks its vehicle/type controls. Generic manual work remains available. New presentation of all tasks belongs to the later workspace task.

A work order's linked task, vehicle and cycle are immutable from creation. Cancel/archive and review a new order to change them. Approval advances only the linked plan and writes a required plan-completion audit in the same transaction as the work order, vehicle status, existing completion audit and Routine-only legacy mirror. A brake completion cannot reset Routine service even if the supplied generic type was Routine. A changed plan version invalidates approval and rolls back all writes. Rejection, cancellation and archive do not advance service history. Mechanic ownership, state transitions, staff approval, separation of duties and terminal freeze remain in force. PUT first discovers identity without a lock, locks vehicle(s), plan, then order, and rejects an identity change during that wait. This also covers approval that changes an unlinked order's vehicle or type to Routine.

Verification: initial creation/client regressions showed 11 failures; SQL/form regressions showed two further missing behaviors. Self-review observed and fixed the resulting Routine-plan lock edge case, summary task identity and mechanic link disclosure. The affected 12-file run passed 186 tests with one outdated exact-shape assertion; after adding the documented primary identity to that assertion, the entire 59-case engine file passed. The final code therefore has passing evidence for all 187 affected cases, including 29 PostgreSQL TEMP-fixture cases. Strict touched lint, UTF-8 and whitespace gates passed. TEMP SQL checks use rollback, same-vehicle FK and a unique-index predicate read from the live catalog; staff/mechanic outlook queries also run read-only against live. No operating rows/sequences changed. Parallel request tests use a serialized transaction model and do not claim a real multi-connection race. Browser/device acceptance, production build and full repository suite were not run. No lifecycle snapshot persistence was added; Task 6 consumes the transaction-local reviewedService hand-off after insertion and before commit.

Task 5 review fix round 1: replay recovery now also requires a newly created order before sending a fuel-diagnostic queue notice. A request carrying fuel diagnostic metadata can recover an existing ordinary plan order without adding a notification or audit entry. A focused regression first reproduced one false fuel notifier call; after the guard, all 38 cases across reviewed-plan, fuel-diagnostic and existing POST suites passed. Added coverage uses the real completion helper through the route with an in-memory transaction fixture: approval advances the linked plan from version 3 to 4, the stale version returns 409, and version 4 creates a different Scheduled order. Strict touched lint, UTF-8 and whitespace checks passed. No additional database or UI change was made; scoped independent re-review follows the fix commit.

## Predictive maintenance Task 6 - inspection signals and outcome evidence (2026-10-24)

The outlook adds signals[] per vehicle. recurring_inspection means the same canonical FAIL on at least two distinct inspections in the current 30 Manila calendar days after that item's latest explicitly confirmed approved repair. It includes checklist_item_id, count, dates, inspection_ids, source links, rule_version, review_disposition (needs_review/work_order_active) and active_work_order. brakes_tires stays combined; no diagnosis or probability is inferred. Post-Shift free text is outside this rule.

Work orders store server-owned inspection_items: [{checklist_item_id, inspection_ids}]. The existing inspection work-order route accepts optional ?checklist_item_id for item review. The existing inspection lock plus a vehicle lock serializes active reuse across newer sources. Generic original orders retain ALL original failed items; later sources attach only to their actual selected item. Partial overlap requires individual item review. Original source_inspection_id uniqueness/retry recovery remains. Source orders cannot move vehicles.

Assigned mechanics record inspection_outcomes: [{checklist_item_id,outcome,evidence}] through existing findings controls/PUT. Outcomes are confirmed (confirmed and repaired), not_confirmed, or inconclusive; evidence is required. Server actor/time and actual linked source IDs replace caller stamps. Partial item edits preserve other outcomes; terminal outcomes freeze. Generic legacy identity is derived from its original checklist, never repair-type text. Existing staff approval/separation of duties remains. Approved confirmation resets only that item's repair cutoff. Approved not_confirmed retires exactly its reviewed source IDs without inventing a repair. Inconclusive stays unresolved. Generic completion and unrelated repair do not clear an item. Archiving completed work preserves its approved disposition.

Migration169 adds private maintenance_forecast_snapshots with rule_version, database capture time/actor, inputs, forecast, outcome and plan/order references. UPDATE/DELETE are refused by a trigger; RLS is on and anon/authenticated table/sequence grants are revoked. Snapshots share scheduling, explicit inspection review, findings, completion and manual odometer transactions. Schedule recovery writes no duplicate snapshot. GET computes/reads only. A manual reading can establish a first observed threshold interval for active reviewed work; readings older than the forecast cannot count prospectively. Early service is separate; missing crossings stay unobserved. prediction_error_days remains null; exact crossing time/accuracy is never invented. Other odometer writers remain unobserved.

Verification: meaningful red tests preceded recurrence, source reuse, prospective crossing, source dismissal/archive behavior, route snapshots, assigned outcomes, older active-source handling, source-vehicle identity and mixed-threshold fixes. Actual PostgreSQL TEMP fixtures cover rollback, live catalog, immutable trigger, scoped reads and staff/mechanic queries. Migration169 applied/dumped; db:contract zero violations; anon probe zero exposed,44 refused/48 inconclusive resolved by the live contract. Final amended evidence/outlook SQL18/18 passed; focused consumer and covering tests passed as detailed in task-6-report.md. Strict touched lint and Impeccable detector passed. No operating rows/application sequences were used for tests. Browser/device acceptance, real multi-connection races, full build and whole-repository suite remain unverified.

Task6 review fix round1: new explicitly targeted source orders now own only the selected item, while existing legacy generic originals retain all original items. Subsequent different-item requests honestly reuse/expand the active source-unique order after active item reuse checks. This prevents mixed-report duplicate active work. Findings forms submit only edited checklist keys; API also preserves unchanged replay source IDs, actor and timestamp, including stale clients. A materially changed item outcome reviews its current linked sources; identical evidence does not silently re-review newly attached reports. Three regressions reproduced the two review findings plus stale API expansion before correction. Covering four-file run66/66passed; strict scoped lint passed. Scoped independent re-review approved spec compliance and task quality; both original Important findings and unchanged API replay preservation are addressed, with no new Important or Critical finding. No suites were repeated for the review.


## Shared maintenance service workspace - Task 7 checkpoint (2026-10-24)

Both /maintenance/predictive and the Fleet overview now compose one service list and selected evidence panel. Plans and recurring checklist findings retain separate identities. Service timing, linked work-order progress and vehicle availability are distinct facts; no physical health score or failure probability is shown. Missing Routine/brakes/tires plans expose configuration without assumed manufacturer intervals. Narrow views open focused detail with Back to service list.

Staff reuse the extracted scheduling form and the selected service_plan_id/current expected_version. Small configuration, manual-odometer and review-deferral dialogs retain failed drafts and persistent errors, refresh authoritative query families after success, and require review after version conflict. Deferral retains original due facts. Existing staff details open via /maintenance?work_order=id; mechanic destinations preserve assigned scope. Read-only roles have no mutation controls. Fleet active work includes Pending Inspection. The compact AI preview reuses due labels and reports request errors.

Implementation verification so far: real-route red4/4 then green4/4; forms red5cases then green12/12; shared/predictive/mechanic consumers14/14; compact AI red1case then shared/AI5/5. Strict touched ESLint passed. A labeled local fixture uses real components+shared CSS with synthetic session/API boundaries. Browser observed desktop evidence, failed-save draft retention and focused narrow detail. Keyboard/date-control and fixture-theme findings are being corrected; review, final browser acceptance and final gates remain pending. No schema change, new dependency, operating-record mutation or auth bypass. Authenticated live application, full build and full repository suite remain unverified.


Task 7 verified implementation checkpoint: the shared outlook and small versioned actions are implemented. Browser fixtures verified desktop/narrow375 layouts, loading/error/retry/stale/empty states, read-only/mechanic action destinations, failed-save draft retention, mobile Review/Back focus, cancel focus restoration, dark theme, date/time Tab/Enter/Escape, historical23 enabled/future25 disabled (today24), and a scrollable date/time calendar with reachable Done. Existing scheduling date defaults remain unchanged. Browser-discovered field names and calendar navigation names were corrected with observed red-to-green tests. A final dark overdue badge issue uses the existing foreground token on danger background; primary plate codes stay on one line. Fixture lacks app font preload, and authenticated live app acceptance is still unverified (local app redirects to sign-in).

Latest covering evidence: picker/assignment13/13; observation/calendar integration10/10; date navigation6/6; server-selected primary task order regression first failed then shared/AI6/6passed. Initial twenty-file lint found two warnings (ref inference and copy apostrophe); final covering lint follows their correction. Prior implementation/form/consumer evidence above remains. UTF8/whitespace and independent spec/quality review pending. Task remains incomplete until independent review.


Task 7 review fix round 1 (2026-10-25): the existing staff work-order destination now keeps a failed detail request visible even when its independent maintenance-register request succeeds. One shared persistent alert appears on both register branches; Retry work order refreshes only the failed detail request, preserving the usable register. Two real-page behavioral regressions failed before the fix and then2/2passed; strict source/test lint passed. The final rebuilt synthetic fixture also confirmed readable dark overdue text and unbroken plate codes at1280px. Prior keyboard/mobile/error/role fixture evidence remains; authenticated app and broader device/zoom/reduced-motion acceptance remain unverified. Independent scoped re-review is pending; no API, schema or permission change.


Task 7 completed after independent fix-round1 review (2026-10-25): spec compliance APPROVED and task quality APPROVED. I1 is addressed, with no new Critical/Important issue or open finding. Reviewed source is f0272bf8 + be23a1fc + c848829d; this completion entry changes documentation only. Shared workspace, configuration/scheduling/odometer actions and all recorded fixture checks stand with the explicit authenticated/device/font/zoom/reduced-motion limits above. No passing suite was rerun for review.


## Predictive maintenance demonstration and final verification - Task 8 (2026-10-25)

Run `npm run demo:maintenance` from the repository folder. It prints an explicitly labeled synthetic demonstration and six PASS lines. It uses the installed Vitest runner and the existing real engine/service tests; no forecast logic is copied into the demonstration. The two database scenarios require the usual ignored environment file (`.env.local` or `.env`) with the app's existing DATABASE_URL and a reachable PostgreSQL connection. Credentials are read by the existing environment loader and are never placed in the command or demonstration output. With dependencies installed, no seed, server, browser sign-in or extra package is needed.

| Scenario | Synthetic evidence and expected result |
| --- | --- |
| Overdue without trips | Reading 5,001 km against a 5,000 km threshold, no trips/date: overdue by 1 km; day estimate stays unknown. |
| Supported future forecast | 9,000 measured km, 30 qualifying trips over 90 calendar days: 100 km/day; 2,000 km remaining gives 20 days, earlier than the 45-day calendar threshold. Evidence sufficiency is not a failure probability. |
| Missing inputs | Configured 5,000 km threshold with no reading: mileage and remaining kilometres stay null, status needs_data. |
| Repeated inspection finding | Two distinct canonical brakes_tires FAIL reports within 30 Manila calendar days produce one count-2 signal; a duplicate report and an out-of-window report do not inflate it. |
| Active-order reuse | Actual review SQL returns the existing linked service-plan order on repeat review; the live-derived active index rejects a duplicate, and cancelling releases the slot. |
| Isolated service completion | Approving linked brakes advances only the brake cycle, leaves Routine unchanged, writes required audits, and rejects a completed retry. |

The runner checks the structured test report for every exact case and source file. A missing, skipped, failed or duplicate matching case fails the demonstration even if the test process returned success. Connection failure also fails it. Other tests in the selected files are intentionally filtered out; they do not substitute for any required case. The database fixtures create connection-local TEMP tables and local identity sequences under pg_temp, run inside transactions, and roll back. They read the public catalog/schema where required, but do not create live fleet/work-order records or advance operating sequences.

Broader branch verification: the final full suite passed 561 files / 6,219 tests (16 files / 162 tests skipped), and focused maintenance/mechanic/inspection/dispatch compatibility passed 47 files / 544 tests. Explicitly enabled maintenance PostgreSQL fixtures passed all 48 cases across four files. These overlap the demo and are not added together. The first full run exposed a stale predictive-route query mock plus two missing installed mobile packages in the worktree; the mock now supplies separate forecast/signal rows and checks HTTP 200, and an ignored mobile dependency junction restored the existing installed packages without a package/lockfile change.

The default Next.js 16.2.11 Turbopack build cannot follow this worktree's node_modules junction outside its filesystem root. The installed CLI's documented fallback, `npm run build -- --webpack`, completed successfully and generated 249 static pages. It retains the existing unchanged geoip.js dynamic-require warning. Route auth passed 342/342 guarded methods. Migration filenames passed (169 files); live ledger 169 applied / 0 pending / 0 changed; live contract 92 classified relations / 0 violations. The anon-only probe returned 0 exposed / 44 refused / 48 inconclusive / 0 unreachable; the catalog contract resolves the 48 empty responses as protected, and an empty response alone is never called a pass.

The synthetic test demo and Task 7 browser fixtures do not establish authenticated live UI, physical device/font/zoom/reduced-motion acceptance or real multi-connection concurrency. No new migration, runtime dependency, operating-data seed, deployment, push or merge is part of Task 8. Independent Task 8 review approved both spec compliance and task quality with no Critical or Important finding. The environment-file wording was corrected against the actual loader. Final whole-branch review remains a parent-owned completion gate.


## Routine completion conflict protection - final review fix (2026-10-26)

Approving an unlinked Routine job now returns an actionable 409 when the same Routine plan has a non-archived linked job in Scheduled, In Progress or Pending Inspection. Complete or cancel that linked job before approving separate Routine work. This prevents one approval from advancing the plan version and leaving another reviewed job unable to complete. The check runs under the existing vehicle and plan locks and throws inside the approval transaction, so the whole request rolls back: work-order edits and stamps, vehicle status, plan and legacy schedule, required audits and completion snapshots.

Existing unlinked jobs remain supported. Their approval advances Routine service when no active linked Routine job remains; Completed, Cancelled and archived linked jobs do not block it. Approval checks the resulting vehicle and type, including a PUT that changes either or both to Routine. A linked brake job and unlinked corrective work remain independent. Current-version linked approval and the stale-version guard are preserved. Generic creation still permits a separate job and always normalizes a requested Completed status to Scheduled; no silent rebinding, automatic cancellation or new creation restriction was added.

Verification: the new real-handler and rollback-only PostgreSQL regressions first failed in nine conflict cases (200 instead of 409), then all 98 focused checks passed, including 60 TEMP-table cases across the four existing SQL suites. They verify active/inactive linked states, target vehicle/type changes, POST normalization, valid linked completion after rejection and whole-request rollback including snapshots. The six-case synthetic demo, strict repository lint and documented Webpack production build passed. The final full suite passed 561 files / 6,223 tests, with 16 files / 174 opt-in tests skipped; all 60 maintenance SQL cases were separately enabled in the focused run. The unchanged schema source-scan test had two transient timeout runs, then passed all 14 cases unchanged in 358ms; its exact environmental cause is unproven. No migration, dependency or operating-data write was made. Authenticated live UI and real multi-connection concurrency remain unverified.
