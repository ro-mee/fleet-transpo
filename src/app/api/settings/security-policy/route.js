import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { getSecurityPolicy, saveSecurityPolicy } from "@/services/security-policy.service";
import { SECURITY_POLICY_KEYS, validateSecurityPolicy } from "@/lib/security-policy";
import { writeAudit } from "@/lib/audit";

const ALLOWED_KEYS = new Set(SECURITY_POLICY_KEYS);

/**
 * GET /api/settings/security-policy
 *
 * Reads the stored security & session policy: idle timeout, absolute session
 * lifetime, lockout, temporary-password and trusted-device lifetimes, and the
 * new-device lookback. The per-field labels and ranges are NOT echoed back —
 * the form reads them from src/lib/security-policy.js, which is the module both
 * sides already import, so a second copy over the wire would be a second place
 * for them to drift.
 *
 * Guarded by `system`, which only super_admin holds — the same resource that
 * guards the connector configuration. This is deliberate rather than riding on
 * `settings`: knowing the configured lockout threshold and idle window is not
 * the same privilege as editing operational settings, and the matrix keeps the
 * two apart (see rolesFor("system", "read") in src/lib/auth/permissions.js).
 */
export async function GET(req) {
  try {
    await requirePermission(req, "system", "read");
    return ok(await getSecurityPolicy());
  } catch (e) {
    return handleError(e);
  }
}

/**
 * PUT /api/settings/security-policy
 *
 * Saves a partial edit. Unknown keys are dropped rather than rejected so the
 * form cannot smuggle a field past the server by renaming it, and only the
 * fields present are validated, so editing the lockout threshold does not
 * require restating the idle timeout.
 *
 * Validation runs against the MERGED candidate — the incoming fields layered
 * over the stored policy — because the cross-field rule (absolute lifetime must
 * exceed the idle window) is only meaningful once both sides are known. A
 * violation is a 400, not a silent repair, so the admin who typed it finds out.
 *
 * Saved changes take effect on sessions created AFTER the save; existing
 * sessions keep the idle window written on their own row.
 */
export async function PUT(req) {
  try {
    const session = await requirePermission(req, "system", "update");
    const body = await parseBody(req);

    const candidate = { ...body };
    for (const key of Object.keys(candidate)) {
      if (!ALLOWED_KEYS.has(key)) delete candidate[key];
    }

    const before = await getSecurityPolicy();
    const check = validateSecurityPolicy({ ...before, ...candidate });
    if (!check.ok) return err(check.error, 400);

    const saved = await saveSecurityPolicy(candidate, session.user?.employeeId ?? null);

    await writeAudit(req, session, {
      action: "update",
      resource: "security_policy",
      oldValues: before,
      newValues: saved,
    });

    return ok(saved);
  } catch (e) {
    return handleError(e);
  }
}
