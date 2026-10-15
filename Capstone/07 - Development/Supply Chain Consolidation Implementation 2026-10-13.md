# Supply-chain consolidation implementation

Date: 2026-10-13
Status: Internal code implemented; cargo source/execution activation and operating approvals remain closed.

Implementation plan: `docs/plans/2026-10-13-supply-chain-workflow-consolidation.md`.

## Behavior

- The existing request simulator selects canonical Guest/VIP or Supply Chain cargo services. Cargo reveals description, declared kg, source department and an item/package draft with weight, dimensions, rotation, handling and temperature. Requested load is distinct from Fleet-owned capacity. Cargo does not inherit passenger location defaults. Switching services preserves the local draft but a Passenger submission excludes it.
- Cargo draft review performs no request/manifest mutation while the manifest writer is unconfigured. The UI explicitly says the draft is unsaved and lost on refresh/navigation. Passenger simulation uses typed PMS v2 and does not trust a browser source-system selector.
- Fleet vehicle new/edit now hosts the single measured Cargo profile editor for saved Cargo vehicles. Unsaved/reclassified vehicles show save-first guidance. Payload, volume, openings, handling, temperature, recorded provenance and expiry remain under vehicles.update. The old kg value is explicitly transitional; disagreements are shown without automatic copying or manufacturing evidence.
- Supply Deliveries is removed from operational menus and no longer edits vehicle profiles. The original route remains a permission-scoped source-snapshot/pre-screen/admin-tools destination; existing local shipment UUID links still work. Admin Settings and Super Admin integration settings provide source-record discovery. No table/API history was deleted, and SCM allocation stays disabled.
- Request queue/detail/Copilot and evidence use Cargo summaries rather than phantom passengers/seats. Queue load/service/source filters are server-side. Existing staff trip and native driver views show optional source physical package facts while preserving older manifests and closed controls.

## Shared data and enforcement

`physical_contract_version: 1` adds nested package facts to the existing immutable manifest. Package kg use bounded exact three-decimal arithmetic; dimensions use four decimals; nominal volume is compared with scaled integers. Ordered-unit expectations are not converted into package counts. Declared kg must agree with package-derived kg. Historical manifests/hashes remain unchanged; the separate explicit Supply physical adapter does not rewrite frozen execution views.

`cargo-physical.service.js` reloads the stored request, validated exact manifest and vehicle profile. It does not trust posted mass, profile or contents. Existing `dispatch_policy.cargoPhysical` defaults OFF. SHADOW reports advisory findings; ENFORCE requires a version and the source-contract/vehicle-standard/mass-basis references before checking mandatory physical evidence. No live policy values or providers were installed. This is an additional physical gate, not approval of cargo license, operating interval, loading plan, safety, receiver or stock policies.

Profile-derived usable kg follows the existing minimum rated/GVW-minus-operating-mass formula minus reserve. Shared recommendation/availability/conflict/commit paths use this basis for the enforced cohort; legacy kg does not become a fallback for unknown mandatory evidence. Volume, individual package/opening fit, temperature compatibility and declared handling are separately checked. One compartment requires a common permissible temperature range; matching flags do not prove collective packing, axle balance or performed securement. Profile provenance and validity through the service window are rechecked.

Dispatch and whole-queue revisions now include cargo profiles/manifests/source allocations and settings. Final dispatch/start transactions serialize compatible writers and recheck persisted physical facts and time-sensitive expiry. Profile, request-manifest and sandbox shipment writers acquire table-before-row locks. Existing recount/clearance binding and custody holds remain; no post-custody manifest correction or new shipment assignment is enabled.

The request-read-scoped cargo-manifest GET exposes validated source metadata/lines only and strips reference-image IDs. It does not expose receipt proofs or grant access to the separate private evidence API. Cargo receipt/evidence/decision/clearance runtime exports still return 503 without their approved configuration.

## Catalog alignment

