import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError, AuthError } from "@/lib/api/utils";
import { sendPush } from "@/services/push.service";
import { setDuty } from "@/services/standby.service";
import { notificationRolesFor } from "@/lib/notifications/recipients";
import {
  INSPECTION_TYPES,
  blockingItemIdsForType,
  validateChecklist,
  isChecklistType,
  CLIENT_SUBMISSION_ID_RE,
} from "@/lib/inspections/checklists";
import { PRE_START_TRIP_STATUSES, DRIVER_ACTIVE_TRIP_STATUSES } from "@/lib/trips/status-groups";

/**
 * POST /api/mobile/driver/inspections
 *
 * Two WRITABLE inspection types, one table (vehicleinspection):
 *  - "Pre-Trip"  — quick critical re-check; trip_id REQUIRED; only a
 *    Passed row for THIS trip unlocks POST /trips/:id/start.
 *  - "Pre-Shift" — shift baseline; trip_id MUST be null; the
 *    vehicle resolves from the driver's live trip or their current
 *    driver_vehicle_assignments row (never from the client).
 *
 * "Post-Shift" — the End Duty report — is a third type in the same table but is
 * deliberately NOT writable here. It is filed by POST /api/mobile/driver/duty,
 * where it shares one transaction with the attendance time_out, so a report
 * cannot exist without the duty having ended. GET still filters on it: the app
 * reads today's row to know whether the report is already done.
 *
 * status: no blocking FAIL → "Passed"; any FAIL on a blocking item → "Failed".
 * severity: no FAIL → "None"; blocking FAIL → "High"; FAIL only on
 * non-blocking items → "Medium" with an Inspection Findings notice.
 * Never touches vehicle_status — grounding stays with the existing incident/maintenance flow.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);

    const inspectionType = String(body.inspection_type ?? "");
    if (!INSPECTION_TYPES.includes(inspectionType)) {
      return err("inspection_type must be Pre-Shift or Pre-Trip", 400);
    }
    // Known type, wrong endpoint — say where it belongs rather than letting it
    // fall through to the checklist validation, which would answer with a
    // confusing "Post-Shift carries no checklist".
    if (!isChecklistType(inspectionType)) {
      return err("End Duty reports are filed by ending duty (POST /api/mobile/driver/duty)", 400);
    }
    const items = Array.isArray(body.items) ? body.items : [];
    const clientSubmissionId = body.client_submission_id;
    if (typeof clientSubmissionId !== "string" || !CLIENT_SUBMISSION_ID_RE.test(clientSubmissionId)) {
      return err("client_submission_id is required", 400);
    }
    const rawTripId = body.trip_id;
    const tripId =
      rawTripId === null || rawTripId === undefined || rawTripId === ""
        ? null
        : Number(rawTripId);

    let vehicleId = null;
    let plateNumber = null;
    let tripIdForInsert = null;

    if (inspectionType === "Pre-Trip") {
      if (!Number.isInteger(tripId) || tripId <= 0) {
        return err("trip_id is required for a Pre-Trip inspection", 400);
      }
      const { rows: trips } = await query(
        `SELECT t.trip_id, t.vehicle_id, v.plate_number
           FROM trips t
           LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
          WHERE t.trip_id = $1 AND t.driver_id = $2 AND t.deleted_at IS NULL
            AND t.trip_status = ANY($3::text[]) LIMIT 1`,
        [tripId, session.user.driverId, PRE_START_TRIP_STATUSES]
      );
      const trip = trips[0];
      if (!trip) throw new AuthError("Trip not found", 404);
      if (!trip.vehicle_id) {
        return err("A vehicle must be assigned before the pre-trip inspection", 400);
      }
      vehicleId = trip.vehicle_id;
      plateNumber = trip.plate_number;
      tripIdForInsert = tripId;
    } else {
      if (tripId !== null) {
        return err("Pre-Shift inspections must not include trip_id", 400);
      }
      // Same resolution order as GET /api/mobile/driver/me: live trip first,
      // then the current assignment. Client never supplies vehicle_id.
      const { rows: liveRows } = await query(
        `SELECT t.vehicle_id, v.plate_number
           FROM trips t
           JOIN vehicles v ON v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL
          WHERE t.driver_id = $1 AND t.deleted_at IS NULL
            AND t.trip_status = ANY($2::text[])
          ORDER BY t.start_time DESC NULLS LAST
          LIMIT 1`,
        [session.user.driverId, DRIVER_ACTIVE_TRIP_STATUSES]
      );
      if (liveRows[0]) {
        vehicleId = liveRows[0].vehicle_id;
        plateNumber = liveRows[0].plate_number;
      } else {
        const { rows: assignmentRows } = await query(
          `SELECT a.vehicle_id, v.plate_number
             FROM driver_vehicle_assignments a
             JOIN vehicles v ON v.vehicle_id = a.vehicle_id AND v.deleted_at IS NULL
            WHERE a.driver_id = $1 AND a.assigned_from <= CURRENT_DATE
              AND (a.assigned_until IS NULL OR a.assigned_until >= CURRENT_DATE)
            ORDER BY a.assigned_from DESC
            LIMIT 1`,
          [session.user.driverId]
        );
        if (!assignmentRows[0]) {
          return err("No vehicle is assigned to you — contact dispatch before starting your shift", 400);
        }
        vehicleId = assignmentRows[0].vehicle_id;
        plateNumber = assignmentRows[0].plate_number;
      }
      tripIdForInsert = null;
    }

    // Item validation runs AFTER ownership/vehicle resolution deliberately. The
    // endpoint answered 404 for a trip the driver does not own before it
    // answered 400 about its payload, and preserving that order means a
    // bad-checklist request against someone else's trip still 404s rather than
    // confirming the trip exists. The inspection_type and client_submission_id
    // checks stay up front — they need no DB round trip and cannot leak anything.
    const checklistResult = validateChecklist(inspectionType, items);
    if (!checklistResult.ok) return err(checklistResult.error, 400);

    const failures = items.filter((i) => i.status === "FAIL");
    const checklist = items.map((item) => ({
      item_id: item.item_id,
      label: item.label || item.item_id,
      status: item.status,
      remarks: item.remarks || "",
    }));
    const blockingItemIds = blockingItemIdsForType(inspectionType);
    const blockingFailures = failures.filter((f) => blockingItemIds.includes(f.item_id));
    const isBlockingFailure = blockingFailures.length > 0;
    const inspectionStatus = isBlockingFailure ? "Failed" : "Passed";
    const severity = isBlockingFailure ? "High" : failures.length ? "Medium" : "None";

    const { rows: insertedRows } = await query(
      `INSERT INTO vehicleinspection
         (vehicle_id, driver_id, trip_id, inspection_type, inspection_date, checklist, findings, severity, status, client_submission_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT (driver_id, client_submission_id) WHERE client_submission_id IS NOT NULL
       DO NOTHING
       RETURNING inspection_id, trip_id, inspection_type, status`,
      [
        vehicleId,
        session.user.driverId,
        tripIdForInsert,
        inspectionType,
        new Date().toISOString().slice(0, 10),
        JSON.stringify(checklist),
        failures.length ? JSON.stringify(failures) : null,
        severity,
        inspectionStatus,
        clientSubmissionId,
      ]
    );

    const inserted = Boolean(insertedRows[0]);
    let inspection = insertedRows[0];
    if (!inspection) {
      const { rows: existingRows } = await query(
        `SELECT inspection_id, trip_id, inspection_type, status FROM vehicleinspection
          WHERE driver_id = $1 AND client_submission_id = $2 LIMIT 1`,
        [session.user.driverId, clientSubmissionId]
      );
      inspection = existingRows[0];
      if (!inspection) throw new Error("Inspection retry could not be resolved");
      const existingTripId = inspection.trip_id == null ? null : Number(inspection.trip_id);
      if (existingTripId !== tripIdForInsert) {
        return err("client_submission_id was already used for another trip", 409);
      }
      if (inspection.inspection_type !== inspectionType) {
        return err("client_submission_id was already used for another inspection type", 409);
      }
    }

    if (failures.length > 0 && inserted) {
      try {
        const { rows: overseers } = await query(
          `SELECT e.employee_id FROM employees e
             JOIN roles r ON r.role_id = e.role_id
            WHERE r.role_name = ANY($1)
              AND e.deleted_at IS NULL
              AND e.role_id IS NOT NULL`,
          [notificationRolesFor("trips", "update_all")]
        );
        const failedLabels = failures.map((f) => f.label || f.item_id).join(", ");
        const remarksLine = failures
          .map((f) => String(f.remarks || "").trim())
          .filter(Boolean)
          .join("; ");
        const title = isBlockingFailure
          ? (inspectionType === "Pre-Shift" ? "Failed Pre-Shift Inspection" : "Failed Pre-Trip Inspection")
          : `Inspection Findings (${inspectionType})`;
        const where = isBlockingFailure
          ? (inspectionType === "Pre-Shift"
              ? "failed the pre-shift inspection"
              : `failed the quick pre-trip safety check for Trip #${tripIdForInsert}`)
          : `reported findings during ${inspectionType} check for Trip #${tripIdForInsert}`;
        const notificationMessage =
          `${plateNumber || `Vehicle #${vehicleId}`} ${where}. Findings: ${failedLabels}.` +
          `${remarksLine ? ` Remarks: ${remarksLine}.` : ""} Requires review.`;
        for (const overseer of overseers) {
          await query(
            `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [overseer.employee_id, title, notificationMessage, "Alert", "vehicle", vehicleId]
          );
        }
        await sendPush({
          employeeIds: overseers.map((overseer) => overseer.employee_id),
          title,
          body: notificationMessage,
          data: { reference_type: "vehicle", reference_id: vehicleId },
        });
      } catch (notificationError) {
        console.warn("inspection oversight notification failed:", notificationError?.message || notificationError);
      }
    }

    // Pre-Shift IS Start Duty. Completing the shift baseline is one action that
    // puts the driver on duty — which is what turns on standby tracking and makes
    // them visible on the dispatch radar. There is no separate Start duty toggle
    // in the app, so this is the only way in.
    //
    // This runs AFTER the insert commits, and outside the insert's own statement,
    // on purpose: setDuty opens its own transaction and its PRESHIFT_REQUIRED gate
    // reads the baseline back, so it can only succeed once this row is durable.
    //
    // Called on retries too (not just on `inserted`). setDuty is safe to repeat —
    // its attendance upsert is guarded by `time_out IS NOT NULL OR time_in IS NULL`,
    // so re-running it while already on duty does not re-stamp time_in. A retry is
    // exactly the case where the first attempt's response was lost, so skipping
    // duty here would strand a driver who did complete the check.
    //
    // A refusal must NOT fail the inspection. The safety record is already
    // committed and is the more important write; a rest day, approved leave or a
    // missing privacy consent blocks duty but cannot un-record a finished check.
    // The reason travels back so the app can act on it — consent has its own
    // screen — rather than showing a dead error.
    let duty = null;
    if (inspectionType === "Pre-Shift") {
      if (isBlockingFailure) {
        duty = {
          started: false,
          code: "PRESHIFT_FAILED",
          message: "Duty was not started because pre-shift vehicle safety check failed.",
        };
      } else {
        try {
          await setDuty(session.user.driverId, true);
          duty = { started: true, code: null, message: null };
        } catch (dutyError) {
          duty = {
            started: false,
            code: dutyError?.code ?? null,
            message: dutyError?.message ?? "Duty could not be started.",
          };
        }
      }
    }

    return ok(duty ? { ...inspection, duty } : inspection, inserted ? 201 : 200);
  } catch (e) {
    return handleError(e);
  }
}

/**
 * GET /api/mobile/driver/inspections
 *
 * The driver's inspections, newest first, optionally filtered to a single
 * trip (?trip_id=) so the app can tell whether the pre-trip gate is satisfied,
 * and/or to one type (?inspection_type=Pre-Shift) so the app can tell whether
 * today's shift baseline exists — a Pre-Shift row has trip_id NULL and would
 * otherwise be buried among the per-trip rows.
 */
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const sp = new URL(req.url).searchParams;
    // An ABSENT trip_id must become null, never 0. `Number(null)` is 0, and 0 is
    // not null, so the `($2::int IS NULL OR trip_id = $2)` escape hatch below
    // fell through to `trip_id = 0` — which matches nothing, because a Pre-Shift
    // baseline carries trip_id NULL by definition. That silently emptied every
    // unfiltered call to this route, so the driver's Pre-Shift card could never
    // clear: the write succeeded and the read-back always returned zero rows.
    // The POST's body handling already had this right; the query string did not.
    const rawTripId = sp.get("trip_id");
    const tripId = rawTripId === null || rawTripId === "" ? null : Number(rawTripId);

    if (tripId !== null && (!Number.isInteger(tripId) || tripId <= 0)) {
      return err("Invalid trip_id", 400);
    }

    const inspectionType = sp.get("inspection_type");
    if (inspectionType && !INSPECTION_TYPES.includes(inspectionType)) {
      return err("Invalid inspection_type", 400);
    }

    const { rows } = await query(
      `SELECT inspection_id, vehicle_id, trip_id, inspection_type, inspection_date,
              checklist, findings, severity, status, created_at
         FROM vehicleinspection
         WHERE driver_id = $1
          AND ($2::int IS NULL OR trip_id = $2)
          AND ($4::text IS NULL OR inspection_type = $4)
        ORDER BY created_at DESC, inspection_id DESC
        LIMIT $3`,
      [session.user.driverId, tripId, 50, inspectionType ?? null]
    );

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
