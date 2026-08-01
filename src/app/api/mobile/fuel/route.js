import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";

/**
 * POST /api/mobile/fuel
 *
 * Mobile fuel report submission.
 *
 * Per mobile/README.md the client may not choose its own driver_id, vehicle_id,
 * or trip_id. driver_id comes from the token; vehicle_id and trip_id are
 * derived from the driver's own recent trips. A client-supplied vehicle_id is
 * verified against that set rather than trusted.
 */

// Columns the client may set. vehicle_id, trip_id, driver_id and created_by are
// all derived server-side and deliberately absent.
const WRITABLE_COLUMNS = [
  "station_id",
  "station_name",
  "liters",
  "amount",
  "price_per_liter",
  "odometer",
  "fuel_type",
  "fuel_date",
  "receipt_url",
];

// Matches the tabs on the web review screen in src/app/(dashboard)/fuel/page.js.
// A mobile submission always enters the queue as Pending.
const SUBMITTED_STATUS = "Pending";

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);

    if (body.liters === undefined) return err("liters is required", 400);
    if (body.amount === undefined) return err("amount is required", 400);
    if (!body.fuel_date) return err("fuel_date is required", 400);

    const liters = Number(body.liters);
    const amount = Number(body.amount);
    if (!Number.isFinite(liters) || liters <= 0) {
      return err("liters must be a positive number", 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return err("amount must be a positive number", 400);
    }

    // Resolve the vehicle from the driver's own trips. Anything the client sent
    // is treated as a request, not a fact — the driver_id predicate is what
    // makes another driver's trip unusable here.
    let trip;
    if (body.trip_id !== undefined && body.trip_id !== null) {
      const tripId = Number(body.trip_id);
      if (!Number.isInteger(tripId)) return err("Invalid trip id", 400);

      const { rows } = await query(
        `SELECT trip_id, vehicle_id
           FROM trips
          WHERE trip_id = $1 AND driver_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [tripId, session.user.driverId]
      );
      // Same 404 for another driver's trip as for a nonexistent one.
      if (!rows[0]) return err("Trip not found", 404);
      trip = rows[0];
    } else {
      // No trip named: fall back to the driver's most recent usable trip.
      const { rows } = await query(
        `SELECT trip_id, vehicle_id
           FROM trips
          WHERE driver_id = $1
            AND deleted_at IS NULL
            AND trip_status <> 'Cancelled'
          ORDER BY start_time DESC NULLS LAST, trip_id DESC
          LIMIT 1`,
        [session.user.driverId]
      );
      if (!rows[0]) {
        return err(
          "No trip is assigned to you, so there is no vehicle to report fuel for",
          409
        );
      }
      trip = rows[0];
    }

    if (
      body.vehicle_id !== undefined &&
      body.vehicle_id !== null &&
      Number(body.vehicle_id) !== trip.vehicle_id
    ) {
      return err("Fuel can only be reported for the vehicle on your trip", 403);
    }

    const columns = [];
    const values = [];
    for (const key of WRITABLE_COLUMNS) {
      if (body[key] !== undefined) {
        columns.push(key);
        values.push(body[key]);
      }
    }

    columns.push("vehicle_id", "trip_id", "driver_id", "created_by", "status");
    values.push(
      trip.vehicle_id,
      trip.trip_id,
      session.user.driverId,
      session.user.employeeId,
      SUBMITTED_STATUS
    );

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(
      `INSERT INTO fuelrecords (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return ok(rows[0], 201);
  } catch (e) {
    return handleError(e);
  }
}
