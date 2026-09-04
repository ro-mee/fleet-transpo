import { query, withTransaction } from "@/lib/db";
import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";

const OVERSEER_ROLES = ["system_admin", "fleet_manager", "admin"];

/**
 * POST /api/driver/responder/arrived
 *
 * Manual fallback for the assigned responder when their GPS is flaky: advances
 * the response to 'Arrived' through the same comment/audit/notification path
 * the automatic tracker uses. The stranded driver is told help has arrived
 * and the overseers are paged to take over resolution.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const driverId = session.user.driverId;
    const employeeId = session.user.employeeId ?? null;

    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT i.incident_id, i.status, i.response_status,
                re.employee_id AS responder_employee_id,
                de.employee_id AS reporter_employee_id,
                re.first_name AS responder_first_name,
                re.last_name AS responder_last_name
           FROM driverincidents i
           JOIN drivers rd ON rd.driver_id = i.responder_driver_id
           JOIN employees re ON re.employee_id = rd.employee_id
           LEFT JOIN drivers dd ON dd.driver_id = i.driver_id
           LEFT JOIN employees de ON de.employee_id = dd.employee_id
          WHERE i.responder_driver_id = $1
            AND i.status = 'Open'
            AND i.deleted_at IS NULL
          ORDER BY i.responder_assigned_at DESC NULLS LAST
          LIMIT 1
          FOR UPDATE OF i`,
        [driverId]
      );
      const row = rows[0];
      if (!row) return { notFound: true };
      if (row.response_status === "Arrived") return { unchanged: true, incidentId: row.incident_id };

      const { rows: updated } = await tx.query(
        `UPDATE driverincidents
            SET response_status = 'Arrived', responded_at = NOW(), updated_at = NOW()
          WHERE incident_id = $1 AND deleted_at IS NULL
          RETURNING response_status`,
        [row.incident_id]
      );

      const responderName =
        `${row.responder_first_name || ""} ${row.responder_last_name || ""}`.trim() || "Fleet responder";
      await tx.query(
        `INSERT INTO incident_comments (incident_id, user_id, action_type, comment_text)
         VALUES ($1, $2, $3, $4)`,
        [row.incident_id, employeeId, "RESPONSE", `Arrived — ${responderName} (manual — responder confirmed on device)`]
      );

      return {
        incidentId: row.incident_id,
        previousStatus: row.response_status,
        responseStatus: updated[0].response_status,
        responderName,
        responderEmployeeId: row.responder_employee_id,
        reporterEmployeeId: row.reporter_employee_id,
      };
    });

    if (result.notFound) return err("No open responder assignment for this driver", 404);
    if (result.unchanged) return ok({ unchanged: true, incident_id: result.incidentId });

    // Mirrors evaluateResponder's Arrived notifications, after commit and
    // best-effort — the status write is what matters.
    if (result.reporterEmployeeId) {
      try {
        const message = `Help has arrived: ${result.responderName}.`;
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [result.reporterEmployeeId, "Help Update", message, "Info", "incident", result.incidentId]
        );
        await sendPush({
          employeeIds: [result.reporterEmployeeId],
          title: "Help Update",
          body: message,
          data: { reference_type: "incident", reference_id: Number(result.incidentId) },
        });
      } catch (e) {
        console.warn("responder arrived driver notification failed:", e?.message || e);
      }
    }
    try {
      const { rows: overseers } = await query(
        `SELECT e.employee_id
           FROM employees e
           JOIN roles r ON r.role_id = e.role_id
          WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`,
        [OVERSEER_ROLES]
      );
      const message = `${result.responderName} has reached the driver — incident #${result.incidentId} (responder confirmed on device). The incident is still open and awaiting resolution.`;
      for (const employee of overseers) {
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [employee.employee_id, "Responder On Scene", message, "Alert", "incident", result.incidentId]
        );
      }
      if (overseers.length) {
        await sendPush({
          employeeIds: overseers.map((employee) => employee.employee_id),
          title: "Responder On Scene",
          body: message,
          data: { reference_type: "incident", reference_id: Number(result.incidentId) },
        });
      }
    } catch (e) {
      console.warn("responder arrived overseer notification failed:", e?.message || e);
    }

    await writeAudit(req, session, {
      action: "responder_arrived_manual",
      resource: "driverincidents",
      resourceId: String(result.incidentId),
      oldValues: { response_status: result.previousStatus },
      newValues: { response_status: result.responseStatus },
    });

    return ok({ arrived: true, incident_id: result.incidentId, response_status: result.responseStatus });
  } catch (e) {
    return handleError(e);
  }
}
