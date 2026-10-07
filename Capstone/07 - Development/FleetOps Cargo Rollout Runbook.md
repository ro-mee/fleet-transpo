# FleetOps Cargo Rollout Runbook — staged enablement

**Status: procedure prepared 2026-10-07 on `feat/passenger-cargo`. Migrations 150–153 unapplied; no enablement has occurred. Do not route bookings to typed gates before the apply checkpoint.**

Full plan: `docs/superpowers/plans/2026-10-05-fleetops-passenger-cargo-integration-and-fuel.md` (Task 7).

## Staged order

1. **Audit.** Run `node scripts/audit-fleet-readiness.mjs` (read-only; exits 0 with a JSON report even when the fleet is incomplete). It enumerates missing fleet asset codes, operational use, plates, commissioning, license classes, categories, OR/CR + insurance verification, usable payload, and custodial pair coverage — plus blocked-reason counts and the resulting passenger/cargo cohorts.
2. **Verify.** Staff confirm categories/classes and attach OR/CR + insurance scans. Only `admin`/`system_admin` attest verification (identity + timestamp); unattested evidence stays `Pending`.
3. **Passenger cohort first.** Enable the typed passenger gate on the validated cohort only (vehicles in `passengerCohort` with verified docs). Unclassified stock keeps legacy behavior; nothing is reclassified by the rollout.
4. **Cargo last.** Enable the cargo source + cargo vehicles only when the `cargoCohort` is verified (use `Cargo`, positive usable payload, verified docs, active pairing).
5. **Monitor.** Publish no-match/blocked-reason counts from the audit after each stage.

## Invariants (never weakened)

- Fail-closed new bookings never cancel already committed schedules; committed trips go through dispatcher review, not silent mutation or blanket bypass.
- Rollback is enablement rollback (stop routing new bookings to the cohort). Compliance checks are never loosened to reach a cohort size, and historical rows are never rewritten.
- `scripts/audit-fleet-readiness.mjs` stays read-only; the suite fails if a write statement appears in it.

## Verification

Pure summarizer `src/lib/vehicles/readiness-inventory.js` (7 tests): cohort placement, every missing-evidence class, blocked-reason counts, live-gate deferral disclosure, input immutability, retired assignments excluded from pair coverage, audit-script read-only assertion. No live DB contact in tests.
