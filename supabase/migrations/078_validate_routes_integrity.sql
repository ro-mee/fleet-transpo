-- The 076 backfill repaired the existing route rows before these checks were
-- introduced. Validate them now so the database records the invariant for all
-- current and future rows.
ALTER TABLE routes VALIDATE CONSTRAINT routes_status_check;
ALTER TABLE routes VALIDATE CONSTRAINT routes_estimate_source_check;
ALTER TABLE routes VALIDATE CONSTRAINT routes_positive_estimates_check;
ALTER TABLE routes VALIDATE CONSTRAINT routes_endpoint_pair_check;
