# Driver Qualifications and Cargo Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver two driver qualification groups and a traceable cargo pickup, discrepancy approval, delivery and source-feedback workflow in the existing web dashboard and shared mobile app.

**Architecture:** Keep transportation-request cargo and independent supply shipments as distinct intake models. Normalize their existing manifest sources into one trip execution contract without copying SCM manifests into transportation requests. Store immutable observations, revision-bound decisions and durable feedback separately from trip lifecycle and source-owned inventory.

**Tech Stack:** Installed Next.js 16.2.11, React 19.2.4, PostgreSQL via pg, existing Zod/Vitest/RBAC/storage infrastructure; Expo 54 and React Native 0.81.5 with React 19.1.0 on mobile. Preserve versions and installed libraries.

## Status and global constraints

- Planning only, 2026-10-09. Creating this plan does not authorize production policy decisions, enable supply assignment or implement the feature.
- Exactly two groups: PASSENGER (Guest Transport/VIP Guest Transport) and CARGO (Restaurant Supply Pickup/Restaurant Food Delivery/Hotel Supply Transfer). Hotel and restaurant cargo share drivers and screen structure.
- A driver may hold both groups only through explicit approval. Cargo approval covers all three cargo service codes; do not create restaurant/hotel cargo subgroups or hidden source-specific qualification restrictions.
- General non-specialized cargo; first release one shipment, trip and destination. No inventory writer, split loads, physical returns or automatic post-load cancellation.
- Source business owner decides quantity acceptance; Fleet clears transport; driver observes; authorized receiver confirms receipt. Actual owner authority must be recorded before enabling writes that depend on it.
- One shared app; assigned trip selects passenger/cargo workflow. Impeccable, UI UX Pro Max and High-End Visual Design are mandatory for mobile UI/UX.
- Original expectations, picked-up quantity and delivered quantity remain separate. Photo reference is not proof of observed receipt. Partner acknowledgement is not shortage approval.
- Existing license, scheduling, consent, vehicle readiness, capacity, inspection, geofence and fuel rules remain independent checks. Business approval cannot bypass safety checks.
- All new evidence is private, ownership-scoped and audited. Never store bearer URLs, credentials or rejected raw payloads in logs.
- All migrations require a fresh `npm run db:status`, idempotent SQL, repository runner, generated dump, schema classifications and live contract/anon checks. Never edit applied SQL or generated schema manually.
- Read `.agents/AGENTS.md`, relevant vault notes and installed Next.js guides before execution. Route `params` is a promise; use `const { id } = await params`.
- Preserve unrelated working-tree edits; create/reuse an isolated worktree at execution. This planning session did not create one or commit other people's edits.

## Verified baseline and important lifecycle correction

Read-only database status during planning: 155 applied files, 0 pending, 0 changed; historical ledger-only filenames 113/114/115 remain. Do not reserve migration numbers from this snapshot; choose each at execution after rereading the ledger.

Existing sources:

| Concern | Existing implementation |
|---|---|
| Typed service/load mapping | `src/lib/integration/contracts.js` exports `SERVICE_CODES`, `serviceLoadFor`; request v2 remains create-only |
| Machine/request identity | `src/app/api/integration/transport-requests/route.js`, `src/lib/integration/source-contract.js`, `src/lib/integration/ingest.js` |
| SCM manifests | `src/lib/supply/contracts.js`, `src/lib/supply/sandbox-integration.js`; `supply_manifest_revisions.manifest_snapshot` contains request lines |
| Shared final pair check | `src/services/recommendation.service.js::validatePairAvailability` |
| Preview/conflicts/Copilot | `src/lib/scheduling/conflicts.js`, `src/lib/ai/pair-scoring.js` |
| Commit evidence | `src/services/dispatch-evidence.service.js` |
| Trip progress/completion | `src/services/transition.service.js`, `src/services/trip-lifecycle.service.js`, `src/lib/scheduling/trip-state.js` |
| Driver ownership | `src/lib/api/ownership.js::assertTripOwnership` |
| Existing mobile cargo | `mobile/lib/load-presentation.js`, `mobile/app/(app)/trip/[id].js`, `mobile/app/(app)/(tabs)/map.js` |
| Mobile offline infrastructure | `mobile/lib/api.js`, `mobile/lib/sync.js`, `mobile/lib/offline-cache.js` |
| Private photo precedent | `src/lib/driver/incident-storage.js`, `src/lib/storage/object-refs.js` |

`Trip Started` begins travel TO pickup. Do not require completed cargo pickup before Start Trip. Recheck qualifications at start; require pickup verification/acceptance at cargo loading and departure transitions (`Passenger Onboard` displayed as cargo-loaded, `En Route`, and legacy `In Progress` paths). Delivery receipt gates completion. A separate pickup securement check is required after loading; the pre-trip vehicle inspection remains before travel to pickup. Do not rename database trip statuses merely to improve cargo copy.

The supply module still has measurement-only evaluation and disabled assignment. Its integration requires the existing D01–D10 owner gates; new execution code must not treat a load-fit result as dispatch eligibility.

## Contract shared across workstreams

Create `src/lib/cargo/contracts.js` and use these names consistently:

