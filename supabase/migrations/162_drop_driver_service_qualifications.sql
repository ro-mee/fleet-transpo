-- Removes the driver service qualification review system (migration 156).
--
-- Classification is enforced statically via drivers.driver_type in the
-- deterministic engine instead, so these tables have no readers. The live
-- tables were verified empty before removal; this is structure-only.
BEGIN;
DROP TRIGGER IF EXISTS qualification_events_immutable ON driver_service_qualification_events;
DROP TRIGGER IF EXISTS qualification_events_no_truncate ON driver_service_qualification_events;
DROP FUNCTION IF EXISTS reject_driver_qualification_event_changes() CASCADE;
DROP TABLE IF EXISTS driver_service_qualification_events;
DROP TABLE IF EXISTS driver_service_qualifications;
COMMIT;
