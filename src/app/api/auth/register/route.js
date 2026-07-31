import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { ok, handleError } from "@/lib/api/utils";

export async function POST(req) {
  try {
    const { email, password, first_name, last_name, role_id } = await req.json();

    if (!email || !password || !first_name || !last_name) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const lowerEmail = email.toLowerCase();
    const hash = await bcrypt.hash(password, 10);

    const existing = await query(
      `SELECT employee_id FROM employees WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [lowerEmail]
    );

    if (existing.rows?.length > 0) {
      await query(
        `UPDATE employees SET password_hash = $1, first_name = $2, last_name = $3 WHERE email = $4`,
        [hash, first_name, last_name, lowerEmail]
      );
    } else {
      await query(
        `INSERT INTO employees (email, password_hash, first_name, last_name, role_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [lowerEmail, hash, first_name, last_name, role_id || 8]
      );
    }

    return ok({ message: "Account created" });
  } catch (e) {
    return handleError(e);
  }
}
