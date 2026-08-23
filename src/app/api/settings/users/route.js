import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { query } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

// Staff account management. Complements /api/auth/register (create) and the
// Drivers directory (driver profiles): this is the index for EVERY employee
// account — dispatchers, managers, admins — with enable/disable for offboarding.
//
// Disabling follows the migration-028 convention: soft-delete (deleted_at) is
// what actually blocks login (auth.js checks deleted_at IS NULL), and
// status='Inactive' carries the human-readable state.

const EMPLOYEE_SELECT = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone,
         e.position, e.status, e.deleted_at, e.created_at,
         r.role_name
    FROM employees e
    LEFT JOIN roles r ON r.role_id = e.role_id
   WHERE e.email IS NOT NULL
`;

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin"]);
    const url = new URL(req.url);
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();

    let sql = `${EMPLOYEE_SELECT}`;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (LOWER(e.first_name || ' ' || e.last_name) LIKE $1 OR LOWER(e.email) LIKE $1)`;
    }
    sql += ` ORDER BY e.created_at DESC LIMIT 500`;

    const { rows } = await query(sql, params);
    return ok({ rows });
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin"]);
    const body = await parseBody(req);
    const employeeId = Number(body?.employee_id);
    const action = body?.action; // "disable" | "enable"

    if (!Number.isInteger(employeeId) || !["disable", "enable"].includes(action)) {
      return err("employee_id and action ('disable' | 'enable') are required", 400);
    }
    // An admin cannot lock themselves out of the console.
    if (action === "disable" && session.user?.employeeId === employeeId) {
      return err("You cannot disable your own account.", 400);
    }

    const { rows: before } = await query(
      `SELECT employee_id, email, first_name, last_name, status, deleted_at FROM employees WHERE employee_id = $1`,
      [employeeId]
    );
    if (!before.length) return err("Employee not found", 404);

    const { rows: updated } = await query(
      action === "disable"
        ? `UPDATE employees SET deleted_at = COALESCE(deleted_at, NOW()), status = 'Inactive', updated_at = NOW(), updated_by = $2 WHERE employee_id = $1 RETURNING employee_id, status, deleted_at`
        : `UPDATE employees SET deleted_at = NULL, status = 'Active', updated_at = NOW(), updated_by = $2 WHERE employee_id = $1 RETURNING employee_id, status, deleted_at`,
      [employeeId, session.user?.employeeId ?? null]
    );

    await writeAudit(req, session, {
      action: "update",
      resource: "employees",
      resourceId: employeeId,
      oldValues: { status: before[0].status, deleted_at: before[0].deleted_at },
      newValues: updated[0],
    });

    return ok(updated[0]);
  } catch (e) {
    return handleError(e);
  }
}
