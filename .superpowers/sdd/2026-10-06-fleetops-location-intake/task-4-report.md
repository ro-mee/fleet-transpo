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

Only the mobile trip route/service and trip-geofence service/test files were changed in this slice. `route-feasibility-context` and `live-trip-monitor` were not touched; Task 4's remaining slice will address them and update the Capstone notes. No migration, DB apply, `.env`, or `schema.sql` work was performed. Verification is focused and mock-based; live schema/deployment behavior was not tested. The prepared Task 2/3 migration prerequisites remain a deployment hold as recorded in the existing reports.
