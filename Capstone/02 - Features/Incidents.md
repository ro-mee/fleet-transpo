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
  - src/lib/incidents/maintenance.js
  - src/lib/driver/grounding.js
  - src/app/(dashboard)/incidents/page.js
  - mobile/app/(app)/incidents.js
  - mobile/components/DriverSos.js
  - mobile/lib/sync.js
  - supabase/migrations/062_driverincidents_resolution_integrity.sql
  - supabase/migrations/083_incident_maintenance_unique.sql
  - supabase/migrations/084_incident_maintenance_state.sql
  - supabase/migrations/085_incident_maintenance_grounding.sql
  - supabase/migrations/086_incident_maintenance_grounding_backfill.sql
last_verified: 2026-08-31
---

# Feature: Incidents

## What it does

Drivers report breakdowns and emergencies from the mobile app; staff triage them in the admin registry, while qualifying vehicle incidents automatically create linked maintenance work orders and take the vehicle out of service.

## The loop — CONFIRMED 2026-08-31

1. **Report.** `POST /api/driver/incidents` from `incidents.js` (typed report) or `DriverSos.js` (SOS = type "Emergency", severity Critical). Offline submissions queue in AsyncStorage (`mobile/lib/sync.js`).
2. **Automate.** Grounding rule: breakdown/mechanical/engine/brake/tire/electrical reports automatically set the vehicle `Under Maintenance`, create one linked `Emergency Repair` work order, alert fleet/maintenance staff, and move affected dispatches to `Pending Reassignment`. Major/Critical accident reports or explicit vehicle-damage reports create a linked `Vehicle Inspection`. Passenger, route, traffic-delay, medical, and other non-vehicle reports do not create maintenance work orders.
3. **Resolve.** The incident modal requires a non-empty `actions_taken` narrative and notifies the reporting driver. Resolving an incident never completes maintenance: a linked work order keeps the vehicle `Under Maintenance` until the maintenance state machine marks it `Completed`; only then can `syncVehicleStatus` return it to `Available`.
4. **See it.** Mobile Activity Logs (`submissions.js`) shows real OPEN/RESOLVED badges and renders `actions_taken`; permanently-failed offline sends are quarantined behind an unsent-reports banner with Retry/Discard.

## Rules that were gaps before 2026-08-31

| Rule | Where | Why |
|---|---|---|
| Maintenance completion restores availability | PUT `/api/vehicle-maintenance/[id]` calls `syncVehicleStatus` after `Completed` | Resolving the incident must not release a vehicle that still needs repair |
| Resolution is documented | server-side required `actions_taken`; CHECK constrains status to Open/Resolved | Resolve-with-no-narrative was unauditable; status was free-form |
| One incident, one repair record | automatic helper + incident row lock + unique `source_incident_id` index | Retries and concurrent reports cannot duplicate the work order |
| One report, one automation run | `client_submission_id` unique partial index (`uq_driverincidents_driver_submission`) | Offline replay racing a manual resubmit duplicated reports and re-paged dispatch |
| Failed ≠ deleted | sync dead-letter (`@offline_dead_letter_incidents`) | A session expiring mid-replay silently destroyed emergency reports |
| Repairs link back to incidents | `vehiclemaintenance.source_incident_id` + `driverincidents.maintenance_id` (migrations 063, 083–086) + completion notification | Staff can open the exact work order and the driver hears when the vehicle returns |
| Resolvers see the blast radius | GET `/api/incidents/[id]` matches grounding's exact audit reason to list interrupted dispatches + linked repairs, rendered in the resolve modal | Whoever resolved had no way to verify reassignment happened |
| Claims ≠ costs | Emergency repairs book `cost = 0`; the driver-reported `expense_amount` travels in remarks as an *unverified claim* staff confirm against the invoice | An unverified number used to flow straight into fleet-cost analytics |
| Structured help requests | Mobile form sends `assistance_needed[]` chips (Tow Truck, Mechanic, Medical, Police, Alternative Vehicle, Fuel); admin registry renders them | Dispatch had to parse prose to know what help to send |

Pure decision logic lives in `src/lib/incidents/resolution.js` and `src/lib/driver/grounding.js` (18 and 11 unit tests) so the routes stay thin — same pattern as [[grounding]]. The DB dedup pattern mirrors fuel/inspection idempotency (migrations 059/060); migrations 083–086 carry it for incident maintenance.

## Known limits

- Reassigning dispatches interrupted by grounding stays manual — the resolve modal now *shows* them (and their live status), but nothing auto-reassigns.
- A failed automatic work-order or grounding attempt remains visible as a retry state; the recovery endpoint is not a general-purpose manual maintenance action.

Closed 2026-08-31: automatic maintenance gates on the incident's own vehicle
and rule-based category/severity; the mobile form offers all four severities
including Critical; repairs carry both incident/work-order links and completing
one notifies the reporting driver; expense claims are reviewed, not auto-booked;
assistance requests are structured chips.

## Manual QA checklist (needs two real sessions)

**Machine-proven 2026-08-23** by `scratch/qa_incidents_e2e.mjs` against the live
API — minted driver+staff JWTs, seeded a dispatch, 19/19 assertions, `[QA]` rows
cleaned up afterwards:

1. ✅ **Replay dedupe** — same `client_submission_id` twice → same incident, one row (S1)
2. ✅ **Grounding + interruption** — vehicle `Under Maintenance`, seeded dispatch → `Pending Reassignment`, exact audit reason, dispatcher + driver ack notifications (S2)
3. ✅ **Resolver context** — GET lists the interrupted dispatch; repairs empty before one exists (S3)
4. ✅ **Resolve loop** — 400 without narrative → 200 → 409 re-resolve; vehicle restored; reporter notified (S4)
5. ✅ **Automatic maintenance + replay guard** — qualifying reports create one cost=0 work order, carry unverified claims in remarks, and persist both incident/work-order links (S5)
6. ✅ **Completion loop** — PUT Completed → vehicle status sync + "Vehicle Repair Completed" to the reporter (S6)

Step 2's first run **failed and found [[BUG Dispatch Teardown Ungrounds Vehicle]]**
— fixed, suite green after.

Still device-only (cannot be asserted headlessly):

- **Expo push receipts** — notifications rows exist and `sendPush` was invoked;
  actual delivery to a handset is unverified.
- **AsyncStorage offline path** — the queue/dead-letter/banner flow needs a real
  device in airplane mode (steps 1–2 of the original manual list).

## Database tables used

`driverincidents` · `vehiclemaintenance` · `vehicles` · `notifications`

## Related

[[Driver Management]] · [[Maintenance]] · [[Notifications]] · [[Mobile Architecture]] · [[Feature Index]]
