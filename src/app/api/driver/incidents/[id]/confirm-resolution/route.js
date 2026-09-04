import { query, withTransaction } from "@/lib/db";
import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";

/**
 * POST /api/driver/incidents/[id]/confirm-resolution
 *
 * The soft close of the confirmation loop: staff resolve (their call stands
 * immediately — driver silence never blocks closure), and the driver — the
 * only person who knows whether help actually arrived — can then confirm.
 * Confirmation is final; until it happens the driver may instead dispute via
 * the reopen endpoint.
 */
export async function POST(req, props) {
  try {
    const session = await requireDriver(req);
    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const result = await withTransaction(async (tx) => {
      const current = await tx.query(
        `SELECT incident_id, status, driver_confirmed_at
           FROM driverincidents
          WHERE incident_id = $1 AND driver_id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [id, session.user.driverId]
      );
      if (!current.rows[0]) return { notFound: true };
      if (current.rows[0].status !== "Resolved") return { notResolved: true };
      if (current.rows[0].driver_confirmed_at) return { row: current.rows[0], changed: false };

      const { rows } = await tx.query(
        `UPDATE driverincidents
            SET driver_confirmed_at = NOW(), updated_at = NOW()
          WHERE incident_id = $1 AND driver_confirmed_at IS NULL
          RETURNING incident_id, status, driver_confirmed_at`,
        [id]
      );
      if (!rows[0]) return { row: current.rows[0], changed: false };

      await tx.query(
        `INSERT INTO incident_comments (incident_id, user_id, action_type, comment_text)
         VALUES ($1, $2, $3, $4)`,
        [id, session.user.employeeId ?? null, "DRIVER_CONFIRMED", "Driver confirmed the resolution — they are safe."]
      );
      return { row: rows[0], changed: true };
    });

    if (result.notFound) return err("Incident not found", 404);
    if (result.notResolved) return err("Only a resolved incident can be confirmed", 409);

    if (result.changed) {
      await writeAudit(req, session, {
        action: "driver_confirm_resolution",
        resource: "driverincidents",
        resourceId: id,
        oldValues: { driver_confirmed_at: null },
        newValues: { driver_confirmed_at: result.row.driver_confirmed_at },
      });
    }
    return ok(result.row);
  } catch (e) {
    return handleError(e);
  }
}
