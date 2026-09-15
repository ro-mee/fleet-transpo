---
type: feature
status: partial
tags: [feature, maintenance]
source:
  - src/lib/ai/predictive-maintenance.js
  - src/app/(dashboard)/fleet/maintenance
  - src/app/api/vehicle-maintenance/[id]/route.js
last_verified: 2026-09-15
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
| `vehiclemaintenance` State Machine | ✅ `Completed` is a terminal state. Strict completion audit trail (`completed_by`, `completed_at`) enforced server-side. |

## The Fleet Maintenance Dashboard

The Fleet Maintenance dashboard allows the Fleet Manager to view active repairs, historical records, and the upcoming predictive maintenance schedule. The system strictly governs the state of a maintenance record:

### State Machine & Completion Audit
A maintenance record transitions from `Scheduled` → `In Progress` → `Completed`.
* **Immutability:** Once a record reaches `Completed`, its status becomes terminal and cannot be reverted to an earlier state by any user.
* **Audit Trail:** When a record is completed (via `PUT /api/vehicle-maintenance/[id]`), the system securely injects the authenticated user's ID (`completed_by`) and the precise database timestamp (`completed_at`). The `POST` creation endpoint forces all new records to `Scheduled` to prevent audit bypass.

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
changed (terminal-state 409, role 403, inspection 400 all intact).
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

## Predictive maintenance

`predictive-maintenance.js` is one of the pure modules in `src/lib/ai/`. It scores vehicles by proximity to a service threshold (odometer-driven) and surfaces them in the advisory ranking.

**Schedule Clamp:** `recomputeVehicleSchedule()` updates a vehicle's next service date and mileage when a maintenance record is `Completed`. To prevent illegal tampering, this function uses a PostgreSQL `GREATEST()` clamp. If a user modifies an older completed maintenance record with a lower odometer reading, the clamp discards the edit and preserves the furthest advanced predictive schedule, keeping the risk scores strictly safe and forward-moving.

## Database tables used

`vehiclemaintenance` · `vehicles` (odometer) · `notifications`

## Related

[[Fleet And Vehicles]] · [[AI Advisory]] · [[Notifications]] · [[Feature Index]]
