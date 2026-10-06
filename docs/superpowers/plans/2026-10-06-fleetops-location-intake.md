# FleetOps v2 Location Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Resolve v2 partner endpoints through stable Fleet location codes, retain unregistered partner place data for human review, and prevent untrusted text/coordinates from creating route, mobile, or geofence targets.

**Architecture:** Add an immutable opaque code to the existing Fleet location registry and durable, explicitly partner-proposal request fields; do not create a new table. V2 may route only through an active linked Fleet registry row, labelled `canonical_registry`; unregistered proposals remain unresolved. A persisted non-null v2 create fingerprint identifies strict behavior across later server reads, while legacy PMS v1 retains current name/gazetteer behavior.

**Tech Stack:** Next.js 16.2.11 App Router, Zod 4, PostgreSQL/Supabase migration runner, existing route resolver, Vitest.

## Global Constraints

- Read `.agents/AGENTS.md` and relevant `Capstone/` notes before implementation; update Routes, Reservations, `transportation_requests` table note, and `SYSTEM.md` after behavior changes.
- Read the installed Next.js 16.2.11 route-handler docs from the root checkout's `node_modules/next/dist/docs/` before editing handlers; this isolated worktree has no local `node_modules`.
- Recheck `npm run db:status` before naming a migration. Candidate 146 is provisional; migrations 144/145 and main-branch Hotel/POS work must be reconciled before merge.
- Never run `db:up` or `db:dump`, copy `.env`, apply live SQL, or edit generated `schema.sql` without new explicit user authorization.
- Partner coordinates are review data only; `addresses.verified` does not verify routing points. Do not route from proposals, and label active registry coordinate provenance `canonical_registry` (not independently verified).
- Legacy PMS v1 resolution behavior remains unchanged. V2 create remains create-only; do not implement update/cancel revisions in this plan.
- No automatic location creation from partner text; no display-name-derived stable codes; retired codes remain reserved.
- Each task is RED → GREEN → focused tests/lint/diff-check → commit; do not claim live database/browser behavior from mocks or static SQL tests.

---

## File map

- Candidate `supabase/migrations/146_location_intake_identity.sql` (only if a fresh `npm run db:status` confirms 146 is unused; otherwise amend the plan and filename before creating it): generated location codes, durable partner proposals, database constraints and catalog assertions.
- `src/lib/integration/contracts.js`, `source-contract.js`, `ingest.js`: typed v2 contract, strict code resolution, durable insert and fingerprint.
- `src/services/route-resolver.service.js`: strict v2 estimate mode; unknown rather than name/gazetteer/heuristic fallback.
- `src/services/trip-geofence.service.js`, `src/app/api/mobile/driver/trips/route.js`, `src/services/route-feasibility-context.service.js`: prevent v2 text fallback in geofence, mobile route display, and next-stop feasibility.
- `src/app/api/locations/route.js`, `src/app/api/locations/[id]/route.js`, `src/app/(dashboard)/routes/locations/page.js`: expose/copy immutable code in Fleet-managed location surfaces.
- `src/app/api/integration/transport-requests/route.js`: expose proposals in authorized list/card projections; detail already uses full-row projection.
- New/updated tests adjacent to each touched module; update `Capstone/02 - Features/Routes.md`, `Capstone/02 - Features/Reservations.md`, `Capstone/03 - Database/Tables/transportation_requests.md`, and `SYSTEM.md`.

---

### Task 1: Add stable codes and durable proposal storage

**Files:** Create migration with the next unused number confirmed at execution; create `src/lib/integration/location-migration.test.js`; modify `src/app/api/locations/route.js`, `src/app/api/locations/[id]/route.js`, and `src/app/(dashboard)/routes/locations/page.js`.

**Interfaces:** `locations.location_code UUID NOT NULL DEFAULT uuid_generate_v4()` with a full unique index across active and retired rows. Add nullable `partner_pickup_location_proposal` and `partner_dropoff_location_proposal` JSONB fields to `transportation_requests`. Proposal objects allow only `address`, `latitude`, and `longitude`; they require a nonempty address or complete coordinate pair; coordinates are both absent/null or both finite and in-range; address max 2,000 characters. The API surfaces `location_code` read-only.

