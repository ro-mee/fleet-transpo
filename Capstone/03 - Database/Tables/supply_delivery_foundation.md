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

All five tables have RLS enabled and revoke all privileges from `anon` and `authenticated`; server routes use the existing authenticated application connection. `db:contract` classified all five as private. `verify:anon` returned explicit HTTP 401 / SQLSTATE 42501 for each. The global probe command exited 1 because 48 older empty responses remained inconclusive; the live contract confirms those relations have RLS enabled with no anon policy.

`/supply-deliveries` and `/api/supply/**` support admin sandbox import, shipment listing, cargo profile maintenance and a deterministic load check. The import route only accepts `sandbox:` source IDs, requires `SUPPLY_SCM_SANDBOX_ENABLED=true`, and is disabled in production. The evaluator also blocks the existing vehicle states that categorically prevent dispatch; `In Use` remains time-dependent and is not treated as unavailable by itself. There is no SCM partner API/authentication, allocation table, receiving/POD evidence, mobile cargo projection, outbox, retry worker or inventory writer. A load check does not reserve a dispatch or establish trip/driver/schedule eligibility.

After contract validation, semantic conflicts are recorded as a `REJECTED` inbox row with the payload hash and a bounded error/status snapshot; the untrusted event body is not copied into that rejection record. Replaying the same source event ID and body returns the same rejection. Schema-invalid payloads are rejected before an event identity is trusted, and an event that conflicts with an already-used event ID or sequence cannot be added because of the inbox uniqueness constraints. Those cases still need a separate safe attempt log before production integration.

See [[../../01 - System/System Boundaries|System Boundaries]], [[../../02 - Features/Dispatch|Dispatch]], [[../Migrations/Migrations|Migrations]] and `docs/plans/supply-chain-fleet-integration-plan.md`.
