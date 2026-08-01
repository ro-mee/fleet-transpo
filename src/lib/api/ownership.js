import { query } from "@/lib/db";
import { AuthError } from "@/lib/api/utils";

/**
 * Ownership checks for records a driver may only touch when the record is
 * theirs.
 *
 * These live in application code because they are the only real guard on the
 * driver path: the app reaches Postgres through the raw pg pool as the owner
 * role, where auth.uid() is NULL and the RLS policies in 002_rls_policies.sql
 * never match. A missing check here is a missing check, full stop.
 *
 * Operations roles (dispatcher, fleet_manager, admin, ...) legitimately act on
 * any record, so every helper is a no-op for them and returns the row.
 */

const DRIVER_ROLE = "driver";

function isDriver(session) {
  return session?.user?.role === DRIVER_ROLE;
}

/**
 * Confirms the trip exists and, for drivers, that it is assigned to them.
 * Returns the trip row so callers do not have to re-query it.
 */
export async function assertTripOwnership(session, tripId) {
  const id = Number(tripId);
  if (!Number.isInteger(id)) {
    throw new AuthError("Invalid trip id", 400);
  }

  const { rows } = await query(
    `SELECT trip_id, driver_id, vehicle_id, trip_status, dispatch_id
       FROM trips
      WHERE trip_id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [id]
  );
  const trip = rows[0];

  // A driver probing someone else's trip gets the same 404 as a nonexistent
  // one, so the endpoint does not confirm which trip ids are real.
  if (!trip || (isDriver(session) && trip.driver_id !== session.user.driverId)) {
    throw new AuthError("Trip not found", 404);
  }

  return trip;
}

/** Same contract as assertTripOwnership, for dispatch schedules. */
export async function assertDispatchOwnership(session, dispatchId) {
  const id = Number(dispatchId);
  if (!Number.isInteger(id)) {
    throw new AuthError("Invalid dispatch id", 400);
  }

  const { rows } = await query(
    `SELECT dispatch_id, driver_id, vehicle_id, status
       FROM dispatchschedules
      WHERE dispatch_id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [id]
  );
  const dispatch = rows[0];

  if (!dispatch || (isDriver(session) && dispatch.driver_id !== session.user.driverId)) {
    throw new AuthError("Dispatch not found", 404);
  }

  return dispatch;
}

/**
 * Forces a list filter onto the caller's own driver_id when they are a driver.
 *
 * `requested` is whatever the client asked for in a query param. A driver asking
 * for someone else's id is rejected outright rather than silently rewritten, so
 * a buggy client surfaces as a 403 instead of quietly wrong data.
 *
 * @returns {number | null} the driver_id to filter by, or null for no filter
 */
export function resolveDriverScope(session, requested) {
  if (!isDriver(session)) {
    const id = Number(requested);
    return Number.isInteger(id) ? id : null;
  }

  const own = session.user.driverId;
  if (requested !== null && requested !== undefined && requested !== "") {
    if (Number(requested) !== own) {
      throw new AuthError("Drivers may only read their own records", 403);
    }
  }
  return own;
}
