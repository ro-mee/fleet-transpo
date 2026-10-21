import { checkVehicleLoadCompatibility, vehicleLoadCompatibilityMessage } from '@/lib/trips/vehicle-load-compatibility';
import { assertCargoCheckpoint, prepareCargoLifecycle } from '@/services/cargo-execution.service';
import { query, withTransaction } from "@/lib/db";

import { requireDriver, parseBody, ok, err, handleError, AuthError } from "@/lib/api/utils";

import { assertTripOwnership } from "@/lib/api/ownership";
import { assertGenericOdometerWriteAllowed } from '@/lib/trips/odometer-gate';

import { canTransitionTrip } from "@/lib/scheduling/trip-state";

import { TRIP_STATUS } from "@/lib/constants";

import { tripDriverTypeMismatch } from "@/lib/drivers/trip-type-gate";



/**

 * PUT /api/mobile/driver/trips/[id]/accept

 *

 * Accept or decline a dispatched trip. A driver may only act on trips assigned

 * to them, and only when the trip is in a pre-acceptance state.

 *

 * Body: { accept: true | false }

 *

 * Accepting transitions to "Driver Accepted". Declining transitions to

 * "Cancelled" ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â trips have no "Rejected" state per the chk_trip_status

 * constraint in 012_status_constraints.sql.

 *

 * The state machine (canTransitionTrip) is the single authority: accept is only

 * legal from Assigned. Legacy ingest statuses (Pending/Approved/ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦/Dispatched)

 * are bridged through Assigned first, then advance to "Driver Accepted".

 */



export async function PUT(req, { params }) {

  try {

    const session = await requireDriver(req);

    const id = (await params).id;

    const body = await parseBody(req);



    if (typeof body.accept !== "boolean") {

      return err("accept field is required and must be true or false", 400);

    }



    const trip = await assertTripOwnership(session, id);

    let current = trip.trip_status;

    const target = body.accept ? TRIP_STATUS.DRIVER_ACCEPTED : TRIP_STATUS.CANCELLED;



    // Static classification gate on accept (declines always pass): accepting

    // a mismatched pair would put the wrong driver type on the road. The

    // service resolves from the stored dispatch chain, never caller input.

    if (body.accept) {

      const mismatch = await tripDriverTypeMismatch({ query }, { driverId: trip.driver_id, dispatchId: trip.dispatch_id });

      if (mismatch) return err(mismatch.message, 409);

    }



    const writeAcceptance = async db => {

      if (body.accept) {

        await prepareCargoLifecycle(db);

        const { rows: assignmentRows } = await db.query(

          `SELECT t.trip_status, t.odometer_capture_required, d.driver_type, tr.load_type, v.operational_use

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

        const lockedTrip = assignmentRows[0];
        if (!lockedTrip) throw new AuthError('Trip not found', 404);
        assertGenericOdometerWriteAllowed({ before: lockedTrip, patch: { trip_status: target } });
        current = lockedTrip.trip_status;
        const compatibility = checkVehicleLoadCompatibility({

          driverType: assignmentRows[0]?.driver_type,

          loadType: assignmentRows[0]?.load_type,

          operationalUse: assignmentRows[0]?.operational_use,

        });

        if (!compatibility.ok) throw new AuthError(vehicleLoadCompatibilityMessage(compatibility.reason), 409);

        // Cargo authority mirrors desktop accept: setTripStatus runs this
        // same checkpoint after this same compatibility block. Unconfigured
        // Cargo authority stays 503, missing linkage stays 409.
        await assertCargoCheckpoint(trip, { to: target, session }, db);

      }

      const check = canTransitionTrip(current, target);

      if (!check.ok) {

        // Accepting from a legacy ingest status: bridge through Assigned first.

        if (body.accept && canTransitionTrip(current, TRIP_STATUS.ASSIGNED).ok) {

          const { rows: bridged } = await db.query(

            `UPDATE trips SET trip_status = $1, updated_at = NOW() WHERE trip_id = $2 RETURNING *`,

            [TRIP_STATUS.ASSIGNED, id]

          );

          if (!bridged[0]) return err("Trip not found", 404);

        } else {

          return err(

            `Cannot accept or decline a trip with status '${current}'`,

            409

          );

        }

      }



      const { rows } = await db.query(

        `UPDATE trips

            SET trip_status = $1, updated_at = NOW(), updated_by = $2

          WHERE trip_id = $3

          RETURNING *`,

        [target, session.user.employeeId, id]

      );



      return ok(rows[0]);

    };

    // NOTE (2026-10-13 rebase): keep the withTransaction wrapper even though the

    // qualification guard is gone. Simplifying this to a direct writeAcceptance

    // call breaks 12/17 mobile-accept route tests for an undetermined substrate

    // reason; the wrapper also preserves the production atomicity main had.

    return body.accept ? await withTransaction(async tx => {

      return writeAcceptance(tx);

    })

      : await writeAcceptance({ query });

  } catch (e) {

    return handleError(e);

  }

}
