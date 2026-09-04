import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { requiresVehicleMaintenance, shouldGroundVehicle } from "@/lib/driver/grounding";
import { sendPush } from "@/services/push.service";
import {
  INCIDENT_ASSISTANCE_OPTIONS,
  INCIDENT_SEVERITIES,
  normalizeIncidentType,
} from "@/lib/incidents/resolution";
import { groundIncident } from "@/lib/incidents/grounding";
import { ensureIncidentMaintenance, notifyMaintenanceTeam } from "@/lib/incidents/maintenance";
import { writeAudit } from "@/lib/audit";

async function resolveDriver(employeeId) {
  const { rows } = await query(
    `SELECT d.driver_id, e.first_name, e.last_name,
            (SELECT vehicle_id
               FROM driver_vehicle_assignments a
              WHERE a.driver_id = d.driver_id
                AND a.assigned_from <= CURRENT_DATE
                AND (a.assigned_until IS NULL OR a.assigned_until >= CURRENT_DATE)
              ORDER BY a.assigned_from DESC
              LIMIT 1) AS assigned_vehicle_id
       FROM employees e
       JOIN drivers d ON d.employee_id = e.employee_id AND d.deleted_at IS NULL
      WHERE e.employee_id = $1 AND e.deleted_at IS NULL
      LIMIT 1`,
    [employeeId]
  );
  return rows[0] || null;
}

function isIncidentPhotoReference(value, driverId) {
  if (typeof value !== "string" || value.length > 512) return false;
  const pathPattern = new RegExp(`^${Number(driverId)}/[0-9a-f-]{16,64}\\.(?:jpg|jpeg|png)$`, "i");
  if (pathPattern.test(value)) return true;

  // Keep already-queued reports from older mobile builds replayable, but only
  // accept URLs that point back to this driver's private evidence bucket.
  try {
    const url = new URL(value);
    return url.pathname.includes(`/storage/v1/object/sign/incident-evidence/${Number(driverId)}/`);
  } catch {
    return false;
  }
}

