import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { ok, err, handleError } from "@/lib/api/utils";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  hashToken,
  signAccessToken,
  signRefreshToken,
} from "@/lib/auth/mobile-token";

/**
 * POST /api/mobile/auth/login
 *
 * The native client cannot hold the httpOnly NextAuth cookie, so it exchanges
 * credentials for a token pair here. Credential checking mirrors the Credentials
 * provider in src/lib/auth.js; only the session mechanism differs.
 *
 * This MVP is driver-only, so non-driver accounts are rejected rather than
 * issued a token they have no screens for.
 */
export async function POST(req) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return err("Email and password are required", 400);
    }

    const { rows } = await query(
      `SELECT e.employee_id,
              e.email,
              e.password_hash,
              e.first_name,
              e.last_name,
              e.phone,
              r.role_name,
              d.driver_id,
              d.driver_status,
              d.license_number
         FROM employees e
         LEFT JOIN roles r   ON r.role_id = e.role_id
         LEFT JOIN drivers d ON d.employee_id = e.employee_id
                            AND d.deleted_at IS NULL
        WHERE e.email = $1
          AND e.deleted_at IS NULL
        LIMIT 1`,
      [email.toLowerCase()]
    );

    const employee = rows[0];

    // Same response for unknown email and wrong password, so the endpoint
    // cannot be used to enumerate accounts.
    if (!employee?.password_hash) {
      return err("Invalid email or password", 401);
    }
    const valid = await bcrypt.compare(password, employee.password_hash);
    if (!valid) {
      return err("Invalid email or password", 401);
    }

    if (employee.role_name !== "driver") {
      return err("This app is for drivers only", 403);
    }
    if (!employee.driver_id) {
      return err("No driver record is linked to this account", 403);
    }

    const accessToken = await signAccessToken({
      employeeId: employee.employee_id,
      role: employee.role_name,
      driverId: employee.driver_id,
    });
    const { token: refreshToken } = await signRefreshToken({
      employeeId: employee.employee_id,
    });

    await query(
      `INSERT INTO mobile_refresh_tokens (employee_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' seconds')::INTERVAL)`,
      [employee.employee_id, hashToken(refreshToken), REFRESH_TOKEN_TTL_SECONDS]
    );

    return ok({
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      driver: {
        driverId: employee.driver_id,
        employeeId: employee.employee_id,
        email: employee.email,
        firstName: employee.first_name,
        lastName: employee.last_name,
        phone: employee.phone,
        status: employee.driver_status,
        licenseNumber: employee.license_number,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
