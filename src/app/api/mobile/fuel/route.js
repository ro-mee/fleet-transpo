import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { isOwnedFuelReceiptUrl } from "@/lib/fuel/receipt-storage";

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
  "station_name",
  "liters",
  "amount",
  "fuel_date",
  "receipt_url",
  "client_submission_id",
];

const ACTIVE_TRIP_STATUSES = [
  "Assigned", "Driver Accepted", "Trip Started", "At Pickup",
  "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress",
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
    if (typeof body.receipt_url !== "string" || !body.receipt_url.trim()) {
      return err("A receipt photo is required to verify the fuel report", 400);
    }
    if (!isOwnedFuelReceiptUrl(body.receipt_url, session.user.driverId)) {
      return err("The receipt photo is not a valid upload for this driver", 400);
    }
    if (typeof body.client_submission_id !== "string" || !/^[0-9a-z-]{16,64}$/i.test(body.client_submission_id)) {
      return err("client_submission_id is required", 400);
    }
    if (Number.isNaN(new Date(body.fuel_date).getTime())) return err("fuel_date must be a valid date", 400);

    const liters = Number(body.liters);
    const amount = Number(body.amount);
    if (!Number.isFinite(liters) || liters <= 0) {
      return err("liters must be a positive number", 400);
    }
    if (liters > 1000) return err("liters exceeds the maximum allowed per fuel report", 400);
    if (!Number.isFinite(amount) || amount <= 0) {
      return err("amount must be a positive number", 400);
    }
    if (amount > 1000000) return err("amount exceeds the maximum allowed per fuel report", 400);
    if (body.station_name !== undefined && String(body.station_name).length > 255) return err("station_name is too long", 400);

    // Resolve the vehicle from the driver's own trips. Anything the client sent
    // is treated as a request, not a fact — the driver_id predicate is what
    // makes another driver's trip unusable here.
    let trip;
    if (body.trip_id !== undefined && body.trip_id !== null) {
      const tripId = Number(body.trip_id);
      if (!Number.isInteger(tripId)) return err("Invalid trip id", 400);

      const { rows } = await query(
        `SELECT t.trip_id, t.vehicle_id, v.fuel_type, v.mileage
           FROM trips t
           JOIN vehicles v ON v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL
          WHERE t.trip_id = $1 AND t.driver_id = $2 AND t.deleted_at IS NULL
            AND t.trip_status = ANY($3::text[])
          LIMIT 1`,
        [tripId, session.user.driverId, ACTIVE_TRIP_STATUSES]
      );
      // Same 404 for another driver's trip as for a nonexistent one.
      if (!rows[0]) return err("Trip not found", 404);
      trip = rows[0];
    } else {
      // No trip named: fall back to the driver's most recent usable trip.
      const { rows } = await query(
        `SELECT t.trip_id, t.vehicle_id, v.fuel_type, v.mileage
           FROM trips t
           JOIN vehicles v ON v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL
          WHERE t.driver_id = $1
            AND t.deleted_at IS NULL
            AND t.trip_status = ANY($2::text[])
          ORDER BY t.start_time DESC NULLS LAST, t.trip_id DESC
          LIMIT 1`,
        [session.user.driverId, ACTIVE_TRIP_STATUSES]
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
    const { rows: duplicate } = await query(
      `SELECT * FROM fuelrecords WHERE driver_id = $1 AND client_submission_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [session.user.driverId, body.client_submission_id]
    );
    if (duplicate[0]) return ok(duplicate[0]);
    for (const key of WRITABLE_COLUMNS) {
      if (body[key] !== undefined) {
        columns.push(key);
        values.push(body[key]);
      }
    }

    columns.push("price_per_liter", "odometer", "fuel_type", "vehicle_id", "trip_id", "driver_id", "created_by", "status");
    values.push(
      Number((amount / liters).toFixed(2)),
      trip.mileage,
      trip.fuel_type || "Unspecified",
      trip.vehicle_id,
      trip.trip_id,
      session.user.driverId,
      session.user.employeeId,
      SUBMITTED_STATUS
    );

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(
      `INSERT INTO fuelrecords (${columns.join(", ")}) VALUES (${placeholders})
       ON CONFLICT (driver_id, client_submission_id) WHERE deleted_at IS NULL AND client_submission_id IS NOT NULL
       DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      values
    );
    return ok(rows[0], 201);
  } catch (e) {
    return handleError(e);
  }
}
