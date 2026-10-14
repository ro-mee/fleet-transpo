# Supply-chain workflow consolidation implementation plan

Date: 2026-10-13
Status: Internal consolidation implemented on 2026-10-13; production cargo/source activation remains pending. See the implementation checkpoint at the end for exact verification and limits.

## Outcome and user requirement

Use the existing Reservations -> Dispatch -> Trips workflow for cargo transport. Move useful Supply Deliveries functionality into those existing surfaces and Fleet vehicle management, then retire its separate operational navigation after replacement destinations and source links work.

When a supply-chain/cargo service is selected, show what is being transported and evaluate it against the actual vehicle's cargo capabilities. Contents and capacity must affect server eligibility, candidate explanations, reassignment and start checks; displaying extra fields alone is insufficient.

Interpret "Supply Chain" as a UI grouping of the existing canonical services RESTAURANT_SUPPLY_PICKUP, RESTAURANT_FOOD_DELIVERY and HOTEL_SUPPLY_TRANSFER. Use service_types.default_load_type and the existing server service/load validation. Do not create another dispatch discriminator or infer Cargo from arbitrary text. Passenger Guest/VIP services keep their existing flow. REQUEST and SUPPLY remain distinct source adapters beneath the common review experience.

## Current baseline and prerequisites

- The shared workflow supports explicit Cargo requests, gross consignment kg, Cargo vehicle/driver compatibility, shared resource checks and trips. Several queue/detail/candidate views still render passenger information for cargo.
- Fleet vehicle editing records vehicles.cargo_capacity_kg. Supply Deliveries separately maintains vehicle_cargo_profiles and derives usable payload from rated payload, gross vehicle limit, operating mass and reserve. These values are not synchronized.
- Shared execution manifest lines contain identity, item name, expected quantity/unit and handling. They lack the supply schema's physical package weights, dimensions, rotation and temperature facts. Supply adapters currently discard those physical facts from the execution view.
- readDispatchRevision and commitDispatchEvidence do not currently cover the cargo profile or manifest tables. Physical checks must join the existing evidence/revalidation mechanism before they can authorize assignment.
- Installed cargo manifest intake and execution exports remain closed with 503 CARGO_CONFIGURATION_REQUIRED. Applied storage does not install trusted providers or approve safety/source/receiver authority.
- Fresh planning-time npm run db:status: 161 on-disk files applied, 0 pending, 0 changed. Ledger-only keys include 113/114/115 and spent 162/163. In contrast, scripts/lib/schema-contract.mjs still lists cargo 158-161 objects in PENDING_TABLES. Reconcile against the live catalog and generated dump in Task 0 before trusting schema.sql or deciding migration scope. Never edit applied migration files or reserve a number from disk listing alone.

Relevant source-of-truth notes: Supply Chain Workflow Consolidation Assessment 2026-10-13, supply_delivery_foundation, transportation_requests, cargo_execution_storage, Fleet And Vehicles, Reservations, Dispatch, Trips and System Boundaries in Capstone.

## Intended user flow

1. Select an existing service. A Cargo service reveals Cargo contents and Transport requirements. Passenger services show passenger/luggage fields. The server verifies the service/load pairing independently.
2. Review the manifest: item names, expected quantities/units, actual transport package counts, gross package weights and relevant physical requirements. Imported source contents are read-only to Fleet staff unless a separately approved correction path exists.
3. The existing assignment/Copilot view shows required kg / authoritative usable kg / remaining kg, nominal volume, package-fit and handling/temperature results. Full contents open in request detail; candidate cards use a compact summary.
4. The existing server gates combine physical checks with driver classification/license, documents, commissioning, maintenance, duty/leave, route/time and shared conflicts. An unknown required fact cannot authorize the enhanced cargo service.
5. The existing trip and mobile cargo views show the same source-bound manifest and retain separate expected, pickup and delivery observations. Quantity acceptance, Fleet departure clearance, receiver proof, partner ACK and inventory closure remain separate authorities.

Capacity is a Fleet-owned vehicle property. The request records the cargo's required load; the requester must not be able to increase a vehicle's capacity through a request field.

## Cargo data contract

Extend the existing immutable manifest representation with an explicit physical-contract version; do not create a third manifest or receipt store. Preserve all historical snapshots/hashes. Legacy manifests remain readable and have unknown physical evidence where fields were never recorded.

