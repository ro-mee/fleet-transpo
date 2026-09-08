-- ============================================
-- MIGRATION 109: trip_monitor_alerts — durable live-monitoring alerts
--
-- PR #4 (Live Monitoring & Delay Intelligence). The monitor evaluates an
-- in-progress trip's risk on every GPS ping / dispatcher view, but a
-- serverless deployment cannot keep alert state in process memory: ping #1
-- and ping #2 may be served by different instances. This table IS the
-- cross-instance memory:
--
--   * unique (trip_id, signal_key) — one row per signal per trip; episodes
--     resurrect the same row rather than piling up history;
--   * `active` + severity — the durable previous state for severity-jump
--     notifications (entering ATTENTION / ACTION fires exactly once) and the
--     off-route hysteresis anchor (a confirmed deviation persists until two
--     consecutive fixes are back within the corridor, even across instances);
--   * lifecycle-owned resolution: completeTrip / cancelTrip resolve a trip's
--     active alerts inside their transaction — the fleet summary's sweep is a
--     defensive backstop only, never the mechanism;
--   * signal_key domain: pickup_delay / destination_delay / off_route /
--     gps_unavailable / next_trip_risk.
--
-- Naturally idempotent: CREATE TABLE IF NOT EXISTS + guarded index/constraint.
-- ============================================

CREATE TABLE IF NOT EXISTS trip_monitor_alerts (
  alert_id BIGSERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trips(trip_id),
  signal_key VARCHAR(40) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (trip, signal): episodes resurrect, history does not pile up.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_trip_monitor_alerts_trip_signal'
  ) THEN
    ALTER TABLE trip_monitor_alerts
      ADD CONSTRAINT uq_trip_monitor_alerts_trip_signal UNIQUE (trip_id, signal_key);
  END IF;
END
$$;

-- The fleet summary reads "active alerts for live trips" every poll.
CREATE INDEX IF NOT EXISTS idx_trip_monitor_alerts_active
  ON trip_monitor_alerts (active, last_detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_trip_monitor_alerts_trip
  ON trip_monitor_alerts (trip_id) WHERE active;