- [ ] Read-only preflight: run `npm run db:status` from the root checkout and inspect current migration filenames/ledger; use the next genuinely unused number, not automatically 146.
- [ ] Write static migration assertions: verify code UUID/default/backfill/NOT NULL, a full unique index, both JSONB columns, and constraints rejecting non-object payloads, unknown proposal keys, empty proposals, partial pairs, invalid coordinate ranges and oversized address strings. Make the migration fail closed if an existing same-named column has the wrong type/default or a same-named index is partial/non-unique.
- [ ] Run `npm run test:run -- --reporter=dot src/lib/integration/location-migration.test.js`; confirm it fails because the candidate migration does not exist yet.
- [ ] Write the additive migration. Backfill every existing `locations` row with a generated UUID; preserve row IDs, names, addresses, points, activity and historical FKs. Keep the unique index non-partial so retired codes cannot be reused. Assert any same-named index is the required unique full index. Do not add/modify RLS because no table is added.
- [ ] Re-run the static migration test and `npm run db:check`; confirm no live SQL was executed.
- [ ] Extend location list/detail GET projections with `location_code`; leave POST/PUT code out of their write allowlists so it is immutable. Show a copyable read-only code in the Fleet location list/detail UI.
- [ ] Add route tests that GET projects the code and POST/PUT cannot choose or change it; run focused location tests and touched ESLint.
- [ ] Commit only the migration/test/location API+UI slice: `feat(locations): add immutable partner location codes`.

### Task 2: Validate v2 codes/proposals and persist strict links

**Files:** Modify `src/lib/integration/contracts.js`, `source-contract.js`, `ingest.js`, `src/app/api/integration/transport-requests/route.js`, pull/route tests and queue/card projections.

**Interfaces:** V2 fields are `pickup_location_code` / `dropoff_location_code` (optional UUIDs) and `pickup_location_proposal` / `dropoff_location_proposal` (optional bounded objects). V2 create normalizes them without changing the existing text fields. Active code lookup returns `pickup_location_id` / `dropoff_location_id`; a proposal is stored only in its partner-proposal JSONB column. V1 parser remains untouched.

- [ ] Add failing Zod tests for valid proposal, address-only proposal, valid coordinate pair, partial pair, out-of-range/NaN coordinate and oversize address; add code UUID shape tests.
- [ ] Run `npm run test:run -- --reporter=dot src/lib/integration/source-contract.test.js`; confirm the new tests fail before parsing is implemented.
- [ ] Add strict v2 proposal schemas (no unknown proposal keys), 2,000-character address cap, finite lat/lng ranges, pair validation, and a refinement requiring a nonempty address or complete coordinate pair. Partner latitude/longitude remain proposal data, never copied into a `locations` row.
- [ ] Add ingest tests using a mocked location row: active code resolves and inserts the exact FK; unknown code throws `LOCATION_CODE_UNKNOWN`; inactive code throws `LOCATION_CODE_RETIRED`; proposal-only inserts the proposal with null location FK; no text-match query is made for v2; v1 still calls its legacy path.
- [ ] Resolve codes before new insert but after source-ID replay/tombstone/fingerprint check, preserving exact replay even if the referenced location is later retired. Insert the resolved FKs and proposal JSONB values; include both codes and normalized proposals in the v2 create fingerprint. Skip `linkRequestLocations` name-based write for v2; keep it for legacy v1.
- [ ] Keep this intermediate v2 commit fail-closed: persist `estimated_distance` / `estimated_duration` as null and skip route creation for every v2 request. Do not call the existing legacy estimate resolver for v2 until Task 3 adds strict canonical-only estimation; this keeps each task commit safe to run independently.
- [ ] Map unknown code to 422 and retired code to 409 with stable machine-readable codes; update push-route tests for the exact status and prove no insert/timeline on failure.
- [ ] Add proposal JSONB to both paginated register and queue/card projections. Derive per-endpoint provenance fields: `canonical_registry` only for a linked active Fleet row with complete in-range coordinates; `pending_review` when a partner proposal exists without a usable registry link; otherwise `unknown`. Test both projection values and preserve existing reservation-read authorization.
- [ ] Run integration and route tests, touched ESLint, `npm run verify:auth`, `npm run db:check`, and `git diff --check`; commit `feat(integration): persist canonical location codes and proposals`.

### Task 3: Make request estimates strict for v2

**Files:** Modify `src/services/route-resolver.service.js` and `.test.js`; update `src/lib/integration/ingest.js` estimate call.

**Interfaces:** `resolveRequestEstimate(request, db, { persistRoute = false, strictRegistry = false })`. Strict mode is also selected automatically when the persisted request has non-null `external_create_fingerprint`; intake explicitly passes strict mode for v2 before the fingerprint is inserted. V2 may use an existing canonical route for the linked endpoint IDs or calculate TomTom only when both linked active registry rows have valid coordinates. If either endpoint is unlinked/retired/unusable or lacks coordinates, return `distanceKm:null`, `durationMin:null`, `source:null`, `basis:'Canonical location unavailable'`, `endpointProvenance:{pickup:'pending_review'|'unknown',dropoff:'pending_review'|'unknown'}`, and a stable reason; never use `estimateTrip`, dynamic hotel/gazetteer, or name matching. Do not add a new estimate-source enum. Legacy mode remains unchanged.

