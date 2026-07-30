import { query, getAdminClient } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
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
          'branch_id', e.branch_id,
          'avatar_url', e.avatar_url,
          'branches', json_build_object(
            'branch_id', b.branch_id,
            'branch_name', b.branch_name
          )
        ) AS employees
      FROM drivers d
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      LEFT JOIN branches b ON e.branch_id = b.branch_id
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
        `SELECT t.*, row_to_json(v.*) as vehicles 
         FROM trips t 
         LEFT JOIN vehicles v ON t.vehicle_id = v.vehicle_id 
         WHERE t.driver_id = $1 AND t.deleted_at IS NULL 
         ORDER BY t.created_at DESC LIMIT 20`,
        [id]
      );
      if (tripRows) trips = tripRows;
    } catch (tripErr) {
      console.warn("Driver trips lookup skipped:", tripErr);
    }

    return ok({
      ...driver,
      ...stats,
      trips,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const { id } = await params;
    const body = await parseBody(req);
    const supabase = getAdminClient();

    const {
      license_number,
      license_expiry,
      license_type,
      license_class,
      years_of_experience,
      driver_status,
      license_image_url,
      // Employee updates
      first_name,
      last_name,
      email,
      phone,
      branch_id,
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
    if (license_number !== undefined) driverPayload.license_number = license_number.trim();
    if (license_expiry !== undefined) driverPayload.license_expiry = license_expiry || null;
    if (license_type !== undefined) driverPayload.license_type = license_type || null;
    if (license_class !== undefined) driverPayload.license_class = license_class || null;
    if (years_of_experience !== undefined) driverPayload.years_of_experience = Number(years_of_experience) || 0;
    if (driver_status !== undefined) driverPayload.driver_status = driver_status;
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
    if (first_name !== undefined) employeePayload.first_name = first_name.trim();
    if (last_name !== undefined) employeePayload.last_name = last_name.trim();
    if (email !== undefined) employeePayload.email = email.trim().toLowerCase();
    if (phone !== undefined) employeePayload.phone = phone.trim() || null;
    if (branch_id !== undefined) employeePayload.branch_id = branch_id ? Number(branch_id) : null;
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
          'branch_id', e.branch_id,
          'avatar_url', e.avatar_url,
          'branches', json_build_object(
            'branch_id', b.branch_id,
            'branch_name', b.branch_name
          )
        ) AS employees
      FROM drivers d
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      LEFT JOIN branches b ON e.branch_id = b.branch_id
      WHERE d.driver_id = $1
      LIMIT 1
    `;

    const { rows: updatedRows } = await query(fetchSql, [id]);
    return ok(updatedRows[0]);
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const { id } = await params;

    const { rows: existingRows } = await query(
      `SELECT driver_id FROM drivers WHERE driver_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );

    if (!existingRows || !existingRows[0]) return err("Driver not found", 404);

    const now = new Date().toISOString();

    // Soft delete driver
    await query(`UPDATE drivers SET deleted_at = $1 WHERE driver_id = $2`, [now, id]);

    return ok({ message: "Driver archived successfully" });
  } catch (e) {
    return handleError(e);
  }
}
