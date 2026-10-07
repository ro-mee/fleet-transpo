# FleetOps Defense Demo Dataset Implementation Plan

> **Execution handoff:** Implement task by task only after the user approves this plan. Read `.agents/AGENTS.md`, the relevant `Capstone/` notes, and the applicable `node_modules/next/dist/docs/` guide before any Next.js code change. Recheck the live schema and data before any write.

**Goal:** Build a connected, reversible, Philippine-context FleetOps demo dataset with historical operations from **2026-09-03 through 2026-10-02** and live workflows reserved for **Saturday, 2026-10-03**.

**Architecture:** A separate Node/`pg` defense seeder will compile a deterministic scenario graph, validate it without writes, then insert only owned records in dependency order with an ownership ledger. Controlled media will use a dedicated storage prefix and manifest. The existing app will make eligibility, leave, dispatch, fuel, maintenance, notification, and report decisions; the seeder will not plant AI conclusions or runtime/security state.

**Tech stack:** Node ESM, PostgreSQL through `pg`, Supabase Storage, Vitest, Next.js 16.2.11, Expo mobile app. The existing `scripts/load-env.mjs` loads local credentials; no credentials belong in seed files.

---

## 1. Scope, facts, and gaps checked on 2026-10-02

| Area | Current evidence | Plan consequence |
| --- | --- | --- |
| Existing seeder | `scripts/seed-demo.mjs` has deterministic generation, `status/plan/up/down`, `system_settings` ledger, transaction, ID-based deletion, and odometer restoration. It targets May–August, 200 trips, and includes shuttle/staff service types. | Reuse its patterns and small helpers where practical; create `scripts/seed-defense.mjs` and focused modules. Never invoke or repurpose the old data plan for this defense. |
| Live baseline | The 2026-10-01 read-only Capstone analysis recorded 2 active super admins, 11 active drivers, 21 active vehicles, 24 requests, 12 dispatches, and 11 active trip rows. It found only 1 reviewed active license and 1 vehicle with a required LTO class. `npm run db:status` failed in this planning environment with no diagnostic text. | Treat counts as a dated snapshot, not a current fact. First execution task must read live ledger, catalog, row counts, and existing seed ownership. Do not reset existing data. |
| Categories and seats | `vehicles.seating_capacity` is passenger seats excluding driver. `vehiclecategories.seating_capacity` has been removed from category endpoints. Current default-category code still names VIP, shuttle, logistics, and staff; `Private Guest Transport` is not in that default list. | Resolve or create only VIP and Private category rows for this seed; do not delete other foundation categories. Never seed shuttle, staff, or logistics requests/vehicles. Check whether the two needed categories exist and are active. |
| Requested capacity | No `requested_seating_capacity` hit in current `src/`, `mobile/`, `scripts/`, or `schema.sql`. Its Capstone design is marked planned. | Seed `passenger_count` only. Assert `vehicle.seating_capacity >= passenger_count` and exact requested category. Do not claim requested-size ranking. |
| Request states | `transportation_requests.fleet_status` permits Pending, Scheduled, Assigned, In Progress, Completed, Cancelled; no Rejected state. | Aim for 45 requests: 30 Completed, 7 Assigned/open, 4 Pending, 2 Scheduled/unassigned, 2 Cancelled. A rejected intake example may replace one Cancelled row only if its real Booking-to-Fleet mapping is verified. |
| Leave and substitutes | `reviewLeaveRequest()` approves Pending leave and marks overlapping dispatches `Pending Reassignment` with `driver_id = NULL`; substitutes require an unpaired driver. | Keep D4 leave Pending before defense. Rehearse approval through the real API and verify dispatch, trip, request, and eligibility consistency before claiming a complete reassignment. D10 stays unpaired. |
| Trips and inspections | Trip start requires a Passed, trip-specific Pre-Trip inspection; Start Duty requires today's Passed Pre-Shift. Post-Shift is submitted through End Duty, not the normal inspection POST. | Historical fixtures use the current checklist shapes and links. D1 gets no 2026-10-03 duty, Pre-Shift, Pre-Trip, or completed trip evidence before the live walkthrough. |
| UVVRP | Code's Manila preset restricts Monday–Friday; Saturday has no restriction. Stored `system_settings.uvvrp_policy` may differ. | Use a configured restricted weekday for V9 and a separate valid exemption example. Do not call October 3 a coding day unless the actual stored policy says so. |
| Fuel and reports | Fuel request policy requires a gauge photo; approved `fuelrecords` drive fuel consumption, while some financial views have historically counted pending record amounts. Existing `scripts/verify-reports.mjs` is hardcoded to the old May–August seed. | Keep pending/approved states in `fuelrequests`; use only approved historical `fuelrecords`. Add a defense-specific report verification entry with Sep/Oct anchors and independent SQL totals. |
| Expenses and cards | `POST /api/mobile/expenses` exists but no mobile expense screen is present under `mobile/app`. The web `/cards` Add Card button is a placeholder while the API can create cards. | Seed optional expense/card data for web Finance only; state the UI limits in the rehearsal notes. Do not invent mobile submission/history or web card creation UX. |
| Booking integration | `BOOKING_GATEWAY` is documented as mock/unconfigured. | Use synthetic request records or sanctioned local intake; do not claim external PMS/Booking delivery. Label lifecycle history as synthetic where generated from fixtures. |

