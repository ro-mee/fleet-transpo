# Supply-chain workflow consolidation assessment

Date: 2026-10-13
Status: Recommendation only. No workflow removal, application change, migration or operational approval.

## Recommendation

Use the existing typed Reservations -> Dispatch -> Trips workflow as the primary Fleet cargo execution path. Consolidate useful Supply Deliveries capabilities into it, then retire the separate operational navigation/page after dependency and data checks. Do not delete the supply tables, applied migrations, immutable source history or source adapter merely to remove a page.

Fleet should have one resource scheduling/assignment system and one trip execution/review system. A distinct SCM source may still warrant its own ingestion and shipment records underneath that shared experience. One physical transport job must not be independently assignable through both intake paths. This assessment recommends a direction; it does not approve new source contracts, safety rules or cargo runtime activation.

## The two existing paths

| Concern | Typed transportation requests | Supply Deliveries foundation |
|---|---|---|
| Intake | Shared integration request endpoint; authenticated PMS/POS sources and the existing staff fallback. V2 writes explicit Passenger/Cargo and a canonical service. | Admin-only SCM sandbox event import; explicit flag, sandbox source IDs and non-production environment required. |
| Job identity | transportation_requests -> dispatchschedules.request_id -> trips. | supply_shipments + immutable supply_manifest_revisions; supply_dispatch_allocations bridges a shipment revision to a requestless dispatch. |
| Cargo detail | Declared total kg, description, department and service. Separate request-manifest adapter/storage contracts exist. | Item/package quantities, weights, dimensions, temperature, handling, pickup readiness and delivery windows. |
| Vehicle evidence | vehicles.operational_use and cargo_capacity_kg, commissioning and document readiness. | Separate vehicle_cargo_profiles with payload/GVW/operating mass/reserve, volume, openings, dimensions, handling, temperature and verification. |
| Scheduling/execution | Existing shared request assignment, availability, conflict, dispatch and trip paths contain typed cargo checks; driver classification compatibility also applies. | Measurement pre-screen only. Load-fit explicitly returns assignment_eligibility NOT_EVALUATED; no installed supply assignment writer. |
| Cargo receipt runtime | Shared cargo services/adapters and review UI exist, but installed execution methods and manifest intake refuse with 503 until approved configuration is supplied. | Can adapt the exact allocation/manifest into the same cargo execution contract; requires an explicit trusted SCM-to-service mapping. This does not enable supply dispatch. |
| Revisions | Shared transport request POST accepts create revision 1 only; update/cancel is refused. Request-manifest service conservatively rejects changes and late first attachment. | Sandbox importer supports sequenced immutable manifest updates before allocation/loading. |

The dispatch service_type value PASSENGER is historical for request-backed jobs, including typed Cargo. It must not be confused with transportation_requests.load_type. SUPPLY_DELIVERY identifies the separate requestless shipment-allocation path. Bulk relabeling request-backed cargo as SUPPLY_DELIVERY would violate the existing linkage model.

## Why consolidation is preferable

1. Existing scheduling already owns drivers, vehicles, conflicts, dispatch evidence and trips. Extending this path avoids a second assignment engine and makes hotel/restaurant cargo use the same operating flow.
2. Payload currently has two independently maintained meanings. Shared assignment compares declared cargo_weight_kg against vehicles.cargo_capacity_kg. Supply load-fit derives min(rated_payload_kg, gross_vehicle_weight_limit_kg - operating_mass_kg) - operational_reserve_kg from vehicle_cargo_profiles. Source inspection found no synchronization between the profile save and the shared vehicle field. For illustration only, a 650 kg job could pass a 1,000 kg vehicle field but fail a profile-derived 500 kg limit. These are example values, not inspected fleet records.
3. Two intake identities and manifest stores need explicit ownership. Re-importing the same real job as both a request and shipment would create separate local identities unless a trusted correlation/uniqueness rule prevents it. This is a design risk, not an observed live duplicate.
4. Supply Deliveries bundles shipment review, load-fit, fleet capability editing and admin integration tools. These belong naturally in request/trip detail, Fleet vehicles and integration administration rather than a second dispatch workspace.

## What to preserve and improve

