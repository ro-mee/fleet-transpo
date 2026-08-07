-- ============================================
-- MIGRATION 026: Smart Transportation Queue — priority inputs
--
-- Adds the two explicit priority signals Fleet uses to feed the automatic
-- priority engine (src/lib/scheduling/priority.js), plus the derived column it
-- writes back to.
--
--   is_vip         guest tier signal (explicit; no longer inferred from prose)
--   is_emergency   urgent operational signal
--   derived_priority  cached engine output — never set by a human. The engine
--                     recomputes it from time-to-pickup + VIP/emergency/overdue
--                     and the configurable dispatch_policy thresholds. Stored so
--                     the queue can ORDER BY it in one pass without recomputing
--                     per row at read time.
--
-- Backfill: any request whose resolved vehicle category is a VIP class is
-- treated as VIP from day one. Other requests default to false (the priority
-- engine then derives a purely time-based level).
--
-- RLS is enabled but inert (app-layer auth) — consistent with every other table.
-- ============================================
BEGIN;

ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS derived_priority VARCHAR(20);

ALTER TABLE transportation_requests
  ADD CONSTRAINT chk_transport_derived_priority
  CHECK (derived_priority IS NULL OR derived_priority IN (
    'Overdue', 'Critical', 'High', 'Medium', 'Normal', 'Future'
  ));

-- One-time VIP backfill from the resolved category (kept in sync with
-- category-resolver.js, which routes VIP-class requests to a VIP category).
UPDATE transportation_requests tr
   SET is_vip = TRUE,
       updated_at = NOW()
  FROM vehiclecategories vc
 WHERE tr.requested_category_id = vc.category_id
   AND vc.category_name ILIKE '%VIP%'
   AND tr.deleted_at IS NULL
   AND tr.is_vip = FALSE;

CREATE INDEX IF NOT EXISTS idx_transport_requests_derived_priority
  ON transportation_requests(derived_priority);

CREATE INDEX IF NOT EXISTS idx_transport_requests_flags
  ON transportation_requests(is_vip, is_emergency);

COMMENT ON COLUMN transportation_requests.derived_priority IS
  'Cached output of the smart priority engine (src/lib/scheduling/priority.js). Never set by a human; recomputed from pickup time + VIP/emergency/overdue and the dispatch_policy thresholds.';
COMMENT ON COLUMN transportation_requests.is_vip IS
  'Guest tier flag. Explicit input to the priority engine; VIP raises the derived level one band (capped at High).';
COMMENT ON COLUMN transportation_requests.is_emergency IS
  'Operational urgency flag. Forces the derived level to Critical within the active windows.';

COMMIT;
