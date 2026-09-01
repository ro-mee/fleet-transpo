import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { ROLE_IDS } from "@/lib/constants";

/**
 * POST /api/drivers/link
 *
 * Finalizes a role-driver employee that has no `drivers` row yet (e.g. accounts
 * created through the old Settings → Add User path). Creates the missing driver
 * profile so the account becomes a usable driver: visible in the Drivers section
 * and able to log in on mobile.
 *
 * Body: { employee_id }
 */
export async function POST(req) {
  try {
    await requirePermission(req, "drivers", "create");
    const body = await parseBody(req);
    const employeeId = Number(body.employee_id);

    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return err("employee_id is required.", 400);
    }

    // Confirm the employee exists, is driver-role, and has no drivers row yet.
    const { rows } = await query(
      `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.password_hash, r.role_name
         FROM employees e
         LEFT JOIN roles r ON r.role_id = e.role_id
        WHERE e.employee_id = $1 AND e.deleted_at IS NULL
        LIMIT 1`,
      [employeeId]
    );

    const employee = rows[0];
    if (!employee) {
      return err("Employee not found", 404);
    }
    if (employee.role_name !== "driver") {
      return err("Only driver-role employees can be linked to a driver profile", 409);
    }

    const { rows: existingDriver } = await query(
      `SELECT driver_id FROM drivers WHERE employee_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [employeeId]
    );
    if (existingDriver[0]) {
      return err("This employee already has a driver profile", 409);
    }

    const { rows: newDriver } = await query(
      `INSERT INTO drivers (employee_id, driver_status, years_of_experience)
       VALUES ($1, 'Available', 0)
       RETURNING driver_id`,
      [employeeId]
    );

    const driverId = newDriver[0]?.driver_id;
    if (!driverId) {
      return err("Failed to create driver profile", 500);
    }

    return ok(
      {
        driver_id: driverId,
        employee_id: employeeId,
        requires_completion: false,
        account: {
          employee_id: employeeId,
          email: employee.email,
          role: employee.role_name,
          has_password: Boolean(employee.password_hash),
        },
      },
      201
    );
  } catch (e) {
    return handleError(e);
  }
}
