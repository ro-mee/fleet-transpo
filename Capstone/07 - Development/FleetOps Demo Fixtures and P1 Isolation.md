# FleetOps demo fixtures and P1 isolation — Task 13, 2026-10-07 (planned)

**Status: plan only. No seed was run.** `scripts/seed-demo.mjs` already runs opt-in (`status | plan | up | down`) with a ledger-scoped `down` that deletes only what `up` inserted, preserving real identities — that mechanism is reused unchanged. Extending its scenarios with typed cargo rows is checkpoint work: the fixture inserts would reference migrations 150–155 columns, which do not exist live, so no seed run is authorized before the apply checkpoint and an isolated-DB `plan`/`up`/`down` verification.

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