```js
// ManifestView: identifiers are opaque strings; quantities are decimal strings.
{
  manifest_ref: { kind: 'REQUEST' | 'SUPPLY', id: 'uuid', revision: 1, hash: 'sha256' },
  source_ref: { system: 'PMS' | 'POS' | 'SCM', organization_id: 'opaque', external_request_id: 'opaque' },
  service_code: 'HOTEL_SUPPLY_TRANSFER',
  lines: [{ line_id: 'oil', name: 'Cooking oil', quantity_basis: 'TRANSPORT_PACKAGE',
    expected_quantity: '10', unit: 'box', reference_image_ref: null, handling: [] }]
}
// ReceiptInput: stage is PICKUP or DELIVERY; no caller-supplied approver/driver IDs.
{
  submission_id: 'uuid', manifest_ref: { kind: 'REQUEST', id: 'uuid', revision: 1, hash: 'sha256' },
  stage: 'PICKUP', observed_at: '2026-10-09T08:00:00Z',
  lines: [{ line_id: 'oil', observed_quantity: '9', condition: 'INTACT',
    issue_code: 'SHORTAGE', remarks: 'Supplier presented nine boxes.', evidence_ids: ['uuid'] }],
  receiver_confirmation_ref: null
}
// DecisionInput: refers to a specific immutable receipt, not just trip ID.
{
  event_id: 'uuid', receipt_id: 'uuid', manifest_hash: 'sha256',
  action: 'WAIT' | 'ACCEPT_OBSERVED' | 'REJECT_PICKUP', reason: 'Authorized explanation'
}
// CargoExecutionView
{
  execution_id: 'uuid', trip_id: 701, version: 1, manifest: /* ManifestView */ {},
  pickup_receipt: null, delivery_receipt: null, source_decision: null, fleet_clearance: null,
  pickup_state: 'NOT_RECORDED' | 'AWAITING_DECISION' | 'WAITING' | 'READY' | 'REJECTED',
  delivery_state: 'NOT_RECORDED' | 'CONFIRMED' | 'AWAITING_REVIEW',
  feedback: { state: 'PENDING' | 'ACKNOWLEDGED' | 'FAILED', last_error_code: null },
  blockers: [{ code: 'CARGO_PICKUP_REQUIRED', message: 'Verify cargo at pickup.' }]
}
```

These are proposed interfaces, not code to paste with comment placeholders. The tasks below supply validation/implementation. Expected counts are not included in receipt input: read them from the locked manifest. Supply `transport_package_count` is not `ordered_quantity`: use package basis and integer counts unless an approved unit-level contract explicitly permits decimals. Never compare boxes against individual units or silently convert a source unit.

All mutations return `{ data: CargoExecutionView }` using existing API helpers. Use 400 for invalid input, 404 for inaccessible trips/evidence, 409 for stale/conflicting state, 403 for forbidden staff/source actions and 503 for disabled policy/partner configuration. Machine codes are stable and human messages are English. Preserve exact replay response by submission/event ID and canonical payload hash; changed replay returns 409.

## Build sequence and gates

| Workstream | Tasks | Independently reviewable result |
|---|---|---|
| A: Qualifications | 0–3 | Approved two-group policy, audited management and consistent eligibility |
| B: Cargo records/backend | 4–8 | Manifest adapters, private evidence and guarded pickup/delivery workflow |
| C: Integration reliability | 9–10 | Sandbox feedback, authenticated decisions, durable retries and scoped offline capture |
| D: Web/mobile/release | 11–14 | Staff review, accessible mobile execution, reports and full acceptance |

Tasks 1–3 can be developed disabled before cargo workflow approval. Task 4 schema/contract work requires data/privacy contract approval; Tasks 6–8 require receipt/decision/safety authority. Sandbox is not a way to infer production policies. Supply dispatch activation is a separate gated step in Task 8.

### Task 0: Record design decisions and approve execution boundaries

**Files:** create `docs/superpowers/specs/2026-10-09-driver-qualifications-cargo-verification-design.md`; update `docs/plans/supply-chain-owner-approval-worksheet.md` only from actual decisions; review the roadmap and `docs/plans/supply-chain-fleet-integration-plan.md`.

**Consumes:** the confirmed two groups and existing cargo paths. **Produces:** approved source mapping, policy version, authorities, rollout mode, receipt quantity/evidence/receiver rules and field-tested mobile brief.

- [ ] Read live ledger/current branches and inventory every assignment/start/progress/completion writer with `rg -n 'validatePairAvailability|setTripStatus|completeTrip|UPDATE trips|INSERT INTO dispatchschedules' src`.
- [ ] Document REQUEST intake as PMS/POS typed cargo with its own immutable request manifest; SUPPLY intake reuses SCM manifest revisions/allocation. A source kind is resolved server-side; a request cannot impersonate an SCM allocation.
- [ ] Record exact goods-license/training, load-plan/axle/securement, interval, receiver, shortage and exception-closeout owner decisions. Pending ownership is an explicit disabled capability, not a default value. Do not fabricate signatures or dates.
- [ ] Record qualification rollout stages OFF, SHADOW, ENFORCE and the opt-in cargo execution gate. SHADOW produces evidence only; enable ENFORCE only after roster review. Record pre-existing scheduled/active trip treatment with named owner; otherwise activation is blocked.
- [ ] Define photo retention/size limits and cleanup authority. Proposed technical limit for review: five JPEG/PNG/WebP photos per issue, 5 MiB each; policy owners must approve retention before live storage activation.
- [ ] Validate normal/short pickup and delivery state tables with owners; get design approval before implementation under the brainstorming skill. Planning can continue while gated decisions are unapproved.
- [ ] Commit only reviewed documentation with `docs: define cargo qualification and receipt boundaries`.

**Acceptance:** document names actual approved authority/version; unapproved capabilities explicitly remain disabled. No unrelated policy or cargo assignment is activated.

### Task 1: Implement two-group qualification policy and persistence

**Create:** `src/lib/drivers/service-qualifications.js`, `src/lib/drivers/service-qualifications.test.js`, `src/services/driver-qualification.service.js`, `src/services/driver-qualification-db.integration.test.js`. **Modify:** `scripts/lib/schema-contract.mjs`. Add one newly numbered migration under `supabase/migrations/` after the ledger check; execution selects the exact filename and records it here before writing.

**Interfaces:** `groupForService(serviceCode) -> 'PASSENGER'|'CARGO'|null`; `evaluateServiceQualification({ serviceCode, qualification }) -> { eligible, code, group }`; `loadDriverQualifications(driverIds, db) -> Map<number, Qualification[]>`; `setDriverQualification({driverId,group,status,policyVersion,reason}, session) -> Qualification`.

- [ ] Write failing tests for the exact five services, unknown service rejection, missing/inactive qualification, dual groups and cargo eligibility independent of hotel/restaurant source:

