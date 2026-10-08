# FleetOps defense demo — live apply record

**Historical apply record, superseded 2026-10-03.** The first defense seed applied to Supabase project `dnxuphhxlzidvwtdqqkq` (`postgres.public`) under ledger hash `ad00690217058d14`, but was later rolled back by exact owned IDs and 86 owned Storage keys because it overlaid old business data. An initial guarded cleanup removed only provable phase4/QA-owned rows; at that checkpoint the defense seed was absent and the baseline remained dirty. The historical `verify` result below is not current defense readiness. See `Capstone/07 - Development/Defense Demo Data Implementation Plan.md`.

**Current result:** The user approved the remaining exact-ID business reset, and the corrected defense seed was applied under hash `7f5cbecaaaab6e7f`. Live `status`, seed `verify`, and independent contamination/report verification passed. Active business/report rows now come only from the new seed. The older narrative below is retained as the audit trail of the first apply; the current result is documented in `Capstone/07 - Development/Defense Demo Data Implementation Plan.md`.

## Actual write

The source hash changed after the apply when trigger cleanup was fixed. The ledger retains the hash of the version actually applied. Do not run `up` again while this ledger is complete.

| Entity | Intended inserts |
| --- | ---: |
| Vehicle categories | 2 new exact categories; preserve 4 existing |
| Driver employees / drivers / vehicles | 10 / 10 / 10 |
| Vehicle documents / custodial pairs | 20 / 9 |
| Weekly schedules / leave balances / leave requests | 70 / 30 / 9 |
| Locations / directional routes | 5 / 10 inserted; 4 / 6 existing rows reused |
| Requests / dispatches / trips | 45 / 37 / 37 |
| Historical attendance / inspections | 29 / 88 |
| Fuel allocations / requests / approved records | 20 / 5 / 12 |
| Maintenance / incidents / expenses / sample cards | 10 / 3 / 6 / 2 |
| Storage assets | 86 exact keys across the existing buckets |
| Retained trigger notices / push rows | 15 / 7, owned by the seed ledger |

30 completed trips fall on 2026-09-03 through 2026-10-02: **21 September, 9 October**. Seven trips remain assigned/open, including D01's October 3 08:00 and 15:00 pickups. D01 has no prefilled October 3 duty, inspection, or completed trip. The six synthetic expenses total **PHP 975**; approved fuel fixtures total **372 L / PHP 23,808**; completed maintenance fixtures total **PHP 20,400**. These are fixture totals for independent verification, not live report results yet.

The current live project is `postgres.public` on the configured Supabase URL. Read-only preflight found **140 applied migrations, 0 pending, 0 changed**, existing `seed:phase4`, and no defense ledger. The existing four category rows will be preserved. The built-in Manila UVVRP policy has weekday coding only; October 3 is Saturday.

## Media review

The [manifest](../scripts/defense-seed/assets/manifest.json) records every `asset_id`, related entity, local filename, bucket/key, source type, use note, and SHA-256. All 10 vehicle and 10 portrait photos are generated; manufacturer pages informed model/seat checks but no official photo was copied or hotlinked. Documents and receipts are visibly marked **DEMO / SAMPLE / NOT VALID**. Representative files: [V01 Camry](../scripts/defense-seed/assets/vehicles/V01.png), [D01 portrait](../scripts/defense-seed/assets/drivers/D01.png), [D01 sample license](../scripts/defense-seed/assets/licenses/D01-front.svg), [V08 expired sample insurance](../scripts/defense-seed/assets/insurance/V08-insurance.svg).

## Trigger outcome and readiness limits

- Ten distinct `+fleetops-dXX` Gmail receiving aliases were derived from three controlled inboxes. Their unique random passwords are in the local, gitignored `.env.defense-accounts.json`; passwords are not in the repository history or chat. Actual OTP delivery has not been exercised.
- The sample licenses are not real ID cards. All 10 `license_verified_at` values remain null and there are zero driver consent rows. D01 is driver ID 77 and employee ID 113. Replace the sample license images and details with genuine credentials before a staff member records a physical-card or LTO Digital ID review. Each driver must accept privacy consent through the app. D01 remains blocked by the production trip eligibility guard until then.
- Trigger cleanup initially missed PostgreSQL rows created 26 ms before its JavaScript timestamp. After a read-only audit showed all affected rows unread and unsent, an exact-ID repair deleted 174 historical/synthetic notifications and 30 pending historical push rows. The ledger now owns the surviving 7 open dispatch notices, 8 D04 pending-leave notices, and 7 open dispatch push rows. The trigger includes one inactive manager/admin recipient, so its actual leave recipient count was 8, despite the preflight count of 7 active staff. The writer now filters against PostgreSQL's transaction timestamp and suppresses synthetic maintenance notices in future applies.
- The live database, trigger, and Storage write have been exercised and verified. A full `up → status → verify → down` rehearsal has not been done because this is the live project. Exact-ID rollback remains available only while owned snapshots and external-reference checks pass.
- The full repository Vitest run ended **3,550 passed / 5 failed** in four existing standby/security test files unrelated to the new seed source. Focused defense tests passed **6/6**; scoped ESLint and `db:check` passed. Treat the overall test suite as an open release gate.
- Rollback uses exact owned row IDs and storage keys. If a seed-owned row changes or outside rows acquire foreign-key references, rollback stops for manual review. A processed push-outbox row or actual rehearsal action can cause that conflict.

## Commands

Read-only status and reconciliation:

```powershell
npm run seed:defense:plan
npm run seed:defense:status
npm run seed:defense:verify
```

To reverse only if status confirms no changed owned rows or outside references:

```powershell
npm run seed:defense:down -- --apply
```

The `down` command retains a `media_cleanup` ledger if database deletion succeeds but exact Storage cleanup fails; rerun it after resolving the Storage error.
