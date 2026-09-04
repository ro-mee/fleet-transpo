import { query, withTransaction } from "@/lib/db";
import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/driver/incidents/[id]/reopen
 *
 * The dispute half of the confirmation loop. Staff resolution is one-way in
 * the staff state machine, but a premature resolve (help still en route,
 * condition worsened) previously left the driver one option: a disconnected
 * duplicate report. This reopens their own incident with a reason, alerts the
 * overseers, and lets the normal acknowledge/resolve cycle run again.
 *
 * Dispute is only possible before the driver confirms the resolution —
 * confirmation is final so the loop cannot ping-pong forever.
 */
export async function POST(req, props) {
  try {
    const session = await requireDriver(req);
    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const parsedBody = await parseBody(req);
    const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {};
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 2000) {
      return errValidation({ reason: "Tell the fleet team what is still wrong (10–2000 characters)" });
    }

    const result = await withTransaction(async (tx) => {
      const current = await tx.query(
        `SELECT incident_id, incident_type, status, driver_confirmed_at
           FROM driverincidents
          WHERE incident_id = $1 AND driver_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [id, session.user.driverId]
      );
      if (!current.rows[0]) return { notFound: true };
      if (current.rows[0].status !== "Resolved") return { notResolved: true };
      if (current.rows[0].driver_confirmed_at) return { alreadyConfirmed: true };

      const { rows } = await tx.query(
        `UPDATE driverincidents
            SET status = 'Open', resolved_at = NULL, resolved_by = NULL,
                reopened_at = NOW(), updated_at = NOW()
          WHERE incident_id = $1 AND status = 'Resolved' AND driver_confirmed_at IS NULL
          RETURNING incident_id, status, resolved_at, reopened_at`,
        [id]
      );
      if (!rows[0]) return { notResolved: true };

      await tx.query(
        `INSERT INTO incident_comments (incident_id, user_id, action_type, comment_text)
         VALUES ($1, $2, $3, $4)`,
        [id, session.user.employeeId ?? null, "REOPENED", `Driver disputed the resolution: ${reason}`]
      );
      return { row: rows[0], incidentType: current.rows[0].incident_type };
    });

    if (result.notFound) return err("Incident not found", 404);
    if (result.notResolved) return err("Only a resolved incident can be disputed", 409);
    if (result.alreadyConfirmed) return err("This resolution was already confirmed and cannot be reopened", 409);

    await writeAudit(req, session, {
      action: "driver_reopen",
      resource: "driverincidents",
      resourceId: id,
      oldValues: { status: "Resolved" },
      newValues: { status: "Open", reason },
    });

    // Page the overseers: a driver disputing a resolution is an active safety
    // signal, not paperwork. Best-effort.
    try {
      const { rows: overseers } = await query(
        `SELECT e.employee_id
           FROM employees e
           JOIN roles r ON r.role_id = e.role_id
          WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`,
        [["system_admin", "fleet_manager", "admin"]]
      );
      const message = `Driver disputed the resolution of incident #${id} (${result.incidentType || "incident"}) and it has been reopened: ${reason.slice(0, 200)}`;
      for (const employee of overseers) {
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [employee.employee_id, "Incident Reopened by Driver", message, "Alert", "incident", id]
        );
      }
      if (overseers.length) {
        await sendPush({
          employeeIds: overseers.map((employee) => employee.employee_id),
          title: "Incident Reopened by Driver",
          body: message,
          data: { reference_type: "incident", reference_id: Number(id) },
        });
      }
    } catch (e) {
      console.warn("incident reopen notification failed:", e?.message || e);
    }

    return ok(result.row);
  } catch (e) {
    return handleError(e);
  }
}
