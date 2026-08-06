-- 019_admin_role.sql
-- Add the missing `admin` role so account provisioning can assign it via the
-- Add User screen (/settings/users/new) and /api/auth/register. role_id 9 is
-- free (roles 1..8 are the REGISTRATION_ROLES set).
--
-- Also backfill role_id on active employees that are linked drivers but have
-- no role assigned (they could not log in / were not visible as staff). Drivers
-- get the `driver` role (id 4). Soft-deleted employees are left untouched.

BEGIN;

INSERT INTO roles (role_id, role_name, description)
VALUES (9, 'admin', 'FleetOps Admin - full operations and user management')
ON CONFLICT (role_id) DO NOTHING;

UPDATE employees e
SET role_id = 4
WHERE e.role_id IS NULL
  AND e.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM drivers d
    WHERE d.employee_id = e.employee_id AND d.deleted_at IS NULL
  );

COMMIT;