The repository has unrelated uncommitted code and documentation changes. Execution must leave them intact and build on the then-current worktree. This plan adds no app behavior, database records, storage objects, or accounts.

## 2. Scenario contract and target counts

The scenario compiler should assign stable semantic keys (`D01`–`D10`, `V01`–`V10`, `R001`–`R045`, etc.) and print a preview before any write. Numeric primary keys are discovered on insert and stored in the ledger. Use Asia/Manila local dates and offset-qualified timestamps (`+08:00`); never derive demo dates from the machine's current date.

| Layer | Target | Required relationship |
| --- | ---: | --- |
| Drivers/vehicles | 10/10 | 9 active custodial pairs; D10 reserve/unpaired. All 10 drivers have 7 schedule rows and Vacation, Personal, Medical balances. |
| Requests/dispatches/trips | ~45 / ~37 / ~37 | 30 completed chains; 7 assigned/open chains; other requests unassigned or cancelled as their state permits. One request → at most one current dispatch → one exclusive trip. Historical cancelled dispatches may remain only when the actual lifecycle creates them. |
| Completed trip split | ~21 September; ~9 on Oct 1–2 | No completed Oct 3 trip before live demo. Distribute request/event creation, fuel, maintenance, and incidents as well as trip timestamps. |
| D1 | 6 completed; 5 assigned/open | At least two on Oct 3; remaining on Oct 5–6; none on Sunday Oct 4. Saturday duty 07:00–19:00, break 12:00–13:00. Route time, preparation buffer, and next commitment must fit. |
| Leave | 7–9 requests | D4 Pending leave overlaps an Oct 3 assigned dispatch; D7 Approved leave covers Oct 3–4; D8 has Saturday rest. Balance usage agrees with approved history. |
| Geography | 8–10 locations; 14–18 directional routes | Verified Philippine coordinates, canonical location/address links, plausible distance and duration. |
| Operations | 10–12 approved fuel records; 4–5 fuel requests; 8–10 maintenance records; ~3 incidents; 6–8 expenses; ~2 cards | Each row has a valid owner and underlying workflow/status; financial reports count only incurred/approved amounts. |
| Media | About 70–90 controlled assets | 10 synthetic Filipino driver portraits, 20 conspicuously invalid license samples, 10 Philippine-context vehicle photos, 20 invalid OR/CR and insurance samples, selected fuel/incident/maintenance evidence. |