- Preserve immutable manifests, package versus ordered-unit distinctions, source-scoped replay/event history and sandbox rejection records. The current supply adapter uses transport_package_count, never ordered_quantity, for observed package expectations.
- Place cargo requests in the existing queue with cargo/service/source filters. Show the original manifest on request/source detail and pickup/delivery observations on the existing trip review.
- Move detailed vehicle cargo capability editing into Fleet vehicle management. Decide the authoritative usable payload and reconcile existing values with provenance before sharing one capacity result across recommendation, assignment, reassignment and start. Do not copy conflicting values automatically.
- Reuse and extend the physical load evaluator for applicable cargo jobs. The request execution manifest currently lacks supply package dimensions, per-package weights and temperature ranges, so a shared experience alone does not supply those inputs. Missing required evidence must remain unknown or blocked under approved rules.
- Keep source adapters distinct where necessary. The shared request envelope supports PMS/POS/Web, while the cargo source contract also supports SCM only as a SUPPLY manifest. An SCM shipment cannot be routed through PMS/POS by renaming its source. A future approved SCM mapping/adapter and job correlation decision are required.
- Retain source quantity acceptance, Fleet safety clearance, receiver confirmation, transport completion, partner acknowledgement and inventory/order closure as separate decisions. One queue does not merge their authority.
- The existing request cargo schedule includes handling buffers, but these defaults do not establish an approved SCM reservation interval or travel/deadhead policy.

## Retirement sequence and dependencies

1. Confirm intended source ownership: PMS/POS cargo through the existing request path; SCM shipment intake only if the actual integration requires it. Define how an external job maps to one Fleet execution identity.
2. Consolidate cargo capability editing and authoritative payload evidence in Fleet vehicles; expose manifest and physical checks through existing request/trip/dispatch surfaces.
3. Preserve exact source-manifest revision/hash references. Reuse the existing REQUEST/SUPPLY adapters and shared execution layer rather than making another receipt store.
4. Update navigation, permissions, the safe supply source link in cargo-execution.client.js, shipmentId selection, report partitioning and affected tests. Maintain a usable read-only history/source view or redirect before retiring /supply-deliveries.
5. Check live shipment/allocation counts, immutable-history references, external consumers and rollback needs before retiring any API/table. This review did not inspect those rows or authorize deletion. Applied migrations remain immutable; any later schema retirement requires the repository migration/security process.

Keep the sandbox importer/admin tools internal while the production SCM contract remains absent. Do not invest in a second supply assignment engine. If the chosen product scope is only PMS/POS hotel/restaurant cargo, retain the SCM foundation as historical/inactive integration infrastructure until its dependencies are proven removable.

## Verification and current-state limits

- Repository instructions, relevant Capstone notes, both integration contracts/importers, load evaluators, dispatch discriminator guards, cargo manifest/execution adapters, navigation/source links and fleet cargo fields were inspected.
- npm run db:status passed: 161 on-disk files applied, 0 pending, 0 changed. It also reports ledger-only keys 113/114/115 plus 162_drop_driver_service_qualifications.sql and 163_drop_maintenance_provider_columns.sql. Earlier notes describing candidates 158-161 as unapplied are historical and cannot establish current status. A ledger result does not prove live table definitions, RLS, source credentials or operating approval.
- Focused Vitest run passed 6 files / 50 tests: load-capacity, cargo-schedule, vehicle-load-compatibility, cargo-manifest.service, integration/cargo/manifests route and shipment-detail-selection.
- No migration apply/dump, schema edit, operational data write, partner send, source activation, browser/device acceptance, full suite or build was performed. Installed cargo execution remains disabled by source. Live row usage and catalog security were not assessed.

Related: [[supply_delivery_foundation]] · [[transportation_requests]] · [[cargo_execution_storage]] · [[Dispatch]] · [[Fleet And Vehicles]] · [[System Boundaries]] · [[FleetOps Cargo Rollout Runbook]]

## Implementation plan drafted - 2026-10-13

The user requested an implementation plan and explicitly required cargo capacity and contents to be considered when a supply-chain/cargo service is selected. The implementation document is `docs/plans/2026-10-13-supply-chain-workflow-consolidation.md`. It treats Supply Chain as the existing cargo-service grouping and sequences catalog reconciliation, versioned physical manifests, one Fleet cargo capability/payload authority, shared transactional eligibility, conditional cargo UI, existing trip/mobile projections and navigation retirement last.

The plan includes item/package quantities, gross weights, dimensions, rotation, handling and temperature facts; required kg versus usable kg; provenance/expiry; exact manifest/profile/policy evidence invalidation; and quantity-versus-package distinctions. Imported source expectations remain source-owned. The existing mock injector is not recast as a live SCM create form, and fixed503 cargo runtime restrictions remain until separately approved configuration exists. No new supply assignment engine or initial table/API deletion is proposed.

Fresh planning-time db:status again reports 161 on-disk files applied / 0 pending / 0 changed, with ledger-only spent 162/163 keys. Source review found cargo objects still classified as unapplied in scripts/lib/schema-contract.mjs; Task 0 requires live-catalog/generated-dump reconciliation before schema work. This documents the mismatch without treating a ledger entry as proof of deployed catalog security or owner approval.

Verification: repository/source and installed Next Route Handlers guide review, independent read-only UI/backend investigations and fresh read-only migration status. No implementation tests were rerun for this documentation-only task; no application/runtime source, migration, generated schema or database rows were changed. SYSTEM.md was updated with the plan and its limits.
