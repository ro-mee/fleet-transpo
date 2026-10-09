import { query, withTransaction } from "@/lib/db";
import { saveAddress, loadStructuredAddress } from "@/services/address.service";
import { resolvePickedAddress } from "@/lib/address/picked";
import { AuthError, requireAuth, requirePermission, parseBody, ok, okWithFullLicense, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizeName, normalizeEmail, normalizePhone, normalizeLicense, isAllowedStoredImageRef } from "@/lib/validation/helpers";
import { LEGAL_DRIVING_AGE, isAtLeastAge } from "@/lib/validation/age";
import { toCalendarDay } from "@/lib/dates";
import { signDriverMedia, toStoredMediaRef } from "@/lib/drivers/media";
import { writeAudit, writeAuditRequired } from "@/lib/audit";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";
import { suspensionAction } from "@/lib/drivers/compliance";
import { syncDriverStatus } from "@/services/status.service";
import { notificationRolesFor, dedupeEmployeeIds } from "@/lib/notifications/recipients";
import { driverReinstatedDriver, driverReinstatedStaff } from "@/lib/notifications/copy";
import { validateLicenseDetails, normalizeLicenseClasses, normalizeLicenseType, licenseCalendarDay } from "@/lib/drivers/license-eligibility";
import { rateLimit } from "@/lib/rate-limit";
import { attachDocumentUpload, documentMetadata, publicUpload } from "@/lib/uploads/document-storage";

// Auto-ensure emergency contact and back license image columns exist in PostgreSQL
let migrationRan = false;
async function ensureDriverColumnsExist() {
  if (migrationRan) return;
  try {
    await query(`
      ALTER TABLE drivers 
      ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS emergency_contact_address TEXT,
      ADD COLUMN IF NOT EXISTS license_image_url TEXT,
      ADD COLUMN IF NOT EXISTS license_back_image_url TEXT;
    `);
    migrationRan = true;
  } catch (err) {
    console.warn("Driver table column check skipped:", err.message);
  }
}

