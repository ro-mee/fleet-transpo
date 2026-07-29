import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ok, err, handleError } from "@/lib/api/utils";

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.employeeId) {
      return err("Unauthorized", 401);
    }

    const { currentPassword, newPassword } = await req.json();
    const employeeId = session.user.employeeId;

    if (!currentPassword || !newPassword) {
      return err("Current password and new password are required", 400);
    }

    if (newPassword.length < 6) {
      return err("New password must be at least 6 characters", 400);
    }

    if (currentPassword === newPassword) {
      return err("New password must be different from current password", 400);
    }

    const { rows } = await query(
      `SELECT password_hash FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`,
      [employeeId]
    );

    if (!rows?.[0]?.password_hash) {
      return err("Account not found", 404);
    }

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) {
      return err("Current password is incorrect", 403);
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE employees SET password_hash = $1 WHERE employee_id = $2`,
      [hash, employeeId]
    );

    return ok({ message: "Password updated successfully" });
  } catch (e) {
    return handleError(e);
  }
}
