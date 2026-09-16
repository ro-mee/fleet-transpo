import { writeAudit } from "@/lib/audit";

export const SECURITY_ALERT_TYPES = ["account_locked", "token_replay"];

/**
 * Ring the alarm: a security-relevant event the admin must see. Writes a
 * `security_alert` audit row (surfaced by GET /api/system/security-alerts).
 * Never throws; details must be metadata only (channel, reason, counts).
 */
export async function raiseSecurityAlert(req, { type, employeeId = null, details = {} } = {}) {
  if (!SECURITY_ALERT_TYPES.includes(type)) return;
  await writeAudit(req, null, {
    action: "security_alert",
    resource: "authentication",
    resourceId: employeeId,
    newValues: { type, ...details },
  });
}