export async function GET(req, { params }) {
  let session = null;
  try {
    session = await requirePermission(req, "drivers", "read_all");
    const revealLicense = new URL(req.url).searchParams.get("include_license") === "1";
    if (revealLicense) await requirePermission(req, "drivers", "update");
    await ensureDriverColumnsExist();
    const { id } = await params;

    const sql = `
      SELECT 
        d.*,
        json_build_object(
          'employee_id', e.employee_id,
          'first_name', e.first_name,
          'last_name', e.last_name,
          'email', e.email,
          'phone', e.phone,
          'position', e.position,
          'avatar_url', e.avatar_url
        ) AS employees
      FROM drivers d
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      WHERE d.driver_id = $1 AND d.deleted_at IS NULL
      LIMIT 1
    `;

    const { rows } = await query(sql, [id]);
    if (!rows || !rows[0]) return err("Driver not found", 404);

    const driver = rows[0];

    // Fetch stats
    let stats = {};
    try {
      const { rows: statsRows } = await query(
        `SELECT * FROM driver_stats WHERE driver_id = $1 LIMIT 1`,
        [id]
      );
      if (statsRows && statsRows[0]) stats = statsRows[0];
    } catch (statsErr) {
      console.warn("Driver stats lookup skipped:", statsErr);
    }

    // Punctuality (All Time) — same definition as the Driver Performance
    // report (operational-reports.js): completed non-deleted trips, measured =
    // server-stamped at_pickup_at + scheduled pickup anchor, geofence
    // overrides excluded from on-time/late. Rate divides by MEASURED only.
    let punctuality = {
      punctuality_completed: 0,
      punctuality_measured: 0,
      punctuality_on_time: 0,
      punctuality_late: 0,
      punctuality_override: 0,
      punctuality_unmeasured: 0,
      punctuality_rate: null,
    };
    try {
      const { rows: punctRows } = await query(
        `SELECT COUNT(t.trip_id)::int AS completed,
          COUNT(*) FILTER (
            WHERE t.at_pickup_at IS NOT NULL
              AND COALESCE(ds.scheduled_departure, tr.pickup_datetime) IS NOT NULL
              AND COALESCE(t.at_pickup_override, FALSE) = FALSE
          )::int AS measured,
          COUNT(*) FILTER (
            WHERE t.at_pickup_at IS NOT NULL
              AND COALESCE(ds.scheduled_departure, tr.pickup_datetime) IS NOT NULL
              AND COALESCE(t.at_pickup_override, FALSE) = FALSE
              AND t.at_pickup_at <= COALESCE(ds.scheduled_departure, tr.pickup_datetime)
                  + ('5 minutes')::interval
          )::int AS on_time,
          COUNT(*) FILTER (
            WHERE t.at_pickup_at IS NOT NULL
              AND COALESCE(ds.scheduled_departure, tr.pickup_datetime) IS NOT NULL
              AND COALESCE(t.at_pickup_override, FALSE) = FALSE
              AND t.at_pickup_at > COALESCE(ds.scheduled_departure, tr.pickup_datetime)
                  + ('5 minutes')::interval
          )::int AS late,
          COUNT(*) FILTER (WHERE COALESCE(t.at_pickup_override, FALSE) = TRUE)::int AS overrides
           FROM trips t
           LEFT JOIN dispatchschedules ds ON ds.dispatch_id = t.dispatch_id
           LEFT JOIN transportation_requests tr ON tr.request_id = ds.request_id
          WHERE t.driver_id = $1 AND t.trip_status = 'Completed' AND t.deleted_at IS NULL`,
        [id]
      );
      const p = punctRows?.[0];
      if (p) {
        const completed = Number(p.completed) || 0;
        const measured = Number(p.measured) || 0;
        const onTime = Number(p.on_time) || 0;
        const late = Number(p.late) || 0;
        const overrides = Number(p.overrides) || 0;
        punctuality = {
          punctuality_completed: completed,
          punctuality_measured: measured,
          punctuality_on_time: onTime,
          punctuality_late: late,
          punctuality_override: overrides,
          punctuality_unmeasured: Math.max(0, completed - measured - overrides),
          punctuality_rate: measured === 0 ? null : Math.round((onTime / measured) * 100),
        };
      }
    } catch (punctErr) {
      console.warn("Driver punctuality lookup skipped:", punctErr);
    }

    // Fetch trip history
    let trips = [];
    try {
      const { rows: tripRows } = await query(
        `SELECT ${TRIPS_SELECT} ${TRIPS_JOINS}
         WHERE t.driver_id = $1 AND t.deleted_at IS NULL
         ORDER BY t.created_at DESC LIMIT 20`,
        [id]
      );
      if (tripRows) trips = tripRows;
    } catch (tripErr) {
      console.warn("Driver trips lookup skipped:", tripErr);
    }

    // Fetch account status for this driver's linked employee
    let account = { employee_id: driver.employee_id, role: "driver", has_password: false };
    try {
      const { rows: empRows } = await query(
        `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.position, e.avatar_url,
                r.role_name AS role, e.password_hash IS NOT NULL AS has_password,
                e.must_change_password, e.temp_credential_expires_at
           FROM employees e
           LEFT JOIN roles r ON r.role_id = e.role_id
          WHERE e.employee_id = $1 LIMIT 1`,
        [driver.employee_id]
      );
      if (empRows && empRows[0]) {
        const row = empRows[0];
        account = {
          employee_id: row.employee_id,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          phone: row.phone,
          position: row.position,
          avatar_url: row.avatar_url,
          role: row.role ?? "driver",
          has_password: Boolean(row.has_password),
          must_change_password: Boolean(row.must_change_password),
          temp_credential_expires_at: row.temp_credential_expires_at,
        };
      }
    } catch (accErr) {
      console.warn("Driver account lookup skipped:", accErr);
    }

    // ── The two saved addresses, reopened for the picker ─────────────────────
    // Best-effort: the loader reports a failure to reopen as a `reason` instead
    // of throwing, because this endpoint ALSO serves the driver detail page and a
    // form that cannot be pre-filled must not take down a view that has nothing
    // to do with editing. The form still opens blank, which is the old behaviour.
    const [residential, emergency] = await Promise.all([
      loadStructuredAddress(driver.address_id),
      loadStructuredAddress(driver.emergency_contact_address_id),
    ]);

    // Media columns hold object keys; resolve them to short-lived URLs for the
    // response. See `lib/drivers/media` — never persist what this returns.
    const uploads = await documentMetadata("drivers", id);
    const documentUploads = {};
    for (const upload of uploads) {
      const column = upload.kind === "license_back" ? "license_back_image_url" : "license_image_url";
      if (`${upload.bucket}/${upload.object_key}` === driver[column]) documentUploads[upload.kind] = publicUpload(upload);
    }
    const responseData = await signDriverMedia({
        ...driver,
        document_uploads: documentUploads,
        ...stats,
        ...punctuality,
        license_expiry: licenseCalendarDay(driver.license_expiry),
        birthdate: toCalendarDay(driver.birthdate),
        trips,
        account,
        // Both keys are always present, so a null `structured_address` never has
        // to be disambiguated by reading a sibling that may be missing.
        structured_address: residential.ok ? residential.value : null,
        structured_address_reason: residential.ok ? null : residential.reason,
        emergency_structured_address: emergency.ok ? emergency.value : null,
        emergency_structured_address_reason: emergency.ok ? null : emergency.reason,
      });
    if (revealLicense) {
      await withTransaction((tx) => writeAuditRequired(tx, req, session, {
        action: "license_full_response_prepared",
        resource: "drivers",
        resourceId: driver.driver_id,
        newValues: { channel: "staff_driver_record", outcome: "prepared" },
      }));
      return okWithFullLicense(responseData);
    }
    const { license_number: _licenseNumber, ...safeResponse } = responseData;
    return ok(safeResponse);
  } catch (e) {
    if (e?.status === 403 && new URL(req.url).searchParams.get("include_license") === "1") {
      const deniedSession = session || await requireAuth(req, ["*"]).catch(() => null);
      if (deniedSession) {
        const limit = await rateLimit(`sensitive-denial:license-full:${deniedSession.user.employeeId}`, { limit: 5, windowMs: 60_000 });
        if (limit.allowed) await writeAudit(req, deniedSession, {
          action: "sensitive_access_denied",
          resource: "drivers",
          resourceId: Number((await params).id) || null,
          newValues: { reason_code: "permission_denied", scope: "full_license" },
        });
      }
    }
    return handleError(e);
  }
}

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "drivers", "update");
    await ensureDriverColumnsExist();
    const { id } = await params;
    const body = await parseBody(req);

    const errors = validateBody(body, {
      first_name: { type: "name", label: "First name", maxLength: 100 },
      last_name: { type: "name", label: "Last name", maxLength: 100 },
      email: { type: "email", label: "Email" },
      phone: { type: "phone", label: "Phone" },
      license_number: { type: "license", label: "License number", maxLength: 30 },
      license_expiry: { type: "date", label: "License expiry" },
      // Same allow-list as POST /api/drivers — see the note there.
      license_image_url: { type: "mediaUrl", label: "License front scan" },
      license_back_image_url: { type: "mediaUrl", label: "License back scan" },
      years_of_experience: { type: "positiveNumber", integer: true, label: "Years of experience" },
      driver_status: { maxLength: 30, label: "Driver status" },
      birthdate: {
        type: "date",
        label: "Birthdate",
        // Same legal-age floor as POST /api/drivers — see the note there.
        validate: (v) =>
          isAtLeastAge(v, LEGAL_DRIVING_AGE)
            ? null
            : `Birthdate must be at least ${LEGAL_DRIVING_AGE} years ago.`,
      },
      sex: { maxLength: 20, label: "Sex" },
      nationality: { maxLength: 100, label: "Nationality" },
      address: { maxLength: 255, label: "Address" },
      emergency_contact_name: { maxLength: 255, label: "Emergency contact name" },
      emergency_contact_phone: { type: "phone", label: "Emergency contact phone" },
      emergency_contact_address: { maxLength: 500, label: "Emergency contact address" },
    });
    Object.assign(errors, validateLicenseDetails(body));
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    // ── The two addresses, in whichever of their two shapes arrived ──────────
    // Same split as POST /api/drivers and as PUT /api/locations: resolution is
    // validation, so it happens before any write, and a refused barangay is a
    // 400 carrying field errors rather than a reason to unwind one.
    //
    // An omitted field resolves to `value: null`, which is what lets an edit
    // that only renames a driver leave both the stored text and the registry row
    // it points at exactly as they are. That is the rule the picker's "send it
    // only when the operator actually picked one" behaviour depends on.
    const residential = await resolvePickedAddress(body, "structured_address");
    if (!residential.ok) return errValidation(residential.errors);
    const emergency = await resolvePickedAddress(body, "emergency_structured_address");
    if (!emergency.ok) return errValidation(emergency.errors);

    const {
      license_number,
      license_expiry,
      license_type,
      license_class,
      years_of_experience,
      driver_status,
      license_image_url,
      license_back_image_url,
      address,
      sex,
      birthdate,
      nationality,
      emergency_contact_name,
      emergency_contact_phone,
      emergency_contact_address,
      // Employee updates
      first_name,
      last_name,
      email,
      phone,
      position,
    } = body;

    // Fetch existing driver to get employee_id
    const { rows: existingRows } = await query(
      `SELECT d.driver_id, d.employee_id, e.email, e.first_name AS employee_first_name,
              e.last_name AS employee_last_name, e.phone AS employee_phone,
              e.position AS employee_position, e.avatar_url AS employee_avatar_url,
              d.license_number, d.driver_status, d.years_of_experience, d.address,
              d.license_expiry::text AS license_expiry,
              d.license_type, d.license_class, d.license_image_url, d.license_back_image_url,
              d.sex, d.birthdate::text AS birthdate, d.nationality,
              d.emergency_contact_name, d.emergency_contact_phone, d.emergency_contact_address,
              d.address_id, d.emergency_contact_address_id, d.license_verified_at,
              d.license_verified_by, d.license_verification_method
         FROM drivers d
         LEFT JOIN employees e ON e.employee_id = d.employee_id
        WHERE d.driver_id = $1 AND d.deleted_at IS NULL
        LIMIT 1`,
      [id]
    );

    if (!existingRows || !existingRows[0]) return err("Driver not found", 404);
    const existing = existingRows[0];

    // Build driver update payload
    const driverPayload = {};
    if (license_number !== undefined) driverPayload.license_number = normalizeLicense(license_number);
    if (license_expiry !== undefined) driverPayload.license_expiry = license_expiry || null;
    if (license_type !== undefined) driverPayload.license_type = normalizeLicenseType(license_type);
    if (license_class !== undefined) driverPayload.license_class = normalizeLicenseClasses(license_class)?.join(", ") || null;
    if (years_of_experience !== undefined) {
      const exp = Number(years_of_experience);
      driverPayload.years_of_experience = Number.isFinite(exp) ? exp : 0;
    }
    if (driver_status !== undefined) driverPayload.driver_status = driver_status;
    // A picked address WINS over the submitted string, for the same reason it
    // does on POST: the server composed it from its own resolution of the
    // barangay code, so the text column and the registry row it is about to
    // point at are guaranteed to describe the same place.
    if (residential.value) driverPayload.address = residential.value.formattedAddress;
    else if (address !== undefined) driverPayload.address = address || null;
    if (sex !== undefined) driverPayload.sex = sex || null;
    if (birthdate !== undefined) driverPayload.birthdate = birthdate || null;
    if (nationality !== undefined) driverPayload.nationality = nationality || null;
    // Canonicalise before anything is written. The reader hands the admin form a
    // short-lived signed URL, and the form submits that back on every save
    // (`drivers/[id]/edit/page.js:116,295`) — storing it would mean the licence
    // image rots when the URL expires, which is the very defect this work exists
    // to close. One canonical value feeds both the driver column and the
    // employee avatar mirror below, so they cannot disagree.
    const storedLicenceFront = toStoredMediaRef(license_image_url, "driver-licenses");
    const storedLicenceBack = toStoredMediaRef(license_back_image_url, "driver-licenses");
    if (storedLicenceFront !== undefined) driverPayload.license_image_url = storedLicenceFront;
    if (storedLicenceBack !== undefined) driverPayload.license_back_image_url = storedLicenceBack;

    const credentialChanged =
      (license_number !== undefined && normalizeLicense(license_number) !== existing.license_number) ||
      (license_expiry !== undefined && (license_expiry || null) !== existing.license_expiry) ||
      (license_type !== undefined && normalizeLicenseType(license_type) !== existing.license_type) ||
      (license_class !== undefined && normalizeLicenseClasses(license_class)?.join(", ") !== existing.license_class) ||
      (storedLicenceFront !== undefined && storedLicenceFront !== existing.license_image_url) ||
      (storedLicenceBack !== undefined && storedLicenceBack !== existing.license_back_image_url);
    if (credentialChanged) {
      driverPayload.license_verified_at = null;
      driverPayload.license_verified_by = null;
      driverPayload.license_verification_method = null;
    }
    if (emergency_contact_name !== undefined) driverPayload.emergency_contact_name = emergency_contact_name || null;
    if (emergency_contact_phone !== undefined) driverPayload.emergency_contact_phone = emergency_contact_phone || null;
    if (emergency.value) driverPayload.emergency_contact_address = emergency.value.formattedAddress;
    else if (emergency_contact_address !== undefined) driverPayload.emergency_contact_address = emergency_contact_address || null;

    // ── The registry rows, before the driver is pointed at them ──────────────
    // One transaction for both addresses, so a driver can never end up pointing
    // at one of the two they picked.
    //
    // A failure here fails the whole request, which is the opposite of what
    // POST /api/drivers does — and deliberately so. There the driver row is
    // already committed by the time this runs (the Supabase client cannot join
    // a `pg` transaction), so the only honest options were a degraded success or
    // unwinding a created account. Here nothing has been written yet, so a hard
    // refusal costs the operator a retry and leaves no half-done state.


    // Keep the driver row, linked employee, credential revocation, and event in
    // one transaction so a required audit failure rolls the edit back.
    await withTransaction(async (tx) => {
    await attachDocumentUpload(tx, session, { uploadId: body.license_front_upload_id, kind: "license_front", recordId: id, ref: storedLicenceFront });
    await attachDocumentUpload(tx, session, { uploadId: body.license_back_upload_id, kind: "license_back", recordId: id, ref: storedLicenceBack });
    if (residential.value) driverPayload.address_id = await saveAddress(residential.value, { tx });
    if (emergency.value) driverPayload.emergency_contact_address_id = await saveAddress(emergency.value, { tx });

    const sameFieldValue = (current, next) => {
      if (current == null || next == null) return current == null && next == null;
      if (current instanceof Date || next instanceof Date) return toCalendarDay(current) === toCalendarDay(next);
      return String(current) === String(next);
    };
    const driverKeys = Object.keys(driverPayload).filter((key) => !sameFieldValue(existing[key], driverPayload[key]));
    if (driverKeys.length) {
      driverKeys.push("updated_at");
    }
    if (driverKeys.length > 0) {
      const setClause = driverKeys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const vals = driverKeys.map((key) => driverPayload[key]);
      const { rows: persistedRows } = await tx.query(
        `UPDATE drivers SET ${setClause} WHERE driver_id = $${driverKeys.length + 1}
         RETURNING sex, license_class, license_type`,
        [...vals, id]
      );
      const persisted = persistedRows[0];
      if (!persisted) throw new AuthError("Driver not found", 404);

      // A successful SQL request is not enough to claim the edit succeeded:
      // these controlled fields must round-trip exactly to what the editor sent.
      // Returning them from the UPDATE makes the check refer to the row that was
      // just written, not a later read that could race another edit.
      const persistedFields = ["sex", "license_class", "license_type"];
      const failedField = persistedFields.find(
        (field) => Object.prototype.hasOwnProperty.call(body, field)
          && persisted[field] !== (driverPayload[field] ?? null)
      );
      if (failedField) {
        console.error(`Driver ${id} update did not persist submitted ${failedField}.`);
        throw new AuthError("Driver changes could not be verified. Reload the driver and try again.", 500);
      }
    }

    // Build employee update payload
    const employeePayload = {};
    if (first_name !== undefined) employeePayload.first_name = normalizeName(first_name);
    if (last_name !== undefined) employeePayload.last_name = normalizeName(last_name);
    if (email !== undefined && email !== null && String(email).trim() !== "") employeePayload.email = normalizeEmail(email);
    if (phone !== undefined) employeePayload.phone = normalizePhone(phone) || null;
    if (position !== undefined) employeePayload.position = position || "Driver";
    if (storedLicenceFront !== undefined && !storedLicenceFront?.startsWith("driver-licenses/drafts/")) {
      // The allow-list replaced a bare startsWith("http") prefix test, which
      // admitted any host. The 512 cap stays: it is why a multi-megabyte scan
      // data URL has never been copied into employees.avatar_url, and that
      // behaviour must not change here. A stored key passes the allow-list and
      // is far under the cap, so the mirror keeps working now that the licence
      // column holds a key rather than a URL.
      employeePayload.avatar_url = (storedLicenceFront && typeof storedLicenceFront === "string" && storedLicenceFront.length <= 512 && isAllowedStoredImageRef(storedLicenceFront)) ? storedLicenceFront : null;
    }
    // Update linked employee record
    const employeeExistingKey = (key) => key === "email" ? "email" : `employee_${key}`;
    const empKeys = Object.keys(employeePayload).filter((key) => !sameFieldValue(existing[employeeExistingKey(key)], employeePayload[key]));
    if (empKeys.length) {
      employeePayload.updated_at = new Date().toISOString();
      empKeys.push("updated_at");
    }
    if (empKeys.length > 0 && existing.employee_id) {
      const setClause = empKeys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const vals = empKeys.map((key) => employeePayload[key]);
      const isEmailChanging = email !== undefined && email !== null && String(email).trim() !== "" && normalizeEmail(email) !== normalizeEmail(existing.email);
      const credentialClause = isEmailChanging
        ? ", auth_version = auth_version + 1"
        : "";
      await tx.query(
        `UPDATE employees SET ${setClause}${credentialClause} WHERE employee_id = $${empKeys.length + 1}`,
        [...vals, existing.employee_id]
      );
      if (isEmailChanging) {
        await tx.query(`UPDATE web_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE employee_id = $1 AND revoked_at IS NULL`, [existing.employee_id]);
        await tx.query(`DELETE FROM mobile_refresh_tokens WHERE employee_id = $1`, [existing.employee_id]);
        await tx.query(`DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`, [existing.employee_id]);
      }
    }

    const changedFields = [...new Set([
      ...driverKeys.filter((key) => key !== "updated_at"),
      ...empKeys.filter((key) => key !== "updated_at"),
    ])];
    if (changedFields.length) {
      await writeAuditRequired(tx, req, session, {
        action: "update",
        resource: "drivers",
        resourceId: Number(id),
        oldValues: { driver_status: existing.driver_status },
        newValues: { changed_fields: changedFields, verification_cleared: credentialChanged },
      });
    }
    });

    // License-renewal reinstatement (gated): saving a valid expiry while the
    // driver carries a compliance suspension ('license_expired') lifts it.
    // Manual/legacy suspensions never auto-restore. An explicit driver_status
    // in this same request wins — the admin said what they meant.
    let reinstated = false;
    if (driver_status === undefined) {
      try {
        const after = await query(
          `SELECT d.driver_status, d.suspension_reason, d.license_expiry,
                  e.first_name || ' ' || e.last_name AS name
             FROM drivers d
             LEFT JOIN employees e ON e.employee_id = d.employee_id
            WHERE d.driver_id = $1 AND d.deleted_at IS NULL`,
          [id]
        );
        // Map the SQL row's snake_case columns onto the helper's camelCase
        // contract — passing the row verbatim silently binds nothing.
        const decision = suspensionAction({
          driverStatus: after.rows[0]?.driver_status,
          suspensionReason: after.rows[0]?.suspension_reason,
          licenseExpiry: after.rows[0]?.license_expiry,
        });
        if (decision.action === "restore") {
          const reinstatement = await withTransaction(async (tx) => {
            const { rows } = await tx.query(
              `UPDATE drivers SET driver_status = $1, suspension_reason = NULL, updated_at = NOW()
                WHERE driver_id = $2 RETURNING driver_id`,
              ["Available", id]
            );
            if (!rows[0]) return false;
            await writeAuditRequired(tx, req, session, {
              action: "driver_status_reinstated",
              resource: "drivers",
              resourceId: Number(id),
              oldValues: { driver_status: after.rows[0]?.driver_status },
              newValues: { status: "Available", reason_code: "license_renewal" },
            });
            return true;
          });
          if (!reinstatement) throw new Error("Driver could not be reinstated");
          reinstated = true;
          const name = after.rows[0]?.name || `Driver #${id}`;

          // Tell the ops roles the driver is back — plus the driver
          // themselves (previously staff-only; the owner never heard).
          // Best-effort.
          const { rows: staff } = await query(
            `SELECT employee_id FROM employees
              WHERE role_id IN (SELECT role_id FROM roles WHERE role_name = ANY($1))
                AND deleted_at IS NULL
                AND role_id IS NOT NULL`,
            [notificationRolesFor("drivers", "update")]
          );
          const { rows: owner } = await query(
            `SELECT e.employee_id FROM drivers d
               JOIN employees e ON e.employee_id = d.employee_id
              WHERE d.driver_id = $1 AND d.deleted_at IS NULL AND e.deleted_at IS NULL`,
            [id]
          );
          const staffRecipients = dedupeEmployeeIds(staff.map((s) => s.employee_id));
          const ownerEmployeeId = owner[0]?.employee_id ?? null;
          // Audience split: staff keep the ops wording; the reinstated driver
          // hears it in their own words, not "compliance suspension lifted".
          const staffCopy = driverReinstatedStaff({ name });
          const ownerCopy = driverReinstatedDriver();
          const inserts = [
            ...staffRecipients.map((employee_id) => ({
              employee_id,
              title: staffCopy.title,
              message: staffCopy.message,
              type: "Info",
              reference_type: "driver",
              reference_id: Number(id) || null,
            })),
            ...(ownerEmployeeId
              ? [{
                  employee_id: ownerEmployeeId,
                  title: ownerCopy.title,
                  message: ownerCopy.message,
                  type: "Info",
                  reference_type: "driver",
                  reference_id: Number(id) || null,
                }]
              : []),
          ];
          if (inserts.length) {
            const { sendPush } = await import("@/services/push.service");
            for (const ins of inserts) {
              await query(
                `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
                 VALUES ($1, $2, $3, 'Info', 'driver', $4)`,
                [ins.employee_id, ins.title, ins.message, Number(id) || null]
              ).catch(() => {});
            }
            if (staffRecipients.length) {
              sendPush({
                employeeIds: staffRecipients,
                title: staffCopy.title,
                body: staffCopy.pushBody,
                data: { reference_type: "driver", reference_id: Number(id) || null },
              }).catch(() => {});
            }
            if (ownerEmployeeId) {
              sendPush({
                employeeIds: [ownerEmployeeId],
                title: ownerCopy.title,
                body: ownerCopy.pushBody,
                data: { reference_type: "driver", reference_id: Number(id) || null },
              }).catch(() => {});
            }
          }
        }
      } catch (complianceErr) {
        console.warn("license-renewal reinstatement skipped:", complianceErr?.message || complianceErr);
      }
    }
    
    // Always sync driver status immediately after updates to ensure compliance suspensions are applied instantly if the license is expired.
    await syncDriverStatus(id);

    // Fetch updated driver via raw SQL query to guarantee clean response
    const fetchSql = `
      SELECT 
        d.*,
        json_build_object(
          'employee_id', e.employee_id,
          'first_name', e.first_name,
          'last_name', e.last_name,
          'email', e.email,
          'phone', e.phone,
          'position', e.position,
          'avatar_url', e.avatar_url
        ) AS employees
      FROM drivers d
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      WHERE d.driver_id = $1
      LIMIT 1
    `;

    const { rows: updatedRows } = await query(fetchSql, [id]);
    if (!updatedRows[0]) return err("Driver not found", 404);
    const updated = await signDriverMedia({
      ...updatedRows[0],
      license_expiry: licenseCalendarDay(updatedRows[0].license_expiry),
      birthdate: toCalendarDay(updatedRows[0].birthdate),
      reinstated,
    });
    const { license_number: _licenseNumber, ...safeUpdated } = updated;
    return ok(safeUpdated);
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await requirePermission(req, "drivers", "delete");
    const id = Number((await params).id);
    const archived = await withTransaction(async (tx) => {
      const { rows: current } = await tx.query(
        `SELECT driver_status FROM drivers WHERE driver_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]
      );
      if (!current[0]) return false;
      const { rows } = await tx.query(
        `UPDATE drivers SET deleted_at = CURRENT_TIMESTAMP WHERE driver_id = $1 AND deleted_at IS NULL RETURNING driver_id`,
        [id]
      );
      if (!rows[0]) return false;
      await writeAuditRequired(tx, req, session, {
        action: "delete", resource: "drivers", resourceId: id,
        oldValues: { driver_status: current[0].driver_status },
        newValues: { deleted_at: true, outcome: "archived" },
      });
      return true;
    });
    if (!archived) return err("Driver not found", 404);

    return ok({ message: "Driver archived successfully" });
  } catch (e) {
    return handleError(e);
  }
}
