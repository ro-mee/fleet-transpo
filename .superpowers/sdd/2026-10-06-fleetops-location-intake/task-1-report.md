# Task 1 Implementation Report — Fleet Location Identity and Partner Proposal Storage

## Status

**DONE_WITH_CONCERNS** — Task 1 is implemented and committed. No live migration was applied. The deployment must not use the changed location API against a database without migration 146.

## Implemented scope

- Added `supabase/migrations/146_location_intake_identity.sql`:
  - Adds `locations.location_code UUID DEFAULT uuid_generate_v4()`, backfills existing rows, sets `NOT NULL`, and creates/verifies a full unique index so retired codes remain reserved.
  - Fails closed on conflicting same-named columns/defaults and on an index that does not match the full, unique, one-column contract.
  - Adds nullable `partner_pickup_location_proposal` and `partner_dropoff_location_proposal` JSONB fields to `transportation_requests`, with checks for object shape, allowed keys, nonempty address or complete coordinate pair, the 2,000-character limit, paired coordinates, numeric finiteness, and coordinate ranges.
  - Does not change location IDs, existing geometry/addresses/activity state, historical foreign keys, RLS, or table count.
- The location list/detail GET APIs project `location_code`. POST/PUT return the database-generated code but do not include it in their write columns; in-place updates preserve the code, and versioned rows receive a new database-generated code.
- The Fleet locations list and edit/detail dialog display the code as read-only and copyable.
- Added migration/API tests and updated the relevant Routes, Reservations, `transportation_requests`, Migrations, and `SYSTEM.md` notes. No v2 writer, route resolver, dispatch, mobile, or geofence behavior was added.

## Migration selection and database safety

A fresh read-only `npm run db:status` from the root checkout reported 141 files applied, 0 pending/changed, with ledger-only entries 113/114/115 and 141/142 treated as spent; root migration 143 was present and applied. This worktree already contained draft migrations 144 and 145, so 146 was selected. Offline `npm run db:check` reports 143 migration files valid and historical duplicate versions frozen.

No `npm run db:up`, `npm run db:dump`, live SQL/catalog query, `.env` inspection, or `schema.sql` edit was performed. Consequently, live schema presence and live query execution are unverified by design.

## TDD and verification evidence

- Migration test RED before implementation: 1 file, 5 failing assertions because migration 146 did not exist. GREEN after the migration: 5/5 passed; the strengthened final migration assertions also pass.
- API projection RED before implementation: 3 files, 5 expected failures and 6 passes; failures were missing `location_code` in list/detail SELECT or POST/PUT `RETURNING`. GREEN after implementation: 3 files, 11/11 passed.
- Final focused run: 4 files, 16/16 tests passed.
- Full Vitest suite after changes: 310 files, 3,587 tests passed. The pre-change baseline was 307 files, 3,577 tests passed.
- Focused ESLint passed for all touched JavaScript files.
- `npm run db:check` passed; staged and committed-diff whitespace checks passed.
- The full suite emitted existing mock/error logs and a missing `EXPO_PUBLIC_API_URL` warning from the mobile test environment; Vitest reported no failures.
- Tests are static/mocked. No browser/manual clipboard test or live SQL/catalog verification is claimed.

## Self-review

Reviewed the migration’s idempotency and catalog guards; checked both JSONB constraints for object/key/size/address/coordinate rules; confirmed full uniqueness includes retired rows; and verified API write columns exclude `location_code`. Reviewed scope, authorization preservation, UI read-only/copy semantics, docs, and diff hygiene. No required code changes remained. An independent nested review agent was unavailable because this session is already a delegated subagent at the configured maximum depth; the review was performed in-session.

## Commit and concerns

- Commit: `e4bf0c0cc30c74e1b554980e2a949d455b9fe7b3`
- Subject: `feat(locations): add immutable partner location codes`
- Starting HEAD in this worktree: `f41b948f767296a9072e484b94c784f859bf23c2` (`docs: plan v2 location intake implementation`). The supplied Task BASE `f41b948f4421f84fbc85b7caaaa980400c53917e` was not present in the object database. Work proceeded from the actual clean `feat/passenger-cargo` branch HEAD and the commit is based on that revision.
- Release hold: apply the approved migration sequence, including 146, before deploying code that selects `locations.location_code`. No live schema verification has been performed.
- No unresolved implementation requirement was found. The clarification tool was unavailable to this delegated agent, so there was no additional user interaction; the brief/design/plan values were unambiguous.

## Review round 1/5 fix report — 2026-10-06

### Fixes

