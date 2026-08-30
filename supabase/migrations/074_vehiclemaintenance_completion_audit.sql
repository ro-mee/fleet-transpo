-- Add completed_by to vehiclemaintenance
ALTER TABLE vehiclemaintenance 
ADD COLUMN IF NOT EXISTS completed_by integer REFERENCES employees(employee_id);
