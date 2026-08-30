-- Add completed_at to vehiclemaintenance
ALTER TABLE vehiclemaintenance 
ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;
