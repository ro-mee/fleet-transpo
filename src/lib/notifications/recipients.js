import { query } from "@/lib/db";
import { rolesFor } from "@/lib/auth/permissions";
import { ROLES } from "@/lib/constants";

// Notification recipient resolution — the routing half of the locked contract:
//
//   RBAC:                who MAY access/perform something?  → rolesFor()
//   Notification routing: who NEEDS to know about this event? → notificationRolesFor()
//     → specific employee_ids → dedupe → per-user notification rows
//
// rolesFor() intentionally injects system_admin as a universal authorization
// bypass, so it must never be used directly as an operational recipient set:
// every staff broadcast would page the System Console. This module derives
// from it but strips non-operational roles, so a future MATRIX edit can only
// widen/narrow *authority* — fan-out stays an explicit notification decision.
//
// Locked audience policy:
// - system_admin: silent on routine fleet operations (system events only).
// - management: informational/observational only; never action-required alerts.

export const SILENT_ROLES = [ROLES.SYSTEM_ADMIN];
export const OBSERVER_ROLES = [ROLES.MANAGEMENT];

/**
 * Roles that should receive an event gated by (resource, action) authority,
 * minus roles that must never be paged for it. Pure — safe to unit-test.
 *
 * @param {string} resource permission resource, e.g. "incidents"
 * @param {string} action permission action, e.g. "read"
 * @param {object} [opts]
 * @param {string[]} [opts.exclude] extra roles to drop (default: system_admin)
 * @returns {string[]} role names
 */
export function notificationRolesFor(resource, action, opts = {}) {
  const exclude = new Set(opts.exclude || SILENT_ROLES);
  return rolesFor(resource, action).filter((role) => !exclude.has(role));
}

/**
 * Normalize a mixed recipient list to unique, positive integer employee ids,
 * preserving first-seen order. The same person qualifying through two paths
 * (e.g. overseer AND dispatcher) must yield exactly 1 notification, not 2.
 * Pure — safe to unit-test.
 */
export function dedupeEmployeeIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Resolve role names to active employee ids. Role-less, deleted, or missing
 * employees are never recipients (kills the orphan-row class at the source).
 */
export async function employeeIdsForRoles(roleNames) {
  if (!roleNames?.length) return [];
  const { rows } = await query(
    `SELECT e.employee_id
       FROM employees e
       JOIN roles r ON r.role_id = e.role_id
      WHERE r.role_name = ANY($1)
        AND e.deleted_at IS NULL
        AND e.role_id IS NOT NULL`,
    [roleNames]
  );
  return (rows || []).map((r) => r.employee_id);
}

/**
 * Full v1 resolver: union role-derived ids with explicit employee ids, then
 * dedupe. Every producer should end its recipient computation here so the
 * per-user fan-out invariant holds in one place.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.roles] role names to expand
 * @param {Array} [opts.employeeIds] explicit employee ids (owners, assignees)
 */
export async function resolveNotificationRecipients(opts = {}) {
  const fromRoles = await employeeIdsForRoles(opts.roles || []);
  return dedupeEmployeeIds([...fromRoles, ...(opts.employeeIds || [])]);
}
