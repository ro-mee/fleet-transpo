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
  - mobile/app/(app)/incident/[id].js
  - mobile/components/DriverSos.js
  - mobile/lib/sync.js
  - mobile/lib/notifications/navigation.js
  - src/lib/incidents/sla.js
  - src/app/api/incidents/[id]/acknowledge/route.js
  - src/app/api/incidents/[id]/response/route.js
  - src/app/api/incidents/[id]/responder/route.js
  - src/app/api/driver/incidents/[id]/location/route.js
  - src/app/api/driver/incidents/[id]/confirm-resolution/route.js
  - src/app/api/driver/incidents/[id]/reopen/route.js
  - src/app/api/driver/incidents/[id]/resolve/route.js
  - src/app/api/driver/responder/resolve/route.js
  - src/lib/incidents/field-resolution.js
  - src/app/api/driver/responder/location/route.js
  - src/app/api/driver/responder/arrived/route.js
  - src/lib/incidents/responder-tracking.js
  - mobile/lib/tracking.js
  - src/components/maps/incident-map.jsx
  - supabase/migrations/062_driverincidents_resolution_integrity.sql
  - supabase/migrations/083_incident_maintenance_unique.sql
  - supabase/migrations/084_incident_maintenance_state.sql
  - supabase/migrations/085_incident_maintenance_grounding.sql
  - supabase/migrations/086_incident_maintenance_grounding_backfill.sql
  - supabase/migrations/101_incident_response_tracking.sql
  - supabase/migrations/102_incident_responder_tracking.sql
last_verified: 2026-09-04
---

# Feature: Incidents

## What it does

Drivers report breakdowns and emergencies from the mobile app; staff triage them in the admin registry, while qualifying vehicle incidents automatically create linked maintenance work orders and take the vehicle out of service.

## The loop — CONFIRMED 2026-08-31, strengthened 2026-09-04 (visibility, notes, SLA), physical-response loop added 2026-09-04, responder GPS automation + field resolution added 2026-09-04

Steps 3, 7, and 8 below landed 2026-09-04 in the first pass (driver status
visibility, acknowledge response note, SLA overdue + escalation) with **no schema
changes** — the note rides the existing `incident_comments` table. The 099 pg_cron
SLA job was verified live on 2026-09-04 (running every minute), but the overdue UI
and escalation compute `due_at < NOW()` dynamically anyway rather than trusting
`overdue_at`.

Steps 4 and 5 (physical rescue tracking + soft confirmation close) landed the same
day as migration **101** (`response_*`, `driver_confirmed_at`, `reopened_at`
columns on `driverincidents`): the system previously tracked the *paperwork*
lifecycle (filed → acknowledged → closed) but not the *physical* one — "an
ambulance is coming, ETA 20 minutes" was prose in an acknowledge note, and the
driver's position froze at report time because GPS only posted during active
trips. Resolution was also staff-declared and one-way (`canTransition` forbids
Resolved→Open), so a premature resolve left the driver one option: a
disconnected duplicate report.

