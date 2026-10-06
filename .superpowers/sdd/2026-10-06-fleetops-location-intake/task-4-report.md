# Task 4 Report: Strict v2 trip readers

**Date:** 2026-10-06
**Branch:** `feat/passenger-cargo`
**Starting recovery HEAD:** `2c823c0d8658ecef8ddfb201050789cd67672d35`
**Original Task 4 review base:** `dad3c6b85b4e1faba3bcefdc2daa8c87d2aff1cd`

## Slice A — mobile driver-trip response and trip-geofence targets

Implemented only `GET /api/mobile/driver/trips` and `getTripGeofenceTargets()` with their focused tests. V2 rows are detected by non-null `external_create_fingerprint`. The mobile response and geofence targets use active, non-retired Fleet registry points joined by the request's explicit pickup/drop-off IDs; route endpoint points are ignored for v2, and unresolved v2 rows do not use text, gazetteer, or proposal coordinates. Endpoint provenance is `canonical_registry`, `pending_review`, or `unknown`, matching the queue projection. Legacy v1 route and text/gazetteer fallback remains covered. Geofence evaluation and trip lifecycle writes/transitions were not changed.

### TDD — RED on unchanged production

Command:

```text
npm run test:run -- src/app/api/mobile/driver/trips/route.test.js src/services/trip-geofence.test.js
```

Observed against the unchanged production files: **exit 1; 2 test files failed; 6 failed, 15 passed (21 total)**. Failures demonstrated that v2 partner text still resolved to gazetteer coordinates (`14.5159034` instead of `null`), a mismatched stored route supplied `(1, 2)` instead of the linked Fleet point `(14.6, 121.02)`, and retired linked points/text fallback still exposed coordinates (`10.0000` or the gazetteer result).

### Exact new regression tests

Mobile (`src/app/api/mobile/driver/trips/route.test.js`):
- `keeps v2 partner text and proposals out of mobile coordinates`
- `uses request-linked active points instead of mismatched stored route endpoints`
- `does not expose a retired v2 location or substitute the stored route point`

Geofence (`src/services/trip-geofence.test.js`):
- `keeps partner proposals and matching text out of targets and leaves the ping unknown`
- `uses only active request-linked points when stored route endpoints differ`
- `does not reuse a retired linked point or resolve its text`

The same focused suites retain the v1 gazetteer fallback, route-coordinate preservation, unknown-coordinate, and inside/outside/stale-geofence tests.

### GREEN and scoped verification

- `npm run test:run -- src/app/api/mobile/driver/trips/route.test.js src/services/trip-geofence.test.js` — **2 files passed; 21/21 tests passed**.
- `npm run lint -- src/app/api/mobile/driver/trips/route.js src/app/api/mobile/driver/trips/route.test.js src/services/trip-geofence.service.js src/services/trip-geofence.test.js` — passed, no ESLint errors or warnings.
- `git diff --check` — passed.

## Scope and limits

Only the mobile trip route/service and trip-geofence service/test files were changed in Slice A. No migration, DB apply, `.env`, or `schema.sql` work was performed. Verification is focused and mock-based; live schema/deployment behavior was not tested. The prepared Task 2/3 migration prerequisites remain a deployment hold as recorded in the existing reports.

## Slice B — route-feasibility next-dispatch and live-trip-monitor reposition

`findNextAssignedDispatch()` now projects the request's `external_create_fingerprint`, explicit pickup/drop-off IDs, proposal-presence flags, and both linked Fleet location rows. Persisted v2 next pickups use only a matching active, non-retired Fleet point with a complete finite in-range coordinate pair; missing, retired, invalid, or mismatched rows stay unknown. Route endpoints, partner text, and proposal coordinates are never reposition inputs. Each endpoint's `canonical_registry`, `pending_review`, or `unknown` provenance is preserved in the route-feasibility and monitor results. `resolvePassengerMinutes()` also retains the strict resolver's per-endpoint provenance. Legacy v1 text/gazetteer fallback is unchanged. Live monitor current endpoint targets preserve the Task 4A linked points and expose the same per-endpoint status.

### TDD — RED on unchanged production

