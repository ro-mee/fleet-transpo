# FleetOps Passenger/Cargo Integration and Fuel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support safe hotel/restaurant passenger and general-cargo trips end to end, with contract-ready multi-subsystem integration, vehicle readiness, deterministic dispatch, driver execution, and honest fuel estimates and reference-price history.

**Architecture:** Preserve the existing transportation-request/dispatch/trip lifecycle. Translate external contracts through the existing shared ingest path; centralize load, readiness and license hard gates server-side; project their evidence into recommendation/Copilot/web/mobile. Persist reference price provenance and trip-specific estimate snapshots separately from actual receipts. Ship as independently verifiable releases; no live PMS/POS or DOE connection is required for integration readiness.

**Tech Stack:** Next.js 16.2.11 / React 19 / Zod 4 / PostgreSQL (`pg`) / Supabase schema + RLS / Vitest; Expo mobile app (installed Expo ~54). Follow `AGENTS.md`, `.agents/AGENTS.md`, and `mobile/AGENTS.md`; read relevant versioned Next docs under `node_modules/next/dist/docs/` and mobile's required Expo docs before coding. The mobile instruction mentions v57 although the installed package is ~54: resolve this discrepancy before mobile implementation; do not assume API compatibility.

## Global constraints

- Operation groups: Guest Transport, VIP Guest Transport, Restaurant Supply Pickup, Restaurant Food Delivery, Hotel Supply Transfer. No staff/employee transport, guest shuttle, refrigerated/specialized cargo, Operations account/UI, mixed-use vehicle or requester app.
- Integration-ready means published, versioned, mock/fixture-tested contracts and source adapters; DO NOT claim an actual PMS/POS connection. Existing push/pull both call `ingestRequest()`; do not re-split them (the older `System Boundaries` summary predates the resolved debt note).
- Source-scoped identity is `(authenticated_source, external_request_id)`, NOT `external_booking_id` alone. Booking/order references are separate and not necessarily unique across requests. External `service_code` is stable; internal `service_type_id` is not a partner contract. Never trust caller-supplied `source_system` as identity.
- Legacy records retain historical meaning; unknown legacy request load is passenger-only where documented, and existing service types/rows are not deleted. No fictitious plate, weight, seats, efficiency, insurance or fuel prices.
- A cargo weight is gross declared consignment weight in kg; cargo capacity is approved usable vehicle cargo payload in kg. Exclude specialized loads and mixed passenger/cargo loads. Positive weight alone does not certify volume, securing or lawful GVW; human loading responsibility and the cargo-secure pre-trip item remain separate.
- Assignment, reassignment and trip start MUST revalidate capacity, road readiness, license, maintenance and conflict evidence server-side; recommendations/Copilot are advisory. Unknown required compliance fails closed for NEW dispatch/starts; existing commitments and historical rows are preserved for review, not silently erased.
- Fuel distance provenance and estimate basis are explicit; `estimated_fuel_consumed_l` is not measured burn and is never written to legacy `fuel_consumed`. Reference price never replaces receipt pump price; historical trip-price snapshots do not change with later prices.
- `schema.sql` is generated, never edited manually. Before EACH migration: `npm run db:status` (ledger owns numbering, including missing files). Idempotent migrations; after: `npm run db:up`, `npm run db:dump`, `npm run verify:anon`, `npm run db:contract`, catalog/real-query checks. For every new public table: explicit RLS, revoke anon/authenticated grants (including TRUNCATE), and register table in `scripts/lib/schema-contract.mjs`; any view uses `security_invoker`, no anon grants, and is registered. `npm run db:check` independently validates filenames.
- Each task follows RED → GREEN → focused tests → full relevant tests → lint → review → small commit; never deploy against the live DB merely to validate a plan. Run live DB commands only at the migration execution checkpoint, with correct environment and authorization. Update relevant `Capstone/` notes and `SYSTEM.md` after each behavioral slice; this planning document is not a claim that features are implemented.

## Release boundaries and dependencies