| Data | Capture/display rule | Operational use |
|---|---|---|
| Source, request, service, line ID and manifest revision/hash | Trusted source identity; stable line IDs; use existing exact ownership mapping | Bind every check and receipt to the correct immutable consignment |
| Item name/description and source SKU/reference | Required readable contents description; source SKU where supplied | Show what is inside; do not infer weight or approved handling from its name |
| Expected quantity, quantity basis and unit | Preserve ordered units versus transport-package basis; retain existing decimal/package rules | Pickup/delivery counting without changing order expectations |
| Transport package count and package description/type | Positive integer count for the first packaged-load release | Physical calculations use packages, never ordered units as an implicit conversion |
| Gross kg per package | Positive, bounded value including packaging; record evidence/source basis | Server calculates total physical cargo kg |
| Length, width and height per package | Positive, bounded canonical metres; UI may show labelled units | Nominal volume and individual compartment/opening fit |
| Rotation permission | Explicit source value; preserve source semantics | Allowed-orientation package checks |
| Handling requirements | Existing validated codes, including fragile, no-stack, food separation, secure load and spill containment | Compare with actual recorded capability and required procedure/evidence |
| Temperature range | Explicit numeric range where needed; distinguish confirmed none from unknown | Check compatible same-compartment requirements and vehicle capability |
| Pickup readiness, mapped stops and delivery window | Preserve source provenance and active Fleet location links | Planning constraints; not a complete reservation interval by themselves |
| Declared consignment kg | Existing request field, labelled separately from calculated kg | Reconcile against package-derived total before assignment |

First release covers packaged loads described by the existing supply model. Unpackaged/bulk loads, multi-zone compartments and automatic split shipments require separate contracts; do not invent a package count of one to pass validation. An omitted physical datum means unknown, not zero. Handling/temperature absence is interpreted only under the versioned source contract; an old missing field is not confirmation of no requirement.

Use bounded server-side decimal calculations, consistent canonical units and existing quantity conventions. Require the declared total to agree with package-derived gross mass at the chosen contract precision; show a reconciliation error instead of silently overwriting source values or guessing a tolerance. Any future tolerance needs a documented policy/version. Contents must never be reduced to cargo_description alone.

## One payload and physical-check authority

Proposed authority for the enhanced cargo cohort is the existing measured vehicle_cargo_profiles, resolved by a shared server loader and a pure evaluator. Subject to D03's approved mass definitions, retain the current static basis:

`usable_payload_kg = min(rated_payload_kg, gross_vehicle_weight_limit_kg - operating_mass_kg) - operational_reserve_kg`

Define whether driver/helpers, fuel, tools and equipment are already included in operating mass or reserve before allowing trip-specific deductions. Account for each once. Do not present this formula alone as proof of legal axle loads, load arrangement or completed securement.

- Move advanced profile editing to Fleet vehicles. Keep the current vehicles.update permission and existing authenticated API checks; profile save identity/time remains recording provenance rather than independent approval.
- Remove two independent editable usable-payload values for the enhanced cohort. Keep vehicles.cargo_capacity_kg for historical compatibility during transition; enhanced reads/filters/commit checks use the profile-derived authoritative value. A later transactionally maintained projection may replace legacy reads only after its consumers and reconciliation are verified.
- Inventory recorded kg/profile disagreements. Mark them for explicit review with evidence; never select the larger figure, auto-fill measurements or copy old values as verified.
- Update vehicle availability, readiness/commissioning, recommendations, conflict evaluation, reassignment, start and payload-utilization reporting to use the same resolved basis. SQL prefilters must not omit a physically suitable candidate or admit an unsuitable one because they still use only the old kg column.
- Physical results have per-check PASS/BLOCK/UNKNOWN with stable reasons and source/profile/rule revisions. Overall physical clearance requires every applicable mandatory check to pass. Assignment additionally requires the existing operational gates.
- Nominal volume and individual box/door fit do not prove collective packability. No-stack, segregation, placement and securement requirements need their approved loading-plan evidence; a matching capability flag is not evidence that a procedure was performed.
- For one compartment, temperature ranges must have a nonempty common permissible range that intersects the supported vehicle range, under the approved operating procedure. A broad vehicle min/max capability cannot certify disjoint cargo temperature requirements. Block unsupported/incompatible combined loads rather than adding a packing optimizer or multi-zone system in this release.

