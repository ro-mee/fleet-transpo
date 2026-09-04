-- GPS-tracked fleet responders on incidents.
--
-- Migration 101 made the physical rescue trackable (response_status/type/
-- details/eta), but every advance is a manual staff action. When the help
-- sent is a fleet driver, their phone already posts GPS to this system —
-- these two columns link the incident to that driver so the server can
-- auto-advance Dispatched → En Route → Arrived and keep the ETA live from
-- their position (src/lib/incidents/responder-tracking.js). External help
-- (ambulance, tow company) has no phone posting here and keeps the manual
-- response form; NULL responder_driver_id means exactly that.

ALTER TABLE public.driverincidents
  ADD COLUMN IF NOT EXISTS responder_driver_id integer,
  ADD COLUMN IF NOT EXISTS responder_assigned_at timestamptz;
