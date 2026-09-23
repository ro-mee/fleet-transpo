import bcrypt from "bcryptjs";
import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { revokeEmployeeSessions } from "@/lib/auth/sessions";
import { normalizeRoleName } from "@/lib/auth/role-names";
import { mintRotatedSession } from "@/lib/auth/session-rotation";

export async function POST(req) {
  try {
    const session = await requireAuth(req, "*");

    const body = await parseBody(req);
    const { currentPassword, newPassword } = body;
    const employeeId = session.user.employeeId;

    if (!newPassword) {
      return err("New password is required", 400);
    }

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`password-change:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`password-change:account:${employeeId}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    const { rows } = await query(
      `SELECT e.password_hash, e.must_change_password, e.email, e.first_name, e.last_name,
              e.position, e.status, e.auth_version, r.role_name
         FROM employees e
         LEFT JOIN roles r ON r.role_id = e.role_id
        WHERE e.employee_id = $1 AND e.deleted_at IS NULL AND e.status = 'Active'`,
      [employeeId]
    );

    const employee = rows?.[0];
    if (!employee) {
      return err("Account not found", 404);
    }

    // Two modes on one endpoint:
    //  - forced (must_change_password): the temporary password was already
    //    proven at login, so the CURRENT password is not re-asked here — the
    //    session gate only admits this path, and re-checking the temp secret
    //    would just be theatre. The flag is the authority.
    //  - voluntary (Settings): unchanged legacy behaviour — current password
    //    required, response carries signInRequired so the client signs out.
    const forced = employee.must_change_password === true;

    if (!forced) {
      if (!currentPassword || !newPassword) {
        return err("Current password and new password are required", 400);
      }
      const errors = validateBody(body, {
        currentPassword: { required: true, label: "Current password" },
        newPassword: { required: true, type: "password", label: "New password" },
      });
      if (!isValidObject(errors)) {
        return errValidation(errors);
      }
    } else {
      const errors = validateBody(body, {
        newPassword: { required: true, type: "password", label: "New password" },
      });
      if (!isValidObject(errors)) {
        return errValidation(errors);
      }
    }

    if (!employee.password_hash) {
      return err("Account not found", 404);
    }

    if (!forced) {
      if (currentPassword === newPassword) {
        return err("New password must be different from current password", 400);
      }
      const valid = await bcrypt.compare(currentPassword, employee.password_hash);
      if (!valid) {
        return err("Current password is incorrect", 403);
      }
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const changed = await withTransaction(async (tx) => {
      const { rows: updated } = await tx.query(
        `UPDATE employees
            SET password_hash = $1,
                auth_version = auth_version + 1,
                updated_at = NOW(),
                must_change_password = false,
                temp_credential_expires_at = NULL
          WHERE employee_id = $2
            AND password_hash = $3
            AND deleted_at IS NULL
            AND status = 'Active'
          RETURNING auth_version`,
        [hash, employeeId, employee.password_hash]
      );
      if (!updated.length) return null;
      await revokeEmployeeSessions(tx, employeeId);
      await tx.query(`DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`, [employeeId]);
      return updated[0];
    });
    if (!changed) return err("Password was changed already. Please sign in again.", 409);

    await writeAudit(req, session, {
      action: "password_change",
      resource: "employees",
      resourceId: employeeId,
      // Never the password or its hash — only the session semantics.
      newValues: { sessions_revoked: true, forced_initial_change: forced },
    });

    if (forced) {
      // Rotate-and-stay: the transaction above revoked every session including
      // this one, so the replacement cookie rides in THIS response. The token
      // carries mustChangePassword: false — the gate opens immediately.
      const { cookie } = await mintRotatedSession({
        employee: {
          employeeId,
          email: employee.email,
          firstName: employee.first_name,
          lastName: employee.last_name,
          position: employee.position,
          status: employee.status,
          role: normalizeRoleName(employee.role_name),
          authVersion: Number(changed.auth_version),
        },
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent") || null,
      });
      const response = ok({ message: "Password set successfully", mustChangePassword: false });
      response.headers.set("Set-Cookie", cookie);
      return response;
    }

    return ok({ message: "Password updated successfully", signInRequired: true });
  } catch (e) {
    return handleError(e);
  }
}