- **Release A: multi-source contract + passenger/cargo data** (Tasks 1–3). Demonstrate both PMS and POS fixture intake, legacy passenger compatibility, updates/cancels, distinct source identity. No live partner.
- **Release B: safe cargo dispatch** (Tasks 4–7). Demonstrate van/truck capacity, pending commissioning and missing compliance blocks, driver-license mismatch, reassignment/start cannot bypass gates. Feature flag or source/service enablement only after audited baseline data.
- **Release C: complete cargo driver workflow** (Tasks 8–9). Demonstrate cargo mobile + inspection + state wording + routes; retain current internal state machine.
- **Release D: fuel reference/estimate lifecycle** (Tasks 10–12). Manual verified prices and deterministic snapshotting are functional independently of automated source adapter; automated provider is an optional separate activation gate within Release D, not a dependency of Releases A–C.
- **Release E: reports, demo and rollout** (Tasks 13–14). P1 insurance metadata/POD/notifications/utilization/ranking are separate follow-ups, not hidden prerequisites of safety gates.

## Task 1: Freeze contract and source identity (Release A)

**Files:** Modify `src/lib/integration/contracts.js`, `src/lib/integration/ingest.js`, `src/lib/integration/booking-gateway.js`, `src/lib/integration/booking-notify.js`, `src/app/api/integration/transport-requests/route.js`; test `src/lib/integration/ingest.test.js`, integration route tests. Create focused `src/lib/integration/source-contract.js` and tests. Migration: `supabase/migrations/<next-unused-version>_transport_source_identity.sql` (choose the concrete number from `npm run db:status` immediately before writing; this is a naming rule, not an existing file).

**Interface:** `normalizeInboundEnvelope(raw, authenticatedSource)` returns `{ contract_version, source_system, external_request_id, external_revision, event_id, event_kind, request }`; source identity comes from authenticated adapter, not payload. V1 legacy adapter maps existing PMS `external_booking_id` to `external_request_id` without changing archived values. Unique active identity `(source_system, external_request_id)`; retain `external_booking_id` for compatibility until all readers/outbound writers switch. Explicit decision before migration on legacy duplicate IDs and soft deletes.

- [ ] RED: add tests with PMS `123` + POS `123` producing two rows, identical event ID replay producing one, changed revision applying once, stale revision rejected, and cancellation after dispatch requiring human review (no silent mutation). Example assertion: `expect(normalizeInboundEnvelope(raw, 'POS').source_system).toBe('POS')` even when `raw.source_system === 'PMS'`; assert `(POS,123)` and `(PMS,123)` persist as distinct requests.
- [ ] GREEN: implement separate source credentials/adapters (rotation/revocation plan), bind source principal, bounded accepted contract versions, deterministic update/cancel state rules, outbound correlation by source + request + event id/sequence, acknowledgements/retry/dedupe/reconciliation. Retain the existing shared push/pull ingest writer and reservation single-writer rule; use DB-backed unique constraints/transactions for races, not SELECT-only idempotency. Do not invent status transitions: if correction touches a committed trip, record pending review.
- [ ] Verify: targeted integration + security tests (impersonation, concurrent duplicate delivery, out-of-order change/cancel, unknown version, historical outbound status) via `npx vitest run src/lib/integration`; run `npm run verify:auth`; migration/catalog gates if schema changes. Publish inbound/outbound JSON examples and negative fixtures. Update `Capstone/01 - System/System Boundaries.md`.

## Task 2: Service taxonomy and discriminated requests (Release A)

**Files:** Modify `src/lib/integration/contracts.js`, `src/lib/integration/category-resolver.js`, `src/lib/integration/ingest.js`, `src/app/api/integration/transport-requests/route.js`; tests alongside each. Migration `<next-unused-version>_load_types_and_services.sql` adds `service_types.service_code/default_load_type`, request `load_type`, `cargo_weight_kg`, `cargo_description`, optionally source_department; add validated CHECKs and safe service catalog seed/upsert. Update `scripts/lib/schema-contract.mjs` only if a new relation is added.

**Interface:** `resolveService(code)` maps one of `GUEST_TRANSPORT`, `VIP_GUEST_TRANSPORT`, `RESTAURANT_SUPPLY_PICKUP`, `RESTAURANT_FOOD_DELIVERY`, `HOTEL_SUPPLY_TRANSFER` to internal service ID and declared load kind. Define passenger payload `{load_type:'Passenger', passenger_count: positive integer}` and cargo `{load_type:'Cargo', cargo_weight_kg: positive finite decimal, cargo_description: nonempty, passenger_count: null|0}`. Reject mismatched service/load kinds; do not infer load or vehicle payload from free-text keywords. Legacy unversioned PMS passenger intake stays working; distinguish invalid new payloads from legacy omissions.

