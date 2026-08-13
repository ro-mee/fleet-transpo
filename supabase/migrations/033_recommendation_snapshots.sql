-- ============================================
-- MIGRATION 027: Recommendation Snapshots
--
-- Records each AI fleet-pair recommendation for a transportation request as an
-- immutable snapshot: the exact vehicle+driver pair, its score/confidence, the
-- reason, the request/driver status at generation time, and a validity window.
--
-- This replaces the old pattern of writing the two halves independently
-- (transportation_requests.ai_vehicle_recommendation / ai_driver_recommendation)
-- with no pair link, no metadata, and no expiry. The snapshot is the durable
-- record of "what the advisor suggested, when, and why". The two legacy columns
-- remain untouched for read-back compatibility; new writes go here.
--
--   is_consumed  = the pair was Accepted & Assigned (set by the assign path).
--   valid_until  = hard expiry. An unconsumed snapshot past this is stale and
--                  the UI must surface it as expired + offer regeneration.
--
-- RLS is enabled but inert (app-layer auth), consistent with every other table.
-- ============================================
BEGIN;

CREATE TABLE IF NOT EXISTS recommendation_snapshots (
  snapshot_id          SERIAL PRIMARY KEY,
  request_id           INT NOT NULL REFERENCES transportation_requests(request_id) ON DELETE CASCADE,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until          TIMESTAMPTZ,
  -- The full recommended pair (vehicle + driver + designated + reasons + score).
  pair_json            JSONB NOT NULL,
  -- Denormalized for indexed validity/consumption lookups.
  vehicle_id           INT REFERENCES vehicles(vehicle_id),
  driver_id            INT REFERENCES drivers(driver_id),
  designated_driver_id INT REFERENCES drivers(driver_id),
  pair_score           NUMERIC,
  confidence           NUMERIC,
  reason_type          VARCHAR(20) DEFAULT 'designated'
    CHECK (reason_type IN ('designated', 'replacement')),
  replacement_reason   TEXT,
  -- Request / driver status captured at generation time.
  fleet_status         VARCHAR(50),
  driver_status        VARCHAR(50),
  is_consumed          BOOLEAN NOT NULL DEFAULT FALSE,
  consumed_at          TIMESTAMPTZ,
  created_by           INT REFERENCES employees(employee_id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE recommendation_snapshots IS
  'Immutable AI fleet-pair recommendation per request. valid_until IS NULL or in the past means the snapshot is stale and should be surfaced as expired.';
COMMENT ON COLUMN recommendation_snapshots.is_consumed IS
  'TRUE once the recommended pair was Accepted & Assigned, so the same suggestion is not reapplied twice.';

-- Latest snapshot per request (for the saved-recommendation card).
CREATE INDEX IF NOT EXISTS idx_rec_snapshots_request
  ON recommendation_snapshots(request_id, generated_at DESC);

-- Fast lookup of the single active (unconsumed) recommendation for a request.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rec_snapshot_active
  ON recommendation_snapshots(request_id)
  WHERE is_consumed = FALSE;

-- Validity / regeneration sweeps.
CREATE INDEX IF NOT EXISTS idx_rec_snapshots_validity
  ON recommendation_snapshots(valid_until) WHERE is_consumed = FALSE;

ALTER TABLE recommendation_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view recommendation snapshots"
  ON recommendation_snapshots FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Fleet staff can manage recommendation snapshots"
  ON recommendation_snapshots FOR ALL
  USING (has_role(ARRAY['admin', 'system_admin', 'fleet_manager', 'dispatcher']));

COMMIT;