1. **Report.** `POST /api/driver/incidents` from `incidents.js` (typed report) or `DriverSos.js` (SOS = type "Emergency", severity Critical). Offline submissions queue in AsyncStorage (`mobile/lib/sync.js`). SOS `location` is a reverse-geocoded place name (`expo-location` `reverseGeocodeAsync`, falls back to `"lat,lng"` text) — never a Google Maps URL; the web's exact-location link is built from the `latitude`/`longitude` columns, which `resolveIncidentCoords` prefers anyway. SOS now also sends `assistance_needed: ["Medical Assistance"]`, and any report whose chips include Medical Assistance sets the previously-dead `medical_assistance_required` column (triage can filter on it instead of parsing prose).
2. **Automate.** Grounding rule: breakdown/mechanical/engine/brake/tire/electrical reports automatically set the vehicle `Under Maintenance`, create one linked `Emergency Repair` work order, alert fleet/maintenance staff, and move affected dispatches to `Pending Reassignment`. Major/Critical accident reports or explicit vehicle-damage reports create a linked `Vehicle Inspection`. Passenger, route, traffic-delay, medical, and other non-vehicle reports do not create maintenance work orders.
3. **Acknowledge with a response note.** POST `/api/incidents/[id]/acknowledge` takes an optional `note` (≤500 chars) — stored as an `incident_comments` row (`action_type='ACKNOWLEDGED'`, no schema change), appended to the driver's push/notification, and shown read-only in the web modal afterwards. This is the ops→driver "help is on the way" signal: *what* is being done, not just *that* it was seen. The latest `ACKNOWLEDGED` comment is exposed as `acknowledge_note` by GET `/api/incidents/[id]` and GET `/api/driver/incidents` (LEFT JOIN LATERAL).
4. **Dispatch the rescue — tracked.** POST `/api/incidents/[id]/response` (permission `incidents/acknowledge`) logs the physical response on the incident row itself (same lifecycle-column pattern as `acknowledged_at`/`resolved_at`): `response_type` (what was sent — required on the first log, inherited after), `response_details` (who/contact, ≤200), `response_eta` (from `eta_minutes`, 1–1440), and `response_status` on a forward-only ladder `Dispatched → En Route → Arrived` (re-sending the current status refreshes ETA/details; backwards moves are 409). Every update writes an `incident_comments` RESPONSE row, audits (`response_update`), and pushes "Help Update" to the driver (the Arrived message differs). Only while the incident is Open. Rendered in the web resolve modal (current-state card + advance/ETA form, `Ambulance` icon) and as a "Help: <status>" row badge; the staff GET also returns the driver's **live position** (`drivers.current_latitude/longitude/last_location_update`, with a "Driver last seen <time>" + map link in the modal).
4b. **Fleet responders update themselves (migration 102).** When the help sent is another fleet driver, staff don't click through the ladder at all: POST `/api/incidents/[id]/responder` assigns a `responder_driver_id` from a picker of active drivers (GET on the same route; excludes the reporting driver, shows each candidate's distance and position freshness), which sets `response_status='Dispatched'` + `response_type='Fleet Responder'` automatically, notifies the responder ("You Are the Responder", deep-links to a mission view) and the driver. From there the responder's phone GPS drives the ladder — `evaluateResponder` (`src/lib/incidents/responder-tracking.js`) computes distance to the driver's live position and a routing ETA (TomTom `tomtomEtaMinutes`, haversine `etaFromDistanceKm` fallback), auto-advances Dispatched→En Route once a position posts after assignment and →Arrived within 200 m, and refreshes `response_eta`. It is triggered by the responder's location POST (`/api/driver/responder/location`), by the stranded driver's 30s poll and the staff detail GET (lazy, fire-and-forget — the same pattern as `escalateOverdueIncidents`; this covers a responder who is *driving with an active trip*, whose trip GPS already updates `drivers.current_*`), and evaluated under `FOR UPDATE OF i` so concurrent triggers can't double-advance. Guards: position older than 5 min is ignored (a stale fix must not fake an arrival), Arrived is final, the ladder never downgrades, and the driver is re-notified only on a status change or an ETA shift ≥5 min (anti-spam). On arrival the overseers are paged "Responder On Scene" — help on scene is the fleet team's cue to resolve. External help (ambulance, tow company) has no phone posting here: `responder_driver_id = NULL` means exactly that, the manual form of step 4, and clearing the assignment returns the incident to it. The responder's app: the single GPS poster (`mobile/lib/tracking.js`) checks `/api/driver/incidents?role=responder` on its 60s refresh and, when there is a mission and no active trip (trip GPS already covers that case), posts `/api/driver/responder/location` on the 30s tick — never queued offline, same rule as the driver heartbeat. The mission screen (same `incident/[id].js`, entered when the report isn't in the driver's own list) shows the stranded driver's live position and an "I've arrived" manual fallback (`/api/driver/responder/arrived`, same notifications as the auto path) for weak GPS. Its Navigate button stays **in-app** (2026-09-04, the guest-trip parity): it deep-links to the rescue navigation screen (`incident/navigate.js`) — the same `TomTomMap` WebView the guest Map tab uses, with the live car icon, traffic-aware route and turn banner, the responder's own GPS as origin, and the stranded driver's live position as the destination (re-baked only past a 200 m move, because the WebView reloads whenever the destination prop changes), plus ETA/distance/traffic-delay in the bottom card and the manual arrival button repeated there ("Open in Google Maps" demoted to a text-link fallback). Web: the resolve modal has the responder picker + "GPS-tracked" state with Unassign, and the incident map plots each open rescue's responder as a blue marker (`responders` prop on `incident-map.jsx`) distinct from the severity dots. The rescue also appears on the **live maps** the way active guest trips do: GET `/api/incidents/responders/active` (permission `incidents/read`, read-only) feeds both `/tracking/live-map` and the dispatcher dashboard's "Live operations map" panel — a blue responder marker + a red stranded-driver pin (`responders` prop on `live-locations-map.jsx`), a "Rescue missions" aside with per-mission ETA, and a responder→driver route polyline (same `/api/tomtom/route`, drawn only when the responder's fix is fresh) when a mission is selected. A rescue renders even with zero active trips; it leaves the feed when the incident is resolved or the responder cleared.
5. **The driver stays tracked and closes the loop.** While the incident is unresolved, the mobile status screen's 30s poll posts the driver's current GPS position to POST `/api/driver/incidents/[id]/location` (updates `drivers.current_*` only — the incident's own lat/lng stay report-time evidence; open-incident-only, not queued offline so a stale replay can't overwrite a live position). The screen renders the rescue card (medkit icon, "Help dispatched" / "En route — ETA <time>" / "Help has arrived" + type/details) and the banner uses the strongest signal: Arrived > En Route/Dispatched > Acknowledged > Waiting. Resolution is a **soft close** (step 6): whoever resolves — staff or the field — their call stands immediately (driver silence never blocks closure), then the driver — the only person who knows whether help actually arrived — either confirms ("I'm safe", POST `confirm-resolution`, sets `driver_confirmed_at` + DRIVER_CONFIRMED comment, final) or disputes with a required reason (10–2000 chars, POST `reopen`: status back to Open, `resolved_at`/`resolved_by` cleared, `reopened_at` set, REOPENED comment, overseers paged "Incident Reopened by Driver", then the normal acknowledge/resolve cycle runs again). Dispute is only possible *before* confirmation, so the loop cannot ping-pong forever. The web modal shows the confirmation state (confirmed ✓ / awaiting / reopened with reason).
6. **Resolve — by the fleet team or from the field.** Two paths since 2026-09-04. **Staff** resolve in the modal (non-empty `actions_taken` narrative required, notifies the reporting driver) — or, without waiting for staff, the two people actually on scene can close it from the mobile app: the **reporting driver** ("I'm safe — resolved" on their status screen, any acknowledged incident — the false-alarm/self-fixed case, no dispatched response needed) or the **assigned fleet responder** ("Mission complete — resolved" on their mission screen, only once `response_status = 'Arrived'` — you can't confirm a rescue from 4 km away; the navigation screen's arrived note points them back to the mission screen for it). Both ride one shared transactional core, `resolveFromField` in `src/lib/incidents/field-resolution.js` (SELECT … `FOR UPDATE OF i`, guards, UPDATE, RESOLVED comment, keep-grounded vehicle UPDATE — same row shape and rules as the staff PATCH), so nothing is triplicated. Guards identical to staff resolve (Open, `acknowledged_at` set, grounding not Pending/Failed) plus the responder arrival gate, decided by the pure `fieldResolutionGuards` in `resolution.js`. The `actions_taken` narrative is auto-generated (`buildFieldResolutionNarrative`: "Resolved by <name> (Driver|Fleet responder) from the mobile app", an optional free-text note appended) — auditable without forcing a form on someone standing next to a broken truck. Endpoints: POST `/api/driver/incidents/[id]/resolve` (the reporter, own report only — another driver gets 404) and POST `/api/driver/responder/resolve` (the responder, latest Open assignment by `responder_driver_id`, 404 when none). After the commit, both page the **overseers** (system_admin/fleet_manager/admin — the authority managing incident reports, insert + `sendPush` best-effort, the OVERSEER_ROLES pattern) and the *other* field party: a driver resolve also tells the assigned responder "Mission Complete"; a responder resolve tells the reporter to confirm or dispute. The two paths compose with the soft close differently — a **driver** resolve sets `driver_confirmed_at` too (the resolution *is* their confirmation, so it is final and the reopen endpoint refuses it — no ping-pong), while a **responder** resolve leaves `driver_confirmed_at` NULL so the step-5 confirm/dispute loop still runs (a disputing driver reopens through the unchanged endpoint). Vehicle safety is never bypassed: `shouldKeepVehicleGrounded` + `syncVehicleStatus` behave exactly as the staff PATCH. The web modal shows provenance: GET `/api/incidents/[id]` joins the resolver's name, and the resolved state carries an attribution line computed client-side from `resolved_by` vs reporter/responder employee ids — "Resolved by the driver · confirmed on their phone · <time>", "Resolved by <responder name> · confirmed on their phone · <time>", or "Resolved by <name> · <time>" for staff. Resolving an incident never completes maintenance: a linked work order keeps the vehicle `Under Maintenance` until the maintenance state machine marks it `Completed`; only then can `syncVehicleStatus` return it to `Available`. Re-resolve after a driver reopen works through the staff PATCH.
7. **The driver watches it happen.** Mobile Activity Logs (`submissions.js`) shows the full ladder — OPEN → ACKNOWLEDGED (from `acknowledged_at`) → RESOLVED — and incident cards are tappable, opening the new driver status screen `mobile/app/(app)/incident/[id].js` (response banner "Waiting for fleet response" / "Help is on the way" / "Resolved", summary card, Submitted→Acknowledged(+note)→Resolved timeline, 30s poll + pull-to-refresh; fed by GET `/api/driver/incidents`, filtered client-side — no new endpoint). Incident notification deep-links were fixed to point there too: `mobile/lib/notifications/navigation.js` maps `incident` → `/incident/[reference_id]` (it previously opened `/incidents`, the blank *report form* — the exact opposite of what a waiting driver needs). The notifications tab resolves incident icons via `reference_type` since the server labels those rows `type: "Info"/"Alert"`.
8. **Silence escalates.** Overdue is computed live — `Open AND due_at < NOW()` — as a summary count, a per-row `overdue` flag, a "SLA Overdue" stat card, and a danger "SLA breached" badge in the web registry (migrations 098/099's `overdue_at`/`pg_cron` job remains, but the UI never depends on it). The 099 pg_cron job was verified live on 2026-09-04 (`incident-sla-breach-check`, `* * * * *`, active, succeeding every minute — it only stamps `overdue_at`, no notifications). On every dashboard load, `escalateOverdueIncidents()` (`src/lib/incidents/sla.js`, fired lazily from the summary branch) notifies system_admin/fleet_manager/admin once per unacknowledged Critical/Major incident past SLA — deduped via `NOT EXISTS` on (employee_id, title, reference_type, reference_id), proven idempotent against the live DB (`scratch/verify_sla_escalation.mjs`: 5 overseers × 1 insert, 0 on reload, rows cleaned up).
   **Bug found by that verification:** the shared `INSERT … SELECT … WHERE NOT EXISTS` dedupe statement fails to parse on Postgres (42P08 — SELECT-list parameters deduce as `text`, the NOT EXISTS comparison as `varchar`). The same shape in `notifyMaintenanceTeam` had been failing **silently on every call** — the "Incident Maintenance Work Order Created" notification never once delivered; the best-effort try/catch masked it. Both statements now carry explicit `$2::varchar`/`$5::varchar` casts (`src/lib/incidents/sla.js`, `src/lib/incidents/maintenance.js`).
9. **See it.** Mobile Activity Logs (`submissions.js`) shows real OPEN/RESOLVED badges and renders `actions_taken`; permanently-failed offline sends are quarantined behind an unsent-reports banner with Retry/Discard. On the web, the admin registry's incident map (`src/components/maps/incident-map.jsx`) shows a permanent label on every marker — severity-color dot + type · severity + driver name — no hover needed (2026-09-03). The map's ctrl/⌘ + scroll-to-zoom handler (plain wheel scroll is ignored and flashes a "Use ctrl + scroll" hint) was extracted to the shared `src/components/maps/map-ctrl-zoom.jsx` on 2026-09-04 so every map view (live tracking map, trip detail, dashboards) has the same zoom UX; the incident map now imports `MapCtrlZoom`/`ZoomHintOverlay` from there instead of its private copy.

## Rules that were gaps before 2026-08-31

| Rule | Where | Why |
|---|---|---|
| Maintenance clearance before release | `api/vehicle-maintenance/[id]/route.js` | Vehicles with critical incidents must pass a manager inspection before `Completed` status |
| Strict State Machine | `api/incidents/[id]/route.js` | Incidents require `acknowledged_at` before resolution. Audit history via `incident_comments`. |
| Incident Confidentiality | `api/incidents/route.js` | HR/Admin reports are shielded from general staff visibility based on role |
| Dynamic SLAs | `api/driver/incidents/route.js`, `pg_cron` | `due_at` calculated server-side based on severity (Critical = 2h, Major = 24h). `pg_cron` idempotently processes breaches into `overdue_at` automatically. |
| Active Trip Aborts | `src/lib/incidents/grounding.js` | Grounding an `In Progress` dispatch aborts the request entirely and pages Guest Services |
| Maintenance completion restores availability | PUT `/api/vehicle-maintenance/[id]` calls `syncVehicleStatus` after `Completed` | Resolving the incident must not release a vehicle that still needs repair |
| Resolution is documented | server-side required `actions_taken`; CHECK constrains status to Open/Resolved | Resolve-with-no-narrative was unauditable; status was free-form |
| One incident, one repair record | automatic helper + incident row lock + unique `source_incident_id` index | Retries and concurrent reports cannot duplicate the work order |
| One report, one automation run | `client_submission_id` unique partial index (`uq_driverincidents_driver_submission`) | Offline replay racing a manual resubmit duplicated reports and re-paged dispatch |
| Failed ≠ deleted | sync dead-letter (`@offline_dead_letter_incidents`) | A session expiring mid-replay silently destroyed emergency reports |
| Repairs link back to incidents | `vehiclemaintenance.source_incident_id` + `driverincidents.maintenance_id` (migrations 063, 083–086) + completion notification | Staff can open the exact work order and the driver hears when the vehicle returns |
| Resolvers see the blast radius | GET `/api/incidents/[id]` matches grounding's exact audit reason to list interrupted dispatches + linked repairs, rendered in the resolve modal | Whoever resolved had no way to verify reassignment happened |
| Claims ≠ costs | Emergency repairs book `cost = 0`; the driver-reported `expense_amount` travels in remarks as an *unverified claim* staff confirm against the invoice | An unverified number used to flow straight into fleet-cost analytics |
| Structured help requests | Mobile form sends `assistance_needed[]` chips (Tow Truck, Mechanic, Medical, Police, Alternative Vehicle, Fuel); admin registry renders them | Dispatch had to parse prose to know what help to send |

Pure decision logic lives in `src/lib/incidents/resolution.js`, `src/lib/driver/grounding.js`, and `src/lib/incidents/responder-tracking.js` (24, 11, and 10 unit tests) so the routes stay thin — same pattern as [[grounding]]. Field resolution's shared transactional core is `src/lib/incidents/field-resolution.js` (called by both driver endpoints). The DB dedup pattern mirrors fuel/inspection idempotency (migrations 059/060); migrations 083–086 carry it for incident maintenance.

## Known limits

- No free-form two-way comment thread — the driver receives the acknowledge note and resolution read-only; their only replies are the structured confirm/dispute actions of step 5 and the field resolution of step 6 (deliberately out of the 2026-09-04 scope).
- The rescue response is a tracked status, not a dispatch system — staff still phone external ambulance/tow companies themselves and record it manually; the responder entity (migration 102) covers only *fleet* responders, whose phones post GPS here. There is no assignment board beyond the one incident at a time.
- Reassigning dispatches interrupted by grounding stays manual — the resolve modal now *shows* them (and their live status), but nothing auto-reassigns.
- A failed automatic work-order or grounding attempt remains visible as a retry state; the recovery endpoint is not a general-purpose manual maintenance action.

Closed 2026-09-04: automatic maintenance gates on the incident's own vehicle
and rule-based category/severity; the mobile form offers all four severities
including Critical; repairs carry both incident/work-order links and completing
one notifies the reporting driver; expense claims are reviewed, not auto-booked;
assistance requests are structured chips. Active trips are aborted and Guest Services notified. Managers must approve clearance.

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

**Machine-proven 2026-09-04** by `scratch/verify_incident_response.mjs` against
the live API (minted driver+staff JWTs, seeded [QA] rows, 28/28 assertions,
cleanup afterwards) — the physical-response loop of steps 4–5:

1. ✅ **Dispatch validation** — first response log without a type → 400 (S1)
2. ✅ **Dispatch + ETA** — 200, `response_type`/`response_eta` (20min out)/`responded_by` set, RESPONSE comment, driver "Help Update" notification (S2)
3. ✅ **Ladder** — En Route with type inherited → Arrived → backwards move 409 (S3–S5)
4. ✅ **Live location** — POST updates `drivers.current_*`, report-time coordinates untouched, rejected once Resolved (S6, S8)
5. ✅ **Soft close** — confirm/reopen rejected while Open (S7); resolve (S8); short-reason reopen 400, real dispute reopens (status Open, `resolved_at` NULL, `reopened_at` set, REOPENED comment, 5 overseers paged) (S9); re-resolve + driver confirm set `driver_confirmed_at` (S10); reopen-after-confirm 409, re-confirm idempotent 200 (S11)
6. ✅ **Medical flag wiring** — report with Medical Assistance chip → 201 + `medical_assistance_required=true` (S12)
7. ✅ **GET exposure** — staff list, resolver GET (reopen reason + driver position), and driver list all expose the new state (S13)

Note for future harnesses: since the auth hardening (migrations 087/088), a
minted Bearer token is rejected (401) unless it carries the employee's CURRENT
`auth_version` and a `familyId` backed by a live `mobile_refresh_tokens` row —
`qa_incidents_e2e.mjs`'s bare `signAccessToken` pattern no longer authenticates.
`verify_incident_response.mjs`'s `mintToken()` seeds a 1-hour QA family row
(cleanup deletes it by `user_agent`). If no eligible spare driver exists (zero
`device_tokens`), `verify_responder_tracking.mjs` mints its own QA responder
employee + driver rows and deletes them in cleanup. Also:
`qa_incidents_e2e.mjs` **soft-deletes** its rows, so `[QA e2e]` incidents with
`deleted_at` set accumulate invisibly (app queries filter them out) — the newer
harnesses' `incidents-left` counts exclude soft-deleted rows for exactly that
reason, and `scratch/cleanup_qa_incidents.mjs` (added 2026-09-04, when six
2026-08-23 leftovers plus 3 linked work orders and 12 live maintenance
notifications were purged) hard-deletes the full chain transactionally,
breaking the circular `driverincidents.maintenance_id ↔
vehiclemaintenance.source_incident_id` FK.

**Machine-proven 2026-09-04** by `scratch/verify_responder_tracking.mjs` against
the live API (minted reporter/responder driver + staff JWTs, seeded [QA] rows,
32/32 assertions, cleanup afterwards) — the GPS responder loop of step 4b:

1. ✅ **Picker** — GET lists Available drivers with distance + freshness, excludes the reporting driver; self-assign 400 (S1–S2)
2. ✅ **Assign** — 200 sets `responder_driver_id`/`responder_assigned_at`, auto-`Dispatched` + `Fleet Responder`, `responded_by` staff, responder + driver notified (S3)
3. **Mission list** — `?role=responder` returns the incident with the driver's live position; the responder's own list excludes it (S4)
4. ✅ **Auto ladder** — responder GPS post 4 km out → auto En Route + `response_eta` + "(auto — responder GPS)" comment + driver notification (S5)
5. ✅ **Stale guard** — 10-min-old position + driver poll → no arrival, no ETA drift (S6)
6. ✅ **Lazy evaluation** — a direct position write (trip-GPS-style, no POST) advanced to Arrived purely from the stranded driver's 30s poll; driver + 4 overseers notified (S7)
7. ✅ **Finality** — a later far-away post doesn't downgrade Arrived; manual backwards move 409 (S8–S9)
8. ✅ **Exposure** — resolver GET (responder object + live position), staff list (`responder_driver_id` + `responder`), driver list (responder name) (S10)
9. ✅ **Clear** — returns to manual mode (`responder_driver_id` NULL, mission list empty, manual response 200); resolve/confirm loop unaffected (S11–S12)
10. ✅ **Manual arrival** — `/api/driver/responder/arrived` → Arrived + "(manual — responder confirmed on device)" comment + driver notification; idempotent (S13)

Two bugs found and fixed by this verification: (1) the picker filtered
`driver_status = 'Active'` — a value the CHECK constraint doesn't allow
(Available/On Trip/Off Duty/On Leave/Suspended), so it always returned empty;
(2) the assign UPDATE hit Postgres 42P08 ("could not determine data type of
parameter $2") — a parameter reused across multiple CASE WHEN arms needs an
explicit `::int` cast, the same quirk as the SLA dedupe bug above. The
`responded_by` name in the manual-arrival notifications also read from the
reporter's join alias (wrong person's name) — caught in self-review.

Still device-only (cannot be asserted headlessly): the mobile GPS poster's
responder branch (30s tick → `/api/driver/responder/location`), the in-app
rescue navigation screen (`incident/navigate.js` — car icon, route, arrival
button), and Expo push receipts.

**Machine-proven 2026-09-04** by `scratch/verify_responder_navigation.mjs`
against the live API (minted reporter/responder driver + staff JWTs, seeded
[QA] rows, 10/10 assertions, cleanup afterwards) — the rescue-on-the-live-map
feed of step 4b (`GET /api/incidents/responders/active`, what puts a rescue on
`/tracking/live-map` and the dispatcher dashboard):

1. ✅ **Empty feed** — an open incident with no responder assigned produces no row (S1)
2. ✅ **Assign + auto En Route** — assign a responder, their GPS post lands, and the lazy `evaluateResponder` hook flips the mission to En Route (S2–S4)
3. ✅ **Both live positions** — the feed exposes the responder at their posted fix AND the stranded driver at their live `drivers.current_*` fix, with status/ETA/type/severity and both parties' names (S5–S7)
4. ✅ **Arrival stays visible** — a ≤200 m post flips the mission to Arrived and it remains on the feed while the incident is open (help on scene is still an active mission) (S8–S10)
5. ✅ **Clear removes it** — unassigning the responder returns the incident to manual mode and takes it off the live map (S11–S12)
6. ✅ **Permission** — a driver token gets 403 on the staff feed (`incidents/read` required) (S13)

Still device-only (cannot be asserted headlessly):

- **Expo push receipts** — notifications rows exist and `sendPush` was invoked;
  actual delivery to a handset is unverified.
- **AsyncStorage offline path** — the queue/dead-letter/banner flow needs a real
  device in airplane mode (steps 1–2 of the original manual list).

**Machine-proven 2026-09-04** by `scratch/verify_field_resolution.mjs` against
the live API (minted reporter/responder driver + staff JWTs, seeded [QA] rows,
16/16 assertions, cleanup afterwards) — the field resolution of step 6 (the
reporting driver or the assigned responder closing the incident from their
phone, overseers paged):

1. ✅ **Driver guards** — resolve before acknowledgement 409 (S1); another
   driver's token on the reporter's incident 404 (S7)
2. ✅ **Driver resolve** — 200 with `resolved_by` = the driver's employee id and
   `driver_confirmed_at` set (resolution *is* the confirmation); auto narrative
   "Resolved by <name> (Driver) from the mobile app — <note>" in
   `actions_taken`; RESOLVED comment row, 5 overseer notifications
   ("Incident Resolved by Driver"), `driver_field_resolve` audit row (S2–S4)
3. ✅ **Finality** — double resolve 409 (S5); the driver cannot dispute their own
   field resolution through `reopen` 409 — the anti-ping-pong rule holds (S6)
4. ✅ **Responder guards** — resolve before arrival 409 (S9, assignment leaves
   the mission at Dispatched); no open assignment 404 (S16)
5. ✅ **Responder resolve** — after the GPS ladder auto-advanced En Route →
   Arrived (S10–S11, lazy evaluation), 200 with `resolved_by` = the responder's
   employee id and `driver_confirmed_at` NULL — the soft close stays open; 5
   overseer notifications + 1 reporter prompt ("Incident Report Resolved",
   confirm-or-dispute) + `responder_field_resolve` audit (S12–S13)
6. ✅ **Loop composition** — the reporter can still soft-close after a responder
   resolve (`confirm-resolution` 200, S14); the resolved mission left the
   `?role=responder` feed (S15)

Harness authorship note: the first run crashed on `await q(...).rows[0]` —
`await` binds looser than `.rows[0]`, so it read `.rows` off the Promise (a
plain JS bug, not an API one); the second run's only failure was the author's
own `LIKE '%from the mobile app'` assertion lacking a trailing `%` once the
optional note is appended to the narrative.

**Bug found by manual QA after the 16/16 run:** tapping the responder's
resolve button failed with "Invalid JSON body" — the mobile app posts these
actions with no body (`JSON.stringify(undefined)` sends nothing), and
`parseBody` 400s on an empty request. Both field-resolve endpoints now use the
new `parseOptionalBody` (`src/lib/api/utils.js`) — no body is valid when the
payload is entirely optional, malformed JSON is still a 400 — and the harness
asserts the no-body POST explicitly (S5, S16). The harness had missed it
because it always sent `{}`.

## Database tables used

`driverincidents` · `incident_comments` · `vehiclemaintenance` · `vehicles` · `notifications`

## Related

[[Driver Management]] · [[Maintenance]] · [[Notifications]] · [[Mobile Architecture]] · [[Feature Index]]
