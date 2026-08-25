import { query, transaction } from "@/lib/db";
import { requireAuth, requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizePhone, isUrl, isBase64DataUrl } from "@/lib/validation/helpers";
import { PRIVACY_POLICY, CURRENT_PRIVACY_POLICY_VERSION } from "@/lib/consent/policies";
import { syncDriverStatus } from "@/services/status.service";
import {
  DRIVER_SELF_EDITABLE_FIELDS,
  DRIVER_VISIBLE_SECTIONS,
} from "@/lib/consent/driver-visibility";

// Auto-ensure the license scan columns exist (staff routes add them via the same
// inline guard). A driver's own endpoint must not assume a staff route has run.
let migrationRan = false;
async function ensureDriverColumnsExist() {
  if (migrationRan) return;
  try {
    await query(`
      ALTER TABLE drivers
      ADD COLUMN IF NOT EXISTS license_image_url TEXT,
      ADD COLUMN IF NOT EXISTS license_back_image_url TEXT;
    `);
    migrationRan = true;
  } catch (err) {
    console.warn("Driver table column check skipped:", err.message);
  }
}

/**
 * GET /api/driver/me
 *
 * A driver's own profile, scoped to the authenticated session's driver_id. Used
 * by the web driver home and (mirrored by the mobile app) to show the driver
 * only their own data. Sections shown are the DRIVER_VISIBLE_SECTIONS union —
 * both surfaces read the same config so the web and mobile views never diverge.
 *
 * The response carries the driver's consent status for the current privacy
 * policy so the UI can gate personal-data sections behind a terms step.
 */
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    await ensureDriverColumnsExist();

    const { rows } = await query(
      `SELECT e.employee_id, e.email, e.first_name, e.last_name, e.phone, e.avatar_url,
              d.driver_id, d.driver_status, d.license_number, d.license_type,
              d.license_class, d.license_expiry, d.years_of_experience,
              d.face_image_url, d.license_image_url, d.license_back_image_url
         FROM employees e
         JOIN drivers d ON d.employee_id = e.employee_id AND d.deleted_at IS NULL
        WHERE e.employee_id = $1 AND e.deleted_at IS NULL
        LIMIT 1`,
      [session.user.employeeId]
    );

    const driver = rows[0];
    if (!driver) {
      return err("No driver record is linked to this account", 403);
    }

    // Performance from the driver_stats view (computed from completed trips).
    let performance = null;
    try {
      const { rows: stats } = await query(
        `SELECT total_trips, total_distance, total_hours, rating, performance_score
           FROM driver_stats WHERE driver_id = $1 LIMIT 1`,
        [driver.driver_id]
      );
      performance = stats[0] ?? null;
    } catch (e) {
      console.warn("driver_stats lookup skipped:", e);
    }

    // Own trip history.
    const { rows: trips } = await query(
      `SELECT t.trip_id, t.trip_status, r.origin, r.destination, t.start_time, t.end_time,
              v.vehicle_id, v.plate_number, v.model
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
         LEFT JOIN routes r   ON r.route_id = t.route_id
        WHERE t.driver_id = $1 AND t.deleted_at IS NULL
        ORDER BY t.start_time DESC NULLS LAST, t.trip_id DESC
        LIMIT 50`,
      [driver.driver_id]
    );

    // Own attendance history.
    let attendance = [];
    try {
      const { rows: att } = await query(
        `SELECT attendance_id, date, time_in, time_out, status, check_in_method, face_verified
           FROM driverattendance WHERE driver_id = $1 ORDER BY date DESC LIMIT 50`,
        [driver.driver_id]
      );
      attendance = att;
    } catch (e) {
      console.warn("attendance lookup skipped:", e);
    }

    // Assigned (paired) vehicle — the active custodial pairing (migration 017),
    // assigned_until IS NULL = currently assigned. This is the car the driver is
    // responsible for, independent of any one trip; it is what the driver's own
    // profile shows so they know which car to expect.
    let assignedVehicle = null;
    try {
      const { rows: av } = await query(
        `SELECT a.assignment_id, a.assigned_from,
                v.vehicle_id, v.plate_number, v.model, v.vehicle_status,
                v.seating_capacity, v.vehicle_name
           FROM driver_vehicle_assignments a
           JOIN vehicles v ON v.vehicle_id = a.vehicle_id AND v.deleted_at IS NULL
          WHERE a.driver_id = $1 AND a.assigned_until IS NULL
          ORDER BY a.assigned_from DESC
          LIMIT 1`,
        [driver.driver_id]
      );
      assignedVehicle = av[0] ?? null;
    } catch (e) {
      console.warn("driver assigned-vehicle lookup skipped:", e);
    }

    // Consent status for the current privacy policy. The driver_consents table
    // is a planned migration (database-normalization); until it exists, the
    // read falls back to "not accepted" so the gate stays on.
    const { rows: consentRows } = await query(
      `SELECT policy_version, accepted_at, accepted_via
         FROM driver_consents
        WHERE driver_id = $1
        ORDER BY accepted_at DESC
        LIMIT 1`,
      [driver.driver_id]
    ).catch(() => ({ rows: [] }));
    const latest = consentRows[0] ?? null;

    return ok({
      employeeId: driver.employee_id,
      email: driver.email,
      firstName: driver.first_name,
      lastName: driver.last_name,
      phone: driver.phone,
      driverId: driver.driver_id,
      driverStatus: driver.driver_status,
      license: {
        number: driver.license_number,
        type: driver.license_type,
        class: driver.license_class,
        expiry: driver.license_expiry,
        yearsExperience: driver.years_of_experience,
        imageUrl: driver.face_image_url,
        frontScanImageUrl: driver.license_image_url,
        backScanImageUrl: driver.license_back_image_url,
      },
      performance,
      trips,
      attendance,
      assignedVehicle: assignedVehicle
        ? {
            vehicleId: assignedVehicle.vehicle_id,
            plateNumber: assignedVehicle.plate_number,
            model: assignedVehicle.model,
            name: assignedVehicle.vehicle_name,
            vehicleStatus: assignedVehicle.vehicle_status,
            seatingCapacity: assignedVehicle.seating_capacity,
            assignedFrom: assignedVehicle.assigned_from,
          }
        : null,
      consent: {
        acceptedVersion: latest?.policy_version ?? null,
        acceptedAt: latest?.accepted_at ?? null,
        acceptedVia: latest?.accepted_via ?? null,
        requiredVersion: CURRENT_PRIVACY_POLICY_VERSION,
        accepted: latest?.policy_version === CURRENT_PRIVACY_POLICY_VERSION,
        policy: PRIVACY_POLICY,
      },
      editableFields: DRIVER_SELF_EDITABLE_FIELDS,
      visibleSections: DRIVER_VISIBLE_SECTIONS,
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * PATCH /api/driver/me
 *
 * Minimal self-edits on a driver's own profile — only the fields declared in
 * DRIVER_SELF_EDITABLE_FIELDS (phone, face image URL, license scan images).
 * Everything else is read-only; the endpoint rejects any other field.
 *
 * License scan columns are writable at any time (30-day window removed
 * 2026-08-25). The AI authenticity/readability check happens in
 * POST /api/driver/license-scan — which is also what the mobile app uses, since
 * it persists the scan and applies a future-dated expiry in one call.
 */
export async function PATCH(req) {
  try {
    const session = await requireDriver(req);
    const driverId = session.user.driverId;
    await ensureDriverColumnsExist();

    const body = await parseBody(req);

    // Reject anything outside the driver's self-editable whitelist.
    const requested = Object.keys(body);
    const disallowed = requested.filter((k) => !DRIVER_SELF_EDITABLE_FIELDS.includes(k));
    if (disallowed.length > 0) {
      return err(`Driver may not edit: ${disallowed.join(", ")}`, 403);
    }

    const errors = validateBody(body, {
      phone: { type: "phone", label: "Phone" },
      face_image_url: { type: "url", label: "Face image URL" },
      license_image_url: { type: "base64Url", label: "License front scan" },
      license_back_image_url: { type: "base64Url", label: "License back scan" },
      license_expiry: { type: "date", label: "License expiry" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const { rows: drv } = await query(
      `SELECT d.driver_id, d.employee_id
         FROM drivers d
        WHERE d.driver_id = $1 AND d.deleted_at IS NULL
        LIMIT 1`,
      [driverId]
    );
    const driver = drv[0];
    if (!driver) {
      return err("Driver record not found", 404);
    }

    if (body.phone !== undefined) {
      await query(`UPDATE employees SET phone = $1, updated_at = NOW() WHERE employee_id = $2`, [
        normalizePhone(body.phone) || null,
        driver.employee_id,
      ]);
    }
    if (body.face_image_url !== undefined) {
      await query(`UPDATE drivers SET face_image_url = $1, updated_at = NOW() WHERE driver_id = $2`, [
        isUrl(body.face_image_url) ? body.face_image_url : null,
        driver.driver_id,
      ]);
    }
    if (body.license_image_url !== undefined) {
      await query(`UPDATE drivers SET license_image_url = $1, updated_at = NOW() WHERE driver_id = $2`, [
        isBase64DataUrl(body.license_image_url) ? body.license_image_url : null,
        driver.driver_id,
      ]);
    }
    if (body.license_back_image_url !== undefined) {
      await query(`UPDATE drivers SET license_back_image_url = $1, updated_at = NOW() WHERE driver_id = $2`, [
        isBase64DataUrl(body.license_back_image_url) ? body.license_back_image_url : null,
        driver.driver_id,
      ]);
    }
    
    let needsStatusSync = false;
    if (body.license_expiry !== undefined) {
      if (!canUpdateLicenseScan({ ...scanGate, side: "front" })) {
        return err("License expiry is locked. You may only update it along with a new scan.", 403);
      }
      await query(`UPDATE drivers SET license_expiry = $1, updated_at = NOW() WHERE driver_id = $2`, [
        body.license_expiry,
        driver.driver_id,
      ]);
      needsStatusSync = true;
    }

    if (needsStatusSync) {
      await syncDriverStatus(driver.driver_id);
    }

    return ok({ message: "Profile updated" });
  } catch (e) {
    return handleError(e);
  }
}
