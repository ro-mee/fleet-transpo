import { checkVehicleLoadCompatibility, vehicleLoadCompatibilityMessage } from '@/lib/trips/vehicle-load-compatibility';
import { requirePermission, parseBody, ok, err, handleError, AuthError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { query } from "@/lib/db";
import { setTripStatus } from "@/services/transition.service";
import { cancelTrip } from "@/services/trip-lifecycle.service";
import { TRIP_STATUS } from "@/lib/constants";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";

// Accept or decline a dispatched trip. Accepting moves Assigned → Driver
// Accepted. Declining transitions to Cancelled (trips have no "Rejected" state).
// Legacy ingest statuses (Pending/Approved/…/Dispatched) are bridged through
// Assigned first, mirroring the state machine.
export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "update");
    const id = (await params).id;
    const body = await parseBody(req);
    if (typeof body.accept !== "boolean") {
      return err("accept field is required and must be true or false", 400);
    }
    await assertTripOwnership(session, id);

    if (body.accept) {
      const { rows: before } = await query(
        `SELECT trip_status FROM trips WHERE trip_id = $1 LIMIT 1`,
        [id]
      );
      const from = before[0]?.trip_status;
      if (!from) return err("Trip not found", 404);

      const beforeWrite = async db => {
        const { rows: assignmentRows } = await db.query(
          `SELECT d.driver_type, tr.load_type, v.operational_use
             FROM trips t
             LEFT JOIN LATERAL (
               SELECT ds.request_id FROM dispatchschedules ds
                WHERE ds.dispatch_id = t.dispatch_id AND ds.deleted_at IS NULL FOR SHARE
             ) ds ON TRUE
             LEFT JOIN LATERAL (
               SELECT tr.load_type FROM transportation_requests tr
                WHERE tr.request_id = ds.request_id AND tr.deleted_at IS NULL FOR SHARE
             ) tr ON TRUE
             LEFT JOIN LATERAL (
               SELECT v.operational_use FROM vehicles v
                WHERE v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL FOR SHARE
             ) v ON TRUE
             LEFT JOIN LATERAL (
               SELECT d.driver_type FROM drivers d
                WHERE d.driver_id = t.driver_id AND d.deleted_at IS NULL FOR SHARE
             ) d ON TRUE
            WHERE t.trip_id = $1 AND t.deleted_at IS NULL
            FOR UPDATE OF t`, [id]
        );
        const compatibility = checkVehicleLoadCompatibility({
          driverType: assignmentRows[0]?.driver_type,
          loadType: assignmentRows[0]?.load_type,
          operationalUse: assignmentRows[0]?.operational_use,
        });
        if (!compatibility.ok) throw new AuthError(vehicleLoadCompatibilityMessage(compatibility.reason), 409);
      };
      // Bridge legacy ingest statuses through Assigned into the live chain.
      if (from !== TRIP_STATUS.ASSIGNED && canTransitionTrip(from, TRIP_STATUS.ASSIGNED).ok) {
        await setTripStatus({ tripId: id, to: TRIP_STATUS.ASSIGNED, session, beforeWrite });
      }
      return ok(await setTripStatus({ tripId: id, to: TRIP_STATUS.DRIVER_ACCEPTED, session, beforeWrite }));
    }
    return ok(await cancelTrip(id, session, { reason: body.reason }));
  } catch (e) { return handleError(e); }
}
