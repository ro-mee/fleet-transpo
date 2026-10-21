---
type: assessment
status: implemented-see-closeout
last_verified: 2026-10-20
related: ["[[Trips]]", "[[cargo_execution_storage]]", "[[Trip Odometer Photo Verification 2026-10-19]]"]
---

# Dual cargo signature plan assessment - 2026-10-20

The owner subsequently approved creating the plan and implementing the cargo-only feature. The implementation and verification record is [[Dual Cargo Signatures Implementation 2026-10-20]]. The original assessment below records the preimplementation review, not the current source status.

The user requested an opinion on supplier pickup and hotel delivery signatures for hotel and restaurant cargo operations. This is a proposal review, not authorization to implement or activate cargo execution. No application, database, environment or dependency change was made.

## Operational recommendation

The feature is appropriate for supplier collections, food and beverage supplies, linen, equipment and departmental handovers. Pickup records who released the observed cargo; delivery records who acknowledged receiving it. Starting and ending odometer photos describe the vehicle journey, while handover evidence describes the cargo exchange. A drawn signature alone does not establish signer identity, source acceptance, Fleet safety clearance or stock/order closure.

Prefer extending the existing versioned cargo receipts and private evidence workflow rather than adding an independent trip-level handover system. A signature must identify the exact receipt, manifest revision, stage, actual per-line quantities and condition acknowledged. Keep expected, collected and delivered quantities distinct. Shortage and damage can coexist, so quantity discrepancy and physical condition should not be mutually exclusive choices.

## Required changes to the proposed plan

- Existing `cargo_receipts` already supports PICKUP/DELIVERY, immutable revisions and replay-safe submissions. `UNIQUE(trip_id, handover_stage)` cannot represent recounts or corrections. Preserve history; require fresh signatures when the acknowledged receipt changes. One pickup and one delivery can be the first release scope, with multiple stops explicitly deferred.
- Start Route is travel to pickup and already owns the starting odometer capture. Require pickup handover before departure with cargo, preserving source/Fleet/securement checks. Record delivery at the actual receiving destination, which may differ from the hotel or the final vehicle return point. Capture ending mileage when the vehicle journey actually ends. Missing receiving proof can hold cargo closure without preventing accurate evidence capture or incident reporting; this needs a deliberate design compatible with the existing completion transaction.
- An incident ID alone must never bypass delivery proof. Define authorized review, trip/stage linkage, reason, evidence and audit for exceptional disposition. Refusal to sign must remain an honest unresolved or reviewed exception.
- Resolve the recording driver from the authenticated assignment; record server receipt time separately from device capture time. Check GPS bounds, age and accuracy and define unavailable-location handling. Offline drafts remain unconfirmed until the server accepts them. Exact retry must not create duplicate records.
- Use the existing cargo permission matrix and ownership checks. The real privileged role is `super_admin`, not `system_admin`. Hotel receiving departments are signer details, not new FleetOps account roles. Define an approved method of establishing receiving authority separately from typing a name or drawing a signature.
- Application RBAC remains mandatory on elevated server database paths. Direct anon/authenticated access must still be denied with explicit RLS and revoked exposed-role grants, schema-contract registration, and live contract/anon verification after any new table is applied.
- Prefer bounded, validated stroke/path data rendered with a fixed template over arbitrary SVG documents. Reject empty drawings and retain signatures privately with approved access/retention rules. `react-native-svg` is absent from `mobile/package.json`; whether a binary rebuild is required depends on the actual installed native client, not only on writing JavaScript.
- Existing production cargo execution methods intentionally return `503 CARGO_CONFIGURATION_REQUIRED`. A signature modal cannot activate missing approved source, receiving, safety, evidence and lifecycle providers. Preserve those boundaries and test shared lifecycle entry points, stale receipts, retries, reassignment and private evidence access as well as route RBAC.

## Verification and limits

Read repository policy, design/RBAC guidance, relevant cargo/Trips/odometer notes, generated table definitions, current cargo contracts/API/service and the mobile dependency manifest. The odometer note records local photo enforcement enabled on 2026-10-19, with hosted/device acceptance still separate. Current source confirms disabled production cargo execution methods. No runtime test, live catalog query, phone test, operating write or deployment was performed for this assessment. Documentation bytes were checked as UTF-8 and for whitespace errors.

Primary references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase data security](https://supabase.com/docs/guides/database/secure-data), [Expo SDK 54 SVG](https://docs.expo.dev/versions/v54.0.0/sdk/svg/), [Expo library workflow](https://docs.expo.dev/workflow/using-libraries/).