- [ ] RED: `npx vitest run src/lib/integration/ingest.test.js`; pin cargo with absent count (not `1`), passenger missing/zero count rejected, negative/NaN cargo weight rejected, mismatched service code blocked, deprecated service code inactive but existing references intact.
- [ ] GREEN: extend Zod boundary and SQL data, map code to service type, backfill old requests as Passenger only when evidence supports it; unresolved rows go to review rather than guessed cargo. Keep raw source wording alongside IDs. Enforce validation in both push and pull paths via shared parse/ingest.
- [ ] Verify DB CHECKs / request projections, full focused tests, anon + contract gates. Update `Capstone/03 - Database/Tables/transportation_requests.md` and `Capstone/02 - Features/Reservations.md`.

## Task 3: Location identity and change semantics (Release A)

**Files:** Modify `src/services/route-resolver.service.js`, `src/lib/integration/ingest.js`, request API projection, associated tests; reuse `locations`, `addresses`, `pickup_location_id/dropoff_location_id`, `resolveRequestEstimate`. No automatic new location creation from arbitrary supplier text.

- [ ] RED: test POS supplier payload with verified point/address, same-name different places unresolved, retired ID fallback explicitly marked, missing coordinate returns unknown (never invented distance), and parent correction creates a new request revision without rewriting historic trip routes.
- [ ] GREEN: source supplies canonical Fleet location ID (when registered) OR named address + lat/lng for dispatcher verification; validate coordinate pairs/ranges, source provenance, optional route estimate; preserve parent's text and the existing durable location links. Choose a reconciliation policy for endpoint changes after dispatch; show dispatcher review rather than silently reroute.
- [ ] Verify read-only route tests and `npm run test:run`; update `Capstone/02 - Features/Routes.md`.

## Task 4: Vehicle model, onboarding and migration-safe road readiness (Release B)

**Files:** `src/app/api/vehicles/route.js`, `src/app/api/vehicles/[id]/route.js`, `src/app/(dashboard)/fleet/vehicles/new/page.js`, `src/app/(dashboard)/fleet/vehicles/[id]/edit/page.js`, `src/services/status.service.js`, documents routes; create `src/lib/vehicles/readiness.js` + tests. Migrations `<next-unused-version>_vehicle_capabilities.sql` and `<next-unused-version>_vehicle_commissioning.sql` only after ledger check.

**Interface:** `evaluateRoadReadiness(vehicle, documents, now) -> { ready:boolean, blockers:string[] }`; `evaluateFuelPlanningReadiness(vehicle) -> { ready:boolean, missing:string[] }`. Store unique non-null `fleet_asset_code`, nullable official `plate_number` (unique for non-null/non-deleted according to live constraints), `operational_use: Passenger|Cargo`, `cargo_capacity_kg`, `commissioning_status: Pending|Ready`; preserve `vehicle_status` synchronizer. Readiness requires official plate, verified OR/CR + valid registration and insurance, maintenance/safety clear, commissioning Ready. Backfill identity only using approved Fleet asset numbering; never synthesize plates or official compliance evidence.

- [ ] RED: pending-plate vehicle creation with asset code, status sync cannot mark commissioning ready, missing OR/CR/insurance/registration blocks, expired docs block, valid complete evidence passes; existing incomplete records are auditable. Include edits to old vehicles lacking category/class without hiding missing data.
- [ ] GREEN: additive nullable migration + inventory/audit report → staged fill of verified codes and docs → enforce new-create invariants and scoped dispatch gates. Separate mandatory road readiness from non-blocking fuel-profile completeness (price unavailable means no cost estimate, not fake cost). UI conditionally shows seats OR cargo kg; conditional fuel profile needs verified baseline.
- [ ] Verify vehicle/API tests, live catalog/constraint check and migration gates; review `Capstone/02 - Features/Fleet And Vehicles.md`. Do not assume unsupported truck license classes: verify actual classification/GVW before altering B/B1 controls, constraints and tests.

## Task 5: One load-capacity and pair-eligibility gate (Release B)

**Files:** Create `src/lib/scheduling/load-capacity.js` + tests. Modify `src/lib/scheduling/conflicts.js`, `src/services/recommendation.service.js`, `src/app/api/integration/transport-requests/[id]/assign/route.js`, `src/app/api/dispatch/route.js`, `src/app/api/dispatch/[id]/route.js`, `src/app/api/trips/[id]/start/route.js`, `src/app/api/vehicles/available/route.js`, common pair evidence.

