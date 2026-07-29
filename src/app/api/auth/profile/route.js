import { query } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ok, err, handleError } from "@/lib/api/utils";

export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user?.employeeId) {
      return err("Unauthorized", 401);
    }

    const { first_name, last_name, email, phone } = await req.json();
    const employeeId = session.user.employeeId;

    if (email && email !== session.user.email) {
      const existing = await query(
        `SELECT employee_id FROM employees WHERE email = $1 AND employee_id != $2 AND deleted_at IS NULL LIMIT 1`,
        [email.toLowerCase(), employeeId]
      );
      if (existing.rows?.length > 0) {
        return err("Email is already in use", 409);
      }
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (first_name !== undefined) {
      fields.push(`first_name = $${idx++}`);
      values.push(first_name);
    }
    if (last_name !== undefined) {
      fields.push(`last_name = $${idx++}`);
      values.push(last_name);
    }
    if (email !== undefined) {
      fields.push(`email = $${idx++}`);
      values.push(email.toLowerCase());
    }
    if (phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(phone);
    }

    if (fields.length === 0) {
      return err("No fields to update", 400);
    }

    values.push(employeeId);
    const result = await query(
      `UPDATE employees SET ${fields.join(", ")} WHERE employee_id = $${idx} RETURNING employee_id, first_name, last_name, email, phone, position`,
      values
    );

    return ok(result.rows?.[0] || { message: "Profile updated" });
  } catch (e) {
    return handleError(e);
  }
}