Driver matrix: D1 main ready mobile driver; D2 healthy backup; D3 high historical workload; D4 pending leave with Oct 3 dispatch; D5 expired license; D6 license due within 30 days; D7 approved leave Oct 3–4; D8 Saturday rest; D9 valid driver paired with a weekday-coded V9; D10 eligible unpaired reserve/substitute/responder candidate. Vehicle matrix: V1/V2 VIP 4 seats, V3 Private 4, V4/V5 Private 5, V6 Private 6 near service, V7 VIP 6, V8 Private 7 expired insurance, V9 Private 7 coding example, V10 VIP 7 maintenance/reserve. Assign class B/B1 only as current license rules permit, based on the registration facts rather than seat-count inference.

## 3. Safety contract

1. `status` and `plan` must be strictly read-only. `plan` compiles the entire graph, validates dates and invariants, prints intended counts/scenarios, reads live reference IDs and collisions, then exits without a write. `status` checks ledger presence, owned row counts, FK reachability, media keys, and before-image hashes; report `absent`, `complete`, `partial`, or `inconsistent` with reasons.
2. `up` must refuse a pending/changed migration, incompatible live schema, colliding semantic key, incompatible category, existing defense ledger, or known unsafe pre-existing phase4 seed overlap. Start with a database and media-reference backup. Inserts and ledger commit in one DB transaction; stage storage objects under a dedicated `defense-2026-10/` prefix and record every exact key. On DB failure, remove only newly uploaded keys.
3. Ledger key `seed:defense-2026-10` records dataset version/hash, generated semantic-key→PK map, all inserted IDs, exact storage keys, trigger-produced descendant IDs where identifiable, and before-images/after-hashes for any modified existing row (especially odometer and status). Prefer creating owned new rows over modifying existing ones. Never mutate system roles, super admins, provider settings, security/runtime tables, or migration ledger.
4. `down` computes a deletion plan first. It must delete only owned IDs and exact owned storage keys, in reverse FK order. If an owned row has been changed after seeding, an unrelated row references it, or a pre-existing row no longer matches its seeded after-hash, stop with a named conflict instead of overwriting or cascading away user work. Restore before-images only when safe. No `TRUNCATE`, date-range delete, or broad storage-prefix sweep.
5. Live rehearsal can create genuine audit, notifications, push-outbox, sessions, trip transitions, or other downstream records. The ledger must distinguish seed-owned records from app-created evidence; rollback must refuse or explicitly handle genuine descendants by ID and ownership, never assume they are disposable. Exercise `up → status → down → absent` in a disposable copy before production use.

## 4. Implementation tasks after approval

Each task is a small reviewable commit; use focused failing tests before changing behavior, then run the named check. The paths below identify ownership, not permission to execute now.

### Task 1 — Freeze live contract and resolve the two-category base

**Files/read:** `.agents/AGENTS.md`; `Capstone/02 - Features/{Reservations,Dispatch,Trips,Driver Management,Assignments,Fleet And Vehicles,Fuel,Maintenance,Incidents,Reports,Routes,UVVRP Number Coding,Travel Expenses}.md`; `Capstone/04 - Architecture/Mobile Architecture.md`; `schema.sql`; relevant `supabase/migrations/`; `scripts/seed-demo.mjs`; actual APIs and screens.

1. Run `npm run db:status`, `npm run db:check`, then read-only catalog queries against the configured database (do not print credentials). If another migration has landed, run `npm run db:dump` before trusting `schema.sql`; inspect any generated diff. Record live table/column/check/index, RLS, category IDs, existing seed keys, storage buckets, and current row counts in an execution report.
2. Confirm exact route, license, shift, break, leave, UVVRP, media, report, and state-machine contracts against code. Confirm whether `Private Guest Transport` exists. If absent, plan one owned category insert; if a canonical active one exists, reference it without modifying it.
3. Check current Next.js guide under `node_modules/next/dist/docs/` before any Next route/UI fix. No migration is expected for the seed; if a genuine schema gap is found, stop to scope the smallest migration, run `db:status` first, then follow `db:up`, `db:dump`, `db:contract`, and `verify:anon` for any new table/view.

