# Task 5 Report — v2 Location Intake Documentation and Final Verification

**Date:** 2026-10-06
**Branch:** `feat/passenger-cargo`
**Starting HEAD:** `ca6ea56613e30e66bc0d3f2615b8db13978526f6`

## Status

**DONE_WITH_CONCERNS.** Updated the Capstone feature, table, system-boundary, migration, and `SYSTEM.md` notes for the approved v2 contract and release holds. No application code, SQL migration, or generated schema was changed. This is not a merge/deploy readiness claim; final code review remains outstanding.

## Contract and limitations documented

- Location codes are server-generated immutable UUIDs uniquely reserved across active and retired rows. V2 links endpoints by active code only; endpoint labels remain unchanged and do not create or name-match Fleet locations.
- Partner proposals are durable, dedicated JSONB review data. They do not create locations or provide route inputs. A future human dispatcher action must link a request to an active Fleet point before that point can be used; the mapping UI/action is not implemented.
- `canonical_registry` means active Fleet-managed point provenance with a complete finite in-range coordinate pair, not independent verification. Unlinked proposals are `pending_review`; other unresolved endpoints are `unknown`.
- Persisted v2 estimates, mobile endpoints, geofence targets, feasibility/reposition, and dispatch recommendations require explicit request-linked active Fleet points. V2 has no text/name, gazetteer, dynamic hotel, seed, stored-route-endpoint, or proposal-coordinate fallback; missing/unusable inputs remain null/unknown. PMS v1 behavior remains compatible.
- V2 is create-only. Source revision and update/cancel semantics remain incomplete.
- Candidate migration 146 is unapplied. Migrations 144/145 and candidate 146 require reconciliation with concurrent main Hotel/POS work before merge; applying a migration requires explicit approval. No live schema/RLS verification or PMS/POS connectivity is claimed.

## Verification evidence

All commands ran from `.worktrees/feat-passenger-cargo`.

### Focused Task 1–4 groups

1. **Task 1** — command:
   ```text
   npm run test:run -- --reporter=dot src/lib/integration/location-migration.test.js src/app/api/locations/route.test.js 'src/app/api/locations/[id]/route.get.test.js' 'src/app/api/locations/[id]/route.put.test.js' 'src/app/(dashboard)/routes/locations/page.test.js'
   ```
   Result: exit 0; **5 files passed, 29/29 tests passed**.

2. **Task 2** — command:
   ```text
   npm run test:run -- --reporter=dot src/lib/integration/source-contract.test.js src/lib/integration/ingest.test.js src/app/api/integration/transport-requests/route.test.js src/app/api/integration/pull/route.test.js
   ```
   Result: exit 0; **4 files passed, 61/61 tests passed**. Existing expected mock/rejection diagnostics were emitted on stderr.

3. **Task 3** — command:
   ```text
   npm run test:run -- --reporter=dot src/services/route-resolver.test.js src/lib/integration/ingest.test.js src/services/live-trip-monitor.service.test.js
   ```
   Result: exit 0; **3 files passed, 78/78 tests passed**. Existing expected integration-log mock diagnostic was emitted on stderr.

4. **Task 4** — command run twice:
   ```text
   npm run test:run -- --reporter=dot src/app/api/mobile/driver/trips/route.test.js src/services/trip-geofence.test.js src/services/route-feasibility-context.test.js src/services/live-trip-monitor.service.test.js src/services/dispatch-radar.test.js
   ```
   Both runs: exit 1; **5 files: 4 passed, 1 failed; 85 passed, 1 failed (86 total)**. The failure is `keeps a v2 recommendation pickup unknown when its link is missing despite matching text` in `src/services/dispatch-radar.test.js:177` (`INFEASIBLE` received; expected `UNKNOWN`).

   Failure isolation:
   - `npm run test:run -- --reporter=dot src/services/dispatch-radar.test.js` — exit 1; **1 failed, 25 passed (26 total)**.
   - `npm run test:run -- --reporter=dot src/services/dispatch-radar.test.js -t "keeps a v2 recommendation pickup unknown when its link is missing despite matching text"` — exit 0; **1 passed, 25 skipped**.
   - `npm run test:run -- --reporter=dot src/services/dispatch-radar.test.js -t "skips the release-to-end duty re-check|keeps a v2 recommendation pickup unknown when its link is missing despite matching text"` — exit 1; **1 passed, 1 failed, 24 skipped**.

   Root cause found: the preceding calendar-span test queues `driverBlockReason.mockReturnValueOnce({blocked:true,...})` and asserts the function is not called. The file's `beforeEach` uses `vi.clearAllMocks()`, which clears call history but not a queued one-time implementation. The next test consumes that leftover blocking result and becomes `INFEASIBLE`; run alone, it passes. No code/test fix was made in that documentation-only pass; the subsequent test-isolation fix and verification are recorded below.

