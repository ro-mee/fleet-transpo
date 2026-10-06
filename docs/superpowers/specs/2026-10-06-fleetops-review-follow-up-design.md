# FleetOps external-review follow-up — design

**Status:** The user approved the recommended bounded scope on 2026-10-06; written-spec review is pending before implementation.

## Goal and boundaries

Resolve the independently verified review defects against the existing passenger/cargo and location-intake contract, without widening partner connectivity or changing the established v1 contract. The source of truth remains the [location-intake design](2026-10-06-fleetops-location-intake-design.md), [Reservations](../../../Capstone/02%20-%20Features/Reservations.md), and [System Boundaries](../../../Capstone/01%20-%20System/System%20Boundaries.md).

No migration status/catalog check, live database access, migration apply, schema dump/edit, connector activation, merge, or deployment is authorized. Migrations 144/145/146 remain draft/unapplied and held for concurrent-main reconciliation and explicit apply approval.

## Finding adjudication

- **1 — no change:** Pull binding to the trusted adapter principal is explicitly allowed by the approved fix brief. The HTTP gateway is an unconnected PMS stub; a real POS pull still needs its own trusted adapter.
- **2 — no change to 146:** Migration 146 has its own `BEGIN`/`COMMIT`; the runner does not add a second wrapper. Do not remove 146's transaction.
- **3 — narrow v1 fix:** A supplied numeric v1 `service_type_id` with no catalog row should fail with stable `SERVICE_UNAVAILABLE` before route work or insert. Preserve active, inactive, or soft-deleted rows whose known load type remains compatible; do not add a v1 active/deleted filter without a compatibility decision. Continue rejecting a known incompatible load type.
- **4 — v2 commit-time service validity:** Keep the early service-code check to avoid provider work for an already-invalid code. After estimation, lock/re-read the active, non-deleted service row with `FOR SHARE` in the same transaction as the request insert; verify load type and insert the locked ID. No external provider call may occur under this lock.
- **5 — atomic route-cache write:** Strict v2 estimation runs with `persistRoute: false` before the transaction. After the locked location/service checks and a successful request insert, persist/update the already-computed estimate on the transaction connection. Do not persist a route on a rejected create or an `ON CONFLICT DO NOTHING` replay, and do not call the route provider while holding locks. Preserve v1 route behavior.
- **6 — cargo description SQL whitespace:** Both the scratch expected constraint and production CHECK trim the explicit SQL ASCII whitespace set (space, tab, LF, CR, FF, VT) before requiring nonempty cargo description.
- **7 — historical count preflight:** Treat `passenger_count IS NULL OR passenger_count <= 0` as requiring explicit historical review before typed-load constraints. NULL is unreachable in the checked-in pre-migration schema but the guard is harmless and fail-closed.
- **8 — v2 zero-coordinate readers:** Permit `(0,0)` only as a canonical v2 target identified by `canonical_registry` provenance, through geofence evaluation, arrival checks, and live-monitor ETA/corridor snapshots. A route-polyline point at `(0,0)` is allowed only for a corridor fetched to that v2 target. Keep `(0,0)` rejected for GPS position inputs and legacy v1 route targets; do not globally change coordinate validation.
- **9 — pull rejection reporting:** Recognized v2 update/cancel events and unsupported revisions remain unprocessed, but count as rejected with stable `SOURCE_REVISION_UNSUPPORTED` in the aggregate response and warning. Malformed rows remain skipped; no update/cancel behavior is implemented.
- **10 — index readiness:** Require `pg_index.indisready` in the migration 145 service-code unique-index guard, matching the existing validity checks.
- **11 — executable whitespace regression:** Extend the existing source-contract/Zod test to reject tab/newline/form-feed/vertical-tab-only proposal addresses while retaining the already-tested coordinate-only proposal case.

The migration runner warns that unwrapped files can fail partially. Add explicit file-level transactions to still-unapplied draft migrations 144 and 145; leave the already-wrapped migration 146 unchanged. This is a draft-safety change only and does not authorize apply.

## Alternatives considered

1. **Recommended bounded correction (chosen):** Implement all corrections above, preserving adapter binding and v1 compatibility while closing v2 commit-time races and end-to-end zero-target gaps.
2. **Runtime-only subset:** Defer route-cache ordering and draft-migration safety. Rejected because both have concrete failure modes and the current task explicitly includes safe migration/transaction gates.
3. **Strictly active-only v1 catalog IDs:** Rejected for this follow-up; the approved v1 rule requires known load-type compatibility, not v2-style activity enforcement. Unknown IDs still fail cleanly.

## Verification

Use test-first slices with focused Vitest suites and touched-file ESLint. Verify migration edits with static tests and offline `npm run db:check`; run `git diff --check` and one full `npm run test:run -- --reporter=dot` after all code changes. No live DB/status/catalog checks or apply, no schema dump, and no production build claim. Update relevant Capstone notes, `SYSTEM.md`, and the local SDD follow-up record after implementation; obtain a fresh scoped review before considering this correction wave resolved.
