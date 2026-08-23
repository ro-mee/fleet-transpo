import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizeName, normalizeEmail, normalizePhone, normalizeLicense } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";
import { suspensionAction } from "@/lib/drivers/compliance";

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
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
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

    return ok({
      ...driver,
      ...stats,
      trips,
      account,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
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
      years_of_experience: { type: "positiveNumber", integer: true, label: "Years of experience" },
      driver_status: { maxLength: 30, label: "Driver status" },
      birthdate: { type: "date", label: "Birthdate" },
      sex: { maxLength: 20, label: "Sex" },
      nationality: { maxLength: 100, label: "Nationality" },
      address: { maxLength: 255, label: "Address" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

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
      `SELECT driver_id, employee_id FROM drivers WHERE driver_id = $1 AND deleted_at IS NULL LIMIT 1`,
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
    if (address !== undefined) driverPayload.address = address || null;
    if (sex !== undefined) driverPayload.sex = sex || null;
    if (birthdate !== undefined) driverPayload.birthdate = birthdate || null;
    if (nationality !== undefined) driverPayload.nationality = nationality || null;
    if (license_image_url !== undefined) driverPayload.license_image_url = license_image_url || null;
    if (license_back_image_url !== undefined) driverPayload.license_back_image_url = license_back_image_url || null;
    if (emergency_contact_name !== undefined) driverPayload.emergency_contact_name = emergency_contact_name || null;
    if (emergency_contact_phone !== undefined) driverPayload.emergency_contact_phone = emergency_contact_phone || null;
    if (emergency_contact_address !== undefined) driverPayload.emergency_contact_address = emergency_contact_address || null;
    driverPayload.updated_at = new Date().toISOString();

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
    if (license_image_url !== undefined) employeePayload.avatar_url = license_image_url || null;
    employeePayload.updated_at = new Date().toISOString();

    // Update linked employee record
    const empKeys = Object.keys(employeePayload);
    if (empKeys.length > 0 && existing.employee_id) {
      const setClause = empKeys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const vals = Object.values(employeePayload);
      await query(
        `UPDATE employees SET ${setClause} WHERE employee_id = $${empKeys.length + 1}`,
        [...vals, existing.employee_id]
      );
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

          // Tell the ops roles the driver is back. Best-effort.
          const { rows: staff } = await query(
            `SELECT employee_id FROM employees
              WHERE role_id IN (SELECT role_id FROM roles WHERE role_name IN ('system_admin','admin','fleet_manager'))
                AND deleted_at IS NULL`
          );
          if (staff.length) {
            const { sendPush } = await import("@/services/push.service");
            await query(
              `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
               SELECT u.employee_id, $2, $3, 'Info', 'driver', $4 FROM unnest($1::int[]) AS u(employee_id)`,
              [staff.map((s) => s.employee_id), "Driver Reinstated",
               `${name}'s license was renewed — compliance suspension lifted and driver is Available again.`, Number(id) || null]
            ).catch(() => {});
            sendPush({
              employeeIds: staff.map((s) => s.employee_id),
              title: "Driver Reinstated",
              body: `${name}'s license renewal lifted the suspension — driver is Available.`,
              data: { reference_type: "driver", reference_id: Number(id) || null },
            }).catch(() => {});
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
    return ok({ ...updatedRows[0], reinstated });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
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