Command:

```text
npm run test:run -- src/services/route-feasibility-context.test.js src/services/live-trip-monitor.service.test.js
```

Observed before production edits: **exit 1; 2 files failed; 10 failed, 29 passed (39 total)**. The failures showed that v2 requests without a usable pickup link still resolved known partner text to a gazetteer point (16-minute reposition), retired/invalid/mismatched links did the same, a valid explicit ID was ignored in favor of text coordinates, strict endpoint provenance was discarded, and live-monitor reposition still called the text resolver. The v1 fallback regression passed against unchanged production.

### New regression tests

Route feasibility (`src/services/route-feasibility-context.test.js`):
- `does not use partner text or proposal coordinates when a v2 pickup link is missing`
- `uses the explicit active request link instead of a mismatched route endpoint`
- table cases for retired, invalid, out-of-range, and ID-mismatched linked rows
- `keeps the legacy v1 gazetteer fallback for a next pickup`
- strict per-endpoint provenance survives `resolvePassengerMinutes()` and attached feasibility

Live trip monitor (`src/services/live-trip-monitor.service.test.js`):
- `keeps v2 next-trip reposition unknown without its active request-linked pickup`
- verifies linked current endpoints and per-endpoint provenance in the selected monitor response
- extends the v1 healthy-trip case to pin the existing fallback provenance

### GREEN and scoped verification

- Focused route-feasibility + live-trip-monitor suites — **2 files passed; 39/39 tests**.
- Combined Task 4 mobile-trip, geofence, route-feasibility, and live-trip-monitor suites — **4 files passed; 60/60 tests**.
- Touched-file ESLint on both services and both test files — passed with no output/errors.
- `git diff --check` — passed before documentation updates and again after the documentation updates.

### Self-review and limits

The next-dispatch SQL joins locations only through `transportation_requests.pickup_location_id` / `dropoff_location_id`; it does not read route endpoint coordinates. The shared strict helper requires ID equality, active status, no retirement timestamp, and queue-compatible complete/range-checked coordinates. Proposal data contributes only to provenance labels. V1 continues through the existing `resolveCoordinatesWithDb()` chain. The unused exported `buildFeasibilityContext()` has no direct repository consumer; it was kept consistent with the shared resolver, and no consumer changes were needed. Trip lifecycle and geofence state transitions are untouched; Task 1/2 ingest, Task 3 resolver logic, mobile route, geofence service, migrations, `.env`, and `schema.sql` were not changed. No live SQL/database behavior is claimed. Migration 146 remains an unapplied release hold.

## Dispatch Radar recommendation fix — review round 1/5 (2026-10-06)

**Starting HEAD:** `e84d4527c715525b46405a85f602675a8ee38ce5`\
**Review base:** `b71812105eae810acc580c1cfca2ff4b75ae99a6`

For the current v2 request and persisted preceding/next commitments, recommendation route endpoints now use only active, non-retired Fleet registry rows whose IDs match the corresponding explicit request link and whose coordinates are complete, finite, and in range. Missing, retired, mismatched, or invalid links remain unknown and never fall back to partner text. The commitment SELECT now projects `external_create_fingerprint`, pickup/drop-off IDs, proposal-presence flags, and both linked registry rows. Proposal data is used only to derive `pending_review` provenance. V1 and tentative legacy text resolution remains unchanged.

### TDD evidence

- Restored only `src/services/dispatch-radar.service.js` to HEAD; retained the new regression tests.
- `npm run test:run -- src/services/dispatch-radar.test.js` against unchanged production: supplied regressions **5 failed, 17 passed**. After adding invalid-coordinate and persisted retired/mismatch cases, the RED run was **9 failed, 17 passed**.
- After the fresh implementation, focused dispatch-radar suite: **1 file passed, 26/26 tests**.
- Combined dispatch-radar, mobile-trip, geofence, route-feasibility, and live-trip-monitor suites: **5 files passed, 86/86 tests**.
- Touched-file ESLint and `git diff --check` passed.

No migration, DB, `.env`, or `schema.sql` work was performed. Verification is static/mock-based; live SQL and deployment behavior are not claimed.
