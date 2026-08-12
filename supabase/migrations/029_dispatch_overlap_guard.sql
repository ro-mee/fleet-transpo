-- 023_dispatch_overlap_guard.sql
-- DB-level double-booking guard for dispatchschedules.
--
-- A literal EXCLUDE USING gist constraint can't be filtered by status, so
-- historical overlaps among Completed/Cancelled rows would violate it. Instead
-- a BEFORE INSERT OR UPDATE trigger rejects a row that overlaps an ACTIVE
-- (Scheduled / In Progress) dispatch for the same vehicle or driver. Per-resource
-- advisory locks serialize concurrent writes so the check-then-insert is
-- race-free at the database, independent of the app-layer checks.
BEGIN;

CREATE OR REPLACE FUNCTION guard_dispatch_overlap() RETURNS trigger AS $$
DECLARE
  other_id   INTEGER;
  eff_arrival TIMESTAMPTZ;
  excl       TEXT;
BEGIN
  IF NEW.status NOT IN ('Scheduled', 'In Progress') OR NEW.scheduled_departure IS NULL THEN
    RETURN NEW;
  END IF;

  eff_arrival := COALESCE(NEW.scheduled_arrival, NEW.scheduled_departure);
  -- On UPDATE the row being edited already exists; exclude it from the scan.
  excl := CASE WHEN TG_OP = 'UPDATE' THEN 'AND dispatch_id <> ' || OLD.dispatch_id ELSE '' END;

  IF NEW.vehicle_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('dispatch_veh_' || NEW.vehicle_id));
    EXECUTE
      'SELECT dispatch_id FROM dispatchschedules
         WHERE deleted_at IS NULL
           AND status IN (''Scheduled'', ''In Progress'')
           AND vehicle_id = $1
           ' || excl || '
           AND scheduled_departure < $2
           AND COALESCE(scheduled_arrival, scheduled_departure) > $3
         LIMIT 1'
      INTO other_id USING NEW.vehicle_id, eff_arrival, NEW.scheduled_departure;
    IF other_id IS NOT NULL THEN
      RAISE EXCEPTION 'Vehicle % is already dispatched (#%) in this time window', NEW.vehicle_id, other_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('dispatch_drv_' || NEW.driver_id));
    EXECUTE
      'SELECT dispatch_id FROM dispatchschedules
         WHERE deleted_at IS NULL
           AND status IN (''Scheduled'', ''In Progress'')
           AND driver_id = $1
           ' || excl || '
           AND scheduled_departure < $2
           AND COALESCE(scheduled_arrival, scheduled_departure) > $3
         LIMIT 1'
      INTO other_id USING NEW.driver_id, eff_arrival, NEW.scheduled_departure;
    IF other_id IS NOT NULL THEN
      RAISE EXCEPTION 'Driver % is already dispatched (#%) in this time window', NEW.driver_id, other_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dispatch_overlap ON dispatchschedules;
CREATE TRIGGER trg_dispatch_overlap
  BEFORE INSERT OR UPDATE OF vehicle_id, driver_id, scheduled_departure, scheduled_arrival, status
  ON dispatchschedules
  FOR EACH ROW
  EXECUTE FUNCTION guard_dispatch_overlap();

COMMIT;
