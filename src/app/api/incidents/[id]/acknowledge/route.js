import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";

/**
 * Explicitly acknowledge an open incident. Reading the registry never clears
 * the safety queue; only this action records that a responder took ownership.
 *
 * An optional `note` travels with the acknowledgement ("Tow truck dispatched,
 * ETA 20 minutes") — it is stored as an incident_comments row and pushed to
 * the driver, who otherwise has no way to know help is actually coming.
 */
export async function POST(req, props) {
  try {
    const session = await requirePermission(req, "incidents", "acknowledge");
    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const parsedBody = await parseBody(req);
    const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {};
    let note = null;
    if (body.note != null) {
      if (typeof body.note !== "string" || !body.note.trim()) {
        return errValidation({ note: "Response note must be non-empty text" });
      }
      note = body.note.trim().slice(0, 500);
    }

    const result = await withTransaction(async (tx) => {
      const current = await tx.query(
        `SELECT i.incident_id, i.status, i.acknowledged_at, i.acknowledged_by,
                e.employee_id AS reporter_employee_id
           FROM driverincidents i
           LEFT JOIN drivers d ON d.driver_id = i.driver_id
           LEFT JOIN employees e ON e.employee_id = d.employee_id
          WHERE i.incident_id = $1 AND i.deleted_at IS NULL
          FOR UPDATE OF i`,
        [id]
      );
      if (!current.rows[0]) return { notFound: true };
      if (current.rows[0].status === "Resolved" || current.rows[0].acknowledged_at) {
        return { row: current.rows[0], changed: false };
      }

      const { rows } = await tx.query(
        `UPDATE driverincidents
            SET acknowledged_at = NOW(),
                acknowledged_by = $2,
                updated_at = NOW()
          WHERE incident_id = $1 AND status = 'Open' AND acknowledged_at IS NULL
          RETURNING incident_id, status, acknowledged_at, acknowledged_by`,
        [id, session.user.employeeId ?? null]
      );
      if (!rows[0]) return { row: current.rows[0], changed: false };

      if (note) {
        await tx.query(
          `INSERT INTO incident_comments (incident_id, user_id, action_type, comment_text)
           VALUES ($1, $2, $3, $4)`,
          [id, session.user.employeeId ?? null, "ACKNOWLEDGED", note]
        );
      }
      return { row: rows[0], current: current.rows[0], changed: true };
    });

    if (result.notFound) return err("Incident not found", 404);
    if (!result.changed) return ok(result.row);

    await writeAudit(req, session, {
      action: "acknowledge",
      resource: "driverincidents",
      resourceId: id,
      oldValues: { acknowledged_at: null },
      newValues: { acknowledged_at: result.row.acknowledged_at, acknowledged_by: result.row.acknowledged_by, note },
    });

    if (result.current?.reporter_employee_id) {
      try {
        const base = `Your incident report (#${id}) has been acknowledged by the fleet team.`;
        const message = note ? `${base} ${note}` : base;
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [result.current.reporter_employee_id, "Incident Report Acknowledged", message, "Info", "incident", id]
        );
        await sendPush({
          employeeIds: [result.current.reporter_employee_id],
          title: "Incident Report Acknowledged",
          body: message,
          data: { reference_type: "incident", reference_id: Number(id) },
        });
      } catch (e) {
        console.warn("incident acknowledgement notification failed:", e?.message || e);
      }
    }

    return ok(result.row);
  } catch (e) {
    return handleError(e);
  }
}
