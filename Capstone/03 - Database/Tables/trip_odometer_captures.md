---
type: database
title: trip_odometer_captures
last_verified: 2026-10-19
---

# Trip odometer capture storage

Migration `164_trip_odometer_captures.sql` adds private trip-bound starting/ending dashboard evidence and `trips.odometer_capture_required` (non-null, default false). The authorized server capture APIs, atomic start/completion consumption, shared mobile camera/review and web evidence view are implemented. Global enforcement remains off: the sample server setting is `ODOMETER_PHOTO_REQUIRED=0`, the effective setting was verified false, and the real `.env` was not changed.

Capture IDs are application-generated UUIDs. Trip, driver and vehicle references use integer foreign keys without cascading deletes. Draft upload/scan states precede ready/committed evidence. Ready and committed rows require a positive reading up to 2,000,000 km, total-km units and a scan timestamp. SQL `IS TRUE` prevents null unit/display fields from slipping through the check. PostgreSQL numeric NaN fails the upper bound. Committed state and timestamp must agree. A partial unique index permits at most one committed capture per trip/stage, while multiple drafts remain possible. Object keys are unique; SHA-256, JPEG/PNG, 5 MB and three scan-attempt bounds are database checks.

The `trip-odometer-photos` bucket is private with JPEG/PNG and 5 MB limits, including when it already exists. Its name is registered in the private media key allowlist. The table has RLS enabled, no client policies and no anon/authenticated privileges, including TRUNCATE. Access must go through authorized server code. No automatic purge, cascade deletion, public object URL, view or scheduled job is added.

## Current verification - 2026-10-19

Read-only status reports 166 applied, zero pending and zero changed-applied checksums; 165–166 are concurrent Fuel migrations. The live contract covers 89 relations with zero violations. The anon probe returned zero exposed, 41 explicit refusals and 48 inconclusive responses; its raw exit is 1, and those inconclusive responses are explained by the live contract rather than treated as explicit passes. The capture table explicitly refuses HTTP 401 / 42501. Catalog evidence confirms RLS, zero anon/authenticated grants, zero capture policies and a private JPEG/PNG 5 MB bucket with no permitting client object policy. `schema.sql` does not prove policies/grants; catalog evidence is required.

Application reads require current assigned driver ownership or staff `trips.read_all`. Upload/scan occur outside lifecycle row locks; a 30-second scan lease is finalized with a timestamp/attempt compare-and-set. Consumption locks current trip/vehicle/capture, checks ownership, stage, ready state, 30-minute age and nondecreasing mileage, then commits capture/trip/mileage together. Exact committed replays are acknowledged before fresh transition/age/geofence checks; changed IDs conflict. No raw provider payload or permanent public URL is stored. Committed content is immutable through application writers; there is no automatic purge of unused drafts.

See [[Trip Odometer Photo Verification 2026-10-19]] for current isolated SQL, regression/build/export evidence and pending real signed-link expiry/device/provider acceptance. A signed URL remains usable by its holder until expiry; no per-request login check is claimed.

## Historical foundation verification - 2026-10-17

Migration applied through the repository runner after status showed only the expected new migration. Status afterward: 164 applied, zero pending, zero changed. `db:dump` regenerated `schema.sql` with only the new table, trip latch, foreign keys and indexes (44 added lines). Live catalog verified columns, constraints, indexes, full grants, policies and bucket limits. `db:contract`: 89 classified relations, zero violations. `verify:anon`: new table explicitly refused (HTTP 401 / 42501); whole probe had zero exposed, 41 refused and 48 existing inconclusive empty responses, resolved by the live contract rather than called passes.

Focused schema and isolated PostgreSQL tests: 35 passed (14 offline, 21 SQL). SQL fixtures create a unique private schema with tiny stand-in trip/driver/vehicle/bucket tables and roll the entire transaction back; no operating trip rows are written. They cover stage uniqueness, foreign keys, malformed ready state, null unit/display, NaN and bounds, duplicate object keys, migration reapplication and client privilege removal. Enable them with `ODOMETER_FIXTURE_DB_TEST=1`; without that explicit setting the SQL suite is skipped. `db:check` and encoding verification passed.
