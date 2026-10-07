# FleetOps migration reconciliation — 2026-10-07

Scope: reconcile the unapplied passenger/cargo drafts in `.worktrees/feat-passenger-cargo`. User authorized status checks and reconciliation, not migration apply, schema dump, merge, connector activation or deployment. Existing status documentation edits were preserved. Root/main source files were not changed.

## Current draft names

| Previous branch draft | Current unapplied draft |
| --- | --- |
| `144_transport_source_identity.sql` | `150_transport_source_identity.sql` |
| `145_load_types_and_services.sql` | `151_load_types_and_services.sql` |
| `146_location_intake_identity.sql` | `152_location_intake_identity.sql` |

Fresh live status immediately before numbering showed applied history through 149, with these three branch drafts pending and no changed applied files. Status after renumbering shows 140 matching applied local files, three pending files at 150/151/152, and zero changed. This is filename/checksum reconciliation evidence, not a live schema/catalog/RLS audit. The status runner's existing ledger initialization uses `CREATE TABLE IF NOT EXISTS`.

Only filenames, explanatory comments, test paths and documentation changed. A comparison of each original file at branch HEAD with its renamed file, normalizing line endings and removing whole-line SQL comments, confirmed all three executable SQL bodies are unchanged. No applied migration or ledger row was renamed or rebaselined.

## Recorded supply baseline inspected

Read Git objects from local `origin/main` at `0ddd6c71ea34527ffd54a0e6210c05810511ae2a`. No fetch, checkout, cherry-pick or merge occurred. Local `main` does not contain the supply files; an absent file in this branch/local main is not proof that it was deleted from the recorded origin history. These Git objects were inspected, not independently checksum-matched to the ledger-only live entries.

| Applied supply version | Recorded SQL responsibility | Relationship to the branch drafts |
| --- | --- | --- |
| 144 | `vehicle_cargo_profiles`, `supply_shipments`, immutable manifests/events and source inbox | Separate relations; does not add or change the draft transportation-request/service/location columns |
| 145 | `supply_site_mappings` referencing Fleet `locations.location_id` | Draft location UUID codes are additive; location IDs and existing mapping FKs are preserved |
| 146 | rejected sandbox `supply_integration_attempts` | Separate relation; not a replacement for the pending PMS/POS revision ledger |
| 147 | `dispatchschedules.service_type`: `PASSENGER` / `SUPPLY_DELIVERY` | Workflow discriminator, not the new request `Passenger` / `Cargo` load kind; do not equate them |
| 148 | supply dispatch allocation relation and deferred consistency/history guards | `SUPPLY_DELIVERY` forbids a request FK and requires an allocation; these guards are not changed or bypassed by drafts 150–152 |
| 149 | terminal supply allocation end-reason CHECK fix | Separate relation; draft SQL does not touch it |

The recorded SCM sandbox importer (`src/app/api/supply/sandbox/transport-requests/route.js`) uses an admin/super-admin session, requires `sandbox:` organization identity and explicit enablement, and is disabled in production. It is not an authenticated PMS/POS adapter. This branch's PMS/POS typed create contract remains source-scoped in `transportation_requests`; it does not silently import supply shipment records or reuse their inbox.

Three-way review from the shared merge base to recorded `origin/main` found no competing edits to the shared ingest, contracts, gateway, pull or outbound service. The transport-request route has an independent `departing-soon` filter and tests, and recommendation tests have independent additions. These must survive a future authorized merge; they were not copied or merged during this migration-only reconciliation.

## Remaining release gates

Number collisions are resolved for this snapshot. Broad code/dispatch reconciliation is not complete. Before apply or release: reconcile the recorded origin baseline and its security registry/schema artifact; confirm recorded migration contents against the applied ledger; run authorized live catalog/constraint and historical-data preflights; agree how both transport pipelines share capacity/readiness/conflict gates; preserve supply allocation triggers; verify passenger and cargo dispatch labels and request linkage. `PASSENGER` currently denotes the old request-backed dispatch flow even if a future request has `load_type = 'Cargo'`; deciding/implementing a unified discriminator is later plan work, not part of renumbering.

Draft 151 still aborts on historical null/nonpositive passenger counts or conflicting catalog data rather than rewriting it. Draft 150 still requires reviewing duplicate/tombstoned source identities before cutover and rejects conflicting indexes. Draft 152 still rejects incompatible existing columns/constraints. These safeguards were not weakened. None of the drafts was executed.

Historical Capstone entries and earlier follow-up plans retain their original 144/145/146 labels as dated history. Current source metadata/tests and the main plan's execution checkpoint use 150/151/152. Do not follow a historical provisional filename for apply.

## Verification

Updated existing migration tests first: RED 3 files / 18 expected assertion failures at the new, not-yet-existing paths; then GREEN 3 files / 18 tests after renaming. Broader integration and offline schema-safety suite passed 9 files / 100 tests. Offline `npm run db:check` validates 143 migration files. Executable SQL parity comparison passed for all three pairs. `npm run lint:ci` and `git diff --check` passed. Scoped review accepted the SQL/test-path changes, then requested current documentation mapping; re-review confirmed that finding resolved with no remaining Important findings. No production build or browser/device/live-schema acceptance is claimed. The prior full-suite result remains the earlier outbound checkpoint's 313 files / 3,727 tests; it was not rerun for this filename/comment-only SQL change.
