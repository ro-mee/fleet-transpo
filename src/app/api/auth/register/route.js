import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError, errValidation } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizeName, normalizeEmail } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { ROLE_IDS } from "@/lib/constants";
import { canAssignRole, assignRejectionHint } from "@/lib/auth/privilege";
import { isEmailConfigured, sendTempPasswordEmail } from "@/lib/email/smtp";
import { isDeliverableEmailAddress } from "@/lib/auth/otp-policy";
import { generateTempPassword, tempPasswordExpiry } from "@/lib/auth/temp-password";

export { canAssignRole };

const VALID_ROLE_IDS = new Set(Object.values(ROLE_IDS));

// Account creation is admin-only. There is no public self-signup: only an
// authenticated super_admin/admin may create employee accounts, and the
// new account's role is taken from an explicit, validated role_id.
//
// The admin never chooses the password. The server generates a temporary
// one, emails it, and marks the account must_change_password so the
// employee has to replace it at first sign-in. The temporary password is
// returned nowhere — it exists only inside that email. Creation fails
// closed: if the invite email cannot be sent, the row is removed again so
// no account exists that nobody can finish setting up.
export async function POST(req) {
  try {
    const session = await requirePermission(req, "accounts", "create");

    const body = await req.json();

    const errors = validateBody(body, {
      email: { required: true, type: "email", label: "Email" },
      first_name: { required: true, type: "name", label: "First name", maxLength: 100 },
      last_name: { required: true, type: "name", label: "Last name", maxLength: 100 },
      role_id: { required: true, type: "id", label: "Role" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const { email, first_name, last_name } = body;
    const roleId = Number(body.role_id);

    if (!VALID_ROLE_IDS.has(roleId)) {
      return err("Invalid role.", 400);
    }
    if (!canAssignRole(session.user.role, roleId)) {
      return err(assignRejectionHint(roleId), 403);
    }

    const lowerEmail = normalizeEmail(email);

    // Dup check runs before the deliverability precheck so the form's 409
    // stays stable regardless of email configuration.
    const existing = await query(
      `SELECT employee_id FROM employees WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [lowerEmail]
    );
    if (existing.rows?.length > 0) {
      // Never overwrite an existing account's credentials from this endpoint —
      // that was an account-takeover path. Reject instead.
      return err("An account with this email already exists.", 409);
    }

    // Fail closed BEFORE any insert: an account whose invite never arrived
    // is worse than no account, because nobody would ever know its password.
    if (!isEmailConfigured()) {
      return err("Email delivery is not configured — accounts cannot be created right now.", 400);
    }
    if (!isDeliverableEmailAddress(lowerEmail)) {
      return err("This address cannot receive email — use a deliverable address.", 400);
    }

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    const expiresAt = tempPasswordExpiry();
    const { rows } = await query(
      `INSERT INTO employees (email, password_hash, first_name, last_name, role_id, must_change_password, temp_credential_expires_at)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING employee_id`,
      [lowerEmail, hash, normalizeName(first_name), normalizeName(last_name), roleId, expiresAt]
    );
    const employeeId = rows[0]?.employee_id;

    try {
      await sendTempPasswordEmail({
        to: lowerEmail,
        firstName: normalizeName(first_name),
        tempPassword,
        expiresAt,
      });
    } catch (emailError) {
      // Fail closed: compensate the insert so no account exists without a
      // delivered credential. If this DELETE itself throws, the orphan row is
      // still safe (flag set, nobody knows the password, visible in the users
      // list where an admin can resend) — swallow it and report the email failure.
      try {
        await query(`DELETE FROM employees WHERE employee_id = $1`, [employeeId]);
      } catch (deleteError) {
        console.warn("Failed to remove invited account after email failure:", deleteError?.message || deleteError);
      }
      await writeAudit(req, session, {
        action: "invite_email_failed",
        resource: "employees",
        resourceId: employeeId,
        newValues: { email: lowerEmail, role_id: roleId },
      });
      return err("Account could not be created — the invitation email failed to send.", 502);
    }

    await writeAudit(req, session, {
      action: "create",
      resource: "employees",
      resourceId: employeeId,
      newValues: {
        email: lowerEmail,
        role_id: roleId,
        first_name: normalizeName(first_name),
        last_name: normalizeName(last_name),
        invited: true,
      },
    });

    return ok({ message: `Account created — temporary password sent to ${lowerEmail}`, employee_id: employeeId }, 201);
  } catch (e) {
    return handleError(e);
  }
}
