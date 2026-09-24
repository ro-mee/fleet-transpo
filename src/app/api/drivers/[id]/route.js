import { query, withTransaction } from "@/lib/db";
import { saveAddress } from "@/services/address.service";
import { resolvePickedAddress } from "@/lib/address/picked";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizeName, normalizeEmail, normalizePhone, normalizeLicense, isAllowedStoredImageRef } from "@/lib/validation/helpers";
import { LEGAL_DRIVING_AGE, isAtLeastAge } from "@/lib/validation/age";
import { signDriverMedia, toStoredMediaRef } from "@/lib/drivers/media";
import { writeAudit } from "@/lib/audit";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";
import { suspensionAction } from "@/lib/drivers/compliance";
import { syncDriverStatus } from "@/services/status.service";
import { notificationRolesFor, dedupeEmployeeIds } from "@/lib/notifications/recipients";
import { driverReinstatedDriver, driverReinstatedStaff } from "@/lib/notifications/copy";

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
  try {
    await requirePermission(req, "drivers", "read_all");
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
                r.role_name AS role, e.password_hash IS NOT NULL AS has_password
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
        };
      }
    } catch (accErr) {
      console.warn("Driver account lookup skipped:", accErr);
    }

    // Media columns hold object keys; resolve them to short-lived URLs for the
    // response. See `lib/drivers/media` — never persist what this returns.
    return ok(
      await signDriverMedia({
        ...driver,
        ...stats,
        trips,
        account,
      })
    );
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req, { params }) {
  try {
    await requirePermission(req, "drivers", "update");
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
    });
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
      `SELECT d.driver_id, d.employee_id, e.email
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
    if (license_type !== undefined) driverPayload.license_type = license_type || null;
    if (license_class !== undefined) driverPayload.license_class = license_class || null;
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
    if (emergency_contact_name !== undefined) driverPayload.emergency_contact_name = emergency_contact_name || null;
    if (emergency_contact_phone !== undefined) driverPayload.emergency_contact_phone = emergency_contact_phone || null;
    if (emergency.value) driverPayload.emergency_contact_address = emergency.value.formattedAddress;
    else if (emergency_contact_address !== undefined) driverPayload.emergency_contact_address = emergency_contact_address || null;
    driverPayload.updated_at = new Date().toISOString();

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
    const savedAddressIds = (residential.value || emergency.value)
      ? await withTransaction(async (tx) => ({
          address_id: residential.value ? await saveAddress(residential.value, { tx }) : null,
          emergency_contact_address_id: emergency.value ? await saveAddress(emergency.value, { tx }) : null,
        }))
      : null;

    // Only the columns whose field was actually picked. Setting one to null
    // because the OTHER was picked would clear an address the operator never
    // touched — the same "omitted is not empty" rule, applied to the id.
    if (residential.value) driverPayload.address_id = savedAddressIds.address_id;
    if (emergency.value) driverPayload.emergency_contact_address_id = savedAddressIds.emergency_contact_address_id;

    // Update driver record via raw SQL query helper
    const driverKeys = Object.keys(driverPayload);
    if (driverKeys.length > 0) {
      const setClause = driverKeys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const vals = Object.values(driverPayload);
      await query(`UPDATE drivers SET ${setClause} WHERE driver_id = $${driverKeys.length + 1}`, [
        ...vals,
        id,
      ]);
    }

    // Build employee update payload
    const employeePayload = {};
    if (first_name !== undefined) employeePayload.first_name = normalizeName(first_name);
    if (last_name !== undefined) employeePayload.last_name = normalizeName(last_name);
    if (email !== undefined) employeePayload.email = normalizeEmail(email);
    if (phone !== undefined) employeePayload.phone = normalizePhone(phone) || null;
    if (position !== undefined) employeePayload.position = position || "Driver";
    if (storedLicenceFront !== undefined) {
      // The allow-list replaced a bare startsWith("http") prefix test, which
      // admitted any host. The 512 cap stays: it is why a multi-megabyte scan
      // data URL has never been copied into employees.avatar_url, and that
      // behaviour must not change here. A stored key passes the allow-list and
      // is far under the cap, so the mirror keeps working now that the licence
      // column holds a key rather than a URL.
      employeePayload.avatar_url = (storedLicenceFront && typeof storedLicenceFront === "string" && storedLicenceFront.length <= 512 && isAllowedStoredImageRef(storedLicenceFront)) ? storedLicenceFront : null;
    }
    employeePayload.updated_at = new Date().toISOString();

    // Update linked employee record
    const empKeys = Object.keys(employeePayload);
    if (empKeys.length > 0 && existing.employee_id) {
      const setClause = empKeys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const vals = Object.values(employeePayload);
      const credentialClause = email !== undefined && normalizeEmail(email) !== normalizeEmail(existing.email)
        ? ", auth_version = auth_version + 1"
        : "";
      await query(
        `UPDATE employees SET ${setClause}${credentialClause} WHERE employee_id = $${empKeys.length + 1}`,
        [...vals, existing.employee_id]
      );
      if (email !== undefined && normalizeEmail(email) !== normalizeEmail(existing.email)) {
        await query(`UPDATE web_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE employee_id = $1 AND revoked_at IS NULL`, [existing.employee_id]);
        await query(`DELETE FROM mobile_refresh_tokens WHERE employee_id = $1`, [existing.employee_id]);
        await query(`DELETE FROM password_reset_tokens WHERE employee_id = $1 AND used_at IS NULL`, [existing.employee_id]);
      }
    }

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
          await query(
            `UPDATE drivers SET driver_status = $1, suspension_reason = NULL, updated_at = NOW()
              WHERE driver_id = $2`,
            ["Available", id]
          );
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
          await writeAudit(req, null, {
            action: "update",
            resource: "drivers",
            resourceId: Number(id) || null,
            oldValues: { driver_status: "Suspended" },
            newValues: { driver_status: "Available", reason: "license renewed — compliance suspension lifted" },
          });
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
    return ok(await signDriverMedia({ ...updatedRows[0], reinstated }));
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req, { params }) {
  try {
    await requirePermission(req, "drivers", "delete");
    const { id } = await params;

    await query(
      `UPDATE drivers SET deleted_at = CURRENT_TIMESTAMP WHERE driver_id = $1`,
      [id]
    );

    return ok({ message: "Driver archived successfully" });
  } catch (e) {
    return handleError(e);
  }
}