- Migration 146 now builds each trusted proposal CHECK on a temporary table, reads the complete PostgreSQL-deparsed definition with `pg_get_constraintdef`, and accepts an existing same-named constraint only when it is a validated single-column CHECK with an identical definition. A weakened `CHECK (... OR TRUE)` no longer matches; the scratch constraints are `ON COMMIT DROP`, and adding a missing check reuses the same expected definition, preserving rerun idempotence.
- Location list/detail GET projections now add `coordinate_provenance: "canonical_registry"` and `coordinate_provenance_note: "not independently verified"` only when the Fleet row is active and latitude/longitude form a complete finite in-range pair. Inactive, missing/partial, non-finite, or out-of-range coordinate rows omit both fields. The Fleet list displays the same label only for rows carrying both fields. No `verified` flag was added or set.

### TDD and verification

- RED command: `npm run test:run -- --reporter=dot src/lib/integration/location-migration.test.js src/app/api/locations/route.test.js 'src/app/api/locations/[id]/route.get.test.js' 'src/app/(dashboard)/routes/locations/page.test.js'` — 4 files, 5 expected failures / 22 passes. The failures were the two missing weakened-constraint guards, the missing list provenance fields, the missing detail provenance fields, and the missing Fleet UI label.
- GREEN command: `npm run test:run -- --reporter=dot src/lib/integration/location-migration.test.js src/app/api/locations/route.test.js 'src/app/api/locations/[id]/route.get.test.js' 'src/app/api/locations/[id]/route.put.test.js' 'src/app/(dashboard)/routes/locations/page.test.js'` — 5 files, 29/29 tests passed.
- Exact new covering test names:
  - `Task 1 location identity migration > rejects a same-named partner_pickup_location_proposal constraint weakened with OR TRUE`
  - `Task 1 location identity migration > rejects a same-named partner_dropoff_location_proposal constraint weakened with OR TRUE`
  - `GET /api/locations > labels only active rows with a complete valid pair as canonical_registry and not independently verified`
  - `GET /api/locations/[id] — the address it hands the picker > projects the stable location code in the read-only detail response`
  - `GET /api/locations/[id] — the address it hands the picker > omits provenance fields for inactive row`
  - `GET /api/locations/[id] — the address it hands the picker > omits provenance fields for missing latitude`
  - `GET /api/locations/[id] — the address it hands the picker > omits provenance fields for missing longitude`
  - `GET /api/locations/[id] — the address it hands the picker > omits provenance fields for latitude outside valid range`
  - `GET /api/locations/[id] — the address it hands the picker > omits provenance fields for longitude outside valid range`
  - `GET /api/locations/[id] — the address it hands the picker > omits provenance fields for non-finite pair`
  - `Fleet location coordinate provenance disclosure > labels an active valid registry coordinate pair canonical_registry and not independently verified`
  - `Fleet location coordinate provenance disclosure > does not show the provenance label for inactive location coordinates`
  - `Fleet location coordinate provenance disclosure > does not show the provenance label for missing location coordinates`
  - `Fleet location coordinate provenance disclosure > does not show the provenance label for invalid location coordinates`
- Touched-file ESLint passed with: `npm exec -- eslint --max-warnings 0 src/lib/integration/location-migration.test.js src/lib/locations/coordinate-provenance.js src/app/api/locations/route.js src/app/api/locations/route.test.js 'src/app/api/locations/[id]/route.js' 'src/app/api/locations/[id]/route.get.test.js' 'src/app/api/locations/[id]/route.put.test.js' 'src/app/(dashboard)/routes/locations/page.js' 'src/app/(dashboard)/routes/locations/page.test.js'`.
- Offline `npm run db:check` passed: 143 migration files valid; historical duplicate versions frozen.
- `git diff --check` passed. Git emitted only non-fatal LF/CRLF normalization warnings for two test files and the SQL migration.

### Self-review and release hold

Reviewed both catalog guards for exact expected-definition comparison, validation state, and single-column scope; confirmed new constraints use the same definition as the comparison and temporary expected objects are dropped at transaction commit. Reviewed API list/detail projections and UI display conditions against active state, coordinate completeness, finiteness, and bounds. The new UI/API label is provenance text only, not an independent verification claim or boolean flag. Capstone Routes, Reservations, `transportation_requests`, Migrations, and `SYSTEM.md` notes were updated. A separate reviewer could not be dispatched because this agent is at the configured maximum subagent depth; self-review was completed in-session.

Migration 146 remains unapplied. No `db:up`, `db:dump`, live SQL/catalog query, `.env` inspection, or `schema.sql` edit was performed. Keep the release hold: reconcile migration 146 and the overlapping contract/schema work with concurrent main Hotel/POS changes before merge; do not rebase or edit main. The focused migration assertions are static/offline, and route/UI tests use mocks/rendered component markup rather than a live database or browser.