## Ordered work packages

Work packages 0-6 have an internal implementation, including default-OFF physical enforcement and retained source-route compatibility. Work package 7's operational activation/device gates remain pending. Implementation is not owner approval or a deployed release.

| Task | Priority / size | Depends on | Deliverable and acceptance |
|---|---|---|---|
| 0. Verify data/catalog and define cutover scope | Critical / Medium | None | Read-only usage/dependency inventory, fresh ledger/catalog/security results, corrected classifications/generated dump where needed, explicit initial PMS/POS cargo cohort and inactive SCM scope. Preserve immutable history. |
| 1. Version contents/physical contracts and intake rules | Critical / Medium | 0 | Extend existing REQUEST/SUPPLY normalization, immutable snapshots/read projections and initial-manifest persistence. Missing contents/physical evidence is a planning hold. No silently successful weight-only submission when contents fail to save. |
| 2. Rehome vehicle capability and reconcile payload | Critical / Medium | 0; D03 for authoritative operating rollout | One Fleet editor, shared profile resolver/evaluator, review list for conflicting/missing evidence, provenance/expiry display and all capacity consumers mapped. |
| 3. Integrate physical eligibility and transactional evidence | Critical / Large | 1, 2; approved enforcement policy | Same mandatory verdict through queue, recommendation, manual/direct assignment, reassignment and start, with profile/manifest/rule changes invalidating prior evidence. |
| 4. Add conditional cargo UI and cargo-aware summaries | High / Medium | 1, 2; 3 before eligible/assign controls | Cargo service reveals contents/requirements; queue/detail/Copilot/evidence/reassignment show kg and cargo facts instead of fabricated passengers/seats. Draft and unavailable states are clear. |
| 5. Extend existing trip/mobile cargo projections | High / Medium | 1, 3 | Same exact manifest contents/requirements in existing review and driver flow; preserve quantity/custody/offline safeguards and public runtime refusal until separately configured. |
| 6. Retire operational Supply Deliveries navigation | High / Small | 4, 5 plus history/admin replacement acceptance | Historical local shipment/revision links remain usable; admin tools remain permission-scoped. Remove menu entry and duplicate editors last; retain route compatibility/read-only source view. No table/API deletion in initial consolidation. |
| 7. Verify and stage the enhanced cargo cohort | Critical / Medium | 0-6; applicable owner/provider approvals | Focused proof, live DB/security gates after migrations, authenticated browser replay and relevant mobile acceptance, then controlled cohort enforcement. Roll back presentation/activation without deleting evidence or disabling existing safety gates. |

### Task 0: bounded discovery and schema alignment

Inventory live shipment/allocation/request-manifest/execution references and active clients before changing destinations. Check applied 158-161 definitions, RLS/grants and relevant functions directly; the ledger alone cannot prove catalog shape or privacy. Inspect spent 162/163 effects, including the removed qualification table, before selecting qualification settings or restoring any model. Do not resurrect a retired schema merely because old code mentions it.

Refresh schema.sql through npm run db:dump before relying on the artifact. Reconcile TABLES/PENDING_TABLES and stale current-status notes to verified catalog state; keep dated historical records identifiable. Preserve request-backed dispatch service_type PASSENGER, including Cargo requests; SUPPLY_DELIVERY remains the requestless allocation discriminator. SCM remains a retained source/history adapter with assignment disabled in this consolidation.

### Task 1: manifest storage and save integrity

Extend cargo/contracts.js and supply adapters with a versioned physical manifest contract, preserving old hashes and receipt bindings. Extend the database validation of newly versioned snapshots through a new forward migration if the catalog cannot enforce the intended shape. Never edit 144-161. Do not rewrite a historical source revision into a physical revision.

The existing request create and manifest attachment are separate seams, and manifest POST is currently fixed503. In the first release, a request awaiting a separately approved manifest can remain visible for planning but must be ineligible for enhanced cargo assignment. The UI must distinguish "request saved" from "contents not saved/configuration unavailable" and preserve its draft. Do not send nested contents to the existing request endpoint and assume it persists them. Later approved combined intake may reuse transaction-bound writers; do not perform a fragile client-side sequence presented as an atomic save.

Require an exact trusted source/request-to-organization mapping before initial attachment. Preserve conservative refusal of request-manifest changes and late first attachment after dispatch; source revisions/cancellation after allocation/custody are a separate reviewed change. No new arbitrary staff editing, image uploads or source permissions are granted by adding form fields.