- [ ] Add failing resolver tests: text-only v2 with a gazetteer-like name returns unknown and does not call dynamic location loader; one missing ID cannot be filled from its text name; valid linked active IDs use registry coordinates; retired IDs do not fall back by name; a configured route with missing registry coordinates still returns unknown; v1 still uses prior fallback.
- [ ] Run `npm run test:run -- --reporter=dot src/services/route-resolver.test.js`; verify the new assertions fail against current resolver behavior.
- [ ] Add the strict option and v2 marker check. In strict mode return unknown before resolution unless both persisted location IDs exist; then call the resolver with names set to null and name fallback disabled, require both active registry rows to have valid coordinates before looking up even a stored route estimate, and disable dynamic location overrides and legacy `estimateForRequest` fallback. For each endpoint independently, set provenance to `canonical_registry` only when its linked row is active with a valid coordinate pair; otherwise use `pending_review` when its proposal exists and `unknown` otherwise. The route estimate itself remains unknown unless both endpoints resolve canonically. Do not create a reusable route for unresolved/missing-coordinate endpoint pairs.
- [ ] Pass strict mode from v2 ingestion; use only code-resolved IDs. Ensure absent codes remain null/unresolved rather than auto-linked by `linkRequestLocations`.
- [ ] Run route resolver and ingest suites, touched ESLint, and `git diff --check`; commit `fix(routes): keep v2 estimates on canonical locations`.

### Task 4: Enforce strict v2 endpoints in mobile/geofence/feasibility readers

**Files:** Modify `src/services/trip-geofence.service.js` + tests, `src/app/api/mobile/driver/trips/route.js` + tests, and `src/services/route-feasibility-context.service.js` + tests.

- [ ] Add failing tests for v2 trips without a canonical location link: no text/gazetteer coordinate is returned by mobile, geofence targets remain unknown, and reposition feasibility remains unknown. Add legacy tests proving existing gazetteer fallback still works for v1.
- [ ] Include request `external_create_fingerprint` and explicit location-link IDs in relevant SELECTs. For v2, use active Fleet registry points associated with those request links only; if a stored route endpoint differs from the request's canonical FK, do not expose the route's point for that request. Return per-endpoint `canonical_registry`, `pending_review`, or `unknown` provenance consistently with the queue projection.
- [ ] Skip `resolveCoordinatesWithDb`/gazetteer fallback for v2 in the mobile trip endpoint and next-dispatch feasibility path; preserve current fallback for legacy rows. Proposals are not consulted by these readers.
- [ ] Add focused tests for a mismatched route link, retired location and valid canonical link; verify no changes to trip lifecycle or geofence state transitions.
- [ ] Run mobile-trip, geofence, route-feasibility and live-trip-monitor suites; run touched ESLint and `git diff --check`; commit `fix(routes): prevent v2 partner text fallback in trip readers`.

### Task 5: Document, verify and record follow-up

**Files:** Update `Capstone/02 - Features/Routes.md`, `Capstone/02 - Features/Reservations.md`, `Capstone/03 - Database/Tables/transportation_requests.md`, `Capstone/01 - System/System Boundaries.md`, and `SYSTEM.md`.

- [ ] Document the accepted code/proposal contract, `canonical_registry` provenance, v1 compatibility, unresolved behavior, and unapplied migration status. State explicitly that proposals do not create locations or route until a separate human mapping action exists.
- [ ] Record release holds: migrations 144/145 and this candidate migration require concurrent-main reconciliation and explicit apply approval; no live DB/schema/RLS claims; dispatcher mapping UI/action and revision/cancel semantics remain incomplete.
- [ ] Run focused test groups from Tasks 1–4, `npm run verify:auth`, `npm run db:check`, touched ESLint, `git diff --check`, then `npm run test:run -- --reporter=dot` once on the final frozen diff. Do not rerun full suite without intervening code changes.
- [ ] Report `npm run build` separately: the last attempt failed because `NEXT_PUBLIC_SUPABASE_URL` was absent from the production build environment; do not add placeholder public origins to make it pass.
- [ ] Commit documentation and verification report only after review; do not mark parent Task 3 complete while explicit dispatcher mapping and source revision behavior remain outstanding.
