import { query } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";

// Best-effort audit trail writer. Populates the audit_logs table
// (see supabase/migrations/001_schema.sql). NEVER throws and NEVER blocks the
// caller's main operation — a failed audit write is logged and swallowed.
//
// Usage in a route handler:
//   const session = await requireAuth(req, [...]);
//   ...perform mutation...
//   await writeAudit(req, session, {
//     action: "create", resource: "vehicles",
//     resourceId: newVehicle.vehicle_id, newValues: newVehicle,
//   });

/**
 * @param {Request} req      The incoming request (for IP + user-agent).
 * @param {object}  session  The session returned by requireAuth (may be null).
 * @param {object}  entry
 * @param {string}  entry.action      e.g. "create" | "update" | "delete" | "login"
 * @param {string}  entry.resource    logical resource name, e.g. "vehicles"
 * @param {number}  [entry.resourceId]
 * @param {object}  [entry.oldValues]
 * @param {object}  [entry.newValues]
 * @param {number}  [entry.employeeId] override actor (e.g. login before session exists)
 */
export async function writeAudit(req, session, entry = {}) {
  try {
    const { action, resource, resourceId, oldValues, newValues } = entry;
    if (!action || !resource) return;

    const employeeId = entry.employeeId ?? session?.user?.employeeId ?? null;
    const ip = req ? clientIp(req) : null;
    const userAgent = req?.headers?.get?.("user-agent") || null;

    await query(
      `INSERT INTO audit_logs
         (employee_id, action, resource, resource_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        employeeId,
        String(action).slice(0, 50),
        String(resource).slice(0, 100),
        resourceId != null ? Number(resourceId) || null : null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ip ? String(ip).slice(0, 50) : null,
        userAgent,
      ]
    );
  } catch (e) {
    // Never let auditing break the request it is recording.
    console.warn("writeAudit failed:", e?.message || e);
  }
}