### Task 3: evidence and commit boundaries

Extend existing dispatch evidence with exact source kind/local identity, manifest revision/hash, current profile identity/hash/expiry and physical-policy version. Include the precise relevant profile/manifest/source rows in the existing transaction's consistent lock order. Profile writers and any manifest/current-pointer writers must participate in compatible locking; hashing without serialization is insufficient.

Re-read the persisted load, profile, driver, vehicle, active manifest and current time inside assignment/reassignment/start commits. Reject stale evidence and require refresh. Do not trust submitted kg, dimensions, capacity, item requirements or earlier green cards as operational evidence. Keep provider/network calls outside DB locks. Apply the same checks at load/departure as required by the existing cargo lifecycle; a recount or changed actual load invalidates earlier clearance bindings. Preserve post-pickup custody holds instead of auto-reassigning/revising.

Use an explicit approved stage/version in the existing dispatch-policy/rollout configuration for the enhanced cohort. Advisory comparisons can expose missing data without loosening current gates; mandatory enforcement starts only after measured/reconciled vehicles and approved service contracts are ready. Never silently fall back to legacy kg when mandatory profile/manifest evidence is absent. Historical passenger/untyped behavior remains covered by regression checks.

### Task 4: conditional UI details

The current /reservations/new page is a legacy passenger mock injector. Add service selection and Cargo sections in its explicitly development/simulation context first; it is not authorization to build a live SCM create form. Do not trust its existing source_system dropdown as machine identity. No-header staff fallback remains PMS-only; POS/SCM require their authorized adapters.

Cargo contents lines show item, quantity/unit, package count, kg/package and derived line kg. A labelled requirements disclosure contains dimensions, rotation, handling and temperature. Show total declared/calculated kg and any mismatch before vehicle selection. Vehicle capacity is displayed after choosing/comparing a vehicle, never entered as the consignment's capacity.

Switching back to Passenger preserves a reversible local draft if useful, but excludes stale hidden cargo fields from the submitted Passenger payload. Cargo submits null passengers and does not display a phantom guest. Imported source manifests show provenance and a correction-required state rather than editable source expectations.

Compact example, using illustrative values: "Cooking oil: 10 boxes x 12 kg = 120 kg; vehicle usable payload 500 kg; remaining 380 kg." A weight pass can still be blocked by size, volume, incompatible requirements or missing evidence. Surface the individual reason next to the comparison; Copilot must not invent physical facts or waive blockers.

### Task 6: source/history continuity

Before removing /supply-deliveries from workspaces, rehome its profile editor to Fleet and its import/site-mapping/replay tools to existing integration administration. Maintain a permission-scoped read-only shipment source destination for existing ?shipmentId= links, preserving exact local UUID and revision references. The compatibility page may remain even when the operational menu is retired. Do not redirect an external request ID to an arbitrary reservation.

Keep SCM source identity and supply allocation constraints intact. Where sources describe one real job, use an approved trusted correlation and a database-backed single-active-execution rule before offering both through an assignable queue; first release avoids this by keeping SCM assignment disabled. No automatic cross-source conversion, second allocation engine, automatic shipment splitting, inventory writer or destructive cleanup is included.

## Primary file map

