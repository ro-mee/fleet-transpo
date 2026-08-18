import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

// Real push device-token registration. The mobile app registers one Expo push
// token per install on login; the push service reads the active tokens for the
// employees a notification targets and sends through Expo Push Service.
//
// RLS lets a user manage only their own tokens; this route mirrors that scope
// so the API boundary and the DB agree even for callers that bypass RLS.

const ALL_ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"];

export async function POST(req) {
  try {
    const session = await requireAuth(req, ALL_ROLES);
    const employeeId = session.user?.employeeId;
    if (employeeId == null) {
      return err("This account is not linked to an employee", 400);
    }

    const body = await parseBody(req);
    const errors = validateBody(body, {
      token: { required: true, maxLength: 250, label: "Device token" },
      platform: { maxLength: 20, label: "Platform" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    const platform = ["android", "ios", "web"].includes(body.platform) ? body.platform : "android";

    const { rows } = await query(
      `INSERT INTO device_tokens (employee_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE
         SET employee_id = EXCLUDED.employee_id,
             platform = EXCLUDED.platform,
             active = TRUE,
             last_seen_at = NOW()
       RETURNING *`,
      [employeeId, body.token, platform]
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req) {
  try {
    const session = await requireAuth(req, ALL_ROLES);
    const employeeId = session.user?.employeeId;
    if (employeeId == null) return ok({ removed: 0 });

    // Logout may send the token it registered so only that device is dropped;
    // without one, every token for the session's employee is deactivated.
    const body = await parseBody(req).catch(() => null);
    const token = body?.token;

    let removed;
    if (token) {
      const { rows } = await query(
        `UPDATE device_tokens SET active = FALSE
          WHERE employee_id = $1 AND token = $2 AND active = TRUE
         RETURNING device_token_id`,
        [employeeId, token]
      );
      removed = rows.length;
    } else {
      const { rows } = await query(
        `UPDATE device_tokens SET active = FALSE
          WHERE employee_id = $1 AND active = TRUE
         RETURNING device_token_id`,
        [employeeId]
      );
      removed = rows.length;
    }
    return ok({ removed });
  } catch (e) { return handleError(e); }
}