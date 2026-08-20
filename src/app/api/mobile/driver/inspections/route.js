import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError, AuthError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";

const INSPECTION_TYPES = ["Pre-Trip", "Pre-Shift"];
const CHECKLIST_ITEM_IDS = ["cabin", "aircon", "dashboard", "exterior", "brakes", "tires", "fuel"];
const INSPECTION_TRIP_STATUSES = [
  "Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned",
  "Dispatched", "Driver Accepted",
];

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
    const clientSubmissionId = body.client_submission_id;

    // trip_id is required and must resolve to the driver's own trip.
    if (!Number.isInteger(tripId)) {
      return err("trip_id is required", 400);
    }
    const { rows: trips } = await query(
      `SELECT t.trip_id, t.vehicle_id, v.plate_number
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
        WHERE t.trip_id = $1 AND t.driver_id = $2 AND t.deleted_at IS NULL
          AND t.trip_status = ANY($3::text[]) LIMIT 1`,
      [tripId, session.user.driverId, INSPECTION_TRIP_STATUSES]
    );
    const trip = trips[0];
    if (!trip) throw new AuthError("Trip not found", 404);
    if (!trip.vehicle_id) {
      return err("A vehicle must be assigned before the pre-trip inspection", 400);
    }

    if (!items.length) {
      return err("items is required and must not be empty", 400);
    }
    if (items.length !== CHECKLIST_ITEM_IDS.length) {
      return err(`exactly ${CHECKLIST_ITEM_IDS.length} inspection items are required`, 400);
    }
    if (typeof clientSubmissionId !== "string" || !/^[0-9a-z-]{16,64}$/i.test(clientSubmissionId)) {
      return err("client_submission_id is required", 400);
    }
    const validItemIds = new Set(CHECKLIST_ITEM_IDS);
    const seenItemIds = new Set();
    const validStatuses = new Set(["PASS", "FAIL"]);
    for (const item of items) {
      if (!validItemIds.has(item?.item_id) || seenItemIds.has(item.item_id) || !validStatuses.has(item?.status)) {
        return err("each item needs item_id and a PASS|FAIL status", 400);
      }
      if (typeof item.remarks !== "undefined" && String(item.remarks).length > 1000) {
        return err("inspection remarks must be 1000 characters or fewer", 400);
      }
      if (item.status === "FAIL" && !String(item.remarks || "").trim()) {
        return err(`remarks are required for failed item '${item.item_id}'`, 400);
      }
      seenItemIds.add(item.item_id);
    }

    const allPass = items.every((i) => i.status === "PASS");
    const failures = items.filter((i) => i.status === "FAIL");

    const checklist = items.map((item) => ({
      item_id: item.item_id,
      label: item.label || item.item_id,
      status: item.status,
      remarks: item.remarks || "",
    }));

    const { rows: insertedRows } = await query(
      `INSERT INTO vehicleinspection
         (vehicle_id, driver_id, trip_id, inspection_type, inspection_date, checklist, findings, severity, status, client_submission_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT (driver_id, client_submission_id) WHERE client_submission_id IS NOT NULL
       DO NOTHING
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
        clientSubmissionId,
      ]
    );

    const inserted = Boolean(insertedRows[0]);
    let inspection = insertedRows[0];
    if (!inspection) {
      const { rows: existingRows } = await query(
        `SELECT inspection_id, trip_id, status FROM vehicleinspection
          WHERE driver_id = $1 AND client_submission_id = $2 LIMIT 1`,
        [session.user.driverId, clientSubmissionId]
      );
      inspection = existingRows[0];
      if (!inspection) throw new Error("Inspection retry could not be resolved");
      if (Number(inspection.trip_id) !== tripId) {
        return err("client_submission_id was already used for another trip", 409);
      }
    }

    if (!allPass && inserted) {
      try {
        const { rows: overseers } = await query(
          `SELECT e.employee_id FROM employees e
             JOIN roles r ON r.role_id = e.role_id
            WHERE r.role_name IN ('system_admin', 'fleet_manager', 'dispatcher', 'admin')
              AND e.deleted_at IS NULL`
        );
        const notificationMessage = `${trip.plate_number || `Vehicle #${trip.vehicle_id}`} failed the pre-trip inspection for Trip #${tripId} and requires review.`;
        for (const overseer of overseers) {
          await query(
            `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [overseer.employee_id, "Failed Pre-Trip Inspection", notificationMessage, "Alert", "vehicle", trip.vehicle_id]
          );
        }
        await sendPush({
          employeeIds: overseers.map((overseer) => overseer.employee_id),
          title: "Failed Pre-Trip Inspection",
          body: notificationMessage,
          data: { reference_type: "vehicle", reference_id: trip.vehicle_id },
        });
      } catch (notificationError) {
        console.warn("inspection oversight notification failed:", notificationError?.message || notificationError);
      }
    }

    return ok(inspection, inserted ? 201 : 200);
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
        ORDER BY created_at DESC, inspection_id DESC
        LIMIT $3`,
      [session.user.driverId, tripId, 50]
    );

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
