-- Removes provider-identity columns from vehiclemaintenance (2026-10-13).
--
-- The register no longer captures where a repair happened: the staff
-- create/edit dialogs and the mechanic evidence form stopped writing these
-- columns, the API allowlists reject them, and the reports workbook dropped
-- the Provider / Service center columns. Only who performed the repair
-- (repair_completed_by + repair_completed_by_name display join) and what was
-- done are recorded now.
BEGIN;
ALTER TABLE vehiclemaintenance DROP COLUMN IF EXISTS service_provider;
ALTER TABLE vehiclemaintenance DROP COLUMN IF EXISTS service_center;
COMMIT;
