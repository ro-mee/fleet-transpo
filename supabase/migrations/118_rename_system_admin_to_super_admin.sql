BEGIN;

-- Canonical role rename: system_admin -> super_admin (role_id 1 unchanged).
--
-- Live-catalog audit (2026-09-22) found NO other live object holding the
-- literal: no RLS policy, function, view, or trigger references it, and
-- `roles.role_name` is the only role_name column in the schema. Historical
-- migration files are untouched. Application code resolves both literals
-- through normalizeRoleName(), so this is safe to apply while either the
-- old or the new code is deployed.
--
-- Rerun-safe: the rename matches only the pre-rename row, and the
-- auth_version bump below fires only when the rename changed a row (a
-- security-role rename must not leave old privileged sessions alive).
WITH renamed AS (
  UPDATE roles
     SET role_name = 'super_admin'
   WHERE role_id = 1
     AND role_name = 'system_admin'
  RETURNING role_id
)
UPDATE employees
   SET auth_version = auth_version + 1,
       updated_at = NOW()
 WHERE role_id = 1
   AND deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM renamed);

COMMIT;
