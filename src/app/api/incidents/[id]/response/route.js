import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";

// The physical side of incident response: what help was dispatched to the
// driver, when it is expected, and how far along it is. The acknowledge note
// says "we saw your report"; this records "an ambulance is coming, ETA 12:40,
// it has arrived". Every update lands in incident_comments and is pushed to
// the driver, whose status screen renders the ladder live.

const RESPONSE_STATUSES = ["Dispatched", "En Route", "Arrived"];
const STATUS_RANK = { Dispatched: 0, "En Route": 1, Arrived: 2 };

export async function POST(req, props) {
  try {
    const session = await requirePermission(req, "incidents", "acknowledge");
    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const parsedBody = await parseBody(req);
    const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {};

    const status = body.response_status;
    if (!RESPONSE_STATUSES.includes(status)) {
      return errValidation({ response_status: "Response status must be Dispatched, En Route, or Arrived" });
    }
    let responseType = null;
    if (body.response_type != null) {
      if (typeof body.response_type !== "string" || !body.response_type.trim()) {
        return errValidation({ response_type: "Response type must be non-empty text" });
      }
      responseType = body.response_type.trim().slice(0, 50);
    }
    let responseDetails = null;
    if (body.response_details != null) {
      if (typeof body.response_details !== "string") {
        return errValidation({ response_details: "Response details must be text" });
      }
      responseDetails = body.response_details.trim() ? body.response_details.trim().slice(0, 200) : null;
    }
    let etaMinutes = null;
    if (body.eta_minutes != null) {
      etaMinutes = Number(body.eta_minutes);
      if (!Number.isFinite(etaMinutes) || etaMinutes <= 0 || etaMinutes > 24 * 60) {
        return errValidation({ eta_minutes: "ETA must be between 1 and 1440 minutes" });
      }
    }

    const result = await withTransaction(async (tx) => {
      const current = await tx.query(
        `SELECT i.incident_id, i.status, i.response_status, i.response_type,
                e.employee_id AS reporter_employee_id
           FROM driverincidents i
           LEFT JOIN drivers d ON d.driver_id = i.driver_id
           LEFT JOIN employees e ON e.employee_id = d.employee_id
          WHERE i.incident_id = $1 AND i.deleted_at IS NULL
          FOR UPDATE OF i`,
        [id]
      );
      if (!current.rows[0]) return { notFound: true };
      if (current.rows[0].status !== "Open") {
        return { closed: true };
      }
      // Forward-only ladder: Dispatched → En Route → Arrived. Re-sending the
      // current status is fine (ETA/detail refresh); going backwards is not.
      const existingRank = current.rows[0].response_status ? STATUS_RANK[current.rows[0].response_status] : -1;
      if (STATUS_RANK[status] < existingRank) {
        return { backwards: true };
      }
      // First log must say what was sent; later updates inherit it if omitted.
      const finalType = responseType || current.rows[0].response_type;
      if (!finalType) return { missingType: true };

      const responseEta = etaMinutes != null ? new Date(Date.now() + etaMinutes * 60_000) : null;
      const { rows } = await tx.query(
        `UPDATE driverincidents
            SET response_status = $2,
                response_type = $3,
                response_details = COALESCE($4, response_details),
                response_eta = CASE WHEN $5::timestamptz IS NOT NULL THEN $5::timestamptz ELSE response_eta END,
                responded_at = NOW(),
                responded_by = $6,
                updated_at = NOW()
          WHERE incident_id = $1 AND deleted_at IS NULL
          RETURNING incident_id, status, response_status, response_type,
                    response_details, response_eta, responded_at, responded_by`,
        [id, status, finalType, responseDetails, responseEta, session.user.employeeId ?? null]
      );
      if (!rows[0]) return { notFound: true };

      const etaText = rows[0].response_eta
        ? ` — ETA ${new Date(rows[0].response_eta).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}`
        : "";
      const detailText = rows[0].response_details ? ` (${rows[0].response_details})` : "";
      await tx.query(
        `INSERT INTO incident_comments (incident_id, user_id, action_type, comment_text)
         VALUES ($1, $2, $3, $4)`,
        [
          id,
          session.user.employeeId ?? null,
          "RESPONSE",
          `${status} — ${rows[0].response_type}${detailText}${etaText}`,
        ]
      );
      return { row: rows[0], current: current.rows[0] };
    });

    if (result.notFound) return err("Incident not found", 404);
    if (result.closed) return err("Response can only be logged while the incident is open", 409);
    if (result.backwards) return err("Response status cannot move backwards", 409);
    if (result.missingType) return errValidation({ response_type: "Response type is required on the first dispatch log" });

    await writeAudit(req, session, {
      action: "response_update",
      resource: "driverincidents",
      resourceId: id,
      oldValues: { response_status: result.current.response_status },
      newValues: {
        response_status: result.row.response_status,
        response_type: result.row.response_type,
        response_eta: result.row.response_eta,
      },
    });

    if (result.current.reporter_employee_id) {
      try {
        const etaText = result.row.response_eta
          ? ` — ETA ${new Date(result.row.response_eta).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}`
          : "";
        const message =
          result.row.response_status === "Arrived"
            ? `Help has arrived: ${result.row.response_type}.`
            : `${result.row.response_type} ${result.row.response_status.toLowerCase()} for your incident report (#${id})${etaText}.`;
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [result.current.reporter_employee_id, "Help Update", message, "Info", "incident", id]
        );
        await sendPush({
          employeeIds: [result.current.reporter_employee_id],
          title: "Help Update",
          body: message,
          data: { reference_type: "incident", reference_id: Number(id) },
        });
      } catch (e) {
        console.warn("incident response notification failed:", e?.message || e);
      }
    }

    return ok(result.row);
  } catch (e) {
    return handleError(e);
  }
}
