-- Fuel transaction integrity: receipt scan history, anomaly flags, status
-- lifecycle, and duplicate detection support.
--
-- Context: the fuel receipt workflow stores Gemini-extracted values in the
-- main fuelrecords columns, but until now there was no record of what the AI
-- originally read vs what the driver submitted. This makes it impossible to
-- audit driver edits or to detect systematic AI extraction errors.
--
-- Changes:
--   1. receipt_scan_data  – raw Gemini extraction preserved for audit
--   2. flags              – deterministic anomaly flags computed at submission
--   3. Status default     – change from 'Completed' to 'Pending' (mobile POST
--      already forces Pending; this aligns the column default)
--   4. receipt_transaction_id – extracted receipt/transaction number for
--      duplicate detection

-- 1. Store the raw AI extraction result alongside driver-confirmed values
ALTER TABLE fuelrecords
  ADD COLUMN IF NOT EXISTS receipt_scan_data JSONB;

COMMENT ON COLUMN fuelrecords.receipt_scan_data IS
  'Raw Gemini extraction result at scan time. Driver-confirmed values go into the main columns. Comparing the two shows what was edited.';

-- 2. Deterministic anomaly flags computed at submission
ALTER TABLE fuelrecords
  ADD COLUMN IF NOT EXISTS flags JSONB;

COMMENT ON COLUMN fuelrecords.flags IS
  'Anomaly flags computed at submission: fuel_type_mismatch, price_anomaly, driver_edited, possible_duplicate, etc. Values: true (flagged) or absent (clean).';

-- 3. Fix the status default — mobile POST already forces Pending, but new web-
--    created records should also default to Pending rather than Completed.
ALTER TABLE fuelrecords ALTER COLUMN status SET DEFAULT 'Pending';

-- 4. Receipt transaction ID for duplicate detection.
--    Gemini already extracts transaction_id; this column stores it at the
--    fuelrecords level so we can query for duplicates efficiently.
ALTER TABLE fuelrecords
  ADD COLUMN IF NOT EXISTS receipt_transaction_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_fuelrecords_receipt_txn
  ON fuelrecords(receipt_transaction_id)
  WHERE receipt_transaction_id IS NOT NULL AND deleted_at IS NULL;