**Gate:** An explicit live contract and preservation manifest exist; no destructive refresh is assumed.

### Task 2 — Build deterministic compiler and read-only commands

**Create:** `scripts/seed-defense.mjs`, `scripts/defense-seed/config.mjs`, `scripts/defense-seed/plan.mjs`, `scripts/defense-seed/validation.mjs`, `scripts/defense-seed/ledger.mjs`, `scripts/defense-seed/validation.test.mjs` (or repo-conventional test suffix). **Modify:** `package.json` scripts only.

1. Add tests for the exact Sep 3–Oct 2 historical window, Oct 3 Saturday, D1 Saturday work/no leave/two Oct 3 trips/five open trips, D7 leave, D8 rest, D4 overlap, no completed post-Oct 2 history, no October 5 defense-date constant, and no forbidden category. Verify tests fail before compiler code.
2. Compile a stable semantic-key graph with no `Math.random` dependence except a fixed seeded PRNG for low-stakes variety. All person, plate, booking, receipt, and document identifiers are fictional. Use explicit `+08:00` stamps and validate minute carry/day boundaries.
3. Add `seed:defense:status`, `seed:defense:plan`, `seed:defense:up`, `seed:defense:down` package commands. `status` and `plan` use read-only DB access; prove via a query spy or transaction read-only test that no `INSERT/UPDATE/DELETE` occurs.
4. Run `npm run test:run -- scripts/defense-seed/validation.test.mjs` and `npm run seed:defense:plan`. Expected: exact date assertions pass and the preview prints all scenario counts without a ledger or DB mutation.

### Task 3 — Owned master data and eligibility

**Create:** `scripts/defense-seed/reference-data.mjs`, `drivers.mjs`, `vehicles.mjs`, `assignments.mjs`, `schedules.mjs`, `leave.mjs`, and focused tests.

1. Seed only missing needed category data, controlled role accounts, 10 `employees`/`drivers`, normalized addresses where the current API requires them, 10 vehicles, documents, 9 active custodial pairs, 70 weekly schedule rows, 30 leave balances, and 7–9 leave requests. Keep D10 unpaired. Avoid fake OTP/MFA/device/session values.
2. Use the current valid Professional license syntax/type/class rules; record a real staff-review action through the authorized workflow for eligible synthetic drivers rather than faking an attestation. If a sample document cannot honestly meet a physical-card review rule, use a separately controlled demo/staging workflow and disclose that limit rather than weakening the guard.
3. Assert exact passenger seat counts; category is a hard constraint and seats are separate. Check D1/V1 and D2/V2 fully eligible on Oct 3, D5 expired, D6 warning, D7 leave, D8 rest, V8 insurance expired, V10 maintenance blocked as intended. Verify valid backups remain for the showcased requests.
4. Create a historical substitute-coverage case that does not consume the D4 live approval story. Prove D10 meets the unpaired-driver rule. Run focused tests and the real availability/recommendation query on candidate windows.

### Task 4 — Geography, bookings, and dispatch continuity

**Create:** `scripts/defense-seed/locations.mjs`, `routes.mjs`, `requests.mjs`, `reservation-events.mjs`, `dispatches.mjs`, `trips.mjs`, and focused validation tests.