### Required verification

- `npm run verify:auth` — exit 0; scanned **294** exported API methods, guarded **294**, **0 failed**.
- `npm run db:check` — exit 0; **143 migration files valid**, historical duplicate versions frozen (offline check only).
- Touched-file ESLint — command:
  ```text
  npx eslint --max-warnings 0 src/lib/integration/location-migration.test.js src/lib/locations/coordinate-provenance.js src/app/api/locations/route.js src/app/api/locations/route.test.js 'src/app/api/locations/[id]/route.js' 'src/app/api/locations/[id]/route.get.test.js' 'src/app/api/locations/[id]/route.put.test.js' 'src/app/(dashboard)/routes/locations/page.js' 'src/app/(dashboard)/routes/locations/page.test.js' src/lib/integration/contracts.js src/lib/integration/ingest.js src/lib/integration/ingest.test.js src/lib/integration/source-contract.test.js src/app/api/integration/pull/route.js src/app/api/integration/pull/route.test.js src/app/api/integration/transport-requests/route.js src/app/api/integration/transport-requests/route.test.js src/services/route-resolver.service.js src/services/route-resolver.test.js src/services/live-trip-monitor.service.js src/services/live-trip-monitor.service.test.js src/app/api/mobile/driver/trips/route.js src/app/api/mobile/driver/trips/route.test.js src/services/trip-geofence.service.js src/services/trip-geofence.test.js src/services/route-feasibility-context.service.js src/services/route-feasibility-context.test.js src/services/dispatch-radar.service.js src/services/dispatch-radar.test.js
  ```
  Result: exit 0; no output, errors, or warnings.
- `git diff --check` — exit 0; no output (also run once more after this report was written).
- `npm run test:run -- --reporter=dot` — initial run before the test-isolation change: exit 1; **311 files: 310 passed, 1 failed; 3,661 tests: 3,660 passed, 1 failed**; duration 49.62s. The only failure was the order-dependent Dispatch Radar mock leak above.
- After test-only commit `2d34d18ef26793551179a4a6bdb40294fdd251ac`, reran `npm run test:run -- --reporter=dot` once: exit 0; **311 files passed; 3,661/3,661 tests passed**; duration 38.55s.
- `npm run build` (separate command) — exit 1 before production compilation: `NEXT_PUBLIC_SUPABASE_URL is not set for this production build.` No placeholder was added.

## Follow-up — Task 4 mock-isolation blocker resolved (2026-10-06)

The failing Dispatch Radar run was reproduced before the change (**1 failed, 25 passed**): the calendar-span test queued a one-time `driverBlockReason` result but asserted the mock was not called, and `vi.clearAllMocks()` left that implementation queued. `src/services/dispatch-radar.test.js` now resets only that mock in `beforeEach` and restores its default `null` return. This is test-only; runtime source and behavior are unchanged.

Verification after the change: focused Dispatch Radar suite **26/26**; combined Task 4 reader suites **5 files, 86/86**; touched ESLint passed; `git diff --check` passed. The coordinator then reran the full suite once after the test-only code change: **311 files passed, 3,661/3,661 tests passed**. A database-looking error in the security-test stderr is a deliberate thrown error fixture at `race-and-leakage.security.test.js:198`, not a connection attempt; no live DB query was executed.

## Safety and release holds

No `db:up`, `db:dump`, live SQL/catalog query, `.env` inspection, or `schema.sql` edit was performed. The offline migration check does not establish live schema or RLS state. Candidate migration 146 remains unapplied; reconcile migrations 144/145/146 with concurrent main Hotel/POS work before merge and obtain explicit approval before applying any migration. Dispatcher mapping UI/action, source revision, and update/cancel semantics remain incomplete. No PMS/POS connectivity, live schema/RLS verification, or merge/deploy readiness is claimed.

**Intended commit subject:** `docs: record v2 location intake contract and release holds`
