# FleetOps demo fixtures and P1 isolation — Task 13, 2026-10-07 (planned)

**Status: typed intake preparation implemented 2026-10-08; no seed was run.** The existing quarter-data runner `scripts/seed-demo.mjs` remains unchanged. `scripts/seed-typed-demo.mjs` accepts explicitly supplied typed intake fixtures and uses its own exact-ID ledger. It does not create vehicles, drivers, compliance evidence, capacity, coordinates, fuel prices or completed trips. The full matrix below still needs authorized isolated-database and device acceptance after the migration checkpoint.

## Opt-in typed intake runner

`node scripts/seed-typed-demo.mjs plan <manifest.json>` validates a manifest and prints the supplied request fields. Planning does not load environment files or connect to a database. The manifest must declare `isolated: true` and a nonempty `requests` array. Each row supplies a canonical service code, matching PMS/Passenger or POS/Cargo source/load, `external_request_id`, pickup/dropoff text and an offset-qualified pickup timestamp. Passenger rows require a positive count; cargo rows require a positive declared weight and description and omit guest/passenger fields. Duplicate source/request identities and unknown services are rejected. No example identity is copied into the live fleet.

`up <manifest.json>` and `down` require explicit `FLEETOPS_TYPED_DEMO_ISOLATED=true` and a dedicated `TYPED_DEMO_DATABASE_URL` pointing to localhost and a database whose name ends in `_demo`. They never read the production `DATABASE_URL`. These commands remain unexecuted and must wait for the migration and isolated-data approval checkpoint.

`up` requires the existing migrated active service catalog, inserts only the supplied requests, and records their IDs under `system_settings['seed:passenger-cargo-v1']` in the same transaction. A database advisory lock prevents concurrent duplicate runs. `down` locks and removes only those IDs; if dispatch has used a fixture, it refuses removal for an explicit review of its child records. Fleet identities and odometers are never modified. The separate runner deliberately prepares intake only; it does not pretend that the start, completion, pricing or negative-readiness scenarios below have been exercised live.

Verification: `src/lib/integration/typed-demo.test.js` passes five offline cases covering deterministic supplied inputs, invalid/missing declarations, atomic ledger writes, missing-catalog rollback and exact-ID removal/use refusal. The database substitute checks the real helper's SQL; it is not a live apply/seed verification.

## Required demo matrix (acceptance fixtures for Task 14)

| # | Scenario | Expected outcome |
|---|---|---|
| 1 | PMS passenger (GUEST_TRANSPORT, 4 pax) | Intake + dispatch + complete on a passenger vehicle |
| 2 | PMS VIP passenger (VIP_GUEST_TRANSPORT) | VIP class resolution, passenger rendering unchanged |
| 3 | POS cargo fit (RESTAURANT_SUPPLY_PICKUP, 650 kg → 1000 kg van) | 65% utilization; Cargo Loaded → At Delivery copy |
| 4 | POS cargo overweight (1800 kg → 1000 kg van) | Same 409 blocker at assign, reassign, dispatch and start; 800 kg excess stated |
| 5 | Unregistered vehicle (no asset code / use) | Task 7 audit flags; typed dispatch blocked with inventory reason |
| 6 | Missing insurance (unverified docs) | `INSURANCE_NOT_VERIFIED`; readiness false |
| 7 | License mismatch (B1 driver, B vehicle) | `driver_license` block before candidate evaluation |
| 8 | Completed cargo trip (36 km, 9 km/L, PHP 62.70/L) | 4.00 L / PHP 250.80 stored estimate; receipt price independent |
| 9 | Price history (61.90 → 62.70 → correction) | Old instants keep old prices; future stays Pending |

## P1 follow-ups — explicitly NOT hidden prerequisites

Planned separately after core passes; no cargo POD dependency for starting trips unless a stakeholder explicitly changes scope:

- Insurance metadata enrichment (policy numbers, provider registry)
- Proof of delivery (POD) capture flow
- Notification wording per load (cargo vs passenger templates)
- Source-department analytics (Kitchen/Front-desk breakdowns)
- Cost ranking across services

## Verification so far

`operational-reports.test.js` (7: five-code filter accept/reject, estimate labels, 650/1000 = 65%, unknown-capacity omission, null-average emptiness) + trip excel parity test (2: filtered export equals the selector view, unknown service 400s). Report queries referencing 151/153 columns carry the same release hold as the rest of the branch: do not deploy before those migrations are applied.
