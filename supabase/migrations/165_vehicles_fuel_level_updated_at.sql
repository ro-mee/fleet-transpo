-- 165: record when vehicles.fuel_level was last written.
--
-- fuel_level is the driver-reported gauge reading consumed by the mobile
-- tank-space check (mobile/fuel submission) and by dispatch scoring. Nothing
-- recorded when it was set, so the value could be stale indefinitely with no
-- way for a consumer to tell. This column is additive metadata only: the
-- writers are the fuel request POST (driver gauge report) and the receipt
-- approval PUT (/api/fuel/[id], which adds the purchased litres under the
-- accounting identity level = min(100, level + litres / tank_capacity)).
--
-- No backfill: updated_at moves for any vehicle edit, so it cannot stand in
-- for a fuel-level timestamp, and inventing one would be worse than NULL.
-- Consumers must treat NULL as "unknown age".
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_level_updated_at timestamptz;

COMMENT ON COLUMN vehicles.fuel_level_updated_at IS
  'When fuel_level was last written (driver gauge report or verified receipt). NULL means unknown.';