async function resolveIncidentContext(driver, body) {
  const requestedTripId = body.trip_id == null ? null : Number(body.trip_id);
  const requestedVehicleId = body.vehicle_id == null ? null : Number(body.vehicle_id);
  let tripVehicleId = null;

  if (requestedTripId != null) {
    const { rows } = await query(
      `SELECT trip_id, vehicle_id
         FROM trips
        WHERE trip_id = $1 AND driver_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [requestedTripId, driver.driver_id]
    );
    if (!rows[0]) return { field: "trip_id", error: "Trip is not assigned to this driver" };
    tripVehicleId = rows[0].vehicle_id == null ? null : Number(rows[0].vehicle_id);
  }

  if (requestedVehicleId != null) {
    const assignedVehicleId = driver.assigned_vehicle_id == null ? null : Number(driver.assigned_vehicle_id);
    if (tripVehicleId != null && requestedVehicleId !== tripVehicleId) {
      return { field: "vehicle_id", error: "Vehicle does not match the selected trip" };
    }
    if (tripVehicleId == null && requestedVehicleId !== assignedVehicleId) {
      return { field: "vehicle_id", error: "Vehicle is not currently assigned to this driver" };
    }
  }

  return {
    tripId: requestedTripId,
    vehicleId:
      tripVehicleId ??
      requestedVehicleId ??
      (driver.assigned_vehicle_id == null ? null : Number(driver.assigned_vehicle_id)),
  };
}

/** List the authenticated driver's own incident reports, newest received first. */
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const driver = await resolveDriver(session.user.employeeId);
    if (!driver) return err("No driver record is linked to this account", 403);

    const { rows } = await query(
      `SELECT i.incident_id, i.vehicle_id, i.trip_id, i.incident_type, i.incident_date,
              i.description, i.location, i.latitude, i.longitude, i.severity, i.status,
              i.actions_taken, i.acknowledged_at, i.resolved_at, i.grounding_status,
              i.requires_vehicle_maintenance, i.maintenance_id, i.maintenance_error,
              i.created_at, v.plate_number
         FROM driverincidents i
         LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
        WHERE i.driver_id = $1 AND i.deleted_at IS NULL
        ORDER BY i.created_at DESC, i.incident_date DESC
        LIMIT 50`,
      [driver.driver_id]
    );
    return ok(rows || []);
  } catch (e) {
    return handleError(e);
  }
}

/** Report an incident. The authenticated driver's ownership is authoritative. */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const driver = await resolveDriver(session.user.employeeId);
    if (!driver) return err("No driver record is linked to this account", 403);

    const parsedBody = await parseBody(req);
    const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {};
    const errors = validateBody(body, {
      incident_type: { required: true, maxLength: 100, label: "Incident type" },
      description: { required: true, maxLength: 2000, label: "Description" },
      location: { maxLength: 300, label: "Location" },
      severity: { maxLength: 20, label: "Severity" },
      incident_date: { type: "date", label: "Incident date" },
      vehicle_id: { type: "id", label: "Vehicle" },
      trip_id: { type: "id", label: "Trip" },
      assistance_needed: { label: "Assistance needed" },
      expense_amount: { type: "positiveNumber", label: "Expense amount" },
      client_submission_id: { maxLength: 64, label: "Submission reference" },
      photo_urls: { label: "Photo references" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    const incidentType = normalizeIncidentType(body.incident_type);
    if (!incidentType) return errValidation({ incident_type: "Incident type is required" });
    const severity = INCIDENT_SEVERITIES.includes(body.severity) ? body.severity : "Minor";

    const assistanceNeeded = body.assistance_needed == null ? null : body.assistance_needed;
    if (
      assistanceNeeded !== null &&
      (!Array.isArray(assistanceNeeded) ||
        assistanceNeeded.length > INCIDENT_ASSISTANCE_OPTIONS.length ||
        assistanceNeeded.some((value) => !INCIDENT_ASSISTANCE_OPTIONS.includes(value)))
    ) {
      return errValidation({ assistance_needed: "Assistance options are invalid" });
    }

    const photoRefs = body.photo_urls == null ? [] : body.photo_urls;
    if (
      !Array.isArray(photoRefs) ||
      photoRefs.length > 3 ||
      photoRefs.some((value) => !isIncidentPhotoReference(value, driver.driver_id))
    ) {
      return errValidation({ photo_urls: "Attach up to 3 valid incident photos" });
    }

    const context = await resolveIncidentContext(driver, body);
    if (context.error) return errValidation({ [context.field]: context.error });

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
                assistance_needed, expense_amount, photo_urls, grounding_status,
                requires_vehicle_maintenance, maintenance_id, maintenance_error
           FROM driverincidents
          WHERE driver_id = $1 AND client_submission_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [driver.driver_id, clientSubmissionId]
      );
      if (duplicate[0]) return ok(duplicate[0]);
    }

    const incidentDate = body.incident_date ? new Date(body.incident_date) : new Date();
    const maintenanceRequired = requiresVehicleMaintenance({
      incidentType,
      severity,
      description: body.description,
      vehicleId: context.vehicleId,
    });
    const groundingRequired = shouldGroundVehicle({
      incidentType,
      severity,
      vehicleId: context.vehicleId,
    }) || maintenanceRequired;
    const groundingStatus = groundingRequired ? "Pending" : "Not Required";

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
          expense_amount, client_submission_id, photo_urls, grounding_status,
          requires_vehicle_maintenance, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          CASE $10::varchar
            WHEN 'Critical' THEN NOW() + interval '2 hours'
            WHEN 'Major' THEN NOW() + interval '24 hours'
            WHEN 'Moderate' THEN NOW() + interval '72 hours'
            ELSE NOW() + interval '7 days'
          END)
       ON CONFLICT (driver_id, client_submission_id)
         WHERE deleted_at IS NULL AND client_submission_id IS NOT NULL
       DO NOTHING
       RETURNING incident_id, incident_type, incident_date, description, location,
                 latitude, longitude, severity, status, created_at, vehicle_id,
                 assistance_needed, expense_amount, photo_urls, grounding_status,
                 requires_vehicle_maintenance`,
      [
        driver.driver_id,
        context.vehicleId,
        context.tripId,
        incidentType,
        incidentDate,
        body.description,
        body.location || null,
        latitude,
        longitude,
        severity,
        assistanceNeeded,
        body.expense_amount || null,
        clientSubmissionId,
        photoRefs,
        groundingStatus,
        maintenanceRequired,
      ]
    );

    if (!rows[0] && clientSubmissionId) {
      const { rows: existing } = await query(
        `SELECT incident_id, incident_type, incident_date, description, location,
                latitude, longitude, severity, status, created_at, vehicle_id,
                assistance_needed, expense_amount, photo_urls, grounding_status,
                requires_vehicle_maintenance, maintenance_id, maintenance_error
           FROM driverincidents
          WHERE driver_id = $1 AND client_submission_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [driver.driver_id, clientSubmissionId]
      );
      if (existing[0]) return ok(existing[0]);
      return err("This report was already submitted", 409);
    }

    const incident = rows[0];
    await writeAudit(req, session, {
      action: "create",
      resource: "driverincidents",
      resourceId: incident.incident_id,
      newValues: {
        status: incident.status,
        severity: incident.severity,
        vehicle_id: incident.vehicle_id,
        trip_id: incident.trip_id,
      },
    });

    try {
      await query(
        `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.user.employeeId,
          "Incident Report Under Review",
          `Your incident report (#${incident.incident_id}) was received and is under review.`,
          "Info",
          "incident",
          incident.incident_id,
        ]
      );
    } catch (e) {
      console.warn("incident driver notification failed:", e?.message || e);
    }

    if (groundingRequired) {
      try {
        await groundIncident({ incident, session, req });
        incident.grounding_status = "Complete";
      } catch (e) {
        console.warn("grounding automation failed:", e?.message || e);
        await query(
          `UPDATE driverincidents
              SET grounding_status = 'Failed',
                  grounding_error = $2,
                  updated_at = NOW()
            WHERE incident_id = $1 AND deleted_at IS NULL`,
          [incident.incident_id, String(e?.message || e).slice(0, 1000)]
        ).catch(() => {});
        incident.grounding_status = "Failed";
        await writeAudit(req, session, {
          action: "update",
          resource: "driverincidents",
          resourceId: incident.incident_id,
          newValues: { grounding_status: "Failed" },
        });

        // Fail-safe fallback to ensure the vehicle is safely grounded
        try {
          const { syncVehicleStatus } = await import("@/services/status.service");
          await syncVehicleStatus(incident.vehicle_id);
        } catch (syncErr) {
          console.error("CRITICAL: Failed to execute fallback syncVehicleStatus during incident grounding:", syncErr);
        }
      }
    }

    if (maintenanceRequired) {
      try {
        const maintenanceResult = await ensureIncidentMaintenance({
          incidentId: incident.incident_id,
          session,
        });
        if (maintenanceResult.workOrder) {
          incident.maintenance_id = maintenanceResult.workOrder.maintenance_id;
          if (maintenanceResult.created) {
            await writeAudit(req, session, {
              action: "auto_create",
              resource: "vehiclemaintenance",
              resourceId: maintenanceResult.workOrder.maintenance_id,
              newValues: {
                source_incident_id: incident.incident_id,
                maintenance_type: maintenanceResult.workOrder.maintenance_type,
                status: maintenanceResult.workOrder.status,
              },
            });
          }
          try {
            // The notification insert is deduplicated, so retries can repair
            // a transient push/DB failure without spamming the team.
            await notifyMaintenanceTeam(maintenanceResult.workOrder, incident.incident_id);
          } catch (e) {
            console.warn("incident maintenance notification failed:", e?.message || e);
          }
        }
      } catch (e) {
        const message = String(e?.message || e).slice(0, 1000);
        console.warn("automatic incident maintenance failed:", message);
        incident.maintenance_error = message;
        await query(
          `UPDATE driverincidents
              SET maintenance_error = $2, updated_at = NOW()
            WHERE incident_id = $1 AND deleted_at IS NULL`,
          [incident.incident_id, message]
        ).catch(() => {});
        await writeAudit(req, session, {
          action: "auto_create_failed",
          resource: "driverincidents",
          resourceId: incident.incident_id,
          newValues: { requires_vehicle_maintenance: true, maintenance_error: message },
        });
      }
    }

    if (!groundingRequired) {
      try {
        const { rows: overseers } = await query(
          `SELECT e.employee_id
             FROM employees e
             JOIN roles r ON r.role_id = e.role_id
            WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`,
          [["system_admin", "fleet_manager", "admin"]]
        );
        const message = `Driver ${driver.first_name || ""} ${driver.last_name || ""} reported ${incident.incident_type} (Severity: ${severity}). View in Incidents.`;
        for (const employee of overseers) {
          await query(
            `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [employee.employee_id, "Incident Report Submitted", message, "Alert", "incident", incident.incident_id]
          );
        }
        if (overseers.length) {
          await sendPush({
            employeeIds: overseers.map((employee) => employee.employee_id),
            title: "Incident Report Submitted",
            body: message,
            data: { reference_type: "incident", reference_id: incident.incident_id },
          });
        }
      } catch (e) {
        console.warn("incident oversight notification failed:", e?.message || e);
      }
    }

    return ok(incident, 201);
  } catch (e) {
    return handleError(e);
  }
}
