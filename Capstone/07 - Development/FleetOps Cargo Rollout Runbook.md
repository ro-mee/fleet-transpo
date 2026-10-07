# FleetOps Cargo Rollout Runbook — staged commissioning

**Status: offline review fixes prepared 2026-10-08 on `feat/passenger-cargo`. Migration application and live catalog verification remain release holds. No enablement has occurred.**

Full plan: `docs/superpowers/plans/2026-10-05-fleetops-passenger-cargo-integration-and-fuel.md` (Task 7).

## Apply checkpoint before this application revision

Do not deploy this revision against a pre-150–153 database. Runtime SQL reads location/load fields, cargo service settings and vehicle capability/document verification columns unconditionally in several paths, including pair validation, strict conflict evidence, start load/checklist detection, candidate queries, vehicle create/edit/commission, dispatch evidence revisions and locks, and the read-only fleet audit. Apply drafts through the repository runner in order, verify the intended project's ledger and catalog, refresh the generated schema, then run the real application queries. Draft 151 preserves historical null load type and removes a load default; draft 153 checks the exact asset index and validated constraints. Conflicting existing catalog objects must halt release rather than be rewritten blindly. Do not manufacture measured payload, verification, plates or fleet rows to clear these checks.

RLS/grants, catalog/check/index shape, migration reruns (including existing valid Cargo rows), generated schema freshness, production query compatibility, and real commissioning/dispatch/start flows need live verification before release. Offline tests do not close those holds. The current catalog has not been contacted for this work.

## Staged order

1. **Audit.** Run `node scripts/audit-fleet-readiness.mjs` after the apply checkpoint. It is read-only and exits 0 with a JSON report even for an incomplete fleet. Missing asset code, operational use, plate, commissioning, supported license class, category, verified documents, finite positive usable capacity and active pair coverage all exclude a vehicle from its cohort and contribute blocked-reason counts. Runtime maintenance/safety/schedule checks are disclosed as deferred; cohort membership alone does not authorize dispatch.
2. **Record evidence.** Save real category/class/capacity and official OR/CR and Insurance scans, numbers and expiries. A pending asset may be created without a plate using its asset code, but cannot commission or dispatch until a real plate is recorded. Saving changed documents resets old verification.
3. **Commission passenger vehicles first.** An `admin` or `super_admin` explicitly confirms the two saved documents in the vehicle form. The commissioning endpoint records staff identity/time and an audit event under locks only when actual readiness passes. Audit the resulting passenger cohort and use that cohort for new typed Passenger requests.
4. **Commission cargo last.** Record Cargo use and a measured positive usable payload, supported class, category, real plate, valid documents and active pair. Commission through the same supported form and inspect the resulting cargo cohort before accepting typed Cargo work.
5. **Monitor.** Review no-match and blocked-reason counts after each stage. Every assignment, reassignment, dispatch edit/create and start still rechecks the shared stored requirements and actual window/evidence. A review override cannot clear overload or road-readiness blockers.

## Boundaries and rollback

There is no feature enablement flag. Staging uses the nullable historical intake boundary plus verified, commissioned fleet cohorts. New intake explicitly writes Passenger or Cargo; null load type is reserved for preserved historical requests and keeps legacy behavior. Do not classify historical rows merely to admit them to a rollout cohort.

Existing schedules are not silently cancelled or rewritten. Typed committed starts must satisfy current checks; unresolved evidence goes to dispatcher review. Stop accepting new typed work when rolling back a stage, and keep compliance checks intact. A UI change or a cohort report does not weaken the server gate. `scripts/audit-fleet-readiness.mjs` remains read-only.

## Offline verification

Inventory tests cover cohort placement, missing identity/static evidence independently, unsupported classes/nonfinite capacities, blocked counts, pair coverage, immutable inputs and read-only audit assertions. Runtime/endpoint regressions cover real verified cargo evidence, document changes under commit evidence, commissioning authorization/atomic audit, unchanged overload wording, stored-weight pinning, legacy null starts and renewed typed documents despite stale legacy expiry/status. Live apply/catalog verification and browser/device acceptance are still outstanding.

Verification on 2026-10-08: 25 targeted files / 243 tests passed, strict owned-file lint passed, diff whitespace passed, 146 migration filenames valid, 300/300 route-auth checks passed. No live database contact.
