-- 143_mechanic_assignment.sql — mechanic assignment + repair evidence. Idempotent.
INSERT INTO roles (role_id, role_name, description)
VALUES (10, 'mechanic', 'Performs assigned vehicle repairs; cannot approve completion.')
ON CONFLICT (role_id) DO NOTHING;

ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS assigned_mechanic_id INT REFERENCES employees(employee_id);
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS repair_started_at TIMESTAMPTZ;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS diagnosis TEXT;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS parts_replaced JSONB DEFAULT '[]'::jsonb;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS labor_hours NUMERIC(8,2);
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_vm_assigned_mechanic
  ON vehiclemaintenance(assigned_mechanic_id) WHERE deleted_at IS NULL;
