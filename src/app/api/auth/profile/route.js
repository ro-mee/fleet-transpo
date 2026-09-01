import bcrypt from "bcryptjs";
import { query, withTransaction } from "@/lib/db";
import { requireAuth, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizeName, normalizeEmail, normalizePhone } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { revokeEmployeeSessions } from "@/lib/auth/sessions";

export async function PATCH(req) {
  try {
    const session = await requireAuth(req, "*");

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
    const normalizedEmail = email === undefined ? session.user.email : normalizeEmail(email);
    const emailChanged = normalizedEmail !== normalizeEmail(session.user.email);

    if (emailChanged) {
      const { rows: credentialRows } = await query(
        `SELECT password_hash FROM employees WHERE employee_id = $1 AND deleted_at IS NULL AND status = 'Active'`,
        [employeeId]
      );
      const valid = await bcrypt.compare(
        String(body.currentPassword || ""),
        credentialRows[0]?.password_hash || "$2b$10$c9wQOSTVJPfSVsx6lrokNeg.W0aGtDnZreMk1p4JMIEXKaFPu.bkW"
      );
      if (!valid) return err("Current password is required to change your email", 403);
    }

    if (emailChanged) {
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
      values.push(normalizedEmail);
    }
    if (phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(normalizePhone(phone) || null);
    }

    if (fields.length === 0) {
      return err("No fields to update", 400);
    }

    values.push(employeeId);
    const versionClause = emailChanged ? ", auth_version = auth_version + 1" : "";
    const result = await withTransaction(async (tx) => {
      const updated = await tx.query(
        `UPDATE employees SET ${fields.join(", ")}, updated_at = NOW()${versionClause} WHERE employee_id = $${idx} RETURNING employee_id, first_name, last_name, email, phone, position`,
        values
      );
      if (emailChanged) {
        await revokeEmployeeSessions(tx, employeeId);
        await tx.query(`DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`, [employeeId]);
      }
      return updated;
    });

    await writeAudit(req, session, {
      action: emailChanged ? "email_change" : "profile_update",
      resource: "employees",
      resourceId: employeeId,
      newValues: {
        fields: fields.map((field) => field.split(" = ")[0]),
        sessions_revoked: emailChanged,
      },
    });

    return ok({ ...(result.rows?.[0] || { message: "Profile updated" }), signInRequired: emailChanged });
  } catch (e) {
    return handleError(e);
  }
}
