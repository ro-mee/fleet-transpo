# FleetOps road-readiness contract — design

**Status:** User approved the bounded contract-first slice on 2026-10-06; written-spec review is pending before implementation.

## Context and decisions

Release B Task 4 is the next approved plan stage. The current vehicle API requires a plate at create time, the tracked schema has no commissioning/cargo-capability fields, and `vehicledocuments.status` is client-settable. The existing `vehicles.registration_expiry` may be historical or inferred from a plate window; neither that date nor `status = 'Active'` is authoritative compliance evidence.

The user chose a separate approval model: fleet managers submit evidence; only `admin` or `system_admin` may attest it as verified, with verifier identity and timestamp recorded. The user also chose the expiry date on a separately verified OR/CR document as the registration-validity source. Existing evidence without an explicit verification attestation is pending, not verified.

No live database/status/catalog query, `.env` inspection, migration, schema dump/edit, connector activation, merge, or deployment is authorized. Migrations 144/145/146 remain unapplied and held for concurrent-main reconciliation and explicit apply approval.

## Bounded slice

Implement only a pure readiness evaluator and its tests. Do not add persistence, migrations, vehicle APIs/forms, dispatch consumers, or mobile/UI behavior in this slice. The helper is a contract foundation; it is not a runtime safety gate until a later server-owned adapter and migration are approved and integrated.

```js
evaluateRoadReadiness(vehicle, documents, now)
  -> { ready: boolean, blockers: string[] }
```

The normalized contract input is `vehicle = { plate_number, commissioning_status, maintenance_clear, safety_clear }` and `documents = [{ document_type, verification_status, verified_by, verified_at, expiry_date, deleted_at }]`; these are DTO fields, not a claim about the current database schema. `now` is a `Date` instant. `blockers` contains these stable machine-readable codes in deterministic order: `PLATE_MISSING`, `COMMISSIONING_NOT_READY`, `MAINTENANCE_NOT_CLEARED`, `SAFETY_NOT_CLEARED`, `OR_CR_NOT_VERIFIED`, `OR_CR_VERIFICATION_AUDIT_MISSING`, `OR_CR_EVIDENCE_AMBIGUOUS`, `REGISTRATION_EXPIRY_MISSING`, `REGISTRATION_EXPIRY_INVALID`, `REGISTRATION_EXPIRED`, `INSURANCE_NOT_VERIFIED`, `INSURANCE_VERIFICATION_AUDIT_MISSING`, `INSURANCE_EVIDENCE_AMBIGUOUS`, `INSURANCE_EXPIRY_MISSING`, `INSURANCE_EXPIRY_INVALID`, `INSURANCE_EXPIRED`, and `REFERENCE_TIME_INVALID`.

Readiness is fail-closed and requires:

- A nonblank official `vehicle.plate_number`; never synthesize a plate. The verifier attests that the OR/CR evidence matches this vehicle and plate.
- `vehicle.commissioning_status === 'Ready'`.
- Explicit server-normalized `vehicle.maintenance_clear === true` and `vehicle.safety_clear === true`. Missing, false, or malformed evidence blocks; these fields are inputs to the pure contract, not client-writable API fields.
- Exactly one non-deleted `OR_CR` document with `verification_status === 'Verified'`, a non-null `verified_by`, a parseable `verified_at` no later than `now`, and a valid `expiry_date` that has not expired.
- Exactly one non-deleted `Insurance` document meeting the same verification-audit requirements and with a valid, non-expired `expiry_date`.
- If multiple non-deleted verified records of a required document type exist, treat the evidence as ambiguous and block rather than choosing one silently. Pending/rejected rows do not supersede a single verified row.

The evaluator ignores legacy document `status`, `vehicles.registration_expiry`, and `vehicles.insurance_expiry`; only verified document records supply expiry evidence. An expiry date is a valid `YYYY-MM-DD` calendar date and remains valid through that day in `Asia/Manila`. Missing and malformed dates use distinct blocker codes; an invalid `now` returns `REFERENCE_TIME_INVALID`. The output contains codes, not user-facing prose; presentation mapping is outside this slice.

Fuel-planning completeness is separate from road readiness. This slice does not implement `evaluateFuelPlanningReadiness`; verified fuel baselines and price snapshots are specified in the later Release D work, and their absence must not make a vehicle unroadworthy.

## Alternatives considered

1. **Pure contract plus tests first (chosen):** defines fail-closed semantics without inventing persisted data or bypassing the prohibited migration-ledger check. It has no runtime effect until the later persistence/adapter slice.
2. **Implement schema, APIs, and UI now:** rejected for this increment because the migration ledger/catalog check is not authorized and the asset-code/backfill policy remains unresolved.
3. **Skip to driver cargo UI:** rejected because Release C depends on safe cargo dispatch; showing cargo execution before Release B gates are implemented would misrepresent readiness.

## Verification and later gates

- Unit tests cover missing plate/commissioning, pending or unaudited evidence, missing/invalid/expired dates, maintenance/safety evidence, duplicate verified records, the expiry-day boundary in Manila, and a complete ready case.
- Run the focused Vitest file, touched ESLint, and `git diff --check`. No live database or migration command is part of this slice.
- A later approved persistence task must define the server-side verifier authorization/audit writes, asset-code policy, and migration numbering/checkpoint before making the contract available to API consumers. The later dispatch task must feed maintenance/safety evidence from server-owned queries and enforce the result inside commit/start gates. Do not claim this pure helper alone prevents dispatch.