**Interface:** `evaluateVehicleCapacity(request, vehicle) -> { eligible:boolean, code:string|null, required:number|null, capacity:number|null, unit:'passengers'|'kg' }`. Passenger requires passenger operation and positive seats; cargo requires cargo operation and positive usable kg; unknown type/required/capacity is **not** eligible. `validatePairAvailability` composes this pure result with road readiness, current license, maintenance, UVVRP, schedules and overlaps; override reason NEVER bypasses load/compliance/license safety blockers.

- [ ] RED: passenger 4/7 pass, 8/7 fail; cargo 650/1000 pass, 1800/1000 fail, 1800/2500 pass, cargo vs passenger and missing capacity fail. Assert original assign, reassignment, direct dispatch and trip start return the SAME blocker on a changed weight/vehicle; no option path may bypass server gate.
- [ ] GREEN: replace implicit `passenger_count || 1` logic with typed evaluator, thread results through all commit and read paths; re-evaluate inside final transaction/commit path when state can change. Make conflict codes stable for UI, logs, AI evidence and tests.
- [ ] Verify focused scheduling, assignment, availability and start suites; concurrency guard remains effective. Update `Capstone/02 - Features/Dispatch.md` and `Capstone/02 - Features/Trips.md`.

## Task 6: Cargo recommendation, Copilot and web dispatch (Release B)

**Files:** `src/lib/integration/category-resolver.js`, `src/lib/dispatch/recommendation-ranking.js`, `src/lib/dispatch/evidence-contract.js`, `src/lib/dispatch/conversation.js`, `src/app/api/integration/transport-requests/[id]/simulate/route.js`, `src/components/reservations/ai-recommendation-panel.jsx`, `src/components/dispatch/dispatch-edit-dialog.jsx`, fleet/dispatch/reservation queue display components, associated tests.

- [ ] RED: deterministic overweight explanation states required, capacity and excess (1400−1000=400 kg); simulation 900 kg changes ONLY capacity verdict and labels all other gates untested unless rerun. Cargo ranking chooses adequate light van over overlarge truck when other factors are equal; safety filters always precede cost/capacity-fit ranking. Reassign UI shows kg not seats.
- [ ] GREEN: service code/category hints only select candidate class, measured weight decides capacity; expose capacity evidence and source to Copilot, never ask LLM to determine eligibility. Web labels passenger or cargo explicitly; reassign dialog uses same blocked reasons, no acceptance button for hard-blocked pairs.
- [ ] Verify Copilot deterministic/evidence/adversarial suites, UI tests and browser accessibility/responsive check; update `Capstone/02 - Features/AI Advisory.md` and `Capstone/02 - Features/Dispatch.md`.

## Task 7: Rollout gate for existing fleet and assignments (Release B)

**Files:** Create read-only audit under `scripts/` (name at implementation), tests; modify source/service enablement policy and availability/admin evidence as required. Do not alter user records in a seed script.

- [ ] RED: audit enumerates missing asset identity, classes, official plates, OR/CR, insurance, payload and pair coverage; asserts legacy completed rows unchanged; fail-closed new booking does not cancel already committed schedules.
- [ ] GREEN: staged enablement: audit → staff verify categories/classes/docs → enable passenger gate on a validated cohort → cargo source + vehicles only when verified; publish no-match/blocked-reason counts and rollback of feature enablement without weakening compliance checks. Preserve committed-trip exception handling through dispatcher review, not blanket bypass.
- [ ] Verify acceptance fixtures, baseline vs after report and migration rollback procedure; document operator runbook in `Capstone/07 - Development/` and `SYSTEM.md`.

## Task 8: Driver API, cargo screens and lifecycle copy (Release C)

**Files:** `src/app/api/mobile/driver/trips/route.js`, `mobile/components/home/DriverHomeCards.jsx`, `mobile/app/(app)/(tabs)/trips.js`, `mobile/app/(app)/trip/[id].js`, `mobile/app/(app)/(tabs)/map.js`, web trip/timeline/notification presentation; create shared load presentation helper in `mobile/lib/` and tests. Read `mobile/AGENTS.md` and resolve Expo docs version before writing app code.

