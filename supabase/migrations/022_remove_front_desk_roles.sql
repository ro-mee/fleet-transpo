-- 022_remove_front_desk_roles.sql
-- FleetOps focuses on fleet & transportation. Remove the front-desk/hospitality
-- roles (reception_staff, restaurant_staff, concierge) and disable the employees
-- who held them so they can no longer log in.
BEGIN;

-- Disable the 3 employees who hold the front-desk roles (block login via soft-delete)
-- and clear their role reference before deleting the role rows.
UPDATE employees
   SET deleted_at = COALESCE(deleted_at, now()),
       role_id = NULL,
       status = 'Inactive'
 WHERE role_id IN (5, 6, 8)
   AND deleted_at IS NULL;

-- Remove the role rows.
DELETE FROM roles WHERE role_id IN (5, 6, 8);

COMMIT;
