import { query } from "@/lib/db";
import { sendPush } from "@/services/push.service";
import { notificationRolesFor } from "@/lib/notifications/recipients";
import { fuelDiagnosticFiled } from "@/lib/notifications/copy";

// Notify only the roles that own the maintenance queue. Failure is
// best-effort: the caller (POST /api/vehicle-maintenance) catches and logs.
//
// Mirrors notifyMaintenanceTeam in src/lib/incidents/maintenance.js and
// src/lib/inspections/maintenance.js, deliberately: the same audience that
// triages incident- and inspection-sourced work orders triages a
// fuel-sourced one. Reused rather than added to the RBAC matrix as a new
// resource — "who NEEDS to know" is not "who MAY act" (see recipients.js).
//
// Dedupe follows the same INSERT … WHERE NOT EXISTS pattern on
// (employee_id, title, reference_type, reference_id) with a fuel-specific
// stable title, so a retry never double-pages while a genuinely second
// filing (new work order id) still notifies.
export async function notifyFuelDiagnosticTeam(workOrder, { plate } = {}) {
  if (!workOrder?.maintenance_id) return { notified: [] };
  const { rows: recipients } = await query(
    `SELECT e.employee_id
       FROM employees e
       JOIN roles r ON r.role_id = e.role_id
      WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL AND e.role_id IS NOT NULL`,
    [notificationRolesFor("incidents", "route_to_maintenance")]
  );
  if (!recipients.length) return { notified: [] };

  const copy = fuelDiagnosticFiled({ plate, workOrderId: workOrder.maintenance_id });
  const inserted = [];
  for (const recipient of recipients) {
    const { rows } = await query(
      // $2/$5 carry explicit ::varchar casts: Postgres deduces SELECT-list
      // parameters as text but the NOT EXISTS comparison as varchar, and the
      // 42P08 conflict fails the whole statement at parse time. Without the
      // casts this notifier would fail silently on every call (best-effort).
      `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
       SELECT $1, $2::varchar, $3, $4, $5::varchar, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications
           WHERE employee_id = $1 AND title = $2::varchar
             AND reference_type = $5::varchar AND reference_id = $6
        )
       RETURNING employee_id`,
      [recipient.employee_id, copy.title, copy.message, "Alert", "fuel_diagnostic", workOrder.maintenance_id]
    );
    if (rows[0]) inserted.push(recipient.employee_id);
  }
  if (inserted.length) {
    await sendPush({
      employeeIds: inserted,
      title: copy.title,
      body: copy.pushBody,
      data: { reference_type: "fuel_diagnostic", reference_id: workOrder.maintenance_id },
    });
  }
  return { notified: inserted };
}
