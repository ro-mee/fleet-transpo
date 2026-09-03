CREATE TABLE company_cards (
  id SERIAL PRIMARY KEY,
  card_label VARCHAR(255),
  card_last_four VARCHAR(4) NOT NULL,
  provider VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  monthly_limit NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_company_cards_status CHECK (status IN ('Active', 'Suspended', 'Cancelled'))
);

CREATE TABLE company_card_assignments (
  id SERIAL PRIMARY KEY,
  company_card_id INT NOT NULL REFERENCES company_cards(id),
  employee_id INT REFERENCES employees(employee_id),
  vehicle_id INT REFERENCES vehicles(vehicle_id),
  assigned_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  unassigned_at TIMESTAMPTZ,
  assigned_by INT NOT NULL REFERENCES employees(employee_id),
  assignment_type VARCHAR(100)
);

CREATE INDEX idx_company_cards_status ON company_cards(status);
CREATE INDEX idx_company_card_assignments_card_id ON company_card_assignments(company_card_id);
CREATE INDEX idx_company_card_assignments_employee ON company_card_assignments(employee_id);
CREATE INDEX idx_company_card_assignments_vehicle ON company_card_assignments(vehicle_id);
