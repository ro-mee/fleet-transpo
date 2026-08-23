import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { getAdminClient } from "@/lib/db";
import { shouldGroundVehicle } from "@/lib/driver/grounding";
import { setDispatchStatus } from "@/services/transition.service";
import { sendPush } from "@/services/push.service";
import { TRIP_STATUS } from "@/lib/constants";

// A breakdown-type incident triggers automation (see POST): the vehicle is set
// to Under Maintenance and dispatchers are notified, so it stops receiving
// future assignments.

async function resolveDriver(employeeId) {
  const { rows } = await query(
    `SELECT d.driver_id, e.first_name, e.last_name,
            (SELECT vehicle_id FROM driver_vehicle_assignments a WHERE a.driver_id = d.driver_id AND a.assigned_until IS NULL LIMIT 1) as assigned_vehicle_id
       FROM employees e
       JOIN drivers d ON d.employee_id = e.employee_id AND d.deleted_at IS NULL
      WHERE e.employee_id = $1 AND e.deleted_at IS NULL LIMIT 1`,
    [employeeId]
  );
  return rows[0] || null;
}

/**
 * GET /api/driver/incidents
 * List the authenticated driver's own incident reports, newest first.
 */
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const driver = await resolveDriver(session.user.employeeId);
    if (!driver) return err("No driver record is linked to this account", 403);

    const { rows } = await query(
      `SELECT i.incident_id, i.vehicle_id, i.trip_id, i.incident_type, i.incident_date,
              i.description, i.location, i.latitude, i.longitude, i.severity, i.status,
              i.actions_taken, i.created_at, v.plate_number
         FROM driverincidents i
         LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
         WHERE i.driver_id = $1
        ORDER BY i.incident_date DESC, i.created_at DESC
        LIMIT 50`,
      [driver.driver_id]
    );
    return ok(rows || []);
  } catch (e) { return handleError(e); }
}