1. Reuse verified canonical locations where suitable; add only missing hotel/NAIA/BGC/Makati/MOA/Intramuros/Quezon City points. Verify coordinates and preserve directional route pairs with realistic duration/distance.
2. Compile 45 distinct guest requests with varied passenger counts 1–7, 20–30% VIP, sources/channels supported by current constants, and dates spread across both months. Use `requested_category_id` plus `passenger_count`; never write planned `requested_seating_capacity`.
3. Build 30 coherent historical request→dispatch→trip chains, 7 open chains (D1 five, D2 one, D4 one), and the unassigned/cancelled rows allowed by the current request state machine. Use supported lifecycle event names and timestamp order. Where historical fixture insertion must bypass a time-dependent API, map every transition to its real service vocabulary and validate the resulting state with the same domain guards; do not forge audit logs or outbound Booking success.
4. Model route duration, deadhead/preparation/turnaround, shift and break, driver/vehicle overlap, maintenance, documents, category, capacity, UVVRP, and substitutes. Test all D1 Oct 3 and Oct 5–6 assignments against the actual pair evaluation. Leave Sunday Oct 4 empty for D1.
5. Make odometer start/end monotonic per vehicle and reconcile current mileage with the latest completed trip. Vary measured early/on-time/late `at_pickup_at` values under the app's grace rule; leave some legitimately unmeasured. Do not plant GPS breadcrumbs.

### Task 5 — Historical duty, inspection, fuel, maintenance, and incidents

**Create:** `scripts/defense-seed/attendance.mjs`, `inspections.mjs`, `fuel.mjs`, `maintenance.mjs`, `incidents.mjs`, `expenses.mjs`, and focused tests.

1. Seed varied past attendance and only historically valid Pre-Shift, per-trip Pre-Trip, and Post-Shift evidence using `src/lib/inspections/checklists.js` and End Duty contract. Keep October 3 D1 duty and inspections absent. Include a failed checklist, a reported Post-Shift defect, and linked/unlinked problem-queue examples without disabling a live pair.
2. Set tank capacity, efficiency, fuel %, September/October allocations, 10–12 approved transaction records, and 4–5 requests including Pending and Approved. For any request whose real API demands a gauge, provide a controlled sample image and use the real policy calculation. Do not pre-insert AI scan confidence or flags; let normal producers calculate them. Avoid a Pending `fuelrecords` amount in reports that count all statuses.
3. Seed 8–10 maintenance records with completed September and Oct 1–2 work, future Scheduled zero-cost work, an active problem order, and service thresholds that naturally drive predictive results. Use legal lifecycle/audit fields for completed work; do not insert fake predictions.
4. Seed ~3 incidents with believable severity and linked repair/response history where supported. Keep any open responder scenario away from V1 and D1. Do not fabricate responder GPS or live map motion.
5. Seed optional web Finance cards/assignments and 6–8 expenses only after confirming `expense_records` required receipt key/hash/OCR snapshot and review semantics. An expense lacking valid controlled receipt evidence should be omitted, not represented as a legitimate submission.

### Task 6 — Media production and storage manifest

**Create:** `scripts/defense-seed/media.mjs`, `scripts/defense-seed/assets/manifest.json` (or `.mjs`), generated asset files under a dedicated reviewed directory, and asset validation tests.

1. Produce Philippine-context portraits, vehicle exteriors, sample licenses, sample OR/CR, sample insurance, and selected receipts/incident/maintenance evidence. Prefer generated images if external reuse rights are uncertain. If an external photo is used, store original URL, license/use note, model match, and attribution; never hotlink Google Images.
2. Every official-looking sample must visibly say **DEMO / SAMPLE / NOT VALID** and contain only fictional identifiers. Keep document text, driver/vehicle names, plates, classes, and expiries consistent with DB rows. Avoid a design close enough to pass as a real credential.
3. Record `asset_id`, kind, semantic entity, exact filename/storage key, source, license note, synthetic flag, and Philippine-context check. Upload through approved storage bucket/key conventions. Check each image resolves through the app's normal signed/public URL path.
4. Stage assets before the DB transaction under seed-owned keys, record exact keys, and clean only newly staged keys if DB commit fails. Do not touch unrelated assets.

### Task 7 — Safe apply, status, rollback, and failure recovery

**Create:** `scripts/defense-seed/apply.mjs`, `rollback.mjs`, `status.mjs`, and integration tests against a disposable database.

