import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError, AuthError } from "@/lib/api/utils";

const INSPECTION_TYPES = ["Pre-Trip", "Pre-Shift"];

/**
 * POST /api/mobile/driver/inspections
 *
 * Records a driver pre-trip check. The START TRIP gate requires a Passed
 * inspection row for the trip before the driver may depart, so this replaces
 * the old dummy prototype with a real write to vehicleinspection.
 *
 * status is derived: every item PASS → "Passed"; any FAIL → "Failed". The
 * per-item answers are stored in the checklist JSONB (one entry per item,
 * including remarks) and findings keeps the raw answers as a JSON string so
 * the table's existing snapshot consumers keep working.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);

    const tripId = Number(body.trip_id ?? null);
    const items = Array.isArray(body.items) ? body.items : [];

    // trip_id is required and must resolve to the driver's own trip.
    if (!Number.isInteger(tripId)) {
      return err("trip_id is required", 400);
    }
    const { rows: trips } = await query(
      `SELECT trip_id, vehicle_id FROM trips
        WHERE trip_id = $1 AND driver_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [tripId, session.user.driverId]
    );
    const trip = trips[0];
    if (!trip) throw new AuthError("Trip not found", 404);

    if (!items.length) {
      return err("items is required and must not be empty", 400);
    }
    const validStatuses = new Set(["PASS", "FAIL"]);
    for (const item of items) {
      if (!item?.item_id || !validStatuses.has(item?.status)) {
        return err("each item needs item_id and a PASS|FAIL status", 400);
      }
    }

    const allPass = items.every((i) => i.status === "PASS");
    const failures = items.filter((i) => i.status === "FAIL");

    const checklist = items.map((item) => ({
      item_id: item.item_id,
      label: item.label || item.item_id,
      status: item.status,
      remarks: item.remarks || "",
    }));

    const { rows } = await query(
      `INSERT INTO vehicleinspection
         (vehicle_id, driver_id, trip_id, inspection_type, inspection_date, checklist, findings, severity, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING inspection_id, trip_id, status`,
      [
        trip.vehicle_id,
        session.user.driverId,
        tripId,
        "Pre-Trip",
        new Date().toISOString().slice(0, 10),
        JSON.stringify(checklist),
        failures.length ? JSON.stringify(failures) : null,
        failures.length ? "High" : "None",
        allPass ? "Passed" : "Failed",
      ]
    );

    return ok(rows[0], 201);
  } catch (e) {
    return handleError(e);
  }
}

/**
 * GET /api/mobile/driver/inspections
 *
 * The driver's inspections, newest first, optionally filtered to a single
 * trip (?trip_id=) so the app can tell whether the pre-trip gate is satisfied.
 */
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const sp = req.nextUrl.searchParams;
    const tripId = Number(sp.get("trip_id") ?? null);

    if (tripId && !Number.isInteger(tripId)) {
      return err("Invalid trip_id", 400);
    }

    const { rows } = await query(
      `SELECT inspection_id, vehicle_id, trip_id, inspection_type, inspection_date,
              checklist, findings, severity, status, created_at
         FROM vehicleinspection
        WHERE driver_id = $1
          AND ($2::int IS NULL OR trip_id = $2)
        ORDER BY created_at DESC
        LIMIT $3`,
      [session.user.driverId, tripId, 50]
    );

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
