ALTER TABLE fuelrecords
ADD COLUMN payment_method VARCHAR(50),
ADD COLUMN company_card_id INT REFERENCES company_cards(id);

-- Optional: If we want to enforce consistency, although fuelrecords didn't have this before, 
-- we should probably set a default or just allow nulls since it's an alter table on existing data.
-- We can add a constraint for future records:
ALTER TABLE fuelrecords
ADD CONSTRAINT chk_fuel_company_card CHECK (
  (payment_method = 'Company Card' AND company_card_id IS NOT NULL) OR 
  (payment_method != 'Company Card' AND company_card_id IS NULL) OR
  (payment_method IS NULL)
);
