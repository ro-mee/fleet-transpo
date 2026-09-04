import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";
import { haversineKm } from "@/lib/scheduling/travel-buffer";

// Assign a FLEET driver as the incident's responder. This is what turns the
// rescue from paperwork into something the system tracks itself: once
// assigned, the responder's phone GPS drives the response ladder
// (Dispatched → En Route → Arrived) and the ETA — see
// src/lib/incidents/responder-tracking.js. External help (ambulance, tow
// company) has no phone posting here and keeps the manual response form;
// clearing the assignment returns the incident to that manual mode.

export async function GET(req, props) {
  try {
    const session = await requirePermission(req, "incidents", "acknowledge");
    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    // Who could plausibly be sent: available drivers with a live account,
    // excluding the incident's own reporting driver. Minimal fields — this is
    // a picker, not the roster (GET /api/drivers needs drivers.read_all).
    // (driver_status has no 'Active' value — the CHECK constraint allows
    // Available/On Trip/Off Duty/On Leave/Suspended.)
    const { rows } = await query(
      `SELECT d.driver_id,
              e.first_name, e.last_name,
              d.driver_status,
              d.current_latitude, d.current_longitude,
              d.last_location_update,
              i.driver_id AS incident_driver_id,
              i.latitude AS incident_latitude, i.longitude AS incident_longitude
         FROM driverincidents i
         CROSS JOIN drivers d
         JOIN employees e ON e.employee_id = d.employee_id AND e.deleted_at IS NULL
        WHERE i.incident_id = $1 AND i.deleted_at IS NULL
          AND d.deleted_at IS NULL
          AND d.driver_status = 'Available'
          AND e.status = 'Active'
        ORDER BY e.first_name, e.last_name`,
      [id]
    );
    if (!rows.length) return err("Incident not found", 404);

    const incidentDriverId = rows[0].incident_driver_id;
    const incidentLat = rows[0].incident_latitude;
    const incidentLng = rows[0].incident_longitude;

    const drivers = rows
      .filter((r) => r.driver_id !== incidentDriverId)
      .map((r) => {
        const distanceKm =
          r.current_latitude != null && incidentLat != null
            ? haversineKm(
                [Number(r.current_latitude), Number(r.current_longitude)],
                [Number(incidentLat), Number(incidentLng)]
              )
            : null;
        return {
          driver_id: r.driver_id,
          name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
          driver_status: r.driver_status,
          distance_km: distanceKm != null ? Number(Number(distanceKm).toFixed(1)) : null,
          position_fresh:
            r.last_location_update != null &&
            Date.now() - new Date(r.last_location_update).getTime() < 5 * 60_000,
        };
      });

    return ok(drivers);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req, props) {
  try {
    const session = await requirePermission(req, "incidents", "acknowledge");
    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const parsedBody = await parseBody(req);
    const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {};
    const hasDriverId = body.driver_id !== undefined && body.driver_id !== null;
    const driverId = hasDriverId ? Number(body.driver_id) : null;
    if (hasDriverId && (!Number.isInteger(driverId) || driverId <= 0)) {
      return errValidation({ driver_id: "driver_id must be a positive integer or null" });
    }

    // Resolve the candidate before the transaction — cheap rejection.
    let candidate = null;
    if (driverId != null) {
      const { rows } = await query(
        `SELECT d.driver_id, e.employee_id, e.first_name, e.last_name
           FROM drivers d
           JOIN employees e ON e.employee_id = d.employee_id
          WHERE d.driver_id = $1 AND d.deleted_at IS NULL
            AND e.deleted_at IS NULL AND e.status = 'Active'
          LIMIT 1`,
        [driverId]
      );
      if (!rows[0]) return errValidation({ driver_id: "Driver not found or inactive" });
      candidate = rows[0];
    }

    const result = await withTransaction(async (tx) => {
      const current = await tx.query(
        `SELECT i.incident_id, i.status, i.driver_id, i.location,
                i.latitude, i.longitude, i.responder_driver_id, i.response_status,
                de.employee_id AS reporter_employee_id,
                de.first_name AS reporter_first_name, de.last_name AS reporter_last_name
           FROM driverincidents i
           LEFT JOIN drivers dd ON dd.driver_id = i.driver_id
           LEFT JOIN employees de ON de.employee_id = dd.employee_id
          WHERE i.incident_id = $1 AND i.deleted_at IS NULL
          FOR UPDATE OF i`,
        [id]
      );
      const row = current.rows[0];
      if (!row) return { notFound: true };
      if (row.status !== "Open") return { closed: true };
      if (candidate && candidate.driver_id === row.driver_id) {
        return { validationError: "The reporting driver cannot be their own responder" };
      }
      if (candidate && candidate.driver_id === row.responder_driver_id) return { unchanged: true };
      if (!candidate && row.responder_driver_id == null) return { unchanged: true };

      const { rows: updated } = await tx.query(
        // $2/$3 carry explicit ::int casts: a parameter reused across several
        // CASE WHEN arms can't be type-inferred by Postgres (42P08) — the same
        // quirk the SLA dedupe insert hit (see Capstone Incidents notes).
        `UPDATE driverincidents
            SET responder_driver_id = $2::int,
                responder_assigned_at = CASE WHEN $2::int IS NOT NULL THEN NOW() ELSE responder_assigned_at END,
                response_status = CASE
                  WHEN $2::int IS NOT NULL THEN 'Dispatched'
                  ELSE response_status
                END,
                response_type = CASE
                  WHEN $2::int IS NOT NULL AND (response_type IS NULL OR response_type = '') THEN 'Fleet Responder'
                  ELSE response_type
                END,
                responded_by = CASE WHEN $2::int IS NOT NULL THEN $3::int ELSE responded_by END,
                responded_at = CASE WHEN $2::int IS NOT NULL THEN NOW() ELSE responded_at END,
                updated_at = NOW()
          WHERE incident_id = $1 AND deleted_at IS NULL
          RETURNING responder_driver_id, responder_assigned_at, response_status, response_type`,
        [id, driverId, session.user.employeeId ?? null]
      );

      const responderName = candidate
        ? `${candidate.first_name || ""} ${candidate.last_name || ""}`.trim()
        : null;
      await tx.query(
        `INSERT INTO incident_comments (incident_id, user_id, action_type, comment_text)
         VALUES ($1, $2, $3, $4)`,
        [
          id,
          session.user.employeeId ?? null,
          "RESPONSE",
          candidate
            ? `Fleet responder assigned: ${responderName} — GPS tracking active (auto En Route / Arrived / ETA)`
            : "Fleet responder unassigned — manual response logging",
        ]
      );

      return {
        row: updated[0],
        responderName,
        responderEmployeeId: candidate?.employee_id ?? null,
        reporterEmployeeId: row.reporter_employee_id,
        reporterName: `${row.reporter_first_name || ""} ${row.reporter_last_name || ""}`.trim(),
        incidentLocation: row.location,
        latitude: row.latitude,
        longitude: row.longitude,
      };
    });

    if (result.notFound) return err("Incident not found", 404);
    if (result.closed) return err("A responder can only be assigned while the incident is open", 409);
    if (result.validationError) return errValidation({ driver_id: result.validationError });
    if (result.unchanged) return ok({ unchanged: true });

    // Best-effort notifications — a push failure must not fail the assignment.
    if (result.responderEmployeeId) {
      try {
        const whereText = result.incidentLocation ? ` at ${result.incidentLocation}` : "";
        const message = `You are responding to incident #${id} — driver ${result.reporterName || "(unknown)"}${whereText}. Open the incident for their live location and navigation.`;
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [result.responderEmployeeId, "You Are the Responder", message, "Alert", "incident", id]
        );
        await sendPush({
          employeeIds: [result.responderEmployeeId],
          title: "You Are the Responder",
          body: message,
          data: { reference_type: "incident", reference_id: Number(id) },
        });
      } catch (e) {
        console.warn("responder assignment notification failed:", e?.message || e);
      }
    }
    if (result.reporterEmployeeId && result.responderName) {
      try {
        const message = `Fleet responder ${result.responderName} has been dispatched to your location. Status and ETA will update automatically as they drive.`;
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [result.reporterEmployeeId, "Help Update", message, "Info", "incident", id]
        );
        await sendPush({
          employeeIds: [result.reporterEmployeeId],
          title: "Help Update",
          body: message,
          data: { reference_type: "incident", reference_id: Number(id) },
        });
      } catch (e) {
        console.warn("responder assignment driver notification failed:", e?.message || e);
      }
    }

    await writeAudit(req, session, {
      action: candidate ? "assign_responder" : "clear_responder",
      resource: "driverincidents",
      resourceId: id,
      oldValues: {},
      newValues: {
        responder_driver_id: result.row.responder_driver_id,
        response_status: result.row.response_status,
      },
    });

    return ok(result.row);
  } catch (e) {
    return handleError(e);
  }
}
