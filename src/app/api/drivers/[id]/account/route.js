import bcrypt from "bcryptjs";
import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { ROLE_IDS } from "@/lib/constants";
import { writeAudit } from "@/lib/audit";
import { isPrivilegedTarget } from "@/lib/auth/privilege";
import { isEmailConfigured, sendTempPasswordEmail } from "@/lib/email/smtp";
import { isDeliverableEmailAddress } from "@/lib/auth/otp-policy";
import { generateTempPassword, tempPasswordExpiry } from "@/lib/auth/temp-password";
import { revokeEmployeeSessions } from "@/lib/auth/sessions";

/**
 * PUT /api/drivers/[id]/account
 *
 * Enables a driver login by emailing a short-lived temporary password. While
 * that invitation is pending, the same action rotates and resends it. A
 * supplied `password` retains the existing staff-assisted password reset path.
 */
export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "drivers", "manage_account");
    const { id } = await params;
    const body = await parseBody(req);
    const invite = body?.sendInvite === true;

    const errors = validateBody(body, {
      password: { type: "password", label: "Password" },
    });
    if (!isValidObject(errors)) return errValidation(errors);
    if (invite && body.password) return err("Do not send a temporary invite and a password together.", 400);

    const { rows: driverRows } = await query(
      `SELECT d.driver_id, d.employee_id
         FROM drivers d
        WHERE d.driver_id = $1 AND d.deleted_at IS NULL
        LIMIT 1`,
      [id]
    );
    const driver = driverRows[0];
    if (!driver) return err("Driver not found", 404);
    const employeeId = driver.employee_id;

    const { rows: empRows } = await query(
      `SELECT e.employee_id, e.email, e.first_name, e.password_hash, e.status,
              e.must_change_password, e.temp_credential_expires_at, r.role_name
         FROM employees e
         LEFT JOIN roles r ON r.role_id = e.role_id
        WHERE e.employee_id = $1 AND e.deleted_at IS NULL
        LIMIT 1`,
      [employeeId]
    );
    const employee = empRows[0];
    if (!employee) return err("Linked employee record not found", 404);

    if (isPrivilegedTarget(employee.role_name)) {
      return err("Privileged accounts cannot be managed through driver account setup.", 403);
    }
    if (employee.role_name && employee.role_name !== "driver") {
      return err("The linked employee already has a non-driver role.", 409);
    }

    if (invite) {
      if (employee.status !== "Active") return err("Activate this employee account before enabling driver login.", 409);
      if (employee.password_hash && !employee.must_change_password) {
        return err("This driver already has a permanent password. Use Manage Login to reset it.", 409);
      }
      if (!isEmailConfigured()) return err("Email delivery is not configured.", 400);
      if (!isDeliverableEmailAddress(employee.email)) {
        return err("This address cannot receive email — update it to a deliverable address first.", 400);
      }

      const tempPassword = generateTempPassword();
      const hash = await bcrypt.hash(tempPassword, 10);
      const expiresAt = tempPasswordExpiry();
      const prepared = await withTransaction(async (tx) => {
        const { rows } = await tx.query(
          `SELECT e.employee_id, e.email, e.first_name, e.status, e.password_hash,
                  e.must_change_password, r.role_name
             FROM employees e
             LEFT JOIN roles r ON r.role_id = e.role_id
            WHERE e.employee_id = $1 AND e.deleted_at IS NULL
            FOR UPDATE OF e`,
          [employeeId]
        );
        const current = rows[0];
        if (!current) return { error: "Linked employee record not found", status: 404 };
        if (isPrivilegedTarget(current.role_name)) {
          return { error: "Privileged accounts cannot be managed through driver account setup.", status: 403 };
        }
        if (current.role_name && current.role_name !== "driver") {
          return { error: "The linked employee already has a non-driver role.", status: 409 };
        }
        if (current.status !== "Active") {
          return { error: "Activate this employee account before enabling driver login.", status: 409 };
        }
        if (current.password_hash && !current.must_change_password) {
          return { error: "This driver already has a permanent password. Refresh and try again.", status: 409 };
        }
        if (!isDeliverableEmailAddress(current.email)) {
          return { error: "This address cannot receive email — update it to a deliverable address first.", status: 400 };
        }

        await tx.query(
          `UPDATE employees
              SET role_id = $1,
                  password_hash = $2,
                  must_change_password = true,
                  temp_credential_expires_at = $3,
                  auth_version = auth_version + 1,
                  updated_at = NOW()
            WHERE employee_id = $4`,
          [ROLE_IDS.driver, hash, expiresAt, employeeId]
        );
        await revokeEmployeeSessions(tx, employeeId);
        await tx.query(
          `DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`,
          [employeeId]
        );
        return { email: current.email, firstName: current.first_name };
      });
      if (prepared.error) return err(prepared.error, prepared.status);

      try {
        await sendTempPasswordEmail({
          to: prepared.email,
          firstName: prepared.firstName,
          tempPassword,
          expiresAt,
        });
      } catch {
        await writeAudit(req, session, {
          action: "driver_invite_email_failed",
          resource: "driver_account",
          resourceId: Number(id),
          newValues: { employee_id: employeeId, email: prepared.email },
        });
        return err("The temporary password email failed. Resend the invite to try again.", 502);
      }

      await writeAudit(req, session, {
        action: "driver_login_invite",
        resource: "driver_account",
        resourceId: Number(id),
        newValues: { employee_id: employeeId, email: prepared.email, expires_at: expiresAt.toISOString() },
      });

      return ok({
        driver_id: Number(id),
        employee_id: employeeId,
        message: `Temporary password emailed to ${prepared.email}`,
        account: {
          employee_id: employeeId,
          email: prepared.email,
          role: "driver",
          has_password: true,
          must_change_password: true,
          temp_credential_expires_at: expiresAt,
        },
      });
    }

    const roleChanged = employee.role_name !== "driver";
    if (roleChanged) {
      await query(
        `UPDATE employees SET role_id = $1, auth_version = auth_version + 1, updated_at = NOW() WHERE employee_id = $2`,
        [ROLE_IDS.driver, employeeId]
      );
      await query(`UPDATE web_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE employee_id = $1 AND revoked_at IS NULL`, [employeeId]);
      await query(`UPDATE mobile_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE employee_id = $1 AND revoked_at IS NULL`, [employeeId]);
    }

    const hasNewPassword = Boolean(body.password && String(body.password).trim() !== "");
    if (hasNewPassword) {
      const hash = await bcrypt.hash(body.password, 10);
      await query(
        `UPDATE employees
            SET password_hash = $1,
                must_change_password = false,
                temp_credential_expires_at = NULL,
                auth_version = auth_version + 1,
                updated_at = NOW()
          WHERE employee_id = $2`,
        [hash, employeeId]
      );
      await query(`UPDATE web_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE employee_id = $1 AND revoked_at IS NULL`, [employeeId]);
      await query(`DELETE FROM mobile_refresh_tokens WHERE employee_id = $1`, [employeeId]);
      await query(`DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`, [employeeId]);
    }

    const { rows: after } = await query(
      `SELECT e.employee_id, e.email, e.password_hash, e.must_change_password,
              e.temp_credential_expires_at, r.role_name
         FROM employees e
         LEFT JOIN roles r ON r.role_id = e.role_id
        WHERE e.employee_id = $1
        LIMIT 1`,
      [employeeId]
    );
    const finalEmp = after[0];

    await writeAudit(req, session, {
      action: "update",
      resource: "driver_account",
      resourceId: Number(id),
      newValues: {
        employee_id: employeeId,
        role: finalEmp?.role_name,
        password_reset: hasNewPassword,
      },
    });

    return ok({
      driver_id: Number(id),
      employee_id: employeeId,
      account: {
        employee_id: employeeId,
        email: finalEmp?.email,
        role: finalEmp?.role_name ?? "driver",
        has_password: Boolean(finalEmp?.password_hash),
        must_change_password: Boolean(finalEmp?.must_change_password),
        temp_credential_expires_at: finalEmp?.temp_credential_expires_at ?? null,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