```js
import { expect, it } from 'vitest';
import { evaluateServiceQualification } from './service-qualifications';
it.each(['RESTAURANT_SUPPLY_PICKUP','RESTAURANT_FOOD_DELIVERY','HOTEL_SUPPLY_TRANSFER'])('%s uses cargo qualification', serviceCode => {
  expect(evaluateServiceQualification({serviceCode, qualification:{group:'CARGO',status:'ACTIVE',policy_version:'demo-v1',verified_by:21,verified_at:'2026-10-09T08:00:00Z'}}))
    .toMatchObject({eligible:true,group:'CARGO'});
});
it('does not let cargo approval authorize guest transport', () => {
  expect(evaluateServiceQualification({serviceCode:'GUEST_TRANSPORT',qualification:{group:'CARGO',status:'ACTIVE',policy_version:'demo-v1',verified_by:21,verified_at:'2026-10-09T08:00:00Z'}}).eligible).toBe(false);
});
```

- [ ] Run `npm run test:run -- src/lib/drivers/service-qualifications.test.js`; confirm missing-module/behavior failure.
- [ ] Implement pure mapping using the canonical existing `serviceLoadFor`; reject unknown codes rather than guessing from source name. An ACTIVE record requires valid verifier/date/policy version; reject missing provenance in pure and persistence tests. Treat group comparison as independent from license eligibility.
- [ ] Add `driver_service_qualifications`: primary UUID, driver FK, `qualification_group` constrained to PASSENGER/CARGO, status ACTIVE/SUSPENDED/REVOKED, policy version, verified_by employee FK, verified_at, reason, version, created/updated timestamps; unique `(driver_id, qualification_group)`. Add append-only `driver_service_qualification_events` with actor, old/new status/group, reason, time and policy version. No blanket roster INSERT.
- [ ] Add DB CHECKs for ACTIVE review provenance, group/status enumerations and positive version. Enable RLS, revoke all anon/authenticated privileges on both tables and classify them private. Use `writeAuditRequired` in the same transaction as current record and history.
- [ ] Verify migration idempotence and constraints in isolated PostgreSQL fixtures; run `db:check`, apply with runner only in the approved target, dump and verify RLS/grants/anon. Do not auto-run unrelated pending files without review.
- [ ] Run pure/DB tests and touched lint; update Driver Management/database notes; commit `feat: add audited passenger and cargo qualifications`.

### Task 2: Expose qualification management and web profile section

**Create:** `src/app/api/drivers/[id]/qualifications/route.js`, matching `route.test.js`, `src/components/drivers/service-qualifications.jsx`, `src/components/drivers/service-qualifications.test.js`. **Modify:** `src/app/(dashboard)/drivers/[id]/page.js`, `src/lib/auth/permissions.js`, `scripts/verify-route-auth.mjs` classifications if required by its existing scanner.

**Interfaces:** GET returns both group states and history; PUT accepts `{group,status,policy_version,reason,expected_version}` and returns current persisted qualification. Reviewer identity/time comes from authenticated staff/server, never body.

- [ ] Add route tests: driver cannot self-approve; management read only; staff without approved write permission denied; changed version 409; invalid group 400; missing driver 404; spoofed verifier ignored/rejected.
- [ ] Run `npm run test:run -- 'src/app/api/drivers/[id]/qualifications/route.test.js'` and record failure.
- [ ] Use existing `requirePermission` infrastructure with dedicated `driver_qualifications.read/manage` actions according to Task 0 approved roles. Do not grant manage through broad `trips.update`. Validate body strictly; update with locked row and expected-version check.
- [ ] Add Passenger Driver and Cargo Logistics Driver sections with allowed services, status, reviewer/date, policy version and history. Show saved status after authoritative refetch; no optimistic approval. Show missing approval honestly. Server permissions control both reads and writes.
- [ ] Test save rejection retains inputs; readonly user sees no mutate action; refresh shows returned state. Use existing component test harness; Vitest runs only `src/**/*.test.js` and `mobile/lib/**/*.test.js`.
- [ ] Run focused tests, touched lint, `verify:auth`; update Driver Management; commit `feat: manage driver service qualifications on profiles`.

### Task 3: Wire qualification into every eligibility boundary

**Modify:** `src/services/recommendation.service.js`, `src/services/dispatch-evidence.service.js`, `src/lib/scheduling/conflicts.js`, `src/lib/scheduling/conflict-types.js`, `src/lib/ai/pair-scoring.js`, `src/app/api/trips/[id]/start/route.js`, `src/app/api/dispatch/route.js`, `src/app/api/dispatch/[id]/route.js`, `src/app/api/integration/transport-requests/[id]/assign/route.js`, `src/app/api/integration/transport-requests/dispatch-plan/route.js`, `src/app/api/dispatch/availability-pairs/route.js`, `src/app/api/vehicles/available/route.js`. Existing custodial/substitute routes remain service-neutral; evaluate their eligibility at service-specific dispatch and expose qualification summaries without treating custody as all-service approval.

**Create:** `src/services/driver-qualification-boundaries.test.js`. **Extend:** existing pair/start/assign/conflict tests and `src/services/passenger-cargo-db.integration.test.js`.

**Interfaces:** shared blocker `DRIVER_SERVICE_QUALIFICATION_REQUIRED` includes required group/service; `validatePairAvailability` retains its existing return shape. Extend dispatch commit evidence with qualification version and canonical stored service code.

- [ ] Write route/service tests proving the same driver qualifies for all three cargo services, fails Passenger unless separately approved, and revoked qualification between preview and write cannot commit. Include substitute selection, reassignment and direct start.
- [ ] Run the boundary tests and existing start route tests; confirm intended failures.
- [ ] Pin service code from stored request/service catalog, not request-body overrides. Legacy untyped rows follow only Task 0 approved rollout compatibility; unrecognized service is a blocker in ENFORCE. Batch-load qualification records with driver context instead of N+1 queries.
- [ ] Inject the pure evaluator into preview/conflict/Copilot and final gate. Read/lock qualification version within final commit transaction or validate a version token that is rechecked inside `commitDispatchEvidence`; an earlier read alone is insufficient.
- [ ] Recheck qualification at trip start and cargo departure; preserve driver/vehicle availability gates. Qualification revocation marks pending work for review; do not auto-delete/reassign an active trip.
- [ ] Run changed eligibility suites, focused live fixture race test, lint and auth gate; update Dispatch/AI Advisory/Driver Management; commit `feat: enforce shared driver qualification across dispatch`.

