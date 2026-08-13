-- ============================================
-- MIGRATION 018: Drop Never-Read, Never-Written Columns
--
-- Purpose:
--   Remove six columns that exist in the live schema but are never read or
--   written by any application code (web under src/, or mobile under mobile/),
--   are not referenced by triggers, RLS policies, indexes, constraints, or
--   views, and carry no authorization or audit meaning. They are dead weight:
--   every SELECT * / row_to_json(...) ships their bytes to the client, and
--   every future developer spends time wondering whether they are used.
--
-- This migration is intentionally CONSERVATIVE. It drops ONLY the
-- never-read AND never-written set. It deliberately keeps:
--   - transportation_requests.ai_vehicle_recommendation / ai_driver_recommendation
--     (written by active routes even though not yet read) — dropping them would
--     break those writes; deferred pending a product decision.
--   - gpstracking.driver_id (written on GPS insert) — written, only derivable
--     back-read; keeps the mobile insert contract intact.
--
-- ============================================

BEGIN;

-- ============================================
-- 1. roles.permissions (JSONB, added by 005)
-- ============================================
-- The authorization matrix lives entirely in src/lib/auth/permissions.js; the
-- database column has no writer and no reader (the app derives permissions
-- from the role name in code). Removing it eliminates a shadow source of truth
-- that could otherwise drift from the real one.

ALTER TABLE roles DROP COLUMN IF EXISTS permissions;

-- ============================================
-- 2. routes.waypoints (JSONB, from 001)
-- ============================================
-- Never referenced by any route handler, service, page, or mobile screen. The
-- route's geometry is not consumed; origin/destination + location FKs are the
-- working representation.

ALTER TABLE routes DROP COLUMN IF EXISTS waypoints;

-- ============================================
-- 3. trips.route_data (JSONB, from 001)
-- ============================================
-- Legacy blob on trips with no reader. Trip metrics/columns are stored
-- relationally (distance, actual_duration, cost columns), so the opaque blob
-- duplicated no useful queryable data.

ALTER TABLE trips DROP COLUMN IF EXISTS route_data;

-- ============================================
-- 4. vehiclemaintenance.inspection_* / severity (added by 005)
-- ============================================
-- inspection_checklist (JSONB), inspection_findings (TEXT), and severity
-- (VARCHAR(20)) were added to vehiclemaintenance in migration 005, but no
-- maintenance form, route, or report reads or writes them. The maintenance
-- write schema (src/app/api/vehicle-maintenance/route.js) does not define
-- these fields, so nothing legitimately populates them.

ALTER TABLE vehiclemaintenance DROP COLUMN IF EXISTS inspection_checklist;
ALTER TABLE vehiclemaintenance DROP COLUMN IF EXISTS inspection_findings;
ALTER TABLE vehiclemaintenance DROP COLUMN IF EXISTS severity;

-- ============================================
-- 5. VERIFICATION NOTES
-- ============================================
-- Before applying this on a live/prod database, the following were confirmed
-- against the live schema and are safe to drop together:
--   * applied with IF EXISTS so either a fresh apply or a re-run on an
--     already-migrated database is a no-op;
--   * no view, trigger function, RLS policy, index, or CHECK constraint
--     references any of these columns (checked via pg_views, pg_index,
--     pg_constraint);
--   * no service in src/services or any route in src/app/api reads or writes
--     them (verified by grep across the repo).

COMMIT;