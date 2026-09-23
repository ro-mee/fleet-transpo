import bcrypt from "bcryptjs";
import { query, withTransaction } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { isEmailConfigured, sendTempPasswordEmail } from "@/lib/email/smtp";
import { isDeliverableEmailAddress } from "@/lib/auth/otp-policy";
import { generateTempPassword, tempPasswordExpiry } from "@/lib/auth/temp-password";
import { revokeEmployeeSessions } from "@/lib/auth/sessions";

// Admin-initiated re-issue of an invited account's temporary password.
//
// Only meaningful while must_change_password is still true — once the
// employee has set their own password there is nothing temporary left to
// resend, and the existing one-time reset-link flow owns that case.
//
// Order is deliberate: rotate the credential + revoke sessions in one
// transaction, THEN email. If the email fails the new password is unknown
// to everyone (502 tells the admin to press Resend again) — unlike account
// creation, where the row itself is the thing that must not survive a
// failed send, so creation compensates with a DELETE instead.
export async function POST(req, { params }) {
  try {
    const session = await requirePermission(req, "accounts", "create");
    // Next 16: route params arrive as a Promise (node_modules/next/dist/docs
    // version-16 upgrade guide). `await` also passes harness calls that hand
    // over a plain object.
    const { id } = await params;
    const employeeId = Number(id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return err("Invalid id.", 400);
    }

    const { rows } = await query(
      `SELECT employee_id, email, first_name, must_change_password, deleted_at, status
         FROM employees
        WHERE employee_id = $1`,
      [employeeId]
    );
    const employee = rows?.[0];
    if (!employee || employee.deleted_at) {
      return err("Account not found", 404);
    }
    if (!employee.must_change_password) {
      return err(
        "This account already has a permanent password — use the password reset flow instead.",
        400
      );
    }
    if (!isEmailConfigured()) {
      return err("Email delivery is not configured.", 400);
    }
    if (!isDeliverableEmailAddress(employee.email)) {
      return err("This address cannot receive email — use a deliverable address.", 400);
    }

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    const expiresAt = tempPasswordExpiry();

    const changed = await withTransaction(async (tx) => {
      const { rows: updated } = await tx.query(
        `UPDATE employees
            SET password_hash = $1,
                temp_credential_expires_at = $2,
                auth_version = auth_version + 1,
                updated_at = NOW()
          WHERE employee_id = $3
            AND must_change_password = true
            AND deleted_at IS NULL
          RETURNING auth_version`,
        [hash, expiresAt, employeeId]
      );
      if (!updated.length) return null;
      await revokeEmployeeSessions(tx, employeeId);
      await tx.query(
        `DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`,
        [employeeId]
      );
      return updated[0];
    });
    if (!changed) {
      return err("Account state changed — refresh and try again.", 409);
    }

    try {
      await sendTempPasswordEmail({
        to: employee.email,
        firstName: employee.first_name,
        tempPassword,
        expiresAt,
      });
    } catch {
      return err(
        "The new temporary password could not be emailed — press Resend invite again.",
        502
      );
    }

    await writeAudit(req, session, {
      action: "invite_resend",
      resource: "employees",
      resourceId: employeeId,
      // Never the password or its hash — only who it went to.
      newValues: { email: employee.email },
    });

    return ok({ message: `A new temporary password was emailed to ${employee.email}` });
  } catch (e) {
    return handleError(e);
  }
}