### Task 4: Implement manifest contracts and adapters

**Create:** `src/lib/cargo/contracts.js`, `src/lib/cargo/contracts.test.js`, `src/lib/cargo/quantities.js`, `src/lib/cargo/quantities.test.js`, `src/services/cargo-manifest.service.js`, `src/services/cargo-manifest.service.test.js`, `src/lib/integration/source-auth.js`, `src/lib/integration/source-auth.test.js`, `src/app/api/integration/cargo/manifests/route.js`, matching test. **Modify:** existing request route to share extracted PMS/POS machine auth without changing its staff-injector semantics; only cargo-machine routes use machine-only mode. New request-manifest migration/classification; existing supply immutable SQL stays unchanged.

**Interfaces:** `normalizeQuantity(value,{basis}) -> canonical decimal string`; `compareQuantities(expected,actual) -> -1|0|1`; `resolveTripManifest(tripId, db) -> ManifestView|null`; `ingestRequestManifest(envelope,principal,db) -> {manifest_ref,replayed}`; `authorizeCargoSource(req,{allowSandbox}) -> {system,organization_id,subject,capabilities}|null`.

- [ ] Test invalid decimals/negative/nonfinite, unknown lines, duplicate IDs, empty/oversized manifests, mixed units, package-count integers and wrong service/load. Use canonical decimal strings and integer-scaled arithmetic (up to three fractional digits); never float subtraction for shortages.
- [ ] Run contracts/quantity tests RED; implement strict schemas with max 500 lines, finite positive expected quantities, nonnegative observations and no uncontrolled reference URLs.
- [ ] Add immutable `request_cargo_manifest_revisions`: UUID, request FK, revision, canonical hash, source event ID, manifest JSON, source organization and creation time; unique request/revision and source/event. Source-bound exact replay is 200; changed event/revision is 409. Existing v1/v2 request ingest remains unchanged; manifest endpoint attaches only to an existing cargo request owned by the principal.
- [ ] SUPPLY adapter reads the allocation's immutable `supply_manifest_revisions.manifest_snapshot.lines`; expected package count comes from `transport_package_count`, stable line from `external_line_id`, name from description/SKU. No implicit conversion of `ordered_quantity`/`ordered_uom`. Until supplier provides a packaging label, display packages.
- [ ] REQUEST adapter reads its request-manifest revision. Missing item manifest yields `CARGO_MANIFEST_REQUIRED`; never manufacture item lines from cargo_description. Keep existing summary reads available while enforcement is disabled.
- [ ] Extract machine auth from current request route with equal-secret/invalid-token no-fallback regressions. Production SCM identity remains disabled until an approved org-scoped credential mapping exists; staff sandbox injectors remain separately gated/nonproduction. Source field in JSON never authenticates caller.
- [ ] Lock relevant request/shipment and prevent revision changes once pickup custody begins. Before pickup, invalidate execution/decision references transactionally and require explicit rescheduling review. Do not advertise request updates/cancels as implemented by this manifest endpoint.
- [ ] Run contract/adapter/auth tests and DB idempotence fixtures, migration/privacy gates; update transportation_requests/supply foundation/System Boundaries; commit `feat: normalize source cargo manifests without duplicate ownership`.

### Task 5: Add execution, receipts, decisions and private evidence persistence

**Create:** `src/services/cargo-execution.repository.js`, `src/services/cargo-execution-db.integration.test.js`, `src/lib/cargo/evidence-storage.js`, matching test; new migration and private classifications. **Modify:** `src/lib/storage/key-format.js`, `src/lib/storage/object-refs.js` only for private cargo bucket/object-key vocabulary.

**Interfaces:** `loadExecutionForUpdate(tripId,tx)`, `insertReceipt(input,actor,tx)`, `appendCargoDecision(input,principal,tx)`, `appendCargoFeedback({execution,eventType,receipt,decision},tx) -> eventId` in `cargo-execution.repository.js`, `storeCargoEvidence({file,tripId,submissionId},actor) -> {evidence_id}`. Signed URLs are produced only for authorized reads. The append helper persists events only; Task 9 provides network delivery.

- [ ] Write actual PostgreSQL tests for one execution/trip, exclusive REQUEST/SUPPLY binding, immutable receipt/history, invalid FKs, changed replay, and two simultaneous submissions. Evidence tests reject foreign trip IDs, mismatched ownership, oversized bytes, unsupported/spoofed MIME and arbitrary object keys.
- [ ] Run repository/evidence tests RED; use isolated fixture namespaces/transactions that do not insert operational rows. Follow existing DB harness teardown discipline.
- [ ] Add `cargo_trip_executions` (UUID, unique trip FK, exactly one request-manifest FK or supply-allocation FK, version, timestamps); `cargo_receipts` (UUID, execution FK, PICKUP/DELIVERY, manifest ref/hash, submission UUID, canonical payload hash, normalized lines JSON, reporter employee/driver, observed/received timestamps, receiver confirmation ref; unique execution/submission); `cargo_decisions` (UUID, receipt FK, immutable action, principal/source, reason, event ID/hash, timestamp); `cargo_fleet_clearances` (receipt/decision binding, authorized staff, version, reason/time); `cargo_evidence` (UUID, execution, uploader, submission, private key, MIME/byte length, created time and retention state). Use FKs, unique indexes and immutable receipt/decision triggers.
- [ ] Create private `cargo-evidence` storage bucket through reviewed idempotent SQL; revoke public access. Use server UUID object keys scoped to execution/submission. Store key, not URL; validate actual bytes with existing upload validator. Server associates uploaded evidence only with its authenticated execution/actor; receipt may reference only matching ready evidence.
- [ ] Treat photo upload and DB transaction as separate failure boundaries: staged evidence can be uploaded again idempotently; failed attachment leaves a tracked orphan. Implement cleanup only with Task 0 approved retention rules; never silently erase unsynced evidence.
- [ ] Add private `cargo_feedback_outbox` and `cargo_decision_inbox` in this schema task using the exact columns/uniqueness described in Task 9. Implement `appendCargoFeedback` with stable event UUID, immutable canonical payload/hash and initial PENDING state; duplicate logical execution/version/type/receipt event returns existing ID, conflicting payload rejects. This removes any dependency on a future network worker from receipt transactions.
- [ ] Add RLS/revokes and classifications for every table; runner/apply/dump/catalog/anon checks. Verify private bucket and cross-owner signing in addition to table grants.
- [ ] Run DB/evidence tests, lint; update database/Trips notes; commit `feat: persist immutable cargo receipts and private evidence`.

