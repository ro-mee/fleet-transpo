-- ==========================================
-- 073: Add review_remarks to fuelrecords
-- ==========================================

BEGIN;

ALTER TABLE fuelrecords ADD COLUMN IF NOT EXISTS review_remarks TEXT;

COMMIT;