/**
 * POST /api/driver/incidents
 * Report an incident. Always scoped to the authenticated driver; a driver can
 * only ever create incidents for themselves.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const driver = await resolveDriver(session.user.employeeId);
    if (!driver) return err("No driver record is linked to this account", 403);

    const body = await parseBody(req);
    const errors = validateBody(body, {
      incident_type: { required: true, maxLength: 100, label: "Incident type" },
      description: { required: true, maxLength: 2000, label: "Description" },
      location: { maxLength: 300, label: "Location" },
      severity: { maxLength: 20, label: "Severity" },
      incident_date: { label: "Incident date" },
      vehicle_id: { type: "id", label: "Vehicle" },
      trip_id: { type: "id", label: "Trip" },
      assistance_needed: { label: "Assistance needed" },
      expense_amount: { type: "positiveNumber", label: "Expense amount" },
      client_submission_id: { maxLength: 64, label: "Submission reference" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    // Offline-replay guard. The mobile app queues incident POSTs during
    // network failures and replays them later; without this key a replay that
    // races a manual resubmit creates duplicate reports — each one re-running
    // grounding automation and paging dispatchers again. Optional so older
    // clients keep working, but format-checked when present.
    let clientSubmissionId = null;
    if (body.client_submission_id !== undefined && body.client_submission_id !== null) {
      if (
        typeof body.client_submission_id !== "string" ||
        !/^[0-9a-z-]{16,64}$/i.test(body.client_submission_id)
      ) {
        return errValidation({ client_submission_id: "Submission reference must be 16-64 letters, digits or dashes" });
      }
      clientSubmissionId = body.client_submission_id;

      const { rows: duplicate } = await query(
        `SELECT incident_id, incident_type, incident_date, description, location,
                latitude, longitude, severity, status, created_at, vehicle_id,
                assistance_needed, expense_amount
           FROM driverincidents
          WHERE driver_id = $1 AND client_submission_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [driver.driver_id, clientSubmissionId]
      );
      // Already recorded (offline replay reaching us late): return the original
      // WITHOUT re-running grounding automation or notifications.
      if (duplicate[0]) return ok(duplicate[0]);
    }

    const severity = ["Minor", "Moderate", "Major", "Critical"].includes(body.severity)
      ? body.severity
      : "Minor";
    const incidentDate = body.incident_date ? new Date(body.incident_date) : new Date();

    // Coordinates are optional: a driver who denied location permission still
    // reports. Range-guard against malformed clients.
    const hasCoords = Number.isFinite(body.latitude) && Number.isFinite(body.longitude);
    const latitude = hasCoords ? body.latitude : null;
    const longitude = hasCoords ? body.longitude : null;
    if (hasCoords && (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)) {
      return errValidation({ coordinates: "Coordinates are out of range" });
    }

    const { rows } = await query(
      `INSERT INTO driverincidents
         (driver_id, vehicle_id, trip_id, incident_type, incident_date,
          description, location, latitude, longitude, severity, assistance_needed,
          expense_amount, client_submission_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (driver_id, client_submission_id)
         WHERE deleted_at IS NULL AND client_submission_id IS NOT NULL
       DO NOTHING
       RETURNING incident_id, incident_type, incident_date, description, location,
                 latitude, longitude, severity, status, created_at, vehicle_id, assistance_needed, expense_amount`,
      [driver.driver_id, body.vehicle_id || driver.assigned_vehicle_id || null, body.trip_id || null, body.incident_type,
       incidentDate, body.description, body.location || null, latitude, longitude, severity, body.assistance_needed || null, body.expense_amount || null, clientSubmissionId]
    );

    // Lost an insert race against a concurrent replay of the same submission:
    // fetch the winner and stop — automation must run once per report.
    if (!rows[0] && clientSubmissionId) {
      const { rows: existing } = await query(
        `SELECT incident_id, incident_type, incident_date, description, location,
                latitude, longitude, severity, status, created_at, vehicle_id,
                assistance_needed, expense_amount
           FROM driverincidents
          WHERE driver_id = $1 AND client_submission_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [driver.driver_id, clientSubmissionId]
      );
      if (existing[0]) return ok(existing[0]);
      return err("This report was already submitted", 409);
    }

    const incident = rows[0];

    // The reporting driver always gets an acknowledgement — best-effort, so a
    // notification hiccup can never fail the report that was just recorded.
    try {
      await query(
        `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [session.user.employeeId, "Incident Report Under Review",
         `Your incident report (#${incident.incident_id}) was copied and is under review.`,
         "Info", "incident", incident.incident_id]
      );
    } catch (e) {
      console.warn("incident driver notification failed:", e?.message || e);
    }

    // Grounding automation: a breakdown-type report OR a Major/Critical severity
    // incident takes the vehicle out of service and alerts staff.
    // Best-effort — a sync hiccup must not fail the report that was just
    // recorded.
    if (shouldGroundVehicle({ incidentType: body.incident_type, severity, vehicleId: incident?.vehicle_id })) {
      try {
        const supabase = getAdminClient();
        await supabase
          .from("vehicles")
          .update({ vehicle_status: "Under Maintenance" })
          .eq("vehicle_id", rows[0].vehicle_id)
          .is("deleted_at", null);

        const { data: dispatchers } = await supabase
          .from("employees")
          .select("employee_id")
          .in("role_id", [1, 2, 3, 7, 9]) // system_admin, fleet_manager, dispatcher, management, admin
          .is("deleted_at", null);
        const { data: vehicle } = await supabase
          .from("vehicles")
          .select("plate_number")
          .eq("vehicle_id", rows[0].vehicle_id)
          .maybeSingle();

        const rows2 = (dispatchers || []).map((emp) => ({
          employee_id: emp.employee_id,
          title: "Vehicle Taken Out of Service",
          message: `Driver reported incident #${rows[0].incident_id} — vehicle ${vehicle?.plate_number || `#${rows[0].vehicle_id}`} taken out of service.`,
          type: "Alert",
          reference_type: "incident",
          reference_id: rows[0].incident_id,
        }));
        if (rows2.length) await supabase.from("notifications").insert(rows2);
        if (rows2.length) {
          await sendPush({
            employeeIds: (dispatchers || []).map((e) => e.employee_id),
            title: rows2[0].title,
            body: rows2[0].message,
            data: { reference_type: "incident", reference_id: rows[0].incident_id },
          });
        }

        const interval = (severity === "Major" || severity === "Critical") ? "48 hours" : "2 hours";

        // Check for active dispatches currently assigned to this vehicle within the safety window
        const activeDispatches = await query(
          `SELECT ds.dispatch_id, ds.dispatch_number, r.guest_name
             FROM dispatchschedules ds
             LEFT JOIN transportation_requests r ON r.request_id = ds.request_id
            WHERE ds.vehicle_id = $1 
              AND ds.status IN ('Scheduled', 'In Progress') 
              AND ds.deleted_at IS NULL
              AND (ds.status = 'In Progress' OR ds.scheduled_departure <= NOW() + $2::interval)`,
          [rows[0].vehicle_id, interval]
        );

        if (activeDispatches?.rows?.length > 0) {
          for (const ds of activeDispatches.rows) {
            // Transition the dispatch into Pending Reassignment through the state
            // machine — this stands down the vehicle/driver and cancels the
            // dispatch's open trips + booking request via the transition service.
            await setDispatchStatus({
              dispatchId: ds.dispatch_id,
              to: "Pending Reassignment",
              session,
              reason: `Incident #${incident.incident_id} grounded the vehicle.`,
            });

            // 3. Create specialized urgent notification for dispatchers
            const guestName = ds.guest_name || "Unknown Guest";
            const urgentRows = (dispatchers || []).map((emp) => ({
              employee_id: emp.employee_id,
              title: "🚨 URGENT: Active Dispatch Interrupted",
              message: `Vehicle ${vehicle?.plate_number || `#${rows[0].vehicle_id}`} had an incident while assigned to guest ${guestName} (Dispatch #${ds.dispatch_number}). Vehicle has been unassigned. Reassign immediately!`,
              type: "Alert",
              reference_type: "dispatch",
              reference_id: ds.dispatch_id,
            }));
            
            for (const notif of urgentRows) {
              await query(
                `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [notif.employee_id, notif.title, notif.message, notif.type, notif.reference_type, notif.reference_id]
              );
            }
            await sendPush({
              employeeIds: (dispatchers || []).map((e) => e.employee_id),
              title: urgentRows[0].title,
              body: urgentRows[0].message,
              data: { reference_type: "dispatch", reference_id: ds.dispatch_id },
            });
          }
        }
      } catch (e) {
        console.warn("grounding automation failed:", e?.message || e);
      }
    } else {
      // Oversight alert to staff who track incident reports. Sent only when
      // grounding doesn't already notify them (a grounded report delivers the
      // "Vehicle Taken Out of Service" alert instead), so each report yields
      // exactly one incident notification per recipient.
      try {
        const { rows: overseers } = await query(
          `SELECT e.employee_id
             FROM employees e
            WHERE e.role_id IN (SELECT role_id FROM roles WHERE role_name IN ('system_admin', 'fleet_manager', 'admin'))
              AND e.deleted_at IS NULL`
        );
        for (const emp of overseers) {
          await query(
            `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [emp.employee_id, "Incident Report Submitted",
             `Driver ${driver.first_name || ""} ${driver.last_name || ""} reported ${incident.incident_type} (Severity: ${severity}). View in Incidents.`,
             "Alert", "incident", incident.incident_id]
          );
        }
        await sendPush({
          employeeIds: overseers.rows.map((e) => e.employee_id),
          title: "Incident Report Submitted",
          body: `Driver ${driver.first_name || ""} ${driver.last_name || ""} reported ${incident.incident_type} (Severity: ${severity}). View in Incidents.`,
          data: { reference_type: "incident", reference_id: incident.incident_id },
        });
      } catch (e) {
        console.warn("incident oversight notification failed:", e?.message || e);
      }
    }

    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
