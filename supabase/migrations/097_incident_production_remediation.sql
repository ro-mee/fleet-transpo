-- Add production remediation fields to driverincidents
ALTER TABLE driverincidents 
  ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS passenger_injured BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS medical_assistance_required BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS third_party_involved BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS police_report_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS insurance_claim_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overdue_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_driverincidents_confidential ON driverincidents(is_confidential);
CREATE INDEX IF NOT EXISTS idx_driverincidents_due_at ON driverincidents(due_at);

-- Create incident comments audit table
CREATE TABLE IF NOT EXISTS incident_comments (
  comment_id SERIAL PRIMARY KEY,
  incident_id INT NOT NULL REFERENCES driverincidents(incident_id),
  user_id INT REFERENCES employees(employee_id),
  action_type VARCHAR(50) NOT NULL,
  comment_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_comments_incident_id ON incident_comments(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_comments_action_type ON incident_comments(action_type);

-- Add manager sign-off clearance fields to vehiclemaintenance
ALTER TABLE vehiclemaintenance
  ADD COLUMN IF NOT EXISTS repair_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspection_required BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inspection_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inspected_by INT REFERENCES employees(employee_id),
  ADD COLUMN IF NOT EXISTS inspection_notes TEXT,
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_approved_by INT REFERENCES employees(employee_id);
