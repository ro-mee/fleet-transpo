---
type: feature
status: partial
tags: [feature, maintenance]
source:
  - src/lib/ai/predictive-maintenance.js
  - src/app/(dashboard)/fleet/maintenance
last_verified: 2026-08-11
---

# Feature: Maintenance

## What it does

Tracks vehicle servicing and flags vehicles approaching a service threshold.

## What's real — CONFIRMED

| Piece | State |
|---|---|
| `src/lib/ai/predictive-maintenance.js` | ✅ Pure scoring module, feeds [[AI Advisory]] |
| `trigger_notify_maintenance_due` | ✅ DB trigger writes a [[Notifications]] row |
| `src/app/(dashboard)/fleet/maintenance/` | ❌ **Empty directory — no page** |
| `vehicleinspection` | ⚪ **0 rows** |

So: the *prediction* and the *notification* work; the *UI* doesn't exist and inspections have never been recorded.

## The gap

A maintenance-due notification fires and links to a page that isn't there. **TODO:** confirm whether the notification links to `/fleet/maintenance` — if so, that's a live 404 for a user.

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

## Predictive maintenance

`predictive-maintenance.js` is one of the pure modules in `src/lib/ai/`. It scores vehicles by proximity to a service threshold (odometer-driven) and surfaces them in the advisory ranking, so a vehicle nearly due for service scores lower for a long trip. Deterministic, like everything else in `src/lib/ai/`. → [[ADR-003 Deterministic AI]]

## Database tables used

`vehicleinspection` **0** · `vehicles` (odometer) · `notifications`

## Related

[[Fleet And Vehicles]] · [[AI Advisory]] · [[Notifications]] · [[Feature Index]]
