---
type: reference
status: disabled-development-candidate
last_verified: 2026-10-10
tags: [database, cargo, privacy]
---

# Cargo execution storage — Task 5

Candidate `159_cargo_execution_storage.sql` is **unapplied**. Candidate 158 is also pending. The fresh runner status is 156 applied, 2 pending, 0 changed. Do not run `db:up` until D01–D10 approval and activation review permit both pending migrations. No generated schema, public operational rows, live storage bucket, uploads, source decisions, partner messages or retention jobs were created.

Seven tables are classified as private in `PENDING_TABLES`, separate from the applied schema: `cargo_trip_executions`, `cargo_receipts`, `cargo_decisions`, `cargo_fleet_clearances`, `cargo_evidence`, `cargo_feedback_outbox`, and `cargo_decision_inbox`. Each candidate table enables RLS and revokes all PUBLIC/anon/authenticated privileges, including TRUNCATE. Candidate trigger functions also revoke exposed-role execution. The candidate private storage bucket has a restrictive policy denying anon/authenticated access even alongside a permissive storage policy.

## Immutable identity and binding

An execution is unique per trip and has exactly one request-manifest or supply-allocation FK. The insert trigger independently follows the trip's dispatch: a foreign request manifest UUID or unrelated supply allocation is rejected even if it exists. REQUEST snapshots must equal the bound persisted snapshot and reference. SUPPLY references must match the allocation's shipment/revision and actual dispatch. The service uses Task 4's explicitly configured supply adapter. Original expected quantities stay in the manifest; receipt observations never replace them.

Parent linkage guards freeze only `trips.dispatch_id`, `dispatchschedules.request_id/service_type`, and the bound supply allocation's `dispatch_id/supply_shipment_id/manifest_revision/allocation_status`. They do not freeze driver, vehicle or general trip-status fields. Task 6 must implement any explicit custody/rescheduling workflow before relaxing these conservative linkage holds. Task 4's first-manifest-after-dispatch and subsequent-revision refusals remain intact.

Receipts and decisions store normalized input, canonical SHA-256 payload identity, authenticated reporter/principal identity, immutable timestamps and the execution version at insertion. Receipt replay is execution/submission scoped; decisions use source-system/organization/event identity. Exact replay returns the first saved result; changed payload or actor replay returns 409. Receipt, decision, clearance and inbox update/delete triggers prevent rewriting history.

Clearances bind execution, immutable receipt, decision, manifest hash and current execution version. SQL rejects an old receipt after a same-stage recount and requires the latest decision for that receipt. `safety_evidence_ref` is nullable and has **no implied safety approval**. Task 5 supplies no clearance writer or safety decision. Task 6 must keep missing or unverified post-load proof blocking; pre-trip inspection is not securement evidence.

## Internal interfaces

`src/services/cargo-execution.repository.js` exports `loadExecutionForUpdate(tripId, tx)`, `insertReceipt(input, actor, tx)`, `appendCargoDecision(input, principal, tx)` and `appendCargoFeedback({execution,eventType,receipt,decision},tx)`. Callers must supply one already-open transaction object with `query`, trusted `cargoConfig`, and, for receipt writes, `cargoTripId`. The loader requires `tx.cargoActor`; receipt insertion uses the authenticated `actor.user.role/driverId/employeeId`. Driver identity is checked against the assigned trip and employee before execution creation or receipt/evidence writes. Staff and source authority are not inferred from a driver session.

All repository access defaults to 503 without explicit data/privacy/source/receiving/retention references and schema readiness. Simulated configuration is restricted to test/development and refused under production NODE_ENV. There is no installed runtime configuration provider or new HTTP writer. The repository returns persisted rows (decision response is its saved JSON representation); the Task 6 service is responsible for the later `CargoExecutionView` response and lifecycle checks.

`storeCargoEvidence({file,tripId,submissionId},actor)` remains a fixed 503 runtime boundary. `createCargoEvidenceStore({db,storage,config})` is an explicitly simulated, nonproduction dependency seam. It validates actual byte length and JPEG/PNG signature through the shared validator; caller MIME/size is insufficient, and arbitrary object keys are rejected. Authenticated ownership is checked before reading the file, reserving records or uploading. Keys are server-created execution/submission/evidence UUID paths. Identical bytes for the same execution/actor/submission reuse the same evidence ID and key; different photos have distinct content identity.

The evidence row commits as STAGED before upload. Failed uploads become ORPHANED; if the status write itself fails, the committed STAGED row still tracks the unresolved object. Retry writes the same validated bytes to the stable key, then becomes READY. Only matching READY evidence can attach to its actor's immutable submission; attachment becomes ATTACHED in the receipt transaction. No retention duration, cleanup worker or automatic deletion was invented. Authorized signing rechecks the persisted trip and uploader, exact bucket and key. Cargo is excluded from generic media parsing/signing so license/avatar/media readers cannot sign cargo references.

## Durable feedback handoff to Task 9

Receipt insertion atomically appends PICKUP_RECORDED or DELIVERY_RECORDED and, when needed, DISCREPANCY_REPORTED. Decision insertion atomically records the source inbox and SOURCE_DECISION_RECORDED. TRANSPORT_CLOSED is a validated event vocabulary item for the later lifecycle writer. `cargoFeedbackSchema` validates complete event data, manifest, receipt and decision relationships; append also re-reads persisted records to reject fabricated or foreign objects.

Outbox identity is `(execution_id,execution_version,event_type,receipt_id)` with nulls not distinct. It stores stable event UUID, source, immutable payload/hash and optional decision FK. Only status, attempts, next_attempt_at, lease_token/lease_expires_at, acknowledgement/acknowledged_at and bounded last_error_code are mutable. Initial status is PENDING. Inbox uniqueness is `(source_system,source_organization_id,event_id)` and its response is immutable. ACK updates cannot change a WAIT decision. No network worker, retry schedule or inventory closure exists in Task 5.

Task 5 review fix (2026-10-10): exact feedback replay remains valid after a later receipt or decision advances the execution version. The append helper validates persisted manifest/source and receipt/decision identity before looking up the historical logical event; matching canonical content returns its original event ID. The current-version requirement applies only when creating a new event. Changed content, foreign source identity and stale new events still return 409. The actual PostgreSQL regression failed before the fix and passed afterward; all 14 focused repository/database tests and scoped lint passed. No SQL migration or activation changed.

## Verification and limitations

Eleven actual PostgreSQL tests passed in disposable uniquely named schemas, including rewritten storage tables; both namespaces are removed in `afterAll`. No public operating rows are used. Two simultaneous same-submission calls assert distinct PostgreSQL backend session IDs and produce one receipt/two expected events; distinct submissions serialize into distinct execution versions. Fixtures verify FK/linkage failures, immutability, replay conflicts, rollback of receipt plus outbox, grant/RLS catalog state, restrictive bucket policy, staged/orphan retry, owned signing and stale-clearance refusal. SQL refusals check constraint/history SQLSTATEs rather than accepting syntax errors.

Focused cargo tests passed, schema-contract tests passed 13/13, existing media-security tests passed 72/72, scoped lint passed, auth audit passed 324/324, and migration naming passed 158 files. The new code's RED/GREEN results and exact commands are in the Task 5 scratch report. Live public cargo catalog/anon/bucket gates are deferred until authorized application; fixture security is not proof of production activation. No full suite, UI/device acceptance or lifecycle/safety release claim is made.

Related: [[Trips]] · [[trips]] · [[transportation_requests]] · [[supply_delivery_foundation]] · [[System Boundaries]]
