import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req, { params }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const { rows } = await query(
      `SELECT 
        fr.*,
        row_to_json(v.*) as vehicles,
        json_build_object(
          'driver_id', d.driver_id,
          'license_number', d.license_number,
          'employees', row_to_json(e.*)
        ) as drivers
      FROM fuelrecords fr
      LEFT JOIN vehicles v ON fr.vehicle_id = v.vehicle_id
      LEFT JOIN drivers d ON fr.driver_id = d.driver_id
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      WHERE fr.fuel_record_id = $1 AND fr.deleted_at IS NULL`,
      [id]
    );

    if (!rows.length) return err("Fuel record not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const body = await parseBody(req);

    // Prevent updating fuel_record_id
    delete body.fuel_record_id;
    body.updated_at = new Date().toISOString();

    const keys = Object.keys(body);
    const values = Object.values(body);

    if (keys.length === 0) return err("No fields to update", 400);

    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    values.push(id);

    const { rows } = await query(
      `UPDATE fuelrecords SET ${setClause} WHERE fuel_record_id = $${values.length} RETURNING *`,
      values
    );

    if (!rows.length) return err("Fuel record not found or already deleted", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    await requireAuth(req);
    const { id } = await params;

    const { rows } = await query(
      `UPDATE fuelrecords SET deleted_at = NOW() WHERE fuel_record_id = $1 RETURNING *`,
      [id]
    );

    if (!rows.length) return err("Fuel record not found", 404);
    return ok({ message: "Fuel record archived successfully" });
  } catch (e) { return handleError(e); }
}
