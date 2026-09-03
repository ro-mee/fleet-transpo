-- Ensure that a company card can only have one active assignment at a time
CREATE UNIQUE INDEX idx_company_card_active_assignment ON company_card_assignments(company_card_id) WHERE unassigned_at IS NULL;
