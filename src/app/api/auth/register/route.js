import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError, errValidation } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizeName, normalizeEmail } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { ROLE_IDS } from "@/lib/constants";

const VALID_ROLE_IDS = new Set(Object.values(ROLE_IDS));

// Account creation is admin-only. There is no public self-signup: only an
// authenticated system_admin/admin may create employee accounts, and the
// new account's role is taken from an explicit, validated role_id.
export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin"]);

    const body = await req.json();

    const errors = validateBody(body, {
      email: { required: true, type: "email", label: "Email" },
      password: { required: true, type: "password", label: "Password" },
      first_name: { required: true, type: "name", label: "First name", maxLength: 100 },
      last_name: { required: true, type: "name", label: "Last name", maxLength: 100 },
      role_id: { required: true, type: "id", label: "Role" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const { email, password, first_name, last_name } = body;
    const roleId = Number(body.role_id);

    if (!VALID_ROLE_IDS.has(roleId)) {
      return err("Invalid role.", 400);
    }

    const lowerEmail = normalizeEmail(email);

    const existing = await query(
      `SELECT employee_id FROM employees WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [lowerEmail]
    );
    if (existing.rows?.length > 0) {
      // Never overwrite an existing account's credentials from this endpoint —
      // that was an account-takeover path. Reject instead.
      return err("An account with this email already exists.", 409);
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO employees (email, password_hash, first_name, last_name, role_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING employee_id`,
      [lowerEmail, hash, normalizeName(first_name), normalizeName(last_name), roleId]
    );

    await writeAudit(req, session, {
      action: "create",
      resource: "employees",
      resourceId: rows[0]?.employee_id,
      newValues: { email: lowerEmail, role_id: roleId, first_name: normalizeName(first_name), last_name: normalizeName(last_name) },
    });

    return ok({ message: "Account created", employee_id: rows[0]?.employee_id }, 201);
  } catch (e) {
    return handleError(e);
  }
}
