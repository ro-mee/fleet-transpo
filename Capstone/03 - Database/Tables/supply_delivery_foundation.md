# Supply delivery foundation

**Status:** Applied foundation, 2026-10-07. This is not a complete supply delivery workflow.

Migration `144_supply_delivery_foundation.sql` adds five private tables:

| Table | Purpose | Key behavior |
|---|---|---|
| `vehicle_cargo_profiles` | One cargo capability profile per vehicle. | Requires positive measurements, dated verification and an employee verifier before `supports_supply_delivery` can be enabled. Canonical measures are kg, m and m3. |
| `supply_shipments` | Current approved request snapshot and current source revision/sequence. | Unique by source organization and external request ID; holds pickup/delivery snapshots and a separate shipment status. |
| `supply_manifest_revisions` | Immutable source manifest history. | Unique by shipment and revision; stores a SHA-256 manifest hash and source event ID. Update/delete is rejected by a trigger. |
| `supply_integration_inbox` | Sandbox event deduplication and response record. | Unique by source organization/event ID and source request/sequence. Stores the event hash and response snapshot, not a partner credential. |
| `supply_shipment_events` | Append-only shipment event history. | Update/delete is rejected by a trigger. Current application events record accepted sandbox imports and manifest changes. |

Migration `145_supply_site_mappings.sql` adds `supply_site_mappings`, an admin-verified mapping from a sandbox SCM organization/site ID to an active Fleet `locations` row. The API offers only active, non-retired locations with a stored address and valid latitude/longitude; the admin confirms the source-to-location match. The mapping table has RLS enabled, an explicit anon/authenticated privilege revoke, a sandbox-only organization constraint, and an employee verifier reference. The map is not geocoded or inferred from the SCM address text.

All five tables have RLS enabled and revoke all privileges from `anon` and `authenticated`; server routes use the existing authenticated application connection. `db:contract` classified all five as private. `verify:anon` returned explicit HTTP 401 / SQLSTATE 42501 for each. The global probe command exited 1 because 48 older empty responses remained inconclusive; the live contract confirms those relations have RLS enabled with no anon policy.

`/supply-deliveries` and `/api/supply/**` support admin sandbox import, shipment listing, cargo profile maintenance, site mapping and a deterministic load check. The import route only accepts `sandbox:` source IDs, requires `SUPPLY_SCM_SANDBOX_ENABLED=true`, and is disabled in production. The evaluator blocks missing or invalid verification identity/time/reference/expiry, expired profiles, and existing vehicle states that categorically prevent dispatch; `In Use` remains time-dependent and is not treated as unavailable by itself. There is no SCM partner API/authentication, allocation table, receiving/POD evidence, mobile cargo projection, outbox, retry worker or inventory writer. A site mapping does not create a route or validate travel time; a load check does not reserve a dispatch or establish trip/driver/schedule eligibility.

After contract validation, semantic conflicts are recorded as a `REJECTED` inbox row when the source event identity is available and unused; exact replays return the stored rejection. Migration `146_supply_import_attempts.sql` adds a separate private attempt ledger for parsed JSON payloads that fail the Zod contract and rejected event-ID, sequence, request or business conflicts that cannot be represented by a unique inbox row. The ledger stores a payload SHA-256, source identifiers only when the organization ID is sandbox-scoped, a rejection code/status, authenticated employee and timestamp. It never stores rejected bodies or invalid field values. The import API records these attempts after validation or transaction rollback, while preserving its existing 400/409 response contract. Syntactically malformed JSON still receives the shared parser's 400 response without an attempt row.

Migration `147_dispatch_service_type.sql` adds the shared `dispatchschedules.service_type` discriminator as groundwork for future shipment allocations. Existing request-linked dispatches are classified `PASSENGER`; legacy requestless rows remain NULL; new general dispatch creates default to `PASSENGER`. The current API rejects `SUPPLY_DELIVERY`, and this schema change does not allocate shipments or expose them to drivers. Fleet Utilization, Driver Performance and Trip Performance now exclude typed cargo dispatches while preserving legacy NULL history; shared fleet cost/fuel metrics remain fleet-wide. Cargo KPIs and the transactional allocation path remain prerequisites.

See [[../../01 - System/System Boundaries|System Boundaries]], [[../../02 - Features/Dispatch|Dispatch]], [[../Migrations/Migrations|Migrations]] and `docs/plans/supply-chain-fleet-integration-plan.md`.