### Task 6: Implement receipt state and discrepancy decision service

**Create:** `src/lib/cargo/execution-state.js`, matching test, `src/services/cargo-execution.service.js`, `src/services/cargo-execution.service.test.js`.

**Interfaces:** `deriveCargoState({manifest,pickup,delivery,decision,clearance}) -> CargoState`; `submitCargoReceipt(tripId,input,session) -> CargoExecutionView`; `recordSourceDecision(tripId,input,principal) -> CargoExecutionView`; `clearCargoDeparture(tripId,{receipt_id,expected_version,reason},session) -> CargoExecutionView`; `getCargoExecution(tripId,session) -> CargoExecutionView`. CargoState contains `pickup_state`, `delivery_state`, `can_depart`, `can_complete`, `blockers` and normalized `lines`; every line contains `line_id`, `unit`, `expected_quantity`, nullable `pickup_quantity`/`delivery_quantity`, `order_shortage`, `delivery_shortage` and condition issues. Unrecorded counts remain null, not zero; shortages are null until their relevant observation exists. With observation, compute nonnegative shortages in the same quantity basis using scaled integers.

- [ ] Add quantity and state tests with realistic immutable records:

```js
it('waits for acceptance of a 10 to 9 pickup', () => {
  const state = deriveCargoState({manifest:oil10,pickup:oilPickup9,delivery:null,decision:null,clearance:null});
  expect(state).toMatchObject({pickup_state:'AWAITING_DECISION',can_depart:false});
});
it('keeps order shortage when all collected boxes arrive', () => {
  const result = deriveCargoState({manifest:oil10,pickup:oilPickup9,delivery:oilDelivery9,decision:acceptPickup9,clearance:clearPickup9});
  expect(result.lines[0]).toMatchObject({expected_quantity:'10',pickup_quantity:'9',delivery_quantity:'9',order_shortage:'1',delivery_shortage:'0'});
});
```

Define `oil10`, pickup/delivery receipts, decision and clearance in the same test file using the shared contract; references bind identical receipt IDs/hash/version. Also test stale decision, WAIT/recount, REJECT, damaged/wrong items, zero counts, unknown/duplicate/missing lines, delivery exceeding pickup and unsupported corrections.

- [ ] Run state/service tests RED. Implement quantity comparisons against manifest for pickup and latest authorized pickup for delivery. Condition exceptions remain distinct from missing quantity; overages also require review.
- [ ] Lock trip/execution/current manifest and relevant receipt/decision inside one transaction. Derive actor IDs from session and source identity. Exact submission replay returns original response; changed same-ID submission 409; unique-ID recount appends a new receipt and invalidates old decision/clearance.
- [ ] For clean pickup set READY only after approved securement/safety evidence and Fleet clearance requirements. For discrepancy, WAIT holds; ACCEPT_OBSERVED binds current receipt; REJECT prevents loading. Reject source decisions after departure rather than altering custody; record attempted late decisions safely.
- [ ] Record receiver confirmation through Task 0 approved authority method; driver-entered name alone does not confirm delivery. Until method is configured, return `CARGO_RECEIVER_CONFIRMATION_REQUIRED` and keep completion blocked. Sandbox confirmation is explicitly simulated and cannot run in production.
- [ ] Insert mandatory audit and outbound event in the receipt/decision transaction using Task 5's `appendCargoFeedback`; network delivery stays disabled until Task 9. Rollback if required audit/event write fails.
- [ ] Run state/service/DB tests; update Trips/shortage scenario; commit `feat: enforce cargo pickup and discrepancy decisions`.

### Task 7: Add scoped cargo APIs and reviewer actions

**Create route/test pairs:** `src/app/api/trips/[id]/cargo/route.js` (GET), `cargo/receipts/route.js` (POST), `cargo/evidence/route.js` (POST), `cargo/clearance/route.js` (POST), `src/app/api/integration/cargo/decisions/route.js` (POST), `src/app/api/trips/[id]/cargo/manual-decision/route.js` (POST). **Modify:** permission matrix and auth audit classification where necessary.

**Interfaces:** routes delegate Task 6 methods; machine decision references externally scoped source request plus receipt ID; trip ID is resolved server-side. Manual decision requires recorded source approver identity/reference, actual communication evidence and reason; authorized Fleet staff record it but are not automatically the source business approver.

- [ ] Write API tests for own-driver observation, foreign trip/evidence 404, unauthenticated refusal, manager readonly, driver self-approval denial, staff lacking clearance permission, source/request mismatch, invalid bearer no browser fallback, production sandbox denial and duplicate/conflicting decisions.
- [ ] Run route tests RED. GET uses trip ownership and approved staff read permissions. POST receipts accepts only active assigned driver observation or explicitly permitted staff correction, with correction provenance. Dedicated manage/read/clearance/manual-decision rights follow Task 0 matrix.
- [ ] Use `await params`, strict schemas, existing error envelopes and `AuthError` codes. Reject caller actor IDs, signed URL references, source names without credentials and evidence from another execution.
- [ ] GET signs authorized photos on demand with bounded expiry; lists omit full evidence URLs/receiver contact. Add pagination to history and bounded source payloads.
- [ ] Run API/auth tests and `npm run verify:auth`; update Authentication/Trips documentation; commit `feat: expose scoped cargo verification and decision APIs`.

### Task 8: Enforce cargo checkpoints in existing lifecycle and activate approved supply allocation separately