| Area | Existing files to extend/reuse |
|---|---|
| Contracts and source reads | src/lib/cargo/contracts.js; src/lib/supply/contracts.js; src/services/cargo-manifest.service.js; src/lib/cargo/read-adapter.js |
| Intake and ownership | src/lib/integration/contracts.js; src/lib/integration/ingest.js; src/lib/integration/source-auth.js; src/app/api/integration/transport-requests/route.js; src/app/api/integration/cargo/manifests/route.js |
| Payload and physical evaluation | src/lib/scheduling/load-capacity.js; src/lib/supply/capacity.js; src/lib/vehicles/readiness-server.js; src/lib/vehicles/readiness-adapter.js; new shared profile resolver only if existing loaders cannot serve the common query |
| Candidate/commit/start | src/services/recommendation.service.js; src/services/dispatch-recommendation-preparation.service.js; src/lib/scheduling/conflicts.js; src/services/evidence-resolve.service.js; src/services/dispatch-evidence.service.js; existing reservation assignment, dispatch edit/create and web/mobile start handlers |
| Vehicle editor/API | src/app/(dashboard)/fleet/vehicles/new/page.js, reused by edit; src/app/api/supply/vehicles/cargo-profile/route.js; vehicle availability/commission routes; rehome the profile component from supply-deliveries/page.js |
| Request UI | src/app/(dashboard)/reservations/new/page.js; reservations/[id]/page.js; reservation-queue-table.jsx; queue-filters.jsx; ai-recommendation-panel.jsx; copilot-option-flow.jsx; evidence-drawer.jsx; dispatch-edit-dialog.jsx |
| Trips/mobile | src/components/cargo/cargo-verification-panel.jsx; cargo-quantity-table.jsx; src/app/(dashboard)/trips/[id]/page.js; mobile/app/(app)/trip/[id].js; mobile/components/cargo/CargoWorkflowScreen.jsx and CargoItemReceiptRow.jsx |
| Retirement and reporting | src/lib/workspaces.js; src/lib/auth/permissions.js; src/services/cargo-execution.client.js; src/lib/supply/shipment-detail-selection.js; src/lib/reports/operational-reports.js |
| Catalog/notes | scripts/lib/schema-contract.mjs; scripts/lib/sql-references.mjs if extraction coverage changes; new forward migration only as needed; generated schema.sql; relevant Capstone notes and SYSTEM.md |

Keep existing JavaScript/Next Route Handler/service/raw-pg patterns, shared controls and permissions. Read installed node_modules/next/dist/docs guides relevant to touched framework APIs before implementation. No ORM, framework, state-library or design-system migration is needed.

## Verification and acceptance matrix

| Scenario | Required proof |
|---|---|
| Select Cargo service; switch to/from Passenger | Conditional form and payload tests; no hidden-field leakage, phantom passenger or source-identity spoofing |
| 100 ordered units inside 10 packages | Contract/evaluator tests calculate weight/volume from 10 packages; receipt expectations retain their declared basis |
| Within kg but excessive volume or oversized doorway/package | Same BLOCK result in recommendation/manual assignment/reassignment/start; appropriate boundary and rotation cases |
| Missing/expired profile, missing manifest or declared/calculated mismatch | UNKNOWN/BLOCK cannot authorize enhanced cargo; draft/error recovery works |
| Conflicting recorded vehicle kg versus derived profile | Explicit review state; authoritative gates/SQL prefilters never select the more permissive value |
| Handling/no-stack/segregation/temperature incompatibility | Required capability and evidence failures block; disjoint same-compartment temperatures cannot pass |
| Exact kg/volume boundary, zero reserve, malformed/NaN/out-of-range values | Focused pure-rule tests at the contract's precision and limits |
| Manifest/profile/policy changes after preview | Actual two-session PostgreSQL regression proves stale commit refusal and compatible writer locking; no provider I/O in locked transaction |
| Forged request mass/profile/contents or duplicate assignment/replay | Persisted facts win; shared single-active resource guards and original immutable command replay remain correct |
| Recount, changed driver/vehicle, cancellation after pickup | Existing decision/clearance invalidation and custody holds remain intact; receipt history is not rewritten |
| Legacy manifests and Passenger/untyped history | Existing reads/hashes/status transitions remain valid; no silent physical approval for missing historical fields |
| Removed menu and old shipment link | Authenticated role-specific source/history navigation works; malformed/foreign IDs fail safely; admin tools do not leak to dispatch/readonly roles |
| Long contents/500 lines/mobile/offline/server503 | Bounded rendering, keyboard labels/focus, accessible errors, stale-draft refusal and unavailable runtime state verified |

Use existing Vitest suites for load-capacity, cargo-schedule, vehicle-load-compatibility, cargo contracts/manifests, recommendation/evidence, request/dispatch/start, cargo lifecycle and source links; add regressions for new behavior, not mirrored implementation tests. Run touched lint, route authorization and migration naming gates. After any authorized migration: npm run db:up, npm run db:dump, live catalog/real-query checks and the paired npm run db:contract + npm run verify:anon. Classify every new table/view and explicitly protect privileges/RLS/view execution as repository policy requires. Never call an empty anon response PASS without the catalog explanation.

Operational rollout additionally requires a production build, authenticated browser walkthrough through the actual cargo path, matching deployed SHA when deployed, and mobile/device acceptance for changed driver presentation/checkpoints. Planning-time source checks or isolated SQL fixtures do not establish those results.

