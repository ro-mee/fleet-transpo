import { query } from "@/lib/db";
import { sendPush } from "@/services/push.service";

// SLA escalation for incidents nobody has answered.
//
// The severity SLA (Critical 2h / Major 24h / Moderate 72h / Minor 7d) is set
// as driverincidents.due_at at report time. When a Critical or Major incident
// is still Open AND unacknowledged past that deadline, the driver is waiting
// in the dark with no responder — this re-alerts the overseer roles once per
// incident. It runs lazily from the incidents registry summary fetch (no cron
// dependency); idempotency comes from the same NOT EXISTS notification dedupe
// pattern used by notifyMaintenanceTeam, so repeated dashboard loads never
// duplicate an escalation.

const ESCALATION_TITLE = "Incident SLA Breached — Unacknowledged";

/** Best-effort: never throws — the registry must load even when escalation fails. */
export async function escalateOverdueIncidents() {
  const { rows: overdue } = await query(
    `SELECT incident_id, incident_type, severity, driver_id
       FROM driverincidents
      WHERE status = 'Open'
        AND acknowledged_at IS NULL
        AND due_at IS NOT NULL
        AND due_at < NOW()
        AND severity IN ('Critical', 'Major')
        AND deleted_at IS NULL`
  );
  if (!overdue.length) return { escalated: 0 };

  const { rows: recipients } = await query(
    `SELECT e.employee_id
       FROM employees e
       JOIN roles r ON r.role_id = e.role_id
      WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`,
    [["system_admin", "fleet_manager", "admin"]]
  );
  if (!recipients.length) return { escalated: 0 };

  let escalated = 0;
  for (const incident of overdue) {
    const message = `Incident #${incident.incident_id} (${incident.incident_type}, ${incident.severity}) has passed its response SLA with no acknowledgement. The reporting driver is still waiting.`;
    const inserted = [];
    for (const recipient of recipients) {
      const { rows } = await query(
        // $2/$5 carry explicit ::varchar casts: Postgres deduces SELECT-list
        // parameters as text but the NOT EXISTS comparison as varchar, and the
        // 42P08 conflict makes the whole statement fail to parse.
        `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
         SELECT $1, $2::varchar, $3, $4, $5::varchar, $6
          WHERE NOT EXISTS (
            SELECT 1 FROM notifications
             WHERE employee_id = $1 AND title = $2::varchar
               AND reference_type = $5::varchar AND reference_id = $6
          )
         RETURNING employee_id`,
        [recipient.employee_id, ESCALATION_TITLE, message, "Alert", "incident", incident.incident_id]
      );
      if (rows[0]) inserted.push(recipient.employee_id);
    }
    if (inserted.length) {
      escalated += 1;
      try {
        await sendPush({
          employeeIds: inserted,
          title: ESCALATION_TITLE,
          body: message,
          data: { reference_type: "incident", reference_id: incident.incident_id },
        });
      } catch (e) {
        console.warn("sla escalation push failed:", e?.message || e);
      }
    }
  }
  return { escalated };
}