**Modify:** `src/services/transition.service.js`, `src/services/trip-lifecycle.service.js`, `src/app/api/trips/[id]/start/route.js`, `src/app/api/trips/[id]/cancel/route.js`; relevant route/service tests. **Create:** `src/services/cargo-lifecycle-guards.test.js`; gated `src/services/supply-dispatch.service.js` and `src/app/api/supply/shipments/[id]/assign/route.js` with tests only after existing supply eligibility/interval/safety policies are approved.

**Interfaces:** `assertCargoCheckpoint(trip,transition,tx)` from `cargo-execution.service.js`; `assignSupplyShipment({shipmentId,manifestRevision,driverId,vehicleId,window,expectedVersion},session)` writes shared dispatch/allocation/trip atomically after full eligibility.

- [ ] Test driver can start travel to pickup without receipt; cannot mark loaded/depart using onboard/enroute or legacy progress shortcuts without current pickup clearance; cannot complete via direct complete/Arrived path without required receipt; direct cancel after collected cargo returns `CARGO_CUSTODY_REVIEW_REQUIRED`.
- [ ] Run guard/route tests RED. Place checks inside shared transition/completion transactions, not only UI/individual route wrappers. Start retains qualification/vehicle/pre-trip gates; pickup adds actual post-load securement evidence under approved safety rules. Geofence override does not bypass receipt/qualification checks.
- [ ] Block silent post-load cancellation. Before custody, source cancellation requires approved coordination with dispatch and history; this task does not make existing create-only request intake accept revisions/cancels.
- [ ] Reassignment before pickup invalidates Fleet clearance and any driver-specific safety evidence. After pickup hold and require approved custody handover; initial release supports no automatic handover.
- [ ] For supply allocation, preserve SUPPLY_DELIVERY/no request_id and the existing deferred bridge constraints. Use full shared resource conflicts and approved service/driver/license/load safety/interval checks. Measurement-only NOT_EVALUATED is never passed to assignment as success. If policies remain unapproved, keep endpoint disabled with 503 and skip activation.
- [ ] Test qualification revocation/manifest change during final transaction and double assignment. Lock driver/vehicle/window evidence as required by approved reservation policy; do not claim race-free eligibility from a preview query.
- [ ] Run lifecycle/DB/legacy passenger regression tests; update Dispatch/Trips/supply foundation; commit `feat: guard cargo departure and receiving checkpoints`.

### Task 9: Implement partner outbox, decision inbox and sandbox gateway

**Create:** `src/lib/cargo/feedback-contract.js`, matching test, `src/lib/integration/cargo-gateway.js`, matching test; `src/services/cargo-feedback.service.js`, `src/services/cargo-feedback-db.integration.test.js`, `src/app/api/integration/cargo/feedback/route.js`, matching test; `src/app/api/cron/cargo-feedback/route.js`, matching test. **Consumes:** Task 5 outbox/inbox schema and append helper. **Modify:** `vercel.json` only if an existing approved scheduling mechanism applies; otherwise document the worker invocation and keep automatic live scheduling disabled.

**Interfaces:** use Task 5's `appendCargoFeedback`; `deliverCargoFeedback({batchSize=50,now,gateway}) -> {acknowledged,pending,failed}`; `getCargoGateway(principal) -> {send(event),getAcknowledgement(eventId)}`. Event types: PICKUP_RECORDED, DISCREPANCY_REPORTED, SOURCE_DECISION_RECORDED, DELIVERY_RECORDED, TRANSPORT_CLOSED. Event identity remains stable through retries. Define these event schemas in `cargo/contracts.js` during Task 5 and re-export/validate transport envelopes here; do not emit unvalidated events while waiting for Task 9.

- [ ] Test source-scoped request collisions, same event replay, changed replay conflict, event receipt acknowledgement distinct from ACCEPT_OBSERVED, gateway timeout, malformed ACK, two workers and ordering for one execution.
- [ ] Run feedback/DB tests RED. Verify Task 5's private `cargo_feedback_outbox` (event UUID, execution/version, authenticated source, type, immutable payload/hash, status/attempt/next attempt, lease token/expiry, ACK/time, bounded failure code); private `cargo_decision_inbox` (source/event unique, payload hash, immutable response, receipt FK, actor/reference/time). Do not add duplicate tables. Verify private classifications and that network delivery updates only mutable attempt/ACK fields, never payload/identity.
- [ ] Lease due rows with `FOR UPDATE SKIP LOCKED`, commit before network call, then update only matching lease token. Preserve event ID; ACK timeout retries at 1/5/15/60 minutes then hourly; after ten attempts mark FAILED for authorized review. Idempotent partner acknowledgement is required before live activation. No blanket retry of rejected business decisions.
- [ ] Gateway is mock by default, org/source-specific, with fixture acceptance/WAIT/REJECT/timeout. Live endpoints/credentials come from approved configuration, never body URLs. Never fetch arbitrary evidence URLs or expose public photos to the partner; provide authorized evidence references with agreed retrieval.
- [ ] Decision inbox deduplicates before applying state; ACK and decisions remain different resources. Staff feedback GET/POST retry requires integrations read/execute plus trip/source scope; retry does not create a new event.
- [ ] Test worker service authentication and batch bounds. Preserve existing booking status gateway/outbound behavior; do not claim its log function is a durable cargo outbox.
- [ ] Run migration/security/feedback/auth gates; update System Boundaries/integration notes; commit `feat: deliver durable cargo feedback with scoped decisions`.

### Task 10: Implement account-scoped mobile drafts and evidence replay

**Create:** `mobile/lib/cargo-drafts.js`, `mobile/lib/cargo-drafts.test.js`, `mobile/lib/cargo-sync.js`, `mobile/lib/cargo-sync.test.js`, `mobile/lib/cargo-api.js`. **Modify:** `mobile/lib/api.js`, `mobile/lib/auth.js` for bounded foreground/reconnect sync and logout/account fencing only; do not place media receipts into the generic JSON queue blindly.

**Interfaces:** `saveCargoDraft({actorId,tripId,manifestRef,draft})`, `listCargoDrafts(actorId)`, `syncCargoDrafts({actorId,api,files})`, `getCargoSyncState(actorId,tripId)`; `cargo-api.js` wraps Task 7 endpoints and typed errors.

