import { query } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizeName, normalizeEmail, normalizePhone } from "@/lib/validation/helpers";

export async function PATCH(req) {
  try {
    const session = await auth();
    if (!session?.user?.employeeId) {
      return err("Unauthorized", 401);
    }

    const body = await req.json();
    const { first_name, last_name, email, phone } = body;

    const errors = validateBody(body, {
      first_name: { type: "name", label: "First name", maxLength: 100 },
      last_name: { type: "name", label: "Last name", maxLength: 100 },
      email: { type: "email", label: "Email" },
      phone: { type: "phone", label: "Phone" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const employeeId = session.user.employeeId;

    if (email && email !== session.user.email) {
      const existing = await query(
        `SELECT employee_id FROM employees WHERE email = $1 AND employee_id != $2 AND deleted_at IS NULL LIMIT 1`,
        [normalizeEmail(email), employeeId]
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
      values.push(normalizeName(first_name));
    }
    if (last_name !== undefined) {
      fields.push(`last_name = $${idx++}`);
      values.push(normalizeName(last_name));
    }
    if (email !== undefined) {
      fields.push(`email = $${idx++}`);
      values.push(normalizeEmail(email));
    }
    if (phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(normalizePhone(phone) || null);
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
