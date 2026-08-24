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
| Repairs link back to incidents | `vehiclemaintenance.source_incident_id` (migration 063, backfilled from the free-text prefix) + completion notifies the reporter | The only connection used to be description text; nobody could query it or hear that the work finished |
| Resolvers see the blast radius | GET `/api/incidents/[id]` matches grounding's exact audit reason to list interrupted dispatches + linked repairs, rendered in the resolve modal | Whoever resolved had no way to verify reassignment happened |
| Claims ≠ costs | Emergency repairs book `cost = 0`; the driver-reported `expense_amount` travels in remarks as an *unverified claim* staff confirm against the invoice | An unverified number used to flow straight into fleet-cost analytics |
| Structured help requests | Mobile form sends `assistance_needed[]` chips (Tow Truck, Mechanic, Medical, Police, Alternative Vehicle, Fuel); admin registry renders them | Dispatch had to parse prose to know what help to send |

Pure decision logic lives in `src/lib/incidents/resolution.js` (14 unit tests) so the routes stay thin — same pattern as [[grounding]]. The DB dedup pattern mirrors fuel/inspection idempotency (migrations 059/060); migration 062 carries it for incidents.

## Known limits

- Reassigning dispatches interrupted by grounding stays manual — the resolve modal now *shows* them (and their live status), but nothing auto-reassigns.

Closed 2026-08-23: the maintenance action gates on `reported_vehicle_id` — the
vehicle the incident itself names — instead of the list's COALESCE fallback; the
mobile form offers all four severities including Critical; repairs carry
`source_incident_id` and completing one notifies the reporting driver; expense
claims are reviewed, not auto-booked; assistance requests are structured chips.

## Manual QA checklist (needs two real sessions)

**Machine-proven 2026-08-23** by `scratch/qa_incidents_e2e.mjs` against the live
API — minted driver+staff JWTs, seeded a dispatch, 19/19 assertions, `[QA]` rows
cleaned up afterwards:

1. ✅ **Replay dedupe** — same `client_submission_id` twice → same incident, one row (S1)
2. ✅ **Grounding + interruption** — vehicle `Under Maintenance`, seeded dispatch → `Pending Reassignment`, exact audit reason, dispatcher + driver ack notifications (S2)
3. ✅ **Resolver context** — GET lists the interrupted dispatch; repairs empty before one exists (S3)
4. ✅ **Resolve loop** — 400 without narrative → 200 → 409 re-resolve; vehicle restored; reporter notified (S4)
5. ✅ **Atomic maintenance + replay guard** — cost=0, unverified claim in remarks, `source_incident_id` set; second POST → 409 (S5)
6. ✅ **Completion loop** — PUT Completed → "Vehicle Repair Completed" to the reporter (S6)

Step 2's first run **failed and found [[BUG Dispatch Teardown Ungrounds Vehicle]]**
— fixed, suite green after.

Still device-only (cannot be asserted headlessly):

- **Expo push receipts** — notifications rows exist and `sendPush` was invoked;
  actual delivery to a handset is unverified.
- **AsyncStorage offline path** — the queue/dead-letter/banner flow needs a real
  device in airplane mode (steps 1–2 of the original manual list).

## Database tables used

`driverincidents` (8 rows) · `vehiclemaintenance` · `vehicles` · `notifications`

## Related

[[Driver Management]] · [[Maintenance]] · [[Notifications]] · [[Mobile Architecture]] · [[Feature Index]]
