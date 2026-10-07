# FleetOps Passenger/Cargo Integration and Fuel — Implementation Baseline

**Status: Tasks 1–14 implemented as prepared code on isolated `feat/passenger-cargo` (2026-10-05 → 2026-10-07); acceptance suite `src/release-acceptance.test.js` green; full suite 331 files / 3,879 tests green. NOT deployed: migrations 150–155 unapplied (user holds live apply for separate authorization/staging), so no live behavior is claimed. Remaining gates before release: concurrent Hotel/POS reconciliation + merge, authorized apply checkpoint (`db:up`, `db:dump`, `verify:anon`, `db:contract`, catalog/real-query checks), Task 10 repository/API/UI + snapshot contract registration, production build env (`NEXT_PUBLIC_SUPABASE_URL`), device/browser acceptance, and the isolated-DB seed run. A concurrent Hotel/POS integration plan on `main` overlaps the request schema/ingest/gateway and reserves version 144; reconcile code plus migration ordering before merge. The plan itself is not proof of end-to-end behavior.**

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