- [ ] Test stable submission IDs across restart/retry, upload-before-receipt dependencies, 409 stale manifest stops replay, 401 requires login, 403/404 becomes visible terminal review, current driver mismatch prevents send and logout cancels in-flight drain.
- [ ] Run draft/sync tests RED using fake storage/files/API with deterministic callbacks.
- [ ] Persist owner, trip, manifest hash, submission ID, local file URI, evidence server IDs and replay status in a bounded owner-keyed queue. Limit 100 pending submissions and approved photo/byte bounds; queue-full returns an explicit error without dropping old cargo evidence.
- [ ] Serialize one sync per actor; upload staged files first, then idempotent receipt. Transport failures retain local draft; permission/stale failures preserve it for review. Never auto-queue start/depart/clearance/source-decision operations.
- [ ] Cancel drains on account switch and recheck actor before every network call. Keep local sensitive files inaccessible to another account; cleanup only under approved retention and after verified upload/receipt acknowledgement. Restart can show submitted evidence as pending without pretending it is approved.
- [ ] Show distinct device-saved, Fleet-saved and partner-received status through the view model. On recount after source WAIT, mint a new receipt submission, not overwrite a sent payload.
- [ ] Run mobile draft/sync and existing API-refresh/offline regressions; update Mobile Architecture; commit `feat: retain scoped offline cargo evidence without false clearance`.

### Task 11: Build staff cargo review and source links

**Create:** `src/components/cargo/cargo-verification-panel.jsx`, `cargo-quantity-table.jsx`, `cargo-decision-history.jsx`, `cargo-feedback-status.jsx`, colocated `.test.js` files; `src/services/cargo-execution.client.js`. **Modify:** `src/app/(dashboard)/trips/[id]/page.js`, `src/app/(dashboard)/reservations/[id]/page.js`, `src/app/(dashboard)/supply-deliveries/page.js`, `src/app/(dashboard)/dispatch/[id]/page.js` only for scoped links/summaries.

**Interfaces:** `CargoVerificationPanel({tripId})` reads CargoExecutionView; `CargoQuantityTable({manifest,pickup,delivery})` displays expected/pickup/delivery and unit; client wraps GET/clearance/manual-decision/retry endpoints.

- [ ] Add rendered tests that 10/9/9 shows order shortage 1 and delivery shortage 0, pending ACK never shows approval, readonly roles have no decisions and server-rejected action retains form.
- [ ] Run component tests RED. Use existing dashboard typography/layout/components and permissions. Do not copy the mobile look to dense staff tables or create a new navigation module solely for evidence.
- [ ] Render Cargo Verification with item comparison, private photo viewer, source decision, Fleet clearance, receiver confirmation, audit timeline and feedback delivery. Keep vehicle inspection in its own section. Show missing manifest/config explicitly.
- [ ] Link REQUEST to reservation and SUPPLY to shipment detail selection. Supply page may need a focused detail component rather than inventing a nonexistent route. Do not show both sources as independent editable manifests for one execution.
- [ ] Gate reviewer controls by server-provided capabilities; invalidated/version conflict refetches current evidence and explains why resubmission is required. Expose partner timeout separately from cargo disagreement.
- [ ] Run component/API tests and authenticated browser review for staff/readonly roles, small desktop and long item labels; update feature notes; commit `feat: review cargo receipts and approvals on trip details`.

### Task 12: Design and implement mobile cargo screens with all three requested skills

**Create:** `docs/superpowers/specs/2026-10-09-mobile-cargo-verification-ui.md`, `mobile/components/cargo/CargoManifestList.jsx`, `CargoItemReceiptRow.jsx`, `CargoIssueSheet.jsx`, `CargoDecisionStatus.jsx`, `CargoReceiptSummary.jsx`, `mobile/lib/cargo-view-model.js`, `mobile/lib/cargo-view-model.test.js`, `mobile/lib/cargo-verification-render.test.js`; screens `mobile/app/(app)/trip/[id]/cargo.js`, `mobile/app/(app)/trip/[id]/cargo-pickup.js`, `mobile/app/(app)/trip/[id]/cargo-delivery.js`. Verify Expo static/dynamic route coexistence before adding folders; current `trip/[id].js` is not replaced blindly.

**Modify:** `mobile/app/(app)/trip/[id].js`, `mobile/app/(app)/(tabs)/map.js`, `mobile/lib/load-presentation.js`; reuse `mobile/lib/theme.js` and existing Clay components. No unrelated whole-app theme rewrite.

**Interfaces:** `buildCargoViewModel(execution,{offline,syncState}) -> {stage,primaryAction,canSubmit,summary,blockers}`; component actions call `cargo-api`/draft service; source/driver group never picks a different hotel/restaurant screen.

- [ ] Read full Impeccable, UI UX Pro Max and High-End Visual Design skills and their relevant native planning/craft guidance. The previous Impeccable context was web-focused/stale; resolve visual authority from current mobile screens/tokens and the user brief. Do not silently refresh unrelated generated design artifacts.
- [ ] Capture current phone screens and present mobile concepts for manifest, normal pickup, shortage, awaiting decision and delivery. Obtain design review under brainstorming before UI implementation. Preserve identity unless replacement is approved. This is a concrete screen review, not a request to approve unfinished code.
- [ ] Document single-column layout, expected/actual quantity hierarchy, separate Report Issue and Confirm Pickup actions, progress, named states and the pickup/departure lifecycle distinction. Apply premium typography/spacing/restrained depth from High-End Visual Design; native usability overrides decorative website effects.
- [ ] Write view-model/render tests before code. Fixture all three cargo services and dual-qualified driver; verify same layout, source-specific labels, no passenger count/call-guest action, unconfirmed receiver blocks delivery confirmation and offline draft cannot become READY.
- [ ] Run mobile cargo tests RED. Implement blank actual-count fields, numeric unit validation, optional reference thumbnail with readable missing-image state, issue/photo flow, review summary, decision wait state and confirmed receiver display. Preserve back navigation and unsaved drafts; no swipe-only required action.
- [ ] Link pickup at At Pickup, departure only after fresh server clearance, and delivery at destination. Keep Start Trip available according to existing pre-trip rules. Button pressed/loading states prevent accidental double submits without changing stable submission IDs.
- [ ] Verify >=44pt iOS/48dp Android targets, >=4.5:1 normal text, >=3:1 meaningful controls, safe areas/keyboard, screen readers, maximum text size, reduced motion and independent light/dark themes. Plus Jakarta Sans already exists; do not add a new font dependency merely for a mockup.
- [ ] Run functional device flows on small phone (~375 width), larger phone and landscape; test Expo web only as supplemental evidence. Inspect screenshots in one batch, fix issues, confirm once. UI UX Pro Max guidance returned for newer RN must be checked against installed 0.81.5 before use.
- [ ] Run mobile tests and passenger/inspection/map regressions; update Mobile Architecture/Driver In-App Guide; commit `feat: guide cargo pickup and delivery in the driver app`.

