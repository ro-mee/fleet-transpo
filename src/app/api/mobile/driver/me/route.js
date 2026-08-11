import { query } from "@/lib/db";
import { requireDriver, ok, handleError, AuthError } from "@/lib/api/utils";

/**
 * GET /api/mobile/driver/me
 *
 * The mobile app's identity call: who am I, and what am I driving today.
 * Everything here is derived from the bearer token's employee_id — the client
 * cannot ask about another driver.
 */
export async function GET(req) {
  try {
    const session = await requireDriver(req);

    const { rows } = await query(
      `SELECT e.employee_id, e.email, e.first_name, e.last_name, e.phone,
              d.driver_id, d.driver_status, d.license_number, d.license_expiry,
              d.current_latitude, d.current_longitude, d.last_location_update
         FROM employees e
         JOIN drivers d ON d.employee_id = e.employee_id AND d.deleted_at IS NULL
        WHERE e.employee_id = $1 AND e.deleted_at IS NULL
        LIMIT 1`,
      [session.user.employeeId]
    );

    const me = rows[0];
    // requireDriver already proved a driver row existed when the token was
    // minted; a miss here means the account was soft-deleted since. Treat it as
    // an auth failure so the app logs out rather than showing a blank profile.
    if (!me) throw new AuthError("Driver record no longer exists", 401);

    // A driver's assigned vehicle is whatever their live trip is using.
    const { rows: activeRows } = await query(
      `SELECT t.trip_id, t.trip_status, r.origin, r.destination, t.start_time,
              v.vehicle_id, v.plate_number, v.model
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
         LEFT JOIN routes r   ON r.route_id = t.route_id
        WHERE t.driver_id = $1 AND t.deleted_at IS NULL
          AND t.trip_status IN ('Driver Accepted', 'Trip Started', 'En Route', 'Arrived', 'In Progress')
        ORDER BY t.start_time DESC NULLS LAST
        LIMIT 1`,
      [session.user.driverId]
    );

    const { rows: recentRows } = await query(
      `SELECT t.trip_id, t.trip_status, r.origin, r.destination, t.start_time,
              v.vehicle_id, v.plate_number, v.model
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
         LEFT JOIN routes r   ON r.route_id = t.route_id
        WHERE t.driver_id = $1 AND t.deleted_at IS NULL
          AND t.trip_status <> 'Cancelled'
        ORDER BY t.start_time DESC NULLS LAST, t.trip_id DESC
        LIMIT 1`,
      [session.user.driverId]
    );

    return ok({
      employeeId: me.employee_id,
      email: me.email,
      firstName: me.first_name,
      lastName: me.last_name,
      phone: me.phone,
      driverId: me.driver_id,
      driverStatus: me.driver_status,
      licenseNumber: me.license_number,
      licenseExpiry: me.license_expiry,
      lastLocation: me.last_location_update
        ? {
            latitude: me.current_latitude,
            longitude: me.current_longitude,
            recordedAt: me.last_location_update,
          }
        : null,
      activeTrip: activeRows[0] ?? null,
      recentTrip: recentRows[0] ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}
