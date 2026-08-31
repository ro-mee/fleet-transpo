import { query, getAdminClient } from "@/lib/db";
import { setDispatchStatus } from "@/services/transition.service";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";

const STAFF_ROLES = ["system_admin", "fleet_manager", "dispatcher", "management", "admin"];

async function staffRecipients() {
  const { rows } = await query(
    `SELECT e.employee_id
       FROM employees e
       JOIN roles r ON r.role_id = e.role_id
      WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`,
    [STAFF_ROLES]
  );
  return rows || [];
}

async function notificationExists(referenceType, referenceId, title, employeeId) {
  const { rows } = await query(
    `SELECT 1
       FROM notifications
      WHERE reference_type = $1 AND reference_id = $2 AND title = $3
        AND employee_id = $4
      LIMIT 1`,
    [referenceType, referenceId, title, employeeId]
  );
  return rows.length > 0;
}

async function insertNotifications(rows) {
  const inserted = [];
  for (const notification of rows) {
    if (await notificationExists(notification.reference_type, notification.reference_id, notification.title, notification.employee_id)) continue;
    await query(
      `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [notification.employee_id, notification.title, notification.message, notification.type, notification.reference_type, notification.reference_id]
    );
    inserted.push(notification);
  }
  return inserted;
}

/**
 * Apply the safety side effects for an incident. Every write is idempotent:
 * vehicle grounding is an upsert-like status set, dispatches are selected only
 * while active, and notifications are checked by their reference/title.
 */
export async function groundIncident({ incident, session, req = null }) {
  if (!incident?.incident_id || !incident.vehicle_id) return { dispatches: [] };

  const supabase = getAdminClient();
  const vehicleId = incident.vehicle_id;
  const { error: vehicleError } = await supabase
    .from("vehicles")
    .update({ vehicle_status: "Under Maintenance" })
    .eq("vehicle_id", vehicleId)
    .is("deleted_at", null);
  if (vehicleError) throw vehicleError;

  const recipients = await staffRecipients();
  const { data: vehicle, error: vehicleReadError } = await supabase
    .from("vehicles")
    .select("plate_number")
    .eq("vehicle_id", vehicleId)
    .maybeSingle();
  if (vehicleReadError) throw vehicleReadError;

  const vehicleTitle = "Vehicle Taken Out of Service";
  if (recipients.length) {
    const vehicleMessage = `Driver reported incident #${incident.incident_id} — vehicle ${vehicle?.plate_number || `#${vehicleId}`} taken out of service.`;
    const rows = recipients.map((employee) => ({
      employee_id: employee.employee_id,
      title: vehicleTitle,
      message: vehicleMessage,
      type: "Alert",
      reference_type: "incident",
      reference_id: incident.incident_id,
    }));
    const inserted = await insertNotifications(rows);
    if (inserted.length) await sendPush({
      employeeIds: inserted.map((employee) => employee.employee_id),
      title: vehicleTitle,
      body: vehicleMessage,
      data: { reference_type: "incident", reference_id: incident.incident_id },
    });
  }

  const interval = incident.severity === "Major" || incident.severity === "Critical" ? "48 hours" : "2 hours";
  const activeDispatches = await query(
    `SELECT ds.dispatch_id, ds.dispatch_number, r.guest_name
       FROM dispatchschedules ds
       LEFT JOIN transportation_requests r ON r.request_id = ds.request_id
      WHERE ds.vehicle_id = $1
        AND ds.status IN ('Scheduled', 'In Progress')
        AND ds.deleted_at IS NULL
        AND (ds.status = 'In Progress' OR ds.scheduled_departure <= NOW() + $2::interval)`,
    [vehicleId, interval]
  );

  for (const dispatch of activeDispatches.rows || []) {
    await setDispatchStatus({
      dispatchId: dispatch.dispatch_id,
      to: "Pending Reassignment",
      session,
      reason: `Incident #${incident.incident_id} grounded the vehicle.`,
    });

    const title = "🚨 URGENT: Active Dispatch Interrupted";
    if (recipients.length) {
      const guestName = dispatch.guest_name || "Unknown Guest";
      const message = `Vehicle ${vehicle?.plate_number || `#${vehicleId}`} had an incident while assigned to guest ${guestName} (Dispatch #${dispatch.dispatch_number}). Vehicle has been unassigned. Reassign immediately!`;
      const rows = recipients.map((employee) => ({
        employee_id: employee.employee_id,
        title,
        message,
        type: "Alert",
        reference_type: "dispatch",
        reference_id: dispatch.dispatch_id,
      }));
      const inserted = await insertNotifications(rows);
      if (inserted.length) await sendPush({
        employeeIds: inserted.map((employee) => employee.employee_id),
        title,
        body: message,
        data: { reference_type: "dispatch", reference_id: dispatch.dispatch_id },
      });
    }
  }

  // Dispatch teardown can reconcile the vehicle back to Available; assert the
  // safety state again after all dispatch transitions have completed.
  const { error: reassertError } = await supabase
    .from("vehicles")
    .update({ vehicle_status: "Under Maintenance" })
    .eq("vehicle_id", vehicleId)
    .is("deleted_at", null);
  if (reassertError) throw reassertError;

  await query(
    `UPDATE driverincidents
        SET grounding_status = 'Complete',
            grounding_completed_at = NOW(),
            grounding_error = NULL,
            updated_at = NOW()
      WHERE incident_id = $1 AND deleted_at IS NULL`,
    [incident.incident_id]
  );
  await writeAudit(req, session, {
    action: "ground",
    resource: "driverincidents",
    resourceId: incident.incident_id,
    newValues: { grounding_status: "Complete", dispatch_count: (activeDispatches.rows || []).length },
  });

  return { dispatches: activeDispatches.rows || [] };
}
