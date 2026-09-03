CREATE TABLE expense_records (
  id SERIAL PRIMARY KEY,
  client_submission_id UUID UNIQUE NOT NULL,
  driver_id INT NOT NULL REFERENCES drivers(driver_id),
  trip_id INT REFERENCES trips(trip_id),
  vehicle_id INT REFERENCES vehicles(vehicle_id),
  category VARCHAR(100) NOT NULL,
  merchant_name VARCHAR(255),
  amount NUMERIC(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'PHP',
  expense_date TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  company_card_id INT REFERENCES company_cards(id),
  receipt_storage_key VARCHAR(255) NOT NULL,
  receipt_sha256 VARCHAR(255) NOT NULL,
  receipt_uploaded_at TIMESTAMPTZ NOT NULL,
  ocr_snapshot JSONB NOT NULL,
  driver_edits JSONB,
  flags JSONB,
  status VARCHAR(50) DEFAULT 'Pending',
  review_remarks TEXT,
  reviewed_by INT REFERENCES employees(employee_id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_expense_category CHECK (category IN ('Toll', 'Parking', 'Meals', 'Lodging', 'Other')),
  CONSTRAINT chk_expense_payment_method CHECK (payment_method IN ('Company Card', 'Cash', 'Personal Card', 'Other')),
  CONSTRAINT chk_expense_status CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  CONSTRAINT chk_expense_company_card CHECK (
    (payment_method = 'Company Card' AND company_card_id IS NOT NULL) OR 
    (payment_method != 'Company Card' AND company_card_id IS NULL)
  )
);

CREATE INDEX idx_expense_records_status ON expense_records(status);
CREATE INDEX idx_expense_records_driver_id ON expense_records(driver_id);
CREATE INDEX idx_expense_records_trip_id ON expense_records(trip_id);
CREATE INDEX idx_expense_records_vehicle_id ON expense_records(vehicle_id);
CREATE INDEX idx_expense_records_company_card_id ON expense_records(company_card_id);
CREATE INDEX idx_expense_records_expense_date ON expense_records(expense_date);
CREATE INDEX idx_expense_records_submitted_at ON expense_records(submitted_at);
CREATE INDEX idx_expense_records_receipt_sha256 ON expense_records(receipt_sha256);

INSERT INTO storage.buckets (id, name, public) 
VALUES ('expense-receipts', 'expense-receipts', false) 
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload expense receipts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'expense-receipts');

CREATE POLICY "Authenticated users can read their expense receipts"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'expense-receipts');
