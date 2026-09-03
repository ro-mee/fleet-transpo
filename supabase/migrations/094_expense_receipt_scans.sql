CREATE TABLE expense_receipt_scans (
  client_submission_id UUID PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES drivers(driver_id),
  receipt_storage_key VARCHAR(255) NOT NULL,
  receipt_sha256 VARCHAR(255) NOT NULL,
  ocr_snapshot JSONB,
  is_submitted BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_expense_receipt_scans_driver_id ON expense_receipt_scans(driver_id);
