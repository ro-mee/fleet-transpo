import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { ROLE_IDS } from "@/lib/constants";

// Mechanic directory for the staff assign-mechanic select on the maintenance
// register (create/edit dialog). Returns active mechanics only — employee id
// plus display name — never credentials, sessions, or other roles.
//
// Guarded by maintenance:create (fleet_manager, admin, super_admin): the only
// roles that reach this list are the ones allowed to set assigned_mechanic_id
// on POST/PUT. The mechanic role itself holds no create grant, so it cannot
// enumerate staff here; mechanics see their own queue, not the directory.
// No migration: reads the existing employees row (role_id 10 = mechanic).
export async function GET(req) {
  try {
    await requirePermission(req, "maintenance", "create");
    const { rows } = await query(
      `SELECT e.employee_id, e.first_name, e.last_name, e.email
         FROM employees e
        WHERE e.role_id = $1 AND e.deleted_at IS NULL AND e.status = 'Active'
        ORDER BY e.first_name, e.last_name
        LIMIT 500`,
      [ROLE_IDS.mechanic]
    );
    return ok(rows);
  } catch (e) { return handleError(e); }
}