- [ ] RED: mobile API returns service code/name, load_type, passenger_count/cargo_description/weight, operational_use and cargo_capacity; cargo card/detail never render `Passengers: 0` or a guest name; passenger rendering unchanged. Cargo maps existing internal `PASSENGER_ONBOARD`/`DROP_OFF` to “Cargo Loaded”/“At Delivery” across mobile, web, notifications and monitoring without renaming DB state.
- [ ] GREEN: only the display mapping branches by load type; GPS acquisition and internal trip transition graph remain unchanged. Present missing cargo description honestly, not a fabricated label.
- [ ] Verify root route tests via `npm run test:run`, mobile tests via repo's existing mobile Vitest setup (inspect `mobile/vitest.config.*`; no `npm test` script is declared in `mobile/package.json`), device/browser checks; update `Capstone/02 - Features/Trips.md` and `Capstone/04 - Architecture/Mobile Architecture.md`.

## Task 9: Trip-specific cargo inspection and realistic booking duration (Release C)

**Files:** `src/lib/inspections/checklists.js`, `src/app/api/mobile/driver/inspections/route.js`, `mobile/lib/inspection-checklist.js`, `mobile/app/(app)/inspection.js`, `src/lib/scheduling/travel-buffer.js` or current time-buffer owner (verify before editing), tests.

- [ ] RED: cargo Pre-Trip demands `cargo_secure` and must not ask passenger-items question; passenger Pre-Trip unchanged; cargo-secure failure blocks server start. Pre-Shift and Post-Shift unchanged. Cargo schedule must include configured loading, securement, unloading and turnaround buffer, rather than treating drive ETA as full window; null scheduled arrival must not silently create a zero-length cargo booking.
- [ ] GREEN: server owns checklist version/type and validates mobile IDs; mobile mirror renders identical IDs/status; server start verifies correct per-trip passed checklist. Buffer is conservative policy data with named provenance; no fabricated timing claims.
- [ ] Verify server/mobile checklist and schedule overlap tests plus actual driver screen acceptance; update `Capstone/02 - Features/Trips.md` and `Capstone/02 - Features/Dispatch.md`.

## Task 10: Price snapshots and manual verified fallback (Release D)

**Files:** Migration `<next-unused-version>_fuel_price_snapshots.sql`; create `src/lib/fuel/price-policy.js` and tests, server-owned snapshot repository and permission-gated manual API/UI; `scripts/lib/schema-contract.mjs`; fuel tests.

**Interface:** snapshot fields include fuel product, region, currency `PHP`, unit `L`, reference price, prior price/adjustment, announced/effective/fetched timestamps (timezone-aware), official source URL, verification method `Manual|Automatic`, lifecycle `Pending|Active|Historical` (derive active by effective interval or atomically transition), ingestion event/source hash, verifier identity. Unique source/version/effectivity key; reject duplicate or implausible changes and unverifiable provenance. `priceAt(fuelType, region, instant)` returns a verified applicable snapshot or null; stale/absent is explicit. Preserve actual fuelreceipt unit price.

- [ ] RED: duplicate price ignored, future stays pending, later effective wins at cutoff, late correction never silently reprices completed trips, decimal/tz/region/type invalid rejected, no price returns unavailable.
- [ ] GREEN: additive RLS-enabled table with zero anon/auth grants, transactional manual verified write, authorized review UI and catalog registration. Define conflict handling for two pending announcements before effectivity and correction provenance.
- [ ] Verify `npm run db:check`, full migration/anon/contract/catalog gates, pure price tests and role authorization; update `Capstone/02 - Features/Fuel.md`.

## Task 11: Distance → planned/actual estimated fuel and cost (Release D)

**Files:** create `src/lib/fuel/trip-estimate.js` + tests; modify `src/app/api/trips/[id]/complete/route.js` and trip/fuel/report projections; migration `<next-unused-version>_trip_fuel_estimate.sql` adds dedicated estimated liters/cost/reference price and FK snapshot plus distance provenance/baseline snapshot as appropriate. Keep `trips.fuel_consumed` meaning unchanged.

- [ ] RED: 36 km/9 km·L⁻¹ = 4.00 estimated L; × PHP 62.70/L = PHP 250.80; planned 32 km and actual 36 km yield +4 km; odometer preferred to validated trip distance to GPS trail; no baseline/route/price yields null with reason, not 0 or fake actual. Subsequent fuel-price updates and vehicle-efficiency edits leave the stored completed-trip basis unchanged; receipt price independent.
- [ ] GREEN: pure decimal-safe estimate using captured distance, baseline, region, applicable effective price and provenance; write trip estimate once at completion with idempotent re-entry and expected fallback ordering. Planned and actual estimates are distinct records/fields; expense/receipt transaction remains separate.
- [ ] Verify focused tests, live migration checks, report arithmetic and docs in `Capstone/02 - Features/Fuel.md`, `Capstone/02 - Features/Trips.md`.

