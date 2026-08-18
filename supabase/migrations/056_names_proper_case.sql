-- Standard Proper Case (Title Case) for person names.
--
-- Lowercases every name field, then capitalises the first letter of each word,
-- so "TEST DRIVER" -> "Test Driver", "jack mors" -> "Jack Mors",
-- "KARLO RAFAEL SUNGA TORRES" -> "Karlo Rafael Sunga Torres".
-- Postgres's initcap() does exactly this and is idempotent, so re-running is a
-- no-op on already-proper-cased values.
--
-- Scope: the person-name columns only. Names are stored on employees
-- (first/last) — drivers join employees for display, so no separate driver
-- name column needs touching. emergency_contact_name and guest_name are covered
-- too. Vehicle / route / provider / category / channel names are NOT person
-- names and are intentionally left as-is.
--
-- Idempotent by construction (initcap of an already-proper-cased value is the
-- same value), so this is safe on a DB where some rows were already normalised.
UPDATE employees
   SET first_name = initcap(trim(first_name)),
       last_name  = initcap(trim(last_name)),
       updated_at = NOW()
 WHERE deleted_at IS NULL
   AND (first_name <> initcap(trim(first_name)) OR last_name <> initcap(trim(last_name)));

UPDATE drivers
   SET emergency_contact_name = initcap(trim(emergency_contact_name)),
       updated_at = NOW()
 WHERE deleted_at IS NULL
   AND emergency_contact_name IS NOT NULL
   AND emergency_contact_name <> initcap(trim(emergency_contact_name));

UPDATE transportation_requests
   SET guest_name = initcap(trim(guest_name)),
       updated_at = NOW()
 WHERE guest_name IS NOT NULL
   AND guest_name <> initcap(trim(guest_name));
