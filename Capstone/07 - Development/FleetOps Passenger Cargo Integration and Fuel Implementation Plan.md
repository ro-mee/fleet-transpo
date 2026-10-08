# FleetOps Passenger/Cargo Integration and Fuel — Implementation Baseline

**Current status — 2026-10-08:** Main is integrated into the feature worktree. Migrations 150–155 are applied through the authorized runner and the generated schema is refreshed; database status is 155 applied / 0 pending / 0 changed, the live contract is 77 relations / 0 violations, and the anon probe is 0 exposed / 29 refused / 48 inconclusive explained by that contract. The actual PostgreSQL readiness, cargo, four-endpoint blocker and preserved legacy-start cases pass. See [[FleetOps Passenger Cargo Review Closeout 2026-10-08]]. Real cohort commissioning, partner activation, device/browser acceptance and deployment are not claimed. Automatic provider publication remains disabled until an approved source is verified. Task 1 remains create-only; revisions/cancellations are not advertised as supported.**

### Historical prepared status before closeout

**Status: Tasks 1–13 prepared on isolated `feat/passenger-cargo`; the 2026-10-07 review defects have a verified offline correction patch on 2026-10-08. See [[FleetOps Passenger Cargo Review Fixes 2026-10-08]] for verification and current scope. NOT deployed: migrations 150–155 remain unapplied and no live behavior is claimed. Manual price repository/API/UI and explicit pending snapshot classification are now implemented offline. Remaining release gates: concurrent Hotel/POS reconciliation, authorized migration apply/dump, live RLS/grants/anon/FK/catalog/real-query verification, legitimate production-build configuration, browser/device acceptance and isolated demo reversal. Automatic provider publication stays disabled until an approved source is verified. Task 1 remains create-only; revisions/cancellations are not advertised as supported.**

Full task-by-task implementation plan: `docs/superpowers/plans/2026-10-05-fleetops-passenger-cargo-integration-and-fuel.md`.

## Scope and release order

FleetOps receives requests from external hotel/restaurant subsystems. The target is **integration-ready**: authenticated, versioned, source-scoped inbound/outbound contracts with partner fixtures and mocks; live PMS/POS connection is not a release prerequisite. Five services: Guest Transport, VIP Guest Transport, Restaurant Supply Pickup, Restaurant Food Delivery, Hotel Supply Transfer. Cargo is general non-specialized cargo only. No staff transport, shuttle, Operations mobile/account, mixed-load vehicle or new requester app.

1. Multi-source contract, request identity/revisions/cancellations, typed passenger/cargo payloads and canonical locations.
2. Vehicle asset identity, separate commissioning status, fail-closed road readiness, shared capacity/pair gate, dispatch/reassignment/start and deterministic Copilot evidence.
3. Driver mobile cargo presentation, trip-specific cargo-secure inspection, lifecycle display copy and loading/unloading schedule buffers.
4. Fuel baseline/distance, verified reference-price history, immutable per-trip estimated fuel/cost snapshot separate from receipt price; DOE/trusted-source adapter with validated fixtures and resilient manual fallback. Real automatic fetch stays disabled until an official source has been verified.
5. Reporting, opt-in reversible demo fixtures, regression and release acceptance.

## Decisions needing real evidence

- A restaurant order ID can collide with a hotel booking ID; identity must be source-scoped. User decision (2026-10-05): a `(source_system, external_request_id)` pair must never be reused, even when the old row is soft-deleted, so replay cannot create a new unrelated trip. Before the prepared Task 1 slice, ingest identified solely by external_booking_id; Task 1 now scopes create identity but still returns 409 for changed create/update/cancel, so revision/correction/cancel handling must be completed before rollout.
- Existing `source_system` in payload is not authenticated identity. Bind it to an authorized source principal; preserve single shared ingest across pull and push.
- Approved cargo payload, plate, OR/CR, insurance, registration and real driver license class require verified data. Inventory and remediation precede staged fail-closed rollout; do not fabricate compliance or strand previously committed trips silently.
- Road readiness and fuel-planning readiness are different. Fuel estimates are not actual burn and never replace receipt transactions.
- This plan is a coordination artifact, **not** verification of new features. Each implementation slice must update its corresponding feature notes and `SYSTEM.md` after passing tests and applicable live database safety gates.

## Planning verification

Cross-checked current repository notes for Reservations, Dispatch, Trips, Vehicles, Routes, Fuel and System Boundaries; inspected existing contract, ingest, package scripts, generated schema, and target file paths. No tests, migrations, source edits or live integration calls were run as part of planning. Existing `SYSTEM.md` had unrelated uncommitted changes; those must remain intact.


## Schema release inventory recorded before apply (2026-10-08)

The global hold covers **every** read/write introduced by drafts 150–155, including passenger reads through shared trip projections. Do not deploy only the UI or individual endpoints ahead of those migrations.

- **150/151:** typed intake/source identities, ingest/pull/push/idempotency, request assignment and snapshot reads, canonical service lookups and load fields, mobile inspection submission and trip start. Historical rows keep `load_type = NULL`; the draft does not rewrite them into Passenger.
- **152:** location-code create/update/list/lookup and intake location reconciliation.
- **153:** vehicle capability onboarding/updates, audited commissioning, availability searches, shared final pair gate, recommendation/queue/conflict evidence, cohort audit and typed cargo capacity. Road evidence includes saved verified documents and server-owned maintenance/incidents.
- **154:** manual reference-price GET/POST/PATCH, pending/active interval transitions, enabled provider persistence, completion repository lookups and the price-provenance join in shared trip/report queries. The new table has an explicit exact-file pending access decision; the live contract still fails when it is missing or unprotected.
- **155:** atomic completion capture and all shared trip/report projections that name planned/actual fuel fields. The common joins now also require **154**, so `/api/trips`, trip detail/active/latest-location feeds, driver trip reads and JSON/Excel report consumers share this hold.
- **150/151 demo preparation:** the opt-in local typed intake runner references prepared request fields and the canonical service catalog. It has not been run. Full dispatch/start/completion/price/device demo acceptance remains separate.

At the earlier offline checkpoint the generated schema remained untouched, and local fixtures did not prove application/rerun or live policies. The current closeout supersedes that state: the runner applied the migrations, the schema was dumped, the live contract/anon checks passed, and actual PostgreSQL temporary-table behavioral tests passed. See [[FleetOps Passenger Cargo Review Closeout 2026-10-08]]. Production fleet/device acceptance remains separate.

## Scheduling closeout rule

An explicit cargo arrival shorter than driving plus the 90-minute loading/securement/unloading/turnaround policy is rejected; the server does not extend a deficient supplied plan. Equal/backward ends reject as well. A missing arrival is derived only from known driving and handling evidence: 60 minutes driving produces 150 minutes occupancy. Adequate explicit plans remain unchanged, and overlap checks use the same accepted end that is saved.