## Task 12: Optional official price-provider adapter and scheduling (Release D)

**Files:** create `src/lib/fuel/providers/official-reference.js` and parser fixture tests; `src/app/api/cron/sync/route.js` or dedicated protected cron route, tests; do not embed scraping in request/dispatch path.

- [ ] RED: official fixture parses price/adjustment + source URL/effectivity; 403/429/timeouts/format drift retain last verified snapshot; extreme 620 from 62 rejected; repeated fetch does not duplicate; announcement Pending until effective, then activated once. Test unsigned/untrusted data cannot self-verify.
- [ ] GREEN: provider fetch → parse → validate → pending snapshot → effective activation, with structured sync health and manual fallback. **Activation gate:** identify an official machine-readable/legally usable source and maintain representative dated fixtures; until then leave scheduler disabled and use manual verified snapshots. No fixed Tuesday assumption and no permanent hardcoded price.
- [ ] Verify mocked provider and cron authorization tests; if scheduled in DB, review `cron.job` live (schema.sql does not include it); update `Capstone/02 - Features/Fuel.md`.

## Task 13: Reports, demo fixtures and P1 isolation (Release E)

**Files:** report selectors/APIs/export paths discovered during implementation, `scripts/seed-demo.mjs`, report tests, service filter UI and `Capstone/` feature notes.

- [ ] RED: service filters cover five codes; cargo utilization = 650/1000 = 65%, unknown capacity omitted; trip report explicitly labels planned/estimated actual distance/fuel/cost and price source; export equals visible filtered view. Demo includes passenger/VIP/cargo fit/overweight, unregistered vehicle, missing insurance, license mismatch, completed cargo and price history.
- [ ] GREEN: additive reports and **opt-in** repeatable seed preserving real identities/configuration, with seed down scoped to tagged rows. P1 separately plan insurance metadata, proof of delivery, notification wording, source department analytics and cost ranking after core passes; no cargo POD dependency for starting trips unless stakeholder explicitly changes scope.
- [ ] Verify seed plan/undo on isolated DB, report export tests, regression suites and scenario checklist; update Analytics/Reports, Fuel and Reservations notes.

## Task 14: End-to-end release acceptance and documentation (Release E)

**Files:** contract fixture docs under `docs/architecture/`, relevant `Capstone/` notes (Vehicles, Reservations, Dispatch, Trips, Routes, Fuel, AI, Mobile, Inspections), `SYSTEM.md`.

- [ ] RED-to-GREEN acceptance: two partner fixtures with same ID never collide; replay/cancel/revision rules deterministic; cargo 650/1000 passes, 1800/1000 blocks, 1800/2500 passes; pending vehicle/missing docs/license blocks; reassign + start cannot bypass; cargo inspection and lifecycle complete; 36/9/62.70 yields 4.00 L/PHP 250.80; receipt independent; provider failure uses last verified with stale warning; historical trip snapshot remains fixed.
- [ ] Execute root `npm run test:run`, `npm run lint:ci`, `npm run build`, `npm run verify:auth`, `npm run db:check`, and migration gates when DB changed. Run mobile Vitest with verified root or mobile config, manual device acceptance for Home/Trips/Inspection; explicit server-authoritative authorization and RLS probe. Record counts and environment; never assert browser/device verification from unit tests alone.
- [ ] Review historical passenger trips, source identities, service catalog status and old reports for regressions; publish partner v1 examples/error/status delivery contract; update all relevant `Capstone/` notes and `SYSTEM.md` **after actual implementation**, then request a final review. Do not mark release done merely because the plan exists.

## Open decisions before coding

1. Exact accepted request revision/cancellation protocol for already assigned/in-progress trips (recommended: require dispatcher review instead of automatic mutation).
2. Who certifies usable cargo payload and authoritative OR/CR/insurance documents; confirm actual GVW/license class for real L300/truck units before enabling those units.
3. Official fuel source availability, permission to parse it, published region/product taxonomy, and stale-price warning horizon. Manual verified fallback is required regardless.
4. Source-specific authentication provisioning and callback/reconciliation protocol; mock contracts suffice until parent subsystems are available.
5. Existing `SYSTEM.md` already has uncommitted changes in this workspace; preserve them and keep plan/documentation edits isolated. No implementation, migration, seed or live data mutation is authorized by this planning artifact.