Fresh ledger: 161 on-disk migration files applied, zero pending/changed; missing-file ledger keys include spent versions 162/163. Live catalog confirms all ten cargo objects from migrations 158–161 exist with RLS enabled and anon/authenticated access revoked. `schema.sql` was refreshed with the repository dumper (87 tables, 1 view), and classifications now reflect applied storage rather than stale PENDING_TABLES entries.

The actual cargo shipment/allocation/profile/request-manifest/execution tables were empty at the read-only inventory checkpoint. No backfill or public operating row mutation was required. Ledger migration 162's retired qualification tables were not recreated: old roster services/endpoints now refuse with 503, preserving permission checks. The primary saved driver_type compatibility gates remain active. Historical isolated custody fixtures have an explicit test-only roster provider and are not current runtime acceptance.

## Verification checkpoint

- Final broad focused regression run after dependency restoration: 78 files passed / 810 tests passed; 5 opt-in database suites / 56 tests skipped in that run. This is not the full repository suite.
- Separate real PostgreSQL physical evidence run: 3/3 passed in a disposable uniquely named schema, including distinct pinned backend sessions, stale profile/new-manifest refusal and profile-writer serialization. The schema was removed afterward; no public rows/sequences were mutated.
- Separate historical cargo PostgreSQL fixtures: 53/53 passed across four suites for immutable manifests, execution storage, service custody/receipts and feedback. Tests used disposable schemas; no public operating rows were changed. Together with the new physical evidence suite, 56 opt-in SQL tests passed separately from the broad focused run.
- Touched JavaScript/JSX/MJS strict lint passed. Route authorization passed 331/331; migration naming check passed for 161 files.
- Live db:contract passed for 88 relations with zero violations/missing objects. Anon probe: zero exposed, 40 explicit refusals, 48 inconclusive; those inconclusive responses are explained by the live catalog's RLS/no-anon-policy result, not called probe passes.
- Authenticated Admin browser inspection confirmed the retained source view, source/admin navigation and cargo service selection revealing contents/requirements without any saved record. Final browser reload confirmed Cargo pickup/drop-off remain unselected rather than inheriting passenger defaults. No live profile save, real shipment/assignment/receipt, full role replay or native-device acceptance occurred.
- Production webpack build passed completely, including 242 static pages and build tracing, with `RAYON_NUM_THREADS=1`, `UV_THREADPOOL_SIZE=1` and a 1536 MB Node heap limit. Initial attempts found missing installed pdf-parse (already declared) and a Windows allocation failure; restoring declared dependencies and limiting parallelism resolved them without package/lock source changes. The existing geoip dynamic-dependency warning remains.
- Android JavaScript export passed with one Metro worker (1453 modules, 82 assets). This verifies bundling, not native-device behavior.

No migration application, operating policy approval, partner traffic, deployment, inventory write or source activation occurred. Cargo drafts and disabled runtime must not be described as a complete operational SCM workflow.

## Cargo queue + Copilot connection plan - 2026-10-15

Plan-only: `docs/superpowers/plans/2026-10-15-cargo-queue-copilot-connection.md`. Projects existing cargo engine facts into queue rows (summary + physical chip label) and Copilot evidence (load projection, scope vocab, kg simulation, prompt rules, drawer live path). No code, migration, or behavior changed.

## Cargo remaining connections - 2026-10-15 (implemented)

Sub-agent driven implementation of `docs/superpowers/plans/2026-10-15-cargo-remaining-connections.md`: substitute type gate (`532b66cd`), roster type filter (`9bae5973`), direct-write checkpoints (`dd4ff50c`), measured-profile commission + fleet visibility (`359bd6de`), board honesty (`7649b65b`). No migration or dependency. Focused 544 pass / 5 pre-existing window.test.js fails (clean-tree identical). Fleet And Vehicles and Dispatch notes carry the behavior details.

Related: [[Supply Chain Workflow Consolidation Assessment 2026-10-13]] · [[Fleet And Vehicles]] · [[Reservations]] · [[Dispatch]] · [[Trips]] · [[supply_delivery_foundation]] · [[cargo_execution_storage]] · [[System Boundaries]].
