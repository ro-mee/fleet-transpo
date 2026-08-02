import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus, syncDispatchReservation } from "@/services/status.service";
import { writeAudit } from "@/lib/audit";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, findRequestForDispatch } from "@/services/reservation-lifecycle.service";

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "driver"]);
    const id = (await params).id;
    const body = await parseBody(req);
    const { rows: before } = await query(`SELECT vehicle_id, driver_id, dispatch_id, trip_status FROM trips WHERE trip_id = $1 LIMIT 1`, [id]);
    if (!before[0]) return err("Trip not found", 404);
    if (["Completed", "Cancelled"].includes(before[0].trip_status)) {
      return err(`Trip is already ${before[0].trip_status} and cannot be completed.`, 409);
    }
    const dist = body.end_odometer - (body.start_odometer || 0);
    const { rows } = await query(`UPDATE trips SET trip_status = 'Completed', end_time = NOW(), end_odometer = $1, distance = $2 WHERE trip_id = $3 RETURNING *`, [body.end_odometer, dist > 0 ? dist : body.distance, id]);
    if (!rows[0]) return err("Trip not found", 404);
    const p = [];
    if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id));
    if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id));
    if (before[0]?.dispatch_id) {
      p.push(query(`UPDATE dispatchschedules SET status = 'Completed' WHERE dispatch_id = $1`, [before[0].dispatch_id]));
      p.push(syncDispatchReservation(before[0].dispatch_id));
    }
    await Promise.all(p);
    await writeAudit(req, session, { action: "update", resource: "trips", resourceId: id, oldValues: { trip_status: before[0].trip_status }, newValues: { trip_status: "Completed" } });

    // A completed trip closes the Booking request. advanceReservation walks
    // In Progress→Completed, writing the timeline and notifying Booking.
    // Best-effort: the trip is already completed regardless of sync outcome.
    if (before[0]?.dispatch_id) {
      try {
        const request = await findRequestForDispatch(before[0].dispatch_id);
        if (request) {
          await advanceReservation({
            requestId: request.request_id,
            toStatus: L.COMPLETED,
            session,
            eventType: E.TRIP_COMPLETED,
            description: `Trip completed.`,
            metadata: {
              trip_id: rows[0]?.trip_id,
              dispatch_id: before[0].dispatch_id,
              end_odometer: rows[0]?.end_odometer ?? null,
              distance: rows[0]?.distance ?? null,
            },
          });
        }
      } catch (e) {
        console.warn("trip-complete -> request Completed sync failed:", e?.message || e);
      }
    }

    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
