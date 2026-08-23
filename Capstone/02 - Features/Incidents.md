---
type: feature
status: working
tags: [feature, incidents, maintenance, mobile]
source:
  - src/app/api/driver/incidents/route.js
  - src/app/api/incidents/route.js
  - src/app/api/incidents/[id]/route.js
  - src/app/api/incidents/[id]/maintenance/route.js
  - src/lib/incidents/resolution.js
  - src/lib/driver/grounding.js
  - src/app/(dashboard)/incidents/page.js
  - mobile/app/(app)/incidents.js
  - mobile/components/DriverSos.js
  - mobile/lib/sync.js
  - supabase/migrations/062_driverincidents_resolution_integrity.sql
last_verified: 2026-08-23
---

# Feature: Incidents

## What it does

Drivers report breakdowns and emergencies from the mobile app; staff triage them in the admin registry, route affected vehicles to emergency repairs, and resolve reports back to the driver.

## The loop — CONFIRMED 2026-08-23

1. **Report.** `POST /api/driver/incidents` from `incidents.js` (typed report) or `DriverSos.js` (SOS = type "Emergency", severity Critical). Offline submissions queue in AsyncStorage (`mobile/lib/sync.js`).
2. **Automate.** Grounding rule ([[BUG shouldGroundVehicle Is A Stub]] for its history): breakdown-type **or** Major/Critical → vehicle `Under Maintenance`, dispatchers alerted, active dispatches → `Pending Reassignment`. Non-grounded reports page oversight instead.
3. **Resolve.** Two admin paths in `(dashboard)/incidents/page.js`, both closing the loop:
   - **Resolve** modal — requires a non-empty `actions_taken` narrative; on Open→Resolved the server restores availability via `syncVehicleStatus` and notifies the reporting driver.
   - **Send to Maintenance** — `POST /api/incidents/[id]/maintenance`: one transaction inserts the Emergency Repair record **and** resolves the incident, then syncs vehicle status + notifies the driver. Replays hit an explicit 409.
4. **See it.** Mobile Activity Logs (`submissions.js`) shows real OPEN/RESOLVED badges and renders `actions_taken`; permanently-failed offline sends are quarantined behind an unsent-reports banner with Retry/Discard.

## Rules that were gaps before 2026-08-23

| Rule | Where | Why |
|---|---|---|
| Resolving restores availability | PATCH `/api/incidents/[id]` calls `syncVehicleStatus` | Plain Resolve used to strand grounded vehicles `Under Maintenance` forever |
| Resolution is documented | server-side required `actions_taken`; CHECK constrains status to Open/Resolved | Resolve-with-no-narrative was unauditable; status was free-form |
| One incident, one repair record | atomic endpoint + `FOR UPDATE` lock | Client-side two-call chain could orphan/duplicate emergency repairs |
| One report, one automation run | `client_submission_id` unique partial index (`uq_driverincidents_driver_submission`) | Offline replay racing a manual resubmit duplicated reports and re-paged dispatch |
| Failed ≠ deleted | sync dead-letter (`@offline_dead_letter_incidents`) | A session expiring mid-replay silently destroyed emergency reports |

Pure decision logic lives in `src/lib/incidents/resolution.js` (14 unit tests) so the routes stay thin — same pattern as [[grounding]]. The DB dedup pattern mirrors fuel/inspection idempotency (migrations 059/060); migration 062 carries it for incidents.

## Known limits

- No linkage column between `vehiclemaintenance` and the originating incident — only free text ("generated from Incident #N").
- Reassigning dispatches interrupted by grounding stays manual; resolving an incident says nothing about them.

Closed 2026-08-23 (later the same day): the maintenance action now gates on
`reported_vehicle_id` — the vehicle the incident itself names — instead of the
list's COALESCE fallback to the driver's *current* assignment; and the mobile
form offers all four severities including Critical.

## Database tables used

`driverincidents` (8 rows) · `vehiclemaintenance` · `vehicles` · `notifications`

## Related

[[Driver Management]] · [[Maintenance]] · [[Notifications]] · [[Mobile Architecture]] · [[Feature Index]]
