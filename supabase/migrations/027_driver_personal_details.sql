-- ============================================
-- MIGRATION 021: Driver personal details (address, sex, birthdate, nationality)
--
-- The driver license scan extracts more personal info than the schema stores.
-- Add columns so the "Scan & Auto-Fill" flow can persist the address, sex,
-- birthdate, and nationality read off the LTO license card.
--
-- All are optional (NULL until a scan fills them in).
-- ============================================

BEGIN;

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS sex VARCHAR(20);
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS birthdate DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS nationality VARCHAR(100);

COMMIT;
