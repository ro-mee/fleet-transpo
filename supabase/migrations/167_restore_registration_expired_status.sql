-- Restore the status used by registration compliance and dispatch eligibility.
-- Live catalog verification showed migration 014's value missing from the check.
-- Preserve every currently accepted status and add only Registration Expired.
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS chk_vehicle_status;
ALTER TABLE public.vehicles ADD CONSTRAINT chk_vehicle_status CHECK (
  vehicle_status IN ('Available', 'Reserved', 'In Use', 'Under Maintenance', 'Decommissioned', 'Registration Expired')
);
