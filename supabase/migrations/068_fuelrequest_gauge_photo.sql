-- Gauge photo evidence: every fuel request must be backed by a dashboard
-- gauge photo. The AI-assisted level estimate rides in calculation_snapshot;
-- only the evidence URL is a real column.
ALTER TABLE fuelrequests
  ADD COLUMN IF NOT EXISTS gauge_photo_url TEXT;