## Rollout, rollback and completion

Build contracts, pure rules and conditional UI under the existing closed provider boundary first. Reconcile/measure the selected Cargo fleet, verify the initial source contract and enable enforcement for the agreed new-work cohort only when applicable D01/D03-D07/D10 decisions and real providers are available. Local driver availability remains authoritative unless an approved HR feed changes that boundary; D02 is not permission to invent one. D08/D09 apply before inventory integrations or new KPI claims, neither of which this consolidation adds.

Do not mark the entire internal implementation blocked by absent external approvals: read-only projections, correction of passenger-only cargo labels, component rehoming, pure evaluator tests and schema-state investigation are independent work. Production source writes, mandatory operating policy, safety/receiver authority and partner sends stay gated separately. Do not enable DRIVER_QUALIFICATION_MODE or resurrect the dropped table as a shortcut to approving Cargo drivers.

Rollback uses the agreed cohort activation/presentation controls and restores compatible navigation if needed. Stop accepting new enhanced jobs while preserving already recorded manifests, receipts, clearances and custody holds. Existing in-flight work requires review; never roll back by weakening safety checks, dropping tables, changing immutable hashes or deleting source evidence.

Complete when Cargo service selection produces meaningful contents/capacity inputs and summaries, all operational entry points enforce the same current authoritative checks, required source/history/admin destinations survive menu retirement, and the relevant verification gates have evidence. Update Reservations, Fleet And Vehicles, Dispatch, Trips, supply_delivery_foundation, transportation_requests, cargo_execution_storage, System Boundaries and SYSTEM.md after each implemented slice. No claim of production SCM integration or inventory closure follows from completion of UI consolidation.

## Planning-task verification

This plan was grounded in current source and relevant Capstone notes, with independent read-only UI/backend investigations. The installed Next Route Handlers guide was read. Fresh db:status passed as recorded above. No tests were rerun for this documentation-only task; the earlier assessment's 50-test result is prior evidence, not a new implementation result. No source/runtime files, migration files, generated schema or database rows were changed by this task.

## Implementation checkpoint - 2026-10-13

The later user instruction to proceed authorized implementation. Cargo service selection now reveals a local contents/physical-requirements draft; Passenger simulation is explicitly typed and PMS-scoped. A Cargo draft cannot create a partial weight-only request while manifest intake remains unavailable. Vehicle-owned capacity is separate from requested load, and Cargo no longer inherits passenger airport/hotel defaults. Measured profile editing is shared from Fleet vehicles; the separate operational Supply menu/editor is retired while the permission-scoped original shipment source/admin route remains.

Versioned physical manifests and exact decimal package totals preserve old hashes/source adapters. Shared candidate, availability, conflict, evidence and locked commit/start paths include physical checks when the existing dispatch policy's cargoPhysical mode is explicitly configured. OFF is the default; SHADOW is advisory; ENFORCE requires a policy version plus source-contract, vehicle-standard and mass-basis references and never falls back to the legacy kg value for missing physical evidence. Mandatory policy activation is not installed by this implementation. Current profile-based capacity is used by the enhanced reporting cohort; legacy report values remain readable and unknown enhanced evidence is omitted, not zero-filled.

Dispatch/queue evidence now hashes relevant profile, manifest, shipment/allocation and policy changes; commits lock those tables and recheck current physical data and full-window profile expiry. Profile and manifest writers acquire compatible table-before-row locks. Source revision/custody/receiver/safety restrictions remain in place. New source-manifest GET is request-read scoped, validates stored ownership/hash and strips image references; receipt/evidence APIs remain separately closed.

Task 0 verified the ten formerly pending cargo objects exist with private catalog posture, refreshed schema.sql and moved them into applied classifications. No migration was added/applied and no public operating row was changed. The live ledger-only qualification removal was respected: legacy roster endpoints now refuse with 503 after their existing permission guards and no runtime SQL names the removed tables. Historical custody fixtures use an explicit test-only provider; current driver_type compatibility remains unchanged.

Verification and acceptance are recorded in [[Supply Chain Consolidation Implementation 2026-10-13]] in Capstone. D01-D10 decisions, installed source/operating providers, production activation/deployment, actual capability saves and native-device acceptance are separate remaining gates. The local draft is intentionally not durable storage; refreshing or leaving the injector discards it.
