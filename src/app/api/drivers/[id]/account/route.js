import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { ROLE_IDS } from "@/lib/constants";

/**
 * PUT /api/drivers/[id]/account
 *
 * Configures a driver's login on demand. Used to enable app/web login for a
 * driver whose employee record has no credentials (legacy Add Driver accounts),
 * or to reset a password. Setting a password revokes any existing mobile
 * sessions for that employee.
 *
 * Body: { password? } — provide a password to set/reset it; omit to only ensure
 * the driver role is applied.
 */
export async function PUT(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const { id } = await params;
    const body = await parseBody(req);

    const errors = validateBody(body, {
      password: { type: "password", label: "Password" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const { rows: driverRows } = await query(
      `SELECT d.driver_id, d.employee_id
         FROM drivers d
        WHERE d.driver_id = $1 AND d.deleted_at IS NULL
        LIMIT 1`,
      [id]
    );
    const driver = driverRows[0];
    if (!driver) {
      return err("Driver not found", 404);
    }
    const employeeId = driver.employee_id;

    const { rows: empRows } = await query(
      `SELECT e.employee_id, e.email, e.password_hash, r.role_name
         FROM employees e
         LEFT JOIN roles r ON r.role_id = e.role_id
        WHERE e.employee_id = $1 AND e.deleted_at IS NULL
        LIMIT 1`,
      [employeeId]
    );
    const employee = empRows[0];
    if (!employee) {
      return err("Linked employee record not found", 404);
    }

    // Always ensure the employee is driver-role.
    if (employee.role_name !== "driver") {
      await query(`UPDATE employees SET role_id = $1, updated_at = NOW() WHERE employee_id = $2`, [
        ROLE_IDS.driver,
        employeeId,
      ]);
    }

    // Set/reset the password when given.
    if (body.password && String(body.password).trim() !== "") {
      const hash = await bcrypt.hash(body.password, 10);
      await query(`UPDATE employees SET password_hash = $1, updated_at = NOW() WHERE employee_id = $2`, [
        hash,
        employeeId,
      ]);

      // Revoke any existing mobile sessions so old tokens cannot linger after
      // a credential change.
      await query(`DELETE FROM mobile_refresh_tokens WHERE employee_id = $1`, [employeeId]);
    }

    const { rows: after } = await query(
      `SELECT e.employee_id, e.email, e.password_hash, r.role_name
         FROM employees e
         LEFT JOIN roles r ON r.role_id = e.role_id
        WHERE e.employee_id = $1
        LIMIT 1`,
      [employeeId]
    );
    const finalEmp = after[0];

    return ok({
      driver_id: Number(id),
      employee_id: employeeId,
      account: {
        employee_id: employeeId,
        email: finalEmp?.email,
        role: finalEmp?.role_name ?? "driver",
        has_password: Boolean(finalEmp?.password_hash),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}