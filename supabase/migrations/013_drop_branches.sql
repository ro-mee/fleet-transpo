-- ============================================
-- MIGRATION 013: Drop Branches Feature
--
-- Removes the branches concept entirely:
--   - branch_id columns on employees, vehicles, vehiclereservations
--   - the branches table itself
--   - the RLS policy that referenced branch_id
-- ============================================

-- Drop policy that references branch_id before dropping the columns
DROP POLICY IF EXISTS "Staff can view own branch reservations" ON vehiclereservations;

DROP POLICY IF EXISTS "Staff can view reservations" ON vehiclereservations;

CREATE POLICY "Staff can view reservations"
  ON vehiclereservations FOR SELECT
  USING (
    has_role(ARRAY['admin', 'system_admin', 'management']) OR
    vehiclereservations.created_by = (
      SELECT employee_id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Drop branch_id columns (drops their FK constraints and indexes)
ALTER TABLE employees DROP COLUMN IF EXISTS branch_id;
ALTER TABLE vehicles DROP COLUMN IF EXISTS branch_id;
ALTER TABLE vehiclereservations DROP COLUMN IF EXISTS branch_id;

-- Drop the branches table
DROP TRIGGER IF EXISTS update_branches_updated_at ON branches;
DROP TABLE IF EXISTS branches CASCADE;