### Task 13: Add defensible reports and reversible sandbox examples

**Create:** `src/lib/reports/cargo-verification.js`, matching test, `src/app/api/reports/cargo-verification/route.js`, matching test, `src/components/reports/cargo-verification-report.jsx`, `scripts/cargo-demo/fixtures.mjs`, `scripts/cargo-demo/fixtures.test.mjs`. **Modify:** `src/app/(dashboard)/reports/page.js`, Vitest include only to add this named demo test path if needed; supply/request sandbox injector uses fixtures explicitly and stays disabled in production.

**Interfaces:** `summarizeCargoExecutions(rows,{from,to,timeZone:'Asia/Manila'}) -> report`; approved metrics count trips/receipts/lines explicitly, never mix those denominators. Filters: service, source, time window and exception/feedback state.

- [ ] Define approved complete/partial transport and order-shortage metrics in Task 0/report note before UI labeling. Test 10/9/9 is complete collected delivery with order shortage, 9/8 is delivery discrepancy and boxes/kg are never summed together.
- [ ] Run report/fixture tests RED. Use receipt/decision events as facts; unresolved does not mean driver fault. Filter timestamps with Manila reporting boundaries and retain source/path distinction.
- [ ] Add demo fixtures for passenger, all three cargo services, clean pickup, accepted shortage, WAIT/recount, rejected shortage, delivery discrepancy and partner timeout. Fixture approvals are explicitly sandbox facts, never updates to real driver review/license data.
- [ ] Implement dry-run-first sandbox import only; no operational seed/cleanup runs in this planning task. Require exact demo namespace on any later cleanup and preserve real data.
- [ ] Run report parity/readonly permission/browser tests and demo fixture tests; update Reports/project demo notes; commit `feat: report cargo verification and demonstrate exception flows`.

### Task 14: Verify end-to-end release and document activation/rollback

**Create:** `src/cargo-release-acceptance.test.js`, `Capstone/07 - Development/Cargo Verification Release Runbook.md`. **Modify:** relevant feature/database notes, roadmap status and `SYSTEM.md` after actual verification.

- [ ] Add acceptance scenarios for full flow, three cargo services/shared group, cross-group refusal, 10/9 acceptance/9 delivery, WAIT/recount, REJECT, 9/8 delivery, damage/wrong item, zero count, overage, missing receiver authority, unauthorized evidence/decision, changed manifest, revoked qualification, duplicate/concurrent submit, offline reconnect and late source decision.
- [ ] Run acceptance suite RED before missing integration fixes; implement only uncovered connections with regression tests. Verify bypasses through direct lifecycle endpoints and legacy In Progress/Arrived transitions.
- [ ] Run focused tests once they pass, then `npm run test:run`, `npm run lint:ci`, `npm run verify:auth`, `npm run db:check`, `npm run build`. Record actual output; pre-existing failure is a limitation with owner, not a claimed pass. Build uses legitimate project configuration, no fake credentials/placeholders.
- [ ] Recheck `db:status`, regenerate schema after authorized applies, run `db:contract` and `verify:anon`; explain every inconclusive empty probe using catalog evidence. Query actual constraints/FKs/private policies and test real app SQL in isolated fixtures. Verify bucket privacy and worker authentication separately.
- [ ] Perform authenticated web and actual Expo device acceptance plus a real sandbox partner round trip. Mock results and Expo web screenshots do not prove live partner/device behavior.
- [ ] Activate OFF -> SHADOW -> ENFORCE qualification only after reviewed roster; cargo execution/partner/live SCM switches are independent and remain disabled until policy/cohort/partner gates pass. Do not disable evidence guards to release a vehicle that is holding cargo. Rollback pauses new assignments and hands active custody cases to authorized review while preserving receipts/outbox.
- [ ] Record missing/expired qualifications, manifest gaps and existing scheduled/active trip review before activation. No automatic compliance attestations or mass cancellation.
- [ ] Update vault notes and SYSTEM.md with implemented behavior, migrations, test counts, browser/device evidence, partner ACK evidence and limitations. Review changes and commit `test: verify cargo qualifications and receipt release gates`.

## Per-task verification and handoff rules

Every code task follows RED -> minimal implementation -> GREEN, relevant lint/security/DB checks, synchronized vault documentation and a focused commit. SQL tests exercise actual constraints and transactional races, not just string matching. UI tests use realistic user states; avoid tests that only mirror JSX source text.

For focused lint run `npx eslint` with exact changed paths quoted; do not lint generated artifacts. Run full gates in Task 14 after the scoped tasks pass. Before each commit, `git diff --check` and review only task-owned changes. Implementation workers must read relevant installed Next docs (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`) and skill instructions in their own session.

Execution options after review: execute inline with executing-plans checkpoints, or task-by-task with subagent-driven-development. No agents are dispatched by this planning task. Missing owner decisions gate dependent capability activation; independent qualified planning/disabled code work can proceed.

## Planning verification

Verified local paths, exports, package versions, test discovery, installed route-handler guidance, current read-only migration status and existing trip progress. Self-review checked two-group consistency, schema/source ownership, quantity units, actor/permission boundaries, transaction timing, mobile offline states, source ACK versus approval and roadmap coverage. This document is an implementation plan; no runtime code, migration apply, UI or partner exchange was performed, and no implementation tests were run.