1. Make `up` refuse a present ledger and use a single DB transaction for owned row inserts, guarded before-image updates, and ledger insertion. Capture trigger-created notifications by exact IDs where possible; otherwise identify a safe provenance boundary and make rollback block when ambiguous.
2. Make `status` compare expected/actual owned IDs, missing rows, changed rows, foreign descendants, before-image drift, and exact media keys; print `absent/complete/partial/inconsistent` with a recovery action.
3. Make `down` perform a read-only conflict preview, then reverse FK deletion by exact IDs and guarded restoration; handle storage keys only after DB success, with retryable ledger/tombstone state if media cleanup fails. No broad `CASCADE`, `TRUNCATE`, or delete-by-date.
4. Test `plan` zero writes, `up` twice (second refuses), transaction rollback on mid-seed failure, status partial detection, safe `down`, refusal after unrelated edits/foreign references, odometer restoration, and exact-key media cleanup. Run `up → status → down → status` in a disposable copy before touching the real target.

### Task 8 — Report reconciliation and app rehearsal

**Create:** `scripts/verify-defense-reports.mjs` (or parameterize `scripts/verify-reports.mjs` without breaking its old anchor); `Capstone/07 - Development/Defense Demo Rehearsal.md`.

1. Compare each report API and export with independent SQL aggregates for **2026-09-03–2026-10-02**, Last 30 Days as viewed on Oct 3, This Month Oct 1–3, and September. Include trip, distance, punctuality measured/unmeasured, approved fuel liters/cost, completed maintenance incurred cost, incident counts, fleet cost, and expense approvals. Date ranges use Manila-local closed-open boundaries.
2. Verify every target screen through authenticated role views: dashboards, queue, dispatch/availability, assignments, compliance, fuel, maintenance/problem queue/prediction, incidents, analytics/reports, web Finance, and D1 mobile Home/Trips/Profile/Schedule/Submissions. Check actual media rendering and counts; do not claim a Today completed-trip chart should be populated before live work.
3. Rehearse D4 leave approval through the real route on a resettable copy. Confirm Pending Reassignment, linked trip/request state, release, valid D10 coverage, and no stale D4 mobile assignment. If a genuine inconsistency is found, document it in `Capstone/07 - Development/Bugs.md`, add a regression test, and plan the smallest separate app fix without relaxing dispatch safety.
4. Rehearse live D1 login/OTP/consent, Pre-Shift, Start Duty, exact-trip Pre-Trip, Accept/Start inside the real time window, fuel flow, and trip completion only when feasible. Let real device generate GPS. Ensure controlled login inboxes and network/device setup; do not seed OTP or session state.
5. Run `npm run lint`, `npm run test:run`, `npm run db:check`, `npm run db:contract`, `npm run verify:anon`, focused defense plan/rollback tests, defense report verification, and a production build if application code changed. Run `npm run db:dump` and review diff only if migrations were actually added. Record exact outputs and remaining limitations.

### Task 9 — Documentation and handoff

**Update:** relevant `Capstone/02 - Features/*.md`, `Capstone/03 - Database/*.md` only if schema/data contract changed, `Capstone/04 - Architecture/Mobile Architecture.md` only if mobile behavior changed, `Capstone/07 - Development/Defense Demo Data Implementation Plan.md`, `SYSTEM.md`, and the rehearsal note.

1. Record the final exact counts, scenario tables, photo/source manifest, date distributions, commands, rollback behavior, verification results, known UI limits, and any supported app fixes. Mark old Oct 5 Monday demo plan as superseded for the defense date without rewriting its historical record.
2. Deliver four commands—preview, apply, validate, rollback—with their real script names, a go/no-go rehearsal checklist, and the ledger/storage backup locations. State plainly which workflows were exercised through the app and which historical records were controlled fixtures.

## 5. Approval and execution boundary

Approval of this plan would authorize implementation work in the repository. Applying data to the configured Supabase project and any destructive cleanup must still be preceded by the concrete `seed:defense:plan` output, a preservation/backup manifest, and a rollback preview for the actual target. The Oct 3 live sequence must be rehearsed on a resettable copy before it is relied on in the defense.
